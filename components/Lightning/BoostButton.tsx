'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { useNostr } from '@/contexts/NostrContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import { Zap, Send, X, Mail, Check, ChevronDown, ChevronUp, AlertCircle, Info } from 'lucide-react';
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
  publisherGuid?: string; // Publisher's podcast:guid
  publisherUrl?: string; // URL to publisher page (will be generated if not provided)
  iconOnly?: boolean; // Show only the icon without text (for compact displays)
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
  publisherGuid,
  publisherUrl,
  iconOnly = false,
}: BoostButtonProps) {
  const [isClient, setIsClient] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { isConnected, connect, sendKeysend, sendPayment, supportsKeysend, walletProviderType } = useBitcoinConnect();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated } = useNostr();
  const { settings } = useUserSettings();
  const [showModal, setShowModal] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const [message, setMessage] = useState('');
  const [senderName, setSenderName] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  const [nostrStatus, setNostrStatus] = useState<'idle' | 'connecting' | 'signing' | 'success' | 'failed'>('idle');
  const [paymentStatuses, setPaymentStatuses] = useState<Map<string, { status: 'waiting' | 'pending' | 'sending' | 'success' | 'failed'; error?: string; amount?: number }>>(new Map());
  const [showSplitDetails, setShowSplitDetails] = useState(false);
  const [fetchedValueSplits, setFetchedValueSplits] = useState<typeof valueSplits>([]);
  // Resolved Nostr pubkeys from Lightning Addresses (for tagging musicians in boost posts)
  // These are extracted from Lightning Address NIP-05 verification during payment resolution
  // and used to add p-tags to Nostr boost posts so musicians receive notifications
  const [resolvedMusicianPubkeys, setResolvedMusicianPubkeys] = useState<Array<{ address: string; pubkey: string }>>([]);

  useEffect(() => {
    setIsClient(true);
    setMounted(true);

    // Load sender name from settings (preferred) or localStorage (legacy) or default
    if (settings.defaultBoostName) {
      setSenderName(settings.defaultBoostName);
    } else {
      const savedName = localStorage.getItem('boostSenderName');
      if (savedName) {
        setSenderName(savedName);
      } else {
        setSenderName('StableKraft.app user');
      }
    }

    // Set default boost amount from settings
    if (settings.defaultBoostAmount) {
      setCustomAmount(settings.defaultBoostAmount.toString());
    }

    return () => setMounted(false);
  }, [settings.defaultBoostAmount, settings.defaultBoostName]);

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

  // Track if we've already fetched to prevent repeated fetches
  const hasFetchedRef = useRef(false);
  const lastTrackIdRef = useRef<string | undefined>(undefined);

  // Fetch track v4vValue data if trackId is provided and valueSplits is empty
  useEffect(() => {
    // Reset fetch flag if trackId changes
    if (lastTrackIdRef.current !== trackId) {
      hasFetchedRef.current = false;
      lastTrackIdRef.current = trackId;
    }

    // Skip if already fetched for this trackId
    if (hasFetchedRef.current) return;

    // Skip if trackId looks like a composite ID (contains '-https' or multiple UUIDs)
    const isCompositeId = trackId && (trackId.includes('-https') || trackId.split('-').length > 5);

    if (trackId && !isCompositeId && valueSplits.length === 0) {
      hasFetchedRef.current = true; // Mark as fetched before async call to prevent duplicates

      fetch(`/api/music-tracks/${trackId}`)
        .then(res => {
          if (!res.ok) {
            // Only log 404s in development
            if (process.env.NODE_ENV === 'development' && res.status === 404) {
              console.warn(`Track not found: ${trackId}`);
            }
            return null;
          }
          return res.json();
        })
        .then(response => {
          if (!response) return;

          if (response.success && response.data?.v4vValue) {
            // Parse v4vValue to extract recipients
            const v4v = response.data.v4vValue;

            // Handle both old format (recipients) and new format (destinations)
            const recipientsList = v4v.recipients || v4v.destinations || [];

            // Filter out fee recipients and convert to our format
            const splits = recipientsList
              .filter((r: any) => !r.fee)
              .map((r: any) => ({
                name: r.name || 'Unknown',
                type: r.type || 'node',
                address: r.address,
                split: Number(r.split) || 0
              }));

            if (splits.length > 0) {
              setFetchedValueSplits(splits);
            }
          }
        })
        .catch(err => {
          // Silently fail - don't spam console
          if (process.env.NODE_ENV === 'development') {
            console.error('Failed to fetch track v4vValue:', err.message);
          }
        });
    }
  }, [trackId, valueSplits.length]); // Only depend on valueSplits.length, not the array itself

  // Use fetched value splits if available, otherwise use prop value splits
  const activeValueSplits = fetchedValueSplits.length > 0 ? fetchedValueSplits : valueSplits;

  // Check if valid V4V payment info exists
  const hasValidV4V = (activeValueSplits && activeValueSplits.length > 0) || !!lightningAddress;

  // Don't render on server-side
  if (!isClient) {
    return (
      <button className={`flex items-center ${iconOnly ? 'justify-center p-2' : 'gap-2 px-4 py-2'} rounded-lg bg-gray-600 text-gray-400 cursor-not-allowed ${className}`}>
        <Zap size={iconOnly ? 20 : 16} />
        {!iconOnly && <span>Boost</span>}
      </button>
    );
  }

  const handleBoost = async () => {
    if (!isConnected) {
      await connect();
      return;
    }
    // Reset states for clean modal open
    setError(null);
    setSuccess(false);
    setIsSending(false);
    setNostrError(null);
    setNostrStatus('idle');
    setPaymentStatuses(new Map());
    setShowModal(true);
  };

  const sendBoost = async () => {
    setIsSending(true);
    setError(null);
    setSuccess(false);
    setNostrError(null);
    setNostrStatus('idle');

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

      // Store resolved musician pubkeys for Nostr tagging (passed directly, not via state)
      let musicianPubkeysForNostr: Array<{ address: string; pubkey: string }> = [];

      if (activeValueSplits && activeValueSplits.length > 0) {
        // Use value splits for multiple recipients (highest priority)
        const valueSplitResult = await sendValueSplitPayments(amount, message);
        result = valueSplitResult;
        if (valueSplitResult.resolvedPubkeys) {
          musicianPubkeysForNostr = valueSplitResult.resolvedPubkeys;
        }
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
          paymentMethod: activeValueSplits?.length ? 'value-splits' :
                        lightningAddress ? 'lightning-address' : 'keysend',
        });

        // Post to Nostr if user is authenticated and Nostr integration is enabled
        // Support both track boosts (trackId) and album boosts (feedId)
        console.log('🔍 Boost: Checking Nostr posting conditions:', {
          nostrIntegrationEnabled: LIGHTNING_CONFIG.features.nostrIntegration,
          hasTrackId: !!trackId,
          hasFeedId: !!feedId,
          isNostrAuthenticated,
          hasNostrUser: !!nostrUser,
          nostrUserNpub: nostrUser?.nostrNpub?.slice(0, 16) + '...',
        });

        // Reset Nostr status
        setNostrError(null);
        setNostrStatus('idle');

        if (LIGHTNING_CONFIG.features.nostrIntegration && (trackId || feedId) && isNostrAuthenticated && nostrUser) {
          console.log('✅ Boost: All conditions met, proceeding to post to Nostr...');
          setNostrStatus('connecting');
          try {
            // Check if unified signer is available (supports NIP-07, NIP-46, and NIP-55)
            const { getUnifiedSigner } = await import('@/lib/nostr/signer');
            const signer = getUnifiedSigner();

            console.log('🔍 Boost: Signer status:', {
              isAvailable: signer.isAvailable(),
              signerType: signer.getSignerType(),
              loginType: localStorage.getItem('nostr_login_type'),
            });
            
            // Ensure signer is available, attempting reconnection if needed
            const { ensureSignerAvailable, verifyNIP46Connection } = await import('@/lib/nostr/signer-reconnect');
            const reconnectResult = await ensureSignerAvailable();

            if (!reconnectResult.success) {
              console.error('❌ Boost: Signer not available:', reconnectResult.error);
              setNostrError(reconnectResult.error || 'Signer not available. Please try reconnecting.');
              setNostrStatus('failed');
              return;
            }

            const signerType = signer.getSignerType();
            
            // Sign event using unified signer (works with NIP-07, NIP-46, and NIP-55)
            console.log(`🔗 Signing boost event with ${signerType || 'unified'} signer...`);
            
            let trackData: any = null;
            let finalTrackTitle = trackTitle || albumName || 'track';
            let finalArtistName = artistName || '';
            let finalFeedId = feedId || '';
            let trackImage: string | null = null;
            let finalEpisodeGuid: string | null = episodeGuid || null;
            let finalFeedGuid: string | null = remoteFeedGuid || null;
            let finalPublisherGuid: string | null = publisherGuid || null;
            let finalPublisherUrl: string | null = publisherUrl || null;

            // Fetch track data if trackId is available
            let actualAlbumName = albumName; // Keep original albumName as fallback
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
                  
                  // Extract feedGuid from track's Feed (for podcast:guid tag)
                  // Try Feed.guid first (the real RSS podcast:guid), then fall back to v4vValue.feedGuid
                  if (!finalFeedGuid) {
                    finalFeedGuid = trackData.feedGuid || trackData.v4vValue?.feedGuid || null;
                  }
                  
                  // Get the correct album name from the feed data if available
                  if (trackData.feedId && trackData.Feed?.title) {
                    actualAlbumName = trackData.Feed.title;
                  }
                }
              }
            }

            // Always try feed API as fallback to get missing data (image, album name, guid)
            if ((!trackImage || !actualAlbumName) && finalFeedId) {
              try {
                const feedResponse = await fetch(`/api/feeds/${finalFeedId}`);
                if (feedResponse.ok) {
                  const feedResult = await feedResponse.json();
                  if (feedResult.success && feedResult.data) {
                    const feedData = feedResult.data;
                    
                    // Set image if not available
                    if (!trackImage) {
                      trackImage = feedData.image || null;
                    }

                    // Extract feed GUID from feed data (the real RSS podcast:guid)
                    if (!finalFeedGuid && feedData.guid) {
                      finalFeedGuid = feedData.guid;
                    }
                    
                    // Get actual album name from feed if we don't have it yet
                    if (!actualAlbumName && feedData.title) {
                      actualAlbumName = feedData.title;
                      console.log('🏷️ Got album name from feed:', actualAlbumName);
                    }
                  }
                }
              } catch (feedError) {
                // Ignore feed fetch errors
                console.warn('Failed to fetch feed data:', feedError);
              }
            }
            
            // Build URL - use track URL if trackId exists, otherwise use album URL
            // Always use production URL for Nostr posts (stablekraft.app)
            // Hardcode stablekraft.app for Nostr posts to ensure correct URLs in published events
            const baseUrl = 'https://stablekraft.app';
            let url: string;

            // Always generate URL from track's actual album name (not current page URL)
            // This ensures correct URL when shuffle mode plays a track from a different album
            if (feedId || finalFeedId) {
              const { generateAlbumSlug } = await import('@/lib/url-utils');
              // Use the correct album name we fetched from feed data
              const albumSlug = generateAlbumSlug(actualAlbumName || finalTrackTitle);
              // Include track parameter if trackId is available for direct track linking
              const trackParam = trackId ? `?track=${trackId}` : '';
              url = `${baseUrl}/album/${albumSlug}${trackParam}`;
              console.log('🔗 Generated album URL from actual album name:', { 
                actualAlbumName, 
                originalAlbumName: albumName, 
                finalUrl: url 
              });
            } else if (trackId) {
              url = `${baseUrl}/music-tracks/${trackId}`;
              console.log('🔗 Using track URL:', url);
            } else {
              url = baseUrl;
              console.log('🔗 Using base URL:', url);
            }
            
            // For the 'r' tag, we'll use the URL with track parameter (no anchor needed)
            const urlWithAnchor = url;
            
            // Build content (Fountain-style format)
            // Include @npub mentions for musicians if we have their Nostr pubkeys
            let musicianMentions = '';
            if (musicianPubkeysForNostr.length > 0) {
              // Deduplicate pubkeys and convert to npub format
              const { nip19 } = await import('nostr-tools');
              const uniquePubkeys = [...new Map(musicianPubkeysForNostr.map(p => [p.pubkey, p])).values()];
              const npubMentions = uniquePubkeys
                .map(({ pubkey }) => `nostr:${nip19.npubEncode(pubkey)}`)
                .join(' ');
              musicianMentions = `\n\n${npubMentions}`;
            }

            // Only include message if user provided one
            const content = message
              ? `⚡ ${amount} sats • "${finalTrackTitle}"${finalArtistName ? ` by ${finalArtistName}` : ''}\n\n${message}${musicianMentions}\n\n${url}`
              : `⚡ ${amount} sats • "${finalTrackTitle}"${finalArtistName ? ` by ${finalArtistName}` : ''}${musicianMentions}\n\n${url}`;
            
            // Build tags
            const tags: string[][] = [];

            // Add standard tags FIRST (amount, preimage, image, URL)
            // These are more widely supported and should appear before podcast identifiers
            tags.push(['amount', (amount * 1000).toString()]); // Amount in millisats

            if (result.preimage) {
              tags.push(['preimage', result.preimage]);
            }

            // Add image tag if available (always include if we have it)
            if (trackImage) {
              tags.push(['image', trackImage]);
            }

            // Add URL reference tag (NIP-18) - more widely supported than 'i' tags
            tags.push(['r', urlWithAnchor]);

            // Add podcast GUID tags at the END (NIP-73 external identifiers)
            // These come last to avoid clients misinterpreting them as "reply to" markers
            // Use finalEpisodeGuid (from track.guid or v4vValue.itemGuid) for podcast:item:guid
            if (finalEpisodeGuid) {
              tags.push(['i', `podcast:item:guid:${finalEpisodeGuid}`]);
            }

            // Use finalFeedGuid (from remoteFeedGuid prop or v4vValue.feedGuid) for podcast:guid
            if (finalFeedGuid) {
              tags.push(['i', `podcast:guid:${finalFeedGuid}`]);
            }

            // Add podcast:publisher:guid tag if available
            if (finalPublisherGuid) {
              // Generate publisher URL if not provided
              if (!finalPublisherUrl && isClient) {
                // Use generatePublisherUrl utility
                const { generatePublisherUrl } = await import('@/lib/url-utils');
                const publisherPath = generatePublisherUrl({ feedGuid: finalPublisherGuid });
                finalPublisherUrl = `${baseUrl}${publisherPath}`;
              }

              // Use full publisher URL with base URL
              const publisherFullUrl = finalPublisherUrl || `${baseUrl}/publisher/${finalPublisherGuid}`;
              tags.push(['i', `podcast:publisher:guid:${finalPublisherGuid}`]);
            }

            // Add p-tags for musician notifications (resolved from Lightning Address NIP-05/Nostr info)
            // These pubkeys were extracted during Lightning Address resolution via resolveLightningAddressDetails()
            // This notifies musicians on Nostr when they're boosted, enabling social discovery
            // Note: p-tags use hex pubkeys per NIP-01 (not npub bech32 format)
            // Self-tagging is allowed - musicians may be in their own splits and want to see the notification
            if (musicianPubkeysForNostr.length > 0) {
              // Deduplicate pubkeys to avoid duplicate p-tags
              const uniquePubkeysForTags = [...new Map(musicianPubkeysForNostr.map(p => [p.pubkey, p])).values()];
              for (const { address, pubkey } of uniquePubkeysForTags) {
                tags.push(['p', pubkey]);
                console.log(`🔔 Added p-tag for musician notification: ${address} → ${pubkey.slice(0, 16)}...`);
              }
            }

            // Create note template
            const { createNoteTemplate } = await import('@/lib/nostr/events');
            const noteTemplate = createNoteTemplate(content, tags);

            console.log('🔍 Boost: Note template created:', {
              contentPreview: content.slice(0, 100) + '...',
              tagCount: tags.length,
              tags: tags.map(t => `[${t[0]}, ${t[1]?.slice(0, 30)}...]`),
            });

            // Sign with unified signer (already obtained above)
            console.log('🔏 Boost: Signing event with', signer.getSignerType(), '...');
            console.log('🔍 Boost: Final signer check before signing:', {
              isAvailable: signer.isAvailable(),
              signerType: signer.getSignerType(),
              hasActiveSigner: !!signer,
            });
            
            setNostrStatus('signing');
            let signedEvent;
            try {
              // Add timeout for signing (30 seconds should be enough)
              const signPromise = signer.signEvent(noteTemplate as any);
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Signing timeout after 30 seconds')), 30000)
              );
              
              signedEvent = await Promise.race([signPromise, timeoutPromise]) as any;
            } catch (signError) {
              console.error('❌ Boost: Failed to sign event:', signError);
              const errorMessage = signError instanceof Error ? signError.message : String(signError);
              console.error('❌ Sign error details:', {
                message: errorMessage,
                signerType: signer.getSignerType(),
                isAvailable: signer.isAvailable(),
                errorName: signError instanceof Error ? signError.name : 'Unknown',
                errorStack: signError instanceof Error ? signError.stack : undefined,
              });
              
              // If it's a NIP-46/nsecBunker signer, check connection status
              if (signerType === 'nip46' || signerType === 'nsecbunker') {
                const nip46Client = signer.getNIP46Client();
                if (nip46Client) {
                  console.error('❌ Boost: NIP-46/nsecBunker connection status after error:', {
                    isConnected: nip46Client.isConnected(),
                    hasConnection: !!nip46Client.getConnection(),
                    pubkey: nip46Client.getPubkey()?.slice(0, 16) + '...' || 'N/A',
                  });
                }
              }
              
              // Set user-visible error
              if (errorMessage.includes('timeout')) {
                setNostrError('Signing timed out. Amber may not be responding. Please check that Amber is open and try again.');
              } else if (errorMessage.includes('not available') || errorMessage.includes('disconnected')) {
                setNostrError('Connection lost. Please try reconnecting with Amber.');
              } else {
                setNostrError(`Signing failed: ${errorMessage}. Please try reconnecting with Amber.`);
              }
              setNostrStatus('failed');
              return;
            }

            console.log('✅ Boost: Event signed successfully:', {
              eventId: signedEvent.id.slice(0, 16) + '...',
              pubkey: signedEvent.pubkey.slice(0, 16) + '...',
              kind: signedEvent.kind,
            });

            // Send signed event to API
            console.log('📤 Boost: Sending to /api/nostr/boost...');
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

            console.log('📥 Boost: API response status:', zapResponse.status);

            if (zapResponse.ok) {
              const zapData = await zapResponse.json();
              console.log('📥 Boost: API response data:', zapData);

              if (zapData.success && zapData.eventId) {
                const published = zapData.published ?? false;
                if (published) {
                  console.log('✅ Boost posted to Nostr successfully:', {
                    eventId: zapData.eventId,
                    published: true,
                    relayResults: zapData.data?.relayResults,
                  });
                  setNostrStatus('success');
                } else {
                  console.warn('⚠️ Boost stored but may not have been published to relays:', {
                    eventId: zapData.eventId,
                    published: false,
                    relayResults: zapData.data?.relayResults,
                  });
                  setNostrError('Boost stored but may not have been published to Nostr relays.');
                  setNostrStatus('failed');
                }
              } else {
                console.error('❌ Boost: API returned success=false:', zapData);
                setNostrError(zapData.error || 'Failed to post boost to Nostr.');
                setNostrStatus('failed');
              }
            } else {
              const errorData = await zapResponse.json().catch(() => ({}));
              console.error('❌ Boost: API request failed:', {
                status: zapResponse.status,
                statusText: zapResponse.statusText,
                error: errorData.error || 'Unknown error',
                errorData,
              });
              setNostrError(errorData.error || `API error: ${zapResponse.statusText}`);
              setNostrStatus('failed');
            }
          } catch (nostrError) {
            console.error('❌ Boost: Exception during Nostr posting:', {
              error: nostrError instanceof Error ? nostrError.message : String(nostrError),
              stack: nostrError instanceof Error ? nostrError.stack : undefined,
            });

            // Provide helpful error messages based on the error
            const errorMessage = nostrError instanceof Error ? nostrError.message : String(nostrError);

            if (errorMessage.includes('iOS') || errorMessage.includes('not supported')) {
              setNostrError('NIP-55 is not supported on iOS. Please log out and reconnect using NIP-46 (Nostr Connect).');
            } else if (errorMessage.includes('No signer available')) {
              setNostrError('No Nostr signer available. Please connect a Nostr wallet (NIP-07 extension, NIP-46, or NIP-55).');
            } else {
              setNostrError(`Failed to post to Nostr: ${errorMessage}. Please try reconnecting with Amber.`);
            }
            setNostrStatus('failed');

            // Don't fail the boost if Nostr posting fails
          }
        } else {
          console.log('⏭️ Boost: Skipping Nostr posting - one or more conditions not met');
        }

        // Trigger confetti celebration after everything is complete! 🎉
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });

        // Close modal after success
        setTimeout(() => {
          setShowModal(false);
          setSuccess(false);
          setMessage('');
          // Reset amount to default from settings
          if (settings.defaultBoostAmount) {
            setCustomAmount(settings.defaultBoostAmount.toString());
          } else {
            setCustomAmount('');
          }
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
  ): Promise<{ preimage?: string; error?: string; resolvedPubkeys?: Array<{ address: string; pubkey: string }> }> => {
    try {
      // Convert valueSplits to ValueRecipient format
      // Ensure split is numeric to prevent string concatenation bugs in calculations
      const recipients = activeValueSplits.map(split => ({
        name: split.name,
        type: split.type as 'node' | 'lnaddress',
        address: split.address,
        split: Number(split.split) || 0,
        fee: false,
        keysendFallback: undefined as { pubkey: string; customKey?: string; customValue?: string } | undefined,
        nostrPubkey: undefined as string | undefined
      }));

      // Resolve Lightning Addresses to get keysend fallback and Nostr info
      // This enables:
      // 1. Keysend-first payments (preferred for Helipad metadata support in podcast apps)
      // 2. Nostr musician tagging (extracts pubkeys from NIP-05 verification for p-tags in boost posts)
      const resolvedNostrPubkeys: Array<{ address: string; pubkey: string }> = [];

      for (const recipient of recipients) {
        if (recipient.type === 'lnaddress' && LNURLService.isLightningAddress(recipient.address)) {
          try {
            console.log(`🔍 Resolving Lightning Address details for ${recipient.address}...`);
            const details = await LNURLService.resolveLightningAddressDetails(recipient.address);

            // Add keysend fallback info if available AND wallet supports keysend
            // Keysend enables Helipad metadata support, which is preferred for podcast apps
            // Skip for wallets that don't support keysend (e.g., Cashu) to avoid unnecessary attempts
            if (supportsKeysend && details.keysend?.status === 'OK' && details.keysend.pubkey) {
              recipient.keysendFallback = {
                pubkey: details.keysend.pubkey,
                customKey: details.keysend.customData?.[0]?.customKey,
                customValue: details.keysend.customData?.[0]?.customValue
              };
              console.log(`✅ Got keysend fallback for ${recipient.address}: ${details.keysend.pubkey.slice(0, 20)}...`);
            }

            // Extract Nostr pubkey for tagging musicians in boost posts
            // This comes from NIP-05 verification data in the Lightning Address details
            if (details.nostr?.names) {
              const [username] = recipient.address.split('@');
              const nostrPubkey = details.nostr.names[username];
              if (nostrPubkey) {
                recipient.nostrPubkey = nostrPubkey;
                resolvedNostrPubkeys.push({ address: recipient.address, pubkey: nostrPubkey });
                console.log(`✅ Got Nostr pubkey for ${recipient.address}: ${nostrPubkey.slice(0, 16)}...`);
              }
            }
          } catch (error) {
            // Non-fatal: continue without keysend fallback or Nostr tagging
            console.warn(`⚠️ Failed to resolve details for ${recipient.address}:`, error);
          }
        }
      }

      // Store resolved Nostr pubkeys for use in Nostr post tags
      if (resolvedNostrPubkeys.length > 0) {
        setResolvedMusicianPubkeys(resolvedNostrPubkeys);
      }

      // Initialize payment statuses for all recipients to 'waiting' (no icon shown)
      // Status will change to 'sending' when each payment starts
      // Use name|address as key since multiple recipients may share the same node address
      const initialStatuses = new Map(recipients.map(r => [
        `${r.name || 'Unknown'}|${r.address}`,
        { status: 'waiting' as const, amount: 0 }
      ]));
      setPaymentStatuses(initialStatuses);

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

      // Progress callback to update UI as each payment completes
      // recipientKey is in format "name|address" to handle multiple recipients with same address
      const onProgress = (recipientKey: string, status: 'sending' | 'success' | 'failed', error?: string, amount?: number) => {
        setPaymentStatuses(prev => {
          const updated = new Map(prev);
          updated.set(recipientKey, { status, error, amount });
          return updated;
        });
      };

      // Use ValueSplitsService for proper multi-recipient payments
      // Pass wallet type so delays can be adjusted (Coinos needs longer delays than Alby)
      const result = await ValueSplitsService.sendMultiRecipientPayment(
        recipients,
        totalAmount,
        sendPayment,
        sendKeysend,
        message,
        helipadMetadata,
        onProgress,
        walletProviderType
      );

      if (!result.success) {
        // Check if any errors are keysend-related for cleaner messaging
        const keysendErrors = result.errors.filter(e => e.toLowerCase().includes('keysend'));
        if (keysendErrors.length > 0) {
          return { error: 'Keysend is not supported by your wallet. Try Alby or Coinos via NWC.', resolvedPubkeys: resolvedNostrPubkeys };
        }
        return { error: result.errors.join(', '), resolvedPubkeys: resolvedNostrPubkeys };
      }

      // Return the primary preimage and resolved Nostr pubkeys for tagging
      return { preimage: result.primaryPreimage, resolvedPubkeys: resolvedNostrPubkeys };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Value split payment failed' };
    }
  };

  // Send 2 sat platform fee metaboost via keysend (preferred) or Lightning Address (fallback)
  const sendPlatformFeeMetaboost = async (): Promise<void> => {
    const platformFee = LIGHTNING_CONFIG.platform.fee || 2;
    const platformLightningAddress = 'lushnessprecious644398@getalby.com';

    try {
      const metaboostMessage = `Metaboost for ${trackTitle || 'track'} - Platform fee`;

      // Try keysend first for Helipad metadata support
      if (supportsKeysend) {
        try {
          console.log(`🔍 Resolving keysend info for platform fee: ${platformLightningAddress}`);
          const details = await LNURLService.resolveLightningAddressDetails(platformLightningAddress);

          if (details.keysend?.status === 'OK' && details.keysend.pubkey) {
            console.log(`✅ Got keysend pubkey for platform fee: ${details.keysend.pubkey.slice(0, 20)}...`);

            // Create Helipad metadata for platform fee
            const helipadMetadata: any = {
              podcast: artistName || 'Unknown Artist',
              episode: trackTitle || 'Unknown Track',
              action: 'boost',
              app_name: 'StableKraft',
              value_msat: platformFee * 1000,
              value_msat_total: platformFee * 1000,
              sender_name: senderName || 'Anonymous',
              name: 'StableKraft',
              app_version: '1.0.0',
              uuid: `metaboost-${Date.now()}-${Math.floor(Math.random() * 999)}`
            };

            if (feedUrl) {
              helipadMetadata.url = feedUrl;
              helipadMetadata.feed = feedUrl;
            }
            if (remoteFeedGuid) {
              helipadMetadata.remote_feed_guid = remoteFeedGuid;
            }
            if (episodeGuid || trackId) {
              helipadMetadata.remote_item_guid = episodeGuid || trackId;
              helipadMetadata.episode_guid = episodeGuid || trackId;
            }
            if (metaboostMessage) {
              helipadMetadata.message = metaboostMessage;
            }

            const result = await sendKeysend(details.keysend.pubkey, platformFee, metaboostMessage, helipadMetadata);
            if (!result.error) {
              console.log(`✅ Platform fee sent via keysend: ${platformFee} sats`);
              return;
            }
            console.warn(`⚠️ Keysend failed for platform fee, falling back to LNURL:`, result.error);
          }
        } catch (keysendError) {
          console.warn(`⚠️ Keysend lookup failed for platform fee, falling back to LNURL:`, keysendError);
        }
      }

      // Fallback to Lightning Address (LNURL)
      const { invoice } = await LNURLService.payLightningAddress(
        platformLightningAddress,
        platformFee,
        metaboostMessage
      );
      await sendPayment(invoice);
      console.log(`✅ Platform fee sent via Lightning Address: ${platformFee} sats`);
    } catch (error) {
      console.error('Platform fee payment failed:', error);
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
      if (activeValueSplits?.length) {
        recipient = `${activeValueSplits.length} recipients`;
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

    // Reset amount to default from settings
    if (settings.defaultBoostAmount) {
      setCustomAmount(settings.defaultBoostAmount.toString());
    } else {
      setCustomAmount('');
    }

    // Clear all states for clean re-open
    setMessage('');
    setError(null);
    setSuccess(false);
    setIsSending(false);
    setNostrError(null);
    setNostrStatus('idle');
    setPaymentStatuses(new Map());

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
          className={`flex items-center ${iconOnly ? 'justify-center p-2' : 'gap-2 px-4 py-2'} bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg font-semibold transition-colors ${className}`}
          title="Send a boost"
        >
          <Zap className={iconOnly ? "w-5 h-5" : "w-5 h-5"} />
          {!iconOnly && <span>Boost</span>}
        </button>
      )}

      {/* Render modal in portal to ensure it's centered over entire viewport */}
      {showModal && mounted && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-white">
                {activeValueSplits && activeValueSplits.length > 0 && customAmount && parseInt(customAmount) > 0
                  ? `Splitting ${customAmount} sats to ${activeValueSplits.length} recipients ⚡`
                  : customAmount && parseInt(customAmount) > 0
                  ? `Sending ${customAmount} sats ⚡`
                  : 'Send a Boost ⚡'}
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
                  {activeValueSplits && activeValueSplits.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {/* For single splits, show directly without dropdown */}
                      {activeValueSplits.length === 1 ? (
                        <div className="flex items-center gap-2 text-yellow-400">
                          <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                          <span className="flex-1">
                            {customAmount && parseInt(customAmount) > 0
                              ? `Sending ${customAmount} sats to ${activeValueSplits[0].name || 'recipient'}`
                              : `Value split to ${activeValueSplits[0].name || 'recipient'}`}
                          </span>
                        </div>
                      ) : (
                        /* For multiple splits, show collapsible dropdown */
                        <button
                          type="button"
                          onClick={() => setShowSplitDetails(!showSplitDetails)}
                          className="flex items-center gap-2 hover:text-yellow-300 transition-colors text-left w-full"
                        >
                          <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                          <span className="text-yellow-400 flex-1">
                            {customAmount && parseInt(customAmount) > 0
                              ? `Splitting ${customAmount} sats to ${activeValueSplits.length} recipients`
                              : `Value splits to ${activeValueSplits.length} recipients`}
                          </span>
                          {showSplitDetails ? (
                            <ChevronUp className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                          )}
                        </button>
                      )}
                      {(showSplitDetails || activeValueSplits.length === 1) && (() => {
                        // Pre-calculate split amounts using the same service that handles payments
                        const totalAmount = customAmount && parseInt(customAmount) > 0 ? parseInt(customAmount) : 0;

                        // Sort splits by percentage FIRST (largest first), then calculate amounts
                        // This ensures calculated amounts stay aligned with display order
                        const sortedActiveValueSplits = [...activeValueSplits].sort((a, b) => b.split - a.split);

                        const sortedSplits = totalAmount > 0
                          ? ValueSplitsService.calculateSplitAmounts(
                              sortedActiveValueSplits.map(s => ({ ...s, fee: false })),
                              totalAmount
                            ).map(calculated => ({
                              name: calculated.recipient.name,
                              type: calculated.recipient.type,
                              address: calculated.recipient.address,
                              split: calculated.recipient.split,
                              calculatedAmount: calculated.amount
                            }))
                          : sortedActiveValueSplits.map(s => ({ ...s, calculatedAmount: 0 }));

                        return (
                          <div className="flex flex-col gap-1">
                            {sortedSplits.map((split, index) => {
                              const amount = split.calculatedAmount;
                              // Use name|address key to match how statuses are stored
                              const statusKey = `${split.name || 'Unknown'}|${split.address}`;
                              const status = paymentStatuses.get(statusKey);

                            return (
                              <div
                                key={index}
                                className="bg-gray-800 rounded-lg p-3 flex items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {split.type === 'lnaddress' ? (
                                    <Mail className="w-3 h-3 text-blue-400 flex-shrink-0" />
                                  ) : (
                                    <Zap className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                                  )}
                                  <div className="flex flex-col flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-white text-sm font-medium truncate">
                                        {split.name || 'Unknown'}
                                      </span>
                                      {status && (
                                        <span className="flex items-center gap-1 text-xs flex-shrink-0">
                                          {status.status === 'waiting' && (
                                            <span className="text-gray-500" title="Queued">⏳</span>
                                          )}
                                          {status.status === 'pending' && (
                                            <span className="text-gray-400">⏳</span>
                                          )}
                                          {status.status === 'sending' && (
                                            <div className="w-3 h-3 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                                          )}
                                          {status.status === 'success' && (
                                            <span className="text-green-400">✓</span>
                                          )}
                                          {status.status === 'failed' && (
                                            <span className="text-red-400">✗</span>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                    {split.address.length > 30 ? (
                                      <a
                                        href={`https://amboss.space/node/${split.address}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-blue-400 hover:text-blue-300 truncate block max-w-full underline"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {`${split.address.slice(0, 12)}...${split.address.slice(-12)}`}
                                      </a>
                                    ) : (
                                      <span className="text-xs text-gray-400 truncate block max-w-full">
                                        {split.address}
                                      </span>
                                    )}
                                    {status?.error && (
                                      <span className="text-xs text-red-400 mt-1">
                                        {status.error}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="text-white text-sm font-semibold">
                                    {amount > 0 ? `${amount} sats` : `${split.split}%`}
                                  </div>
                                  {amount > 0 && (
                                    <div className="text-xs text-gray-500">
                                      {split.split}%
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {/* StableKraft Platform Fee */}
                          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center justify-between gap-2 border border-gray-700/50">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Zap className="w-3 h-3 text-green-400 flex-shrink-0" />
                              <div className="flex flex-col flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-white text-sm font-medium">
                                    StableKraft fee
                                  </span>
                                  <div className="relative group">
                                    <Info className="w-3 h-3 text-gray-400 hover:text-gray-300 cursor-help" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-xs text-gray-200 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-lg">
                                      <p>This small fee is added on top of your boost to help collect metadata for testing and development.</p>
                                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-600"></div>
                                    </div>
                                  </div>
                                </div>
                                <span className="text-xs text-gray-400">
                                  Platform support
                                </span>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-white text-sm font-semibold">
                                {LIGHTNING_CONFIG.platform.fee} sats
                              </div>
                              <div className="text-xs text-gray-500">
                                flat fee
                              </div>
                            </div>
                          </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : lightningAddress && LNURLService.isLightningAddress(lightningAddress) ? (
                    <>
                      <Mail className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400">Lightning Address: {lightningAddress}</span>
                    </>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                        <span className="flex-1">
                          No V4V payment info available for this track
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        This track is missing Value4Value payment configuration. Boosting is not available.
                      </p>
                    </div>
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

            {/* Keysend Warning - show when wallet is connected but doesn't support keysend */}
            {isConnected && !supportsKeysend && activeValueSplits?.some(s => s.type === 'node') && (
              <div className="mb-4 p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg text-yellow-200 text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>Keysend is not supported by your wallet. Try Alby or Coinos via NWC.</span>
              </div>
            )}

            {/* Error Messages */}
            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
                {error}
              </div>
            )}

            {/* Nostr Status */}
            {LIGHTNING_CONFIG.features.nostrIntegration && isNostrAuthenticated && nostrUser && (trackId || feedId) && (
              <div className="mb-4">
                {nostrStatus === 'signing' && (
                  <div className="p-3 bg-blue-900/50 border border-blue-700 rounded-lg text-blue-200 text-sm flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    <span>Signing boost event...</span>
                  </div>
                )}
                {nostrStatus === 'success' && (
                  <div className="p-3 bg-green-900/50 border border-green-700 rounded-lg text-green-200 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    <span>Boost posted to Nostr successfully!</span>
                  </div>
                )}
                {nostrStatus === 'failed' && nostrError && (
                  <div className="p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg text-yellow-200 text-sm">
                    <div className="font-semibold mb-1">⚠️ Boost payment succeeded, but Nostr posting failed:</div>
                    <div>{nostrError}</div>
                    <div className="mt-2 text-xs text-yellow-300/80">
                      Tip: Try logging out and reconnecting with Amber to restore the connection.
                    </div>
                  </div>
                )}
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
                disabled={isSending || !customAmount || parseInt(customAmount) < 1 || !hasValidV4V}
                className="flex-1 py-2 px-4 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-black rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {isSending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : !hasValidV4V ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>No V4V Info</span>
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
        </div>,
        document.body
      )}
    </>
  );
}