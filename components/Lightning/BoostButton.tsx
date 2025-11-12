'use client';

import React, { useState, useEffect } from 'react';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { useNostr } from '@/contexts/NostrContext';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import { Zap, Send, X, Mail, Check } from 'lucide-react';
import confetti from 'canvas-confetti';

interface BoostButtonProps {
  trackId?: string;
  feedId?: string;
  trackTitle?: string;
  artistName?: string;
  valueSplits?: Array<{
    name?: string;
    address: string;
    split: number;
    type: 'node' | 'lnaddress';
  }>;
  lightningAddress?: string; // Primary Lightning Address for this track/artist
  className?: string;
  autoOpen?: boolean; // Auto-open modal without showing button
  onClose?: () => void; // Callback when modal is closed
  feedUrl?: string; // RSS feed URL
  episodeGuid?: string; // Episode GUID
  remoteFeedGuid?: string; // Remote feed GUID
  albumName?: string; // Album name (can be same as trackTitle)
}

export function BoostButton({
  trackId,
  feedId,
  trackTitle,
  artistName,
  valueSplits = [],
  lightningAddress,
  className = '',
  autoOpen = false,
  onClose,
  feedUrl,
  episodeGuid,
  remoteFeedGuid,
  albumName,
}: BoostButtonProps) {
  const [isClient, setIsClient] = useState(false);
  const { isConnected, connect, sendKeysend, sendPayment} = useBitcoinConnect();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated } = useNostr();
  const [showModal, setShowModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // Load saved sender name from localStorage
    const savedName = localStorage.getItem('boostSenderName');
    if (savedName) {
      setSenderName(savedName);
    }
  }, []);

  // Handle autoOpen - check connection first
  useEffect(() => {
    if (autoOpen && isClient) {
      if (isConnected) {
        setShowModal(true);
      } else {
        // Not connected, trigger connection
        connect().then(() => {
          // After successful connection, show the modal
          setShowModal(true);
        }).catch(() => {
          // If connection fails or is cancelled, close the component
          if (onClose) {
            onClose();
          }
        });
      }
    }
  }, [autoOpen, isClient, isConnected]);

  // Don't render on server-side
  if (!isClient) {
    return (
      <button className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-600 text-gray-400 cursor-not-allowed ${className}`}>
        <Zap size={16} />
        Boost
      </button>
    );
  }

  const handleBoost = async () => {
    if (!isConnected) {
      await connect();
      return;
    }
    setShowModal(true);
  };

  const sendBoost = async () => {
    setIsSending(true);
    setError(null);
    setSuccess(false);

    try {
      const amount = parseInt(customAmount);

      if (!amount || amount < 1) {
        setError('Please enter a valid amount (minimum 1 sat)');
        setIsSending(false);
        return;
      }

      let result: { preimage?: string; error?: string } = { error: 'No payment method configured' };

      // Determine payment destination priority:
      // 1. Value splits (if configured) - highest priority
      // 2. Lightning Address (if provided)
      // 3. Node pubkey via keysend

      if (valueSplits && valueSplits.length > 0) {
        // Use value splits for multiple recipients (highest priority)
        result = await sendValueSplitPayments(amount, message);
      } else if (lightningAddress && LNURLService.isLightningAddress(lightningAddress)) {
        // Pay to Lightning Address via LNURL-pay

        try {
          const { invoice } = await LNURLService.payLightningAddress(
            lightningAddress,
            amount,
            message
          );

          result = await sendPayment(invoice);
        } catch (lnurlError) {
          console.error('Lightning Address payment failed:', lnurlError);
          result = { error: `Lightning Address payment failed: ${lnurlError instanceof Error ? lnurlError.message : 'Unknown error'}` };
        }
      } else if (lightningAddress && lightningAddress.length === 66 && (lightningAddress.startsWith('02') || lightningAddress.startsWith('03'))) {
        // Pay to node pubkey via keysend
        try {
          // Debug: Log what values we're receiving
          console.log('🔍 BoostButton values:', {
            feedUrl,
            feedId,
            remoteFeedGuid,
            episodeGuid,
            trackId,
            albumName,
            artistName,
            trackTitle
          });

          // Create Helipad metadata matching exact working format from logs
          const helipadMetadata: any = {
            podcast: artistName || 'Unknown Artist',
            episode: trackTitle || 'Unknown Track',
            action: 'boost',
            app_name: 'StableKraft',
            value_msat: amount * 1000, // Integer as per Helipad spec
            value_msat_total: amount * 1000, // Integer as per Helipad spec
            sender_name: senderName || 'Anonymous',
            name: 'StableKraft',
            app_version: '1.0.0',
            uuid: `boost-${Date.now()}-${Math.floor(Math.random() * 999)}`
          };

          // Add required fields matching exact working format
          if (feedUrl) {
            helipadMetadata.url = feedUrl;
            helipadMetadata.feed = feedUrl; // Working logs show both url and feed fields
          }
          if (feedId) {
            helipadMetadata.feedId = feedId; // Keep as string - working logs show "6590183" not integer
          }
          if (remoteFeedGuid) {
            helipadMetadata.remote_feed_guid = remoteFeedGuid;
          }
          if (episodeGuid || trackId) {
            helipadMetadata.remote_item_guid = episodeGuid || trackId;
            helipadMetadata.episode_guid = episodeGuid || trackId; // Working logs show episode_guid field
          }
          if (albumName) {
            helipadMetadata.album = albumName; // Working logs show album field
          }
          if (message) {
            helipadMetadata.message = message;
          }

          console.log('📋 Final Helipad metadata:', helipadMetadata);

          result = await sendKeysend(lightningAddress, amount, message, helipadMetadata);
        } catch (keysendError) {
          console.error('Keysend payment failed:', keysendError);
          result = { error: `Keysend payment failed: ${keysendError instanceof Error ? keysendError.message : 'Unknown error'}` };
        }
      } else {
        // No V4V data available - no payment should be possible
        result = { error: 'No Value4Value configuration found for this track' };
      }

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);

        // Trigger confetti celebration! 🎉
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });

        // Save sender name to localStorage for future boosts
        if (senderName) {
          localStorage.setItem('boostSenderName', senderName);
        }

        // Send 2 sat platform fee metaboost
        try {
          await sendPlatformFeeMetaboost();
        } catch (feeError) {
          console.warn('Platform fee metaboost failed:', feeError);
          // Don't fail the main payment if the fee fails
        }

        // Log the boost to the database
        await logBoost({
          trackId,
          feedId,
          amount,
          message,
          senderName,
          preimage: result.preimage,
          paymentMethod: valueSplits?.length ? 'value-splits' :
                        lightningAddress ? 'lightning-address' : 'keysend',
        });

        // Post to Nostr if user is authenticated and Nostr integration is enabled
        // Support both track boosts (trackId) and album boosts (feedId)
        if (LIGHTNING_CONFIG.features.nostrIntegration && (trackId || feedId) && isNostrAuthenticated && nostrUser) {
          try {
            // Check if NIP-07 extension is available for signing
            const hasNip07 = typeof window !== 'undefined' && (window as any).nostr;
            
            if (!hasNip07) {
              if (process.env.NODE_ENV === 'development') {
                console.log('ℹ️ Boost not posted to Nostr: NIP-07 extension required');
              }
              return;
            }
            
            // Extension-based login: sign event on client side using NIP-07
            console.log('🔗 Signing boost event with NIP-07 extension...');
            
            let trackData: any = null;
            let finalTrackTitle = trackTitle || albumName || 'track';
            let finalArtistName = artistName || '';
            let finalFeedId = feedId || '';
            let trackImage: string | null = null;
            let finalEpisodeGuid: string | null = episodeGuid || null;
            let finalFeedGuid: string | null = remoteFeedGuid || null;
            
            // Fetch track data if trackId is available
            if (trackId) {
              const trackResponse = await fetch(`/api/music-tracks/${trackId}`);
              if (trackResponse.ok) {
                const trackResult = await trackResponse.json();
                if (trackResult.success && trackResult.data) {
                  trackData = trackResult.data;
                  finalTrackTitle = trackData.title || finalTrackTitle;
                  finalArtistName = trackData.artist || finalArtistName;
                  finalFeedId = trackData.feedId || finalFeedId;
                  trackImage = trackData.image || trackData.itunesImage || trackData.Feed?.image || null;
                  
                  // Extract itemGuid from track (for podcast:item:guid tag)
                  if (!finalEpisodeGuid) {
                    // Try track.guid first (this is the itemGuid)
                    finalEpisodeGuid = trackData.guid || null;
                    
                    // If not found, try v4vValue.itemGuid
                    if (!finalEpisodeGuid && trackData.v4vValue?.itemGuid) {
                      finalEpisodeGuid = trackData.v4vValue.itemGuid;
                    }
                  }
                  
                  // Extract feedGuid from track's v4vValue (for podcast:guid tag)
                  if (!finalFeedGuid && trackData.v4vValue?.feedGuid) {
                    finalFeedGuid = trackData.v4vValue.feedGuid;
                  }
                }
              }
            } else if (feedId) {
              // For album boosts, fetch feed data to get image and guid
              try {
                const feedResponse = await fetch(`/api/feeds/${feedId}`);
                if (feedResponse.ok) {
                  const feedResult = await feedResponse.json();
                  if (feedResult.success && feedResult.data) {
                    const feedData = feedResult.data;
                    trackImage = feedData.image || null;
                    
                    // Extract feed GUID from feed data
                    // The feed.id might be the GUID, or we might need to extract it from the originalUrl
                    if (!finalFeedGuid) {
                      // Try to extract GUID from feed.id if it looks like a GUID
                      // Or use feed.id if it's a full GUID format
                      if (feedData.id && feedData.id.includes('-')) {
                        finalFeedGuid = feedData.id;
                      }
                    }
                  }
                }
              } catch (feedError) {
                // Ignore feed fetch errors
                console.warn('Failed to fetch feed data for image:', feedError);
              }
            }
            
            // Build URL - use track URL if trackId exists, otherwise use album URL
            // Always use production URL for Nostr posts (stablekraft.app)
            // Hardcode stablekraft.app for Nostr posts to ensure correct URLs in published events
            const baseUrl = 'https://stablekraft.app';
            let url: string;
            if (trackId) {
              url = `${baseUrl}/music-tracks/${trackId}`;
            } else if (feedId) {
              url = `${baseUrl}/album/${feedId}`;
            } else {
              url = baseUrl;
            }
            
            // Sanitize title for URL anchor
            const sanitizedTitle = finalTrackTitle
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            const urlWithAnchor = `${url}#${sanitizedTitle}`;
            
            // Build content
            const boostMessage = message || `Auto boost for "${finalTrackTitle}"`;
            const content = `⚡ ${amount} sats • "${finalTrackTitle}"${finalArtistName ? ` by ${finalArtistName}` : ''}\n\n${boostMessage}\n\n🎧 ${urlWithAnchor}`;
            
            // Build tags
            const tags: string[][] = [];
            
            // Add podcast GUID tags if available
            // Use finalEpisodeGuid (from track.guid or v4vValue.itemGuid) for podcast:item:guid
            if (finalEpisodeGuid) {
              tags.push(['k', 'podcast:item:guid']);
              tags.push(['i', `podcast:item:guid:${finalEpisodeGuid}`, urlWithAnchor]);
            }
            
            // Use finalFeedGuid (from remoteFeedGuid prop or v4vValue.feedGuid) for podcast:guid
            if (finalFeedGuid) {
              tags.push(['k', 'podcast:guid']);
              tags.push(['i', `podcast:guid:${finalFeedGuid}`, urlWithAnchor]);
            }
            
            // Add image tag if available (always include if we have it)
            if (trackImage) {
              tags.push(['image', trackImage]);
            }
            
            // Create note template
            const { createNoteTemplate } = await import('@/lib/nostr/events');
            const noteTemplate = createNoteTemplate(content, tags);
            
            // Sign with NIP-07 extension
            const nostr = (window as any).nostr;
            const signedEvent = await nostr.signEvent(noteTemplate);
            
            console.log('✅ Boost event signed with NIP-07:', signedEvent.id.slice(0, 16) + '...');
            
            // Send signed event to API
            const zapResponse = await fetch('/api/nostr/boost', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-nostr-user-id': nostrUser.id,
              },
              body: JSON.stringify({
                trackId: trackId || null,
                feedId: feedId || null,
                amount,
                message,
                paymentHash: result.preimage,
                signedEvent, // Send the signed event (kind 1 note)
              }),
            });

            if (zapResponse.ok) {
              const zapData = await zapResponse.json();
              if (zapData.success && zapData.eventId) {
                const published = zapData.data?.published ?? false;
                if (published) {
                  console.log('✅ Boost posted to Nostr:', zapData.eventId, '(published to relays)');
                } else {
                  console.warn('⚠️ Boost stored but may not have been published to relays:', zapData.eventId);
                }
              }
            } else {
              const errorData = await zapResponse.json().catch(() => ({}));
              console.warn('Failed to post boost to Nostr:', errorData.error || 'Unknown error');
            }
          } catch (nostrError) {
            console.warn('Failed to post boost to Nostr:', nostrError);
            // Don't fail the boost if Nostr posting fails
          }
        }

        // Close modal after success
        setTimeout(() => {
          setShowModal(false);
          setSuccess(false);
          setMessage('');
          setSenderName('');
          setCustomAmount('');
        }, 2000);
      }
    } catch (err) {
      console.error('Boost error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send boost');
    } finally {
      setIsSending(false);
    }
  };

  // Handle value split payments (multiple recipients)
  const sendValueSplitPayments = async (
    totalAmount: number,
    message?: string
  ): Promise<{ preimage?: string; error?: string }> => {
    try {
      // Convert valueSplits to ValueRecipient format
      const recipients = valueSplits.map(split => ({
        name: split.name,
        type: split.type as 'node' | 'lnaddress',
        address: split.address,
        split: split.split,
        fee: false
      }));

      // Debug: Log what values we're receiving for value splits
      console.log('🔍 BoostButton values (value splits):', {
        feedUrl,
        feedId,
        remoteFeedGuid,
        episodeGuid,
        trackId,
        albumName,
        artistName,
        trackTitle
      });

      // Create Helipad metadata matching exact working format from logs
      const helipadMetadata: any = {
        podcast: artistName || 'Unknown Artist',
        episode: trackTitle || 'Unknown Track',
        action: 'boost',
        app_name: 'StableKraft',
        value_msat: totalAmount * 1000, // Integer as per Helipad spec
        value_msat_total: totalAmount * 1000, // Integer as per Helipad spec
        sender_name: senderName || 'Anonymous',
        name: 'StableKraft',
        app_version: '1.0.0',
        uuid: `boost-${Date.now()}-${Math.floor(Math.random() * 999)}`
      };

      // Add required fields matching exact working format
      if (feedUrl) {
        helipadMetadata.url = feedUrl;
        helipadMetadata.feed = feedUrl; // Working logs show both url and feed fields
      }
      if (feedId) {
        helipadMetadata.feedId = feedId; // Keep as string - working logs show "6590183" not integer
      }
      if (remoteFeedGuid) {
        helipadMetadata.remote_feed_guid = remoteFeedGuid;
      }
      if (episodeGuid || trackId) {
        helipadMetadata.remote_item_guid = episodeGuid || trackId;
        helipadMetadata.episode_guid = episodeGuid || trackId; // Working logs show episode_guid field
      }
      if (albumName) {
        helipadMetadata.album = albumName; // Working logs show album field
      }
      if (message) {
        helipadMetadata.message = message;
      }

      console.log('📋 Final Helipad metadata (value splits):', helipadMetadata);

      // Use ValueSplitsService for proper multi-recipient payments
      const result = await ValueSplitsService.sendMultiRecipientPayment(
        recipients,
        totalAmount,
        sendPayment,
        sendKeysend,
        message,
        helipadMetadata
      );

      if (!result.success) {
        return { error: `Multi-recipient payment failed: ${result.errors.join(', ')}` };
      }

      // Return the primary preimage
      return { preimage: result.primaryPreimage };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Value split payment failed' };
    }
  };

  // Send 2 sat platform fee metaboost
  const sendPlatformFeeMetaboost = async (): Promise<void> => {
    const platformFee = LIGHTNING_CONFIG.platform.fee || 2;
    const platformNodePubkey = LIGHTNING_CONFIG.platform.nodePublicKey;
    const platformLightningAddress = 'lushnessprecious644398@getalby.com';

    if (!platformNodePubkey && !platformLightningAddress) {
      console.warn('No platform node pubkey or Lightning Address configured for metaboost');
      return;
    }

    try {
      const metaboostMessage = `Metaboost for ${trackTitle || 'track'} - Platform fee`;
      
      // Try keysend first, fallback to Lightning Address
      if (platformNodePubkey) {
        console.log(`🔑 Attempting keysend to platform node: ${platformNodePubkey}`);
        try {
          // Create Helipad metadata matching exact working format from logs
          const helipadMetadata: any = {
            podcast: artistName || 'Unknown Artist',
            episode: trackTitle || 'Unknown Track',
            action: 'boost',
            app_name: 'StableKraft',
            value_msat: platformFee * 1000, // Integer as per Helipad spec
            value_msat_total: platformFee * 1000, // Integer as per Helipad spec
            sender_name: senderName || 'Anonymous',
            name: 'StableKraft',
            app_version: '1.0.0',
            uuid: `boost-${Date.now()}-${Math.floor(Math.random() * 999)}`
          };

          // Add optional fields matching exact working format
          if (feedUrl) {
            helipadMetadata.url = feedUrl;
            helipadMetadata.feed = feedUrl; // Working logs show both url and feed fields
          }
          if (feedId) {
            helipadMetadata.feedId = feedId; // Keep as string - working logs show "6590183" not integer
          }
          if (episodeGuid || trackId) {
            helipadMetadata.remote_item_guid = episodeGuid || trackId;
            helipadMetadata.episode_guid = episodeGuid || trackId; // Working logs show episode_guid field
          }
          if (albumName) {
            helipadMetadata.album = albumName; // Working logs show album field
          }
          if (metaboostMessage) helipadMetadata.message = metaboostMessage;
          if (remoteFeedGuid) helipadMetadata.remote_feed_guid = remoteFeedGuid;
          await sendKeysend(platformNodePubkey, platformFee, metaboostMessage, helipadMetadata);
          console.log(`✅ Platform fee metaboost sent via keysend: ${platformFee} sats`);
          return;
        } catch (keysendError) {
          console.error('❌ Keysend failed, trying Lightning Address fallback:', keysendError);
        }
      } else {
        console.warn('⚠️ No platform node pubkey configured, using Lightning Address fallback');
      }
      
      // Fallback to Lightning Address
      if (platformLightningAddress) {
        const { invoice } = await LNURLService.payLightningAddress(
          platformLightningAddress,
          platformFee,
          metaboostMessage
        );
        await sendPayment(invoice);
        console.log(`✅ Platform fee metaboost sent via Lightning Address: ${platformFee} sats`);
      }
    } catch (error) {
      console.error('Platform fee metaboost failed:', error);
      throw error;
    }
  };

  const logBoost = async (data: {
    trackId?: string;
    feedId?: string;
    amount: number;
    message?: string;
    senderName?: string;
    preimage?: string;
    paymentMethod?: string;
  }) => {
    try {
      // Determine recipient based on payment method
      let recipient = 'unknown';
      if (valueSplits?.length) {
        recipient = `${valueSplits.length} recipients`;
      } else if (lightningAddress) {
        recipient = lightningAddress;
      }

      // Ensure we always have required fields
      const finalTrackId = data.trackId || trackId || albumName || trackTitle || 'boost-track';
      const finalFeedId = data.feedId || feedId || 'boost-feed';
      
      const logData = {
        trackId: finalTrackId,
        feedId: finalFeedId,
        trackTitle: trackTitle || 'Unknown Track',
        artistName: artistName || 'Unknown Artist',
        amount: data.amount,
        message: data.message || '',
        senderName: data.senderName || '',
        type: data.paymentMethod || 'unknown',
        recipient: recipient,
        preimage: data.preimage,
      };

      // Clean the log data to remove undefined/null values (but keep required fields)
      const cleanLogData = Object.fromEntries(
        Object.entries(logData).filter(([key, value]) => {
          // Always keep required fields even if empty
          if (['trackId', 'amount', 'type', 'recipient'].includes(key)) {
            return true;
          }
          // Filter out undefined/null for optional fields
          return value !== undefined && value !== null;
        })
      );

      const response = await fetch('/api/lightning/log-boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanLogData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Log boost API error:', response.status, errorText);
      }
    } catch (err) {
      console.error('Failed to log boost:', err);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    if (onClose) {
      onClose();
    }
  };

  const handleBoostClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleBoost();
  };

  return (
    <>
      {!autoOpen && (
        <button
          onClick={handleBoostClick}
          className={`flex items-center gap-2 px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg font-semibold transition-colors ${className}`}
          title="Send a boost"
        >
          <Zap className="w-5 h-5" />
          <span>Boost</span>
        </button>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl max-w-md w-full p-6 relative" style={{ transform: 'translate(0, 0)' }}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                Send a Boost ⚡
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {trackTitle && (
              <div className="mb-4 p-3 bg-gray-800 rounded-lg">
                <p className="text-sm text-gray-400">Boosting</p>
                <p className="text-white font-semibold">{trackTitle}</p>
                {artistName && (
                  <p className="text-sm text-gray-400">by {artistName}</p>
                )}

                {/* Payment Method Indicator */}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {lightningAddress && LNURLService.isLightningAddress(lightningAddress) ? (
                    <>
                      <Mail className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400">Lightning Address: {lightningAddress}</span>
                    </>
                  ) : valueSplits && valueSplits.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-yellow-400" />
                        <span className="text-yellow-400">Value splits to {valueSplits.length} recipients:</span>
                      </div>
                      <div className="ml-5 text-xs text-gray-300">
                        {valueSplits.map((split, index) => (
                          <div key={index} className="flex items-center gap-1">
                            <span>{split.name || 'Unknown'}</span>
                            <span className="text-gray-500">({split.split}%)</span>
                            <span className="text-gray-600">-</span>
                            <span className="text-blue-300">
                              {split.type === 'lnaddress' ? split.address : `${split.address.slice(0, 8)}...${split.address.slice(-8)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 text-gray-400" />
                      <span className="text-gray-400">Platform keysend</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Amount Selection */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                Amount (sats)
              </label>
              <input
                type="number"
                placeholder="Enter amount in sats"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                min="1"
                required
              />
            </div>

            {/* Sender Name */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                Your Name (optional)
              </label>
              <input
                type="text"
                placeholder="Enter your name"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value.slice(0, 50))}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                maxLength={50}
              />
              <p className="text-xs text-gray-500 mt-1">
                {senderName.length}/50
              </p>
            </div>

            {/* Message */}
            <div className="mb-6">
              <label className="text-sm text-gray-400 mb-2 block">
                Message (optional)
              </label>
              <textarea
                placeholder={LIGHTNING_CONFIG.boostagram.placeholder}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, LIGHTNING_CONFIG.boostagram.maxLength))}
                className="w-full px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500 resize-none"
                rows={3}
                maxLength={LIGHTNING_CONFIG.boostagram.maxLength}
              />
              <p className="text-xs text-gray-500 mt-1">
                {message.length}/{LIGHTNING_CONFIG.boostagram.maxLength}
              </p>
            </div>

            {/* Error/Success Messages */}
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm">
                ⚡ Boost sent successfully!
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleCloseModal}
                className="flex-1 py-2 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={sendBoost}
                disabled={isSending || !customAmount || parseInt(customAmount) < 1}
                className="flex-1 py-2 px-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-black rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>
                      Send {customAmount} sats
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}