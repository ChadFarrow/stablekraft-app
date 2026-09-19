'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { APP_NAME } from '@/lib/constants';
import { boostNotifiedPubkeys, clientTag, collectPersonNpubs, podcastIdentifierTags } from '@/lib/nostr/boost-note';
import { createPortal } from 'react-dom';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { useNostr } from '@/contexts/NostrContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { looksLikeNostrIdentifier, resolveBoostSenderName } from '@/lib/lightning/sender-name';
import { LNURLService } from '@/lib/lightning/lnurl';
import { BoostBoxService } from '@/lib/lightning/boostbox';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import { Zap, Send, X, Mail, Check, ChevronDown, ChevronUp, AlertCircle, Info } from 'lucide-react';
import confetti from 'canvas-confetti';
import { toast } from '@/components/Toast';

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
    isHost?: boolean;
    // Routing TLV for node recipients — identifies which account the receiving node credits.
    customKey?: string;
    customValue?: string;
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
  iconOnly?: boolean; // Show only the icon without text (for compact displays)
  remoteStartTime?: number; // VTS remoteStartTime for accurate Helipad metadata
  // <podcast:person> entries parsed from the feed, pre-combined from track-level
  // + feed/album-level. Any entry with an `npub` gets a Nostr `p` tag on the
  // boost event so the person is notified.
  persons?: Array<{ name?: string; role?: string; group?: string; npub?: string }>;
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
  iconOnly = false,
  remoteStartTime,
  persons = [],
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
  const [postToNostr, setPostToNostr] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [nostrError, setNostrError] = useState<string | null>(null);
  const [nostrStatus, setNostrStatus] = useState<'idle' | 'connecting' | 'signing' | 'success' | 'failed'>('idle');
  const [paymentStatuses, setPaymentStatuses] = useState<Map<string, { status: 'waiting' | 'pending' | 'sending' | 'success' | 'failed'; error?: string; amount?: number }>>(new Map());
  const [showSplitDetails, setShowSplitDetails] = useState(false);
  const [fetchedValueSplits, setFetchedValueSplits] = useState<typeof valueSplits>([]);
  const [fetchedLightningAddress, setFetchedLightningAddress] = useState<string | undefined>(undefined);
  // Resolved Nostr pubkeys from Lightning Addresses (for tagging musicians in boost posts)
  // These are extracted from Lightning Address NIP-05 verification during payment resolution
  // and used to add p-tags to Nostr boost posts so musicians receive notifications
  const [resolvedMusicianPubkeys, setResolvedMusicianPubkeys] = useState<Array<{ address: string; pubkey: string }>>([]);
  // Once the field is edited by hand, no prefill effect may overwrite it.
  const senderNameTouchedRef = useRef(false);

  const isNostrSignedIn = isNostrAuthenticated && !!nostrUser;

  useEffect(() => {
    setIsClient(true);
    setMounted(true);

    // Set default boost amount from settings
    if (settings.defaultBoostAmount) {
      setCustomAmount(settings.defaultBoostAmount.toString());
    }

    // Load persisted "post to Nostr" preference (defaults to on)
    const savedPostToNostr = localStorage.getItem('boostPostToNostr');
    if (savedPostToNostr !== null) {
      setPostToNostr(savedPostToNostr === 'true');
    }

    return () => setMounted(false);
  }, [settings.defaultBoostAmount]);

  const prefillSenderName = useCallback(() => {
    setSenderName(resolveBoostSenderName({
      settingsName: settings.defaultBoostName,
      savedName: localStorage.getItem('boostSenderName'),
      nostrDisplayName: nostrUser?.displayName,
    }));
  }, [settings.defaultBoostName, nostrUser?.displayName]);

  // Sender name resolves in its own effect because the Nostr display name arrives
  // asynchronously (NostrContext backfills kind-0 after login) — re-running the
  // mount effect for it would clobber an amount the user had already typed.
  useEffect(() => {
    if (senderNameTouchedRef.current) return;
    prefillSenderName();
  }, [prefillSenderName]);

  // Re-prefill on every open, and clear the touched flag with it. A name typed and
  // then abandoned (modal closed without boosting) is never persisted, so without
  // this it would sit in the field for the life of the page — outliving the setting
  // change or the Nostr profile load that should have replaced it.
  useEffect(() => {
    if (!showModal) return;
    senderNameTouchedRef.current = false;
    prefillSenderName();
  }, [showModal, prefillSenderName]);

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

    if (trackId && !isCompositeId && valueSplits.length === 0 && !lightningAddress) {
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

          if (response.success && response.data) {
            if (response.data.v4vValue) {
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
                  split: Number(r.split) || 0,
                  customKey: r.customKey,
                  customValue: r.customValue
                }));

              if (splits.length > 0) {
                setFetchedValueSplits(splits);
              }
            }
            // Also pick up v4vRecipient (lightning address) if available
            if (response.data.v4vRecipient && !lightningAddress) {
              setFetchedLightningAddress(response.data.v4vRecipient);
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
  const activeLightningAddress = lightningAddress || fetchedLightningAddress;

  // Check if valid V4V payment info exists
  const hasValidV4V = (activeValueSplits && activeValueSplits.length > 0) || !!activeLightningAddress;

  // Don't render on server-side
  if (!isClient) {
    return (
      <button
        aria-label="Send a boost"
        className={`flex items-center ${iconOnly ? 'justify-center p-2' : 'gap-2 px-4 py-2'} rounded-lg bg-gray-600 text-gray-400 cursor-not-allowed ${className}`}
      >
        <Zap size={iconOnly ? 20 : 16} className="pointer-events-none" />
        {!iconOnly && <span>Boost</span>}
      </button>
    );
  }

  // Build Helipad metadata object for boost payments.
  // Used by direct keysend, LNURL (via BoostBox), and value splits paths.
  const buildHelipadMetadata = (amount: number, msg?: string): Record<string, any> => {
    const metadata: Record<string, any> = {
      podcast: artistName || 'Unknown Artist',
      episode: trackTitle || 'Unknown Track',
      action: 'boost',
      app_name: APP_NAME,
      value_msat: amount * 1000,
      value_msat_total: amount * 1000,
      sender_name: senderName || 'Anonymous',
      name: APP_NAME,
      app_version: '1.0.0',
      uuid: `boost-${Date.now()}-${Math.floor(Math.random() * 999)}`
    };

    if (feedUrl) {
      metadata.url = feedUrl;
      metadata.feed = feedUrl;
    }
    if (feedId) {
      metadata.feedId = feedId;
    }
    if (remoteFeedGuid) {
      metadata.remote_feed_guid = remoteFeedGuid;
    }
    // `trackId` is a StableKraft row id, not an RSS `<item>` guid. Fixing the
    // five prop sources in #242 is not enough on its own: this fallback would
    // put the same unresolvable value back into the TLV an artist reads in
    // Helipad, on every boost that passes a `trackId`. Omit the field instead
    // — `remote_item_guid` is optional, and a wrong guid is worse than none.
    if (episodeGuid) {
      metadata.remote_item_guid = episodeGuid;
      metadata.episode_guid = episodeGuid;
    }
    if (albumName) {
      metadata.album = albumName;
    }
    if (publisherGuid) {
      metadata.publisher_guid = publisherGuid;
    }
    if (isNostrAuthenticated && nostrUser?.nostrNpub) {
      metadata.sender_npub = nostrUser.nostrNpub;
    }
    if (msg) {
      metadata.message = msg;
    }
    if (remoteStartTime !== undefined && remoteStartTime > 0) {
      metadata.ts = remoteStartTime;
    }

    return metadata;
  };

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
      // Collect BoostBox URLs from LNURL payments for metaboost boost_link
      let collectedBoostboxUrls: string[] = [];
      // Recipients skipped by a partly-successful split payment (see sendValueSplitPayments).
      let failedRecipients: Array<{ name: string; amount: number; error: string }> = [];

      if (activeValueSplits && activeValueSplits.length > 0) {
        // Use value splits for multiple recipients (highest priority)
        const valueSplitResult = await sendValueSplitPayments(amount, message);
        result = valueSplitResult;
        if (valueSplitResult.resolvedPubkeys) {
          musicianPubkeysForNostr = valueSplitResult.resolvedPubkeys;
        }
        if (valueSplitResult.boostboxUrls) {
          collectedBoostboxUrls = valueSplitResult.boostboxUrls;
        }
        if (valueSplitResult.failedRecipients) {
          failedRecipients = valueSplitResult.failedRecipients;
        }
      } else if (activeLightningAddress && LNURLService.isLightningAddress(activeLightningAddress)) {
        // Pay to Lightning Address via LNURL-pay

        try {
          // Store metadata in BoostBox for LNURL payments
          let comment = message;
          if (LIGHTNING_CONFIG.features.boostbox) {
            const boostboxResult = await BoostBoxService.storeMetadata(
              buildHelipadMetadata(amount, message),
              undefined,
              activeLightningAddress
            );
            if (boostboxResult) {
              comment = boostboxResult.desc;
              collectedBoostboxUrls = [boostboxResult.url];
            }
          }

          const { invoice } = await LNURLService.payLightningAddress(
            activeLightningAddress,
            amount,
            comment
          );

          result = await sendPayment(invoice);
        } catch (lnurlError) {
          console.error('Lightning Address payment failed:', lnurlError);
          result = { error: `Lightning Address payment failed: ${lnurlError instanceof Error ? lnurlError.message : 'Unknown error'}` };
        }
      } else if (activeLightningAddress && activeLightningAddress.length === 66 && (activeLightningAddress.startsWith('02') || activeLightningAddress.startsWith('03'))) {
        // Pay to node pubkey via keysend
        try {
          const helipadMetadata = buildHelipadMetadata(amount, message);
          console.log('📋 Final Helipad metadata:', helipadMetadata);

          result = await sendKeysend(activeLightningAddress, amount, message, helipadMetadata);
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

        // A boost that fails outright used to reach the server not at all — logBoost
        // only ran on the success branch — so the one thing most worth a warning was
        // the one thing invisible from outside the sender's browser.
        await logBoost({
          trackId,
          feedId,
          amount,
          message,
          senderName,
          paymentMethod: activeValueSplits?.length ? 'value-splits' :
                        activeLightningAddress ? 'lightning-address' : 'keysend',
          status: 'failed',
          error: result.error,
          failedRecipients,
        });
      } else {
        setSuccess(true);

        // Save sender name to localStorage for future boosts. An identifier-shaped
        // value is never persisted — resolveBoostSenderName would skip it on the next
        // load anyway, so storing it would just leave the two out of step.
        if (senderName && !looksLikeNostrIdentifier(senderName)) {
          localStorage.setItem('boostSenderName', senderName);
        }

        // Send 2 sat platform fee metaboost (include BoostBox URLs as boost_link)
        let platformFeeError: string | undefined;
        try {
          await sendPlatformFeeMetaboost(collectedBoostboxUrls);
        } catch (feeError) {
          // The recipients have already been paid, so a failed fee never fails the
          // boost — but it must not be invisible either. It was previously swallowed
          // into a console.warn nobody reads, which is how a fee could quietly stop
          // going out while every boost still reported success.
          platformFeeError = feeError instanceof Error ? feeError.message : String(feeError);
          console.warn('Platform fee metaboost failed:', feeError);
          toast.warning(`Boost sent. The ${LIGHTNING_CONFIG.platform.fee} sat StableKraft fee didn't go through: ${platformFeeError}`);
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
                        activeLightningAddress ? 'lightning-address' : 'keysend',
          feeStatus: platformFeeError ? 'failed' : 'sent',
          feeError: platformFeeError,
          failedRecipients,
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
        let nostrPostingFailed = false;

        if (LIGHTNING_CONFIG.features.nostrIntegration && (trackId || feedId) && isNostrAuthenticated && nostrUser && postToNostr) {
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
              nostrPostingFailed = true;
              // Don't return - let execution continue to auto-close the modal
              // Payment already succeeded, Nostr posting is secondary
            } else {

            const signerType = signer.getSignerType();
            
            // Sign event using unified signer (works with NIP-07, NIP-46, and NIP-55)
            console.log(`🔗 Signing boost event with ${signerType || 'unified'} signer...`);
            
            let trackData: any = null;
            // Feed-level persons from /api/feeds/[id], for a boost with no track.
            let feedPersons: unknown = null;
            let finalTrackTitle = trackTitle || albumName || 'track';
            let finalArtistName = artistName || '';
            let finalFeedId = feedId || '';
            let trackImage: string | null = null;
            let finalEpisodeGuid: string | null = episodeGuid || null;
            let finalFeedGuid: string | null = remoteFeedGuid || null;
            let finalPublisherGuid: string | null = publisherGuid || null;

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

            // Always try feed API as fallback to get missing data (image, album name, guid).
            // Also when nothing has supplied the feed's persons yet: the track lookup
            // carries them, but an album boost has no track, and most callers pass none.
            const havePersons = !!trackData || persons.some(p => p?.npub);
            if ((!trackImage || !actualAlbumName || !havePersons) && finalFeedId) {
              try {
                const feedResponse = await fetch(`/api/feeds/${finalFeedId}`);
                if (feedResponse.ok) {
                  const feedResult = await feedResponse.json();
                  if (feedResult.success && feedResult.data) {
                    const feedData = feedResult.data;
                    feedPersons = feedData.persons;

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
              // Link by feed id, not by an album-title slug — titles are not unique and a
              // title slug resolves to whichever same-titled feed has the most tracks (#183).
              // These URLs get published into Nostr events, so a wrong link is permanent.
              // finalFeedId is preferred: it's a real Track.feedId, whereas the feedId prop
              // is sometimes a podcast:guid (PlaylistTemplateCompact passes one). Both
              // resolve — an id on the resolver's exact rung, a guid on the guid rung.
              const albumIdentifier = finalFeedId || feedId;
              // Include track parameter if trackId is available for direct track linking
              const trackParam = trackId ? `?track=${trackId}` : '';
              url = `${baseUrl}/album/${encodeURIComponent(albumIdentifier!)}${trackParam}`;
              console.log('🔗 Generated album URL from feed id:', {
                albumIdentifier,
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
            
            // Everyone the note names: the <podcast:person>/<podcast:txt> npubs —
            // from the caller, the track, its feed, or the feed alone — then the split
            // recipients' pubkeys (resolved from their Lightning Addresses). Each
            // becomes both an @mention in the text and a `p` tag — one list, so an
            // artist can't be tagged yet invisible in the body.
            const { nip19 } = await import('nostr-tools');
            const notifiedPubkeys = boostNotifiedPubkeys(
              musicianPubkeysForNostr.map(p => p.pubkey),
              collectPersonNpubs(persons, trackData?.persons, trackData?.Feed?.persons, feedPersons),
              (npub) => {
                try {
                  const decoded = nip19.decode(npub);
                  return decoded.type === 'npub' && typeof decoded.data === 'string' ? decoded.data : null;
                } catch (err) {
                  console.warn(`⚠️ Could not decode person npub ${npub.slice(0, 20)}...:`, err);
                  return null;
                }
              }
            );

            // Build content (Fountain-style format)
            const musicianMentions = notifiedPubkeys.length > 0
              ? `\n\n${notifiedPubkeys.map(hex => `nostr:${nip19.npubEncode(hex)}`).join(' ')}`
              : '';

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

            // NIP-73 external identifiers at the END, so clients don't misread them
            // as "reply to" markers — each one immediately followed by the `k` naming
            // its kind. The `k` is what makes the note findable at all:
            // {"kinds":[1],"#k":["podcast:guid","podcast:item:guid"]} is how an indexer
            // asks a relay for podcast boosts, and an `i` without its `k` matches that
            // never. 274 notes were invisible to every index for months on exactly that
            // (#237). Do not "tidy" the k tags away — see lib/nostr/boost-note.ts.
            tags.push(...podcastIdentifierTags({
              itemGuid: finalEpisodeGuid,        // track.guid or v4vValue.itemGuid
              feedGuid: finalFeedGuid,           // remoteFeedGuid prop or v4vValue.feedGuid
              publisherGuid: finalPublisherGuid,
            }));

            // p-tags for everyone the text mentions, so each is notified.
            // Hex pubkeys per NIP-01, not npub bech32. Self-tagging is allowed —
            // musicians may be in their own splits and want to see the notification.
            for (const hex of notifiedPubkeys) {
              tags.push(['p', hex]);
              console.log(`🔔 Added p-tag: ${hex.slice(0, 16)}...`);
            }

            // NIP-89 attribution, last because it takes part in nothing above.
            // Without it the app has no name on the wire but the `r` URL, so
            // boosts show as unattributed wherever they're aggregated (#237).
            tags.push(clientTag());

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
              // For remote signers (NIP-46), ping first with a short timeout so we
              // fail fast (~5s) instead of hanging 120s when the signer app was
              // killed by iOS overnight and isn't listening on the relay. Any
              // response — even an error — proves reachability.
              if (signerType === 'nip46' || signerType === 'nsecbunker') {
                const nip46Client = signer.getNIP46Client();
                if (nip46Client) {
                  try {
                    await nip46Client.pingSigner(5000);
                    console.log('✅ Boost: Signer ping succeeded, proceeding with signEvent');
                  } catch (pingErr) {
                    const pingMsg = pingErr instanceof Error ? pingErr.message : String(pingErr);
                    console.warn('⚠️ Boost: Signer ping failed, skipping signEvent:', pingMsg);
                    throw new Error('Signer unreachable. Open your signer app (Primal/Amber) and try again.');
                  }
                }
              }

              // Timeout must match NIP-46 relay-based timeout (120s) — Primal and other
              // remote signers route through Nostr relays which can take 40-80+ seconds
              const signPromise = signer.signEvent(noteTemplate as any);
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Signing timeout after 120 seconds')), 120000)
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
                setNostrError('Signing timed out. Your signer may not be responding. Please check that it is open and try again.');
              } else if (errorMessage.includes('not available') || errorMessage.includes('disconnected')) {
                setNostrError('Connection lost. Please try reconnecting your signer.');
              } else {
                setNostrError(`Signing failed: ${errorMessage}. Please try reconnecting your signer.`);
              }
              setNostrStatus('failed');
              nostrPostingFailed = true;

              // For NIP-46, surface a one-tap Reconnect action so the user doesn't
              // have to walk to Settings → Reconnect signer themselves.
              if (signerType === 'nip46' || signerType === 'nsecbunker') {
                toast.error('Nostr signer not responding.', {
                  duration: 15000,
                  action: {
                    label: 'Reconnect',
                    onClick: async () => {
                      const reconnectToastId = toast.info('Reconnecting signer…', { duration: 30000 });
                      try {
                        const { reconnectSignerManually } = await import('@/lib/nostr/signer-reconnect');
                        const result = await reconnectSignerManually();
                        toast.dismiss(reconnectToastId);
                        if (result.success) {
                          toast.success('Signer reconnected — try the boost again.');
                        } else {
                          toast.error(result.error || 'Reconnect failed. Please log out and back in.');
                        }
                      } catch (err) {
                        toast.dismiss(reconnectToastId);
                        const msg = err instanceof Error ? err.message : String(err);
                        toast.error(`Reconnect failed: ${msg}`);
                      }
                    },
                  },
                });
              }
              // Don't return - let execution continue to auto-close the modal
            }

            if (signedEvent) {
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
                  nostrPostingFailed = true;
                }
              } else {
                console.error('❌ Boost: API returned success=false:', zapData);
                setNostrError(zapData.error || 'Failed to post boost to Nostr.');
                setNostrStatus('failed');
                nostrPostingFailed = true;
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
              nostrPostingFailed = true;
            }
            } // end if (signedEvent)
            } // end else (reconnectResult.success)
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
              setNostrError(`Failed to post to Nostr: ${errorMessage}. Please try reconnecting your signer.`);
            }
            setNostrStatus('failed');
            nostrPostingFailed = true;

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
        // Use longer delay if Nostr posting failed so user can read the warning
        const closeDelay = nostrPostingFailed ? 4000 : 2000;
        setTimeout(() => {
          setShowModal(false);
          setSuccess(false);
          setMessage('');
          setNostrError(null);
          setNostrStatus('idle');
          // Reset amount to default from settings
          if (settings.defaultBoostAmount) {
            setCustomAmount(settings.defaultBoostAmount.toString());
          } else {
            setCustomAmount('');
          }
          // Notify parent component that modal is closed
          if (onClose) {
            onClose();
          }
        }, closeDelay);
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
  ): Promise<{
    preimage?: string;
    error?: string;
    resolvedPubkeys?: Array<{ address: string; pubkey: string }>;
    boostboxUrls?: string[];
    // Recipients that did NOT get paid on an otherwise-successful boost.
    // sendMultiRecipientPayment reports success when *any* recipient succeeds, and at
    // >=50% it even replaces the per-recipient errors with a summary string — so
    // without carrying these out, a partly-paid boost is indistinguishable from a
    // fully-paid one anywhere except the payment rows on that user's screen.
    failedRecipients?: Array<{ name: string; amount: number; error: string }>;
  }> => {
    try {
      // Convert valueSplits to ValueRecipient format
      // Ensure split is numeric to prevent string concatenation bugs in calculations
      const recipients = activeValueSplits.map(split => ({
        name: split.name,
        type: split.type as 'node' | 'lnaddress',
        address: split.address,
        split: Number(split.split) || 0,
        fee: false,
        // Carried through so payKeysend can emit them as TLV records, and so Fountain
        // recipients stay detectable by their routing key.
        customKey: split.customKey,
        customValue: split.customValue,
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

      const helipadMetadata = buildHelipadMetadata(totalAmount, message);
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
        walletProviderType,
        supportsKeysend
      );

      if (!result.success) {
        // Check if any errors are keysend-related for cleaner messaging
        const keysendErrors = result.errors.filter(e => e.toLowerCase().includes('keysend'));
        if (keysendErrors.length > 0) {
          return { error: 'Keysend is not supported by your wallet. Try Alby or Coinos via NWC.', resolvedPubkeys: resolvedNostrPubkeys };
        }
        return { error: result.errors.join(', '), resolvedPubkeys: resolvedNostrPubkeys };
      }

      // Return the primary preimage, resolved Nostr pubkeys for tagging, and BoostBox URLs
      return {
        preimage: result.primaryPreimage,
        resolvedPubkeys: resolvedNostrPubkeys,
        boostboxUrls: result.boostboxUrls,
        failedRecipients: result.failedPayments.map(payment => ({
          name: payment.recipient.name || payment.recipient.address,
          amount: payment.amount,
          error: payment.result?.error || 'unknown error',
        })),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Value split payment failed' };
    }
  };

  // Send 2 sat platform fee metaboost via Lightning Address (LNURL)
  const sendPlatformFeeMetaboost = async (boostboxUrls?: string[]): Promise<void> => {
    const platformFee = LIGHTNING_CONFIG.platform.fee || 2;
    const platformLightningAddress = LIGHTNING_CONFIG.platform.lightningAddress;

    try {
      const metaboostMessage = `Metaboost for ${trackTitle || 'track'} - Platform fee`;

      // Build Helipad metadata and store in BoostBox for LNURL payment context
      let comment: string | undefined = metaboostMessage;
      if (LIGHTNING_CONFIG.features.boostbox) {
        const helipadMetadata = buildHelipadMetadata(platformFee, metaboostMessage);
        helipadMetadata.uuid = `metaboost-${Date.now()}-${Math.floor(Math.random() * 999)}`;
        helipadMetadata.name = APP_NAME;
        if (boostboxUrls && boostboxUrls.length > 0) {
          helipadMetadata.boost_link = boostboxUrls[0];
        }
        const boostboxResult = await BoostBoxService.storeMetadata(
          helipadMetadata,
          APP_NAME,
          platformLightningAddress,
          100
        );
        if (boostboxResult) {
          comment = boostboxResult.desc;
        }
      }

      const { invoice } = await LNURLService.payLightningAddress(
        platformLightningAddress,
        platformFee,
        comment
      );

      // sendPayment RESOLVES with { error } on failure — it does not throw (see
      // BitcoinConnectProvider, which parses the Lightning error and returns it).
      // Discarding the result logged "✅ Platform fee sent" over every failed fee and
      // left the caller's catch unreachable, so a fee that never went out was
      // indistinguishable from one that did. The two other payment paths
      // (value-splits.ts, and the single-recipient branch above) already check it.
      // No retry here on purpose: sendPayment already retries no-route and timeout
      // internally, and retrying from out here would re-issue a fresh invoice —
      // double-paying whenever the first attempt actually settled but reported failure.
      const result = await sendPayment(invoice);
      if (result.error) {
        throw new Error(result.error);
      }

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
    // Outcome of the platform-fee metaboost. Reported so a fee failure on someone
    // else's machine reaches the server logs — their browser console is unreachable.
    feeStatus?: 'sent' | 'failed';
    feeError?: string;
    failedRecipients?: Array<{ name: string; amount: number; error: string }>;
    status?: 'succeeded' | 'failed';
    error?: string;
  }) => {
    try {
      // Determine recipient based on payment method
      let recipient = 'unknown';
      if (activeValueSplits?.length) {
        recipient = `${activeValueSplits.length} recipients`;
      } else if (activeLightningAddress) {
        recipient = activeLightningAddress;
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
        feeStatus: data.feeStatus,
        feeError: data.feeError,
        failedRecipients: data.failedRecipients?.length ? data.failedRecipients : undefined,
        status: data.status || 'succeeded',
        error: data.error,
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
          {/* px, not rem: w-5 scales with the OS font setting, so on Android the glyph
              swelled to fill (and eventually overflow) a fixed-size button. Identical to
              w-5 h-5 at the default root size, so nothing changes at 1x. */}
          <Zap size={20} className="pointer-events-none" />
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
                aria-label="Close boost dialog"
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

                        // Sort splits: track recipients first, then host/show recipients
                        // Within each group, sort by weight (largest first)
                        const sortedActiveValueSplits = [...activeValueSplits].sort((a, b) => {
                          const aHost = a.isHost ? 1 : 0;
                          const bHost = b.isHost ? 1 : 0;
                          if (aHost !== bHost) return aHost - bHost;
                          return b.split - a.split;
                        });
                        const totalSplitWeight = sortedActiveValueSplits.reduce((sum, s) => sum + s.split, 0);

                        const sortedSplits = totalAmount > 0
                          ? ValueSplitsService.calculateSplitAmounts(
                              sortedActiveValueSplits.map(s => ({ ...s, fee: false })),
                              totalAmount
                            ).map((calculated, i) => ({
                              name: calculated.recipient.name,
                              type: calculated.recipient.type,
                              address: calculated.recipient.address,
                              split: calculated.recipient.split,
                              calculatedAmount: calculated.amount,
                              isHost: sortedActiveValueSplits[i]?.isHost ?? false
                            }))
                          : sortedActiveValueSplits.map(s => ({ ...s, calculatedAmount: 0, isHost: s.isHost ?? false }));

                        const hasGroups = sortedSplits.some(s => s.isHost) && sortedSplits.some(s => !s.isHost);

                        return (
                          <div className="flex flex-col gap-1">
                            {sortedSplits.map((split, index) => {
                              // Show section header when transitioning from track to show splits
                              const showTrackHeader = hasGroups && index === 0 && !split.isHost;
                              const showHostHeader = hasGroups && split.isHost && (index === 0 || !sortedSplits[index - 1].isHost);
                              const amount = split.calculatedAmount;
                              // Use name|address key to match how statuses are stored
                              const statusKey = `${split.name || 'Unknown'}|${split.address}`;
                              const status = paymentStatuses.get(statusKey);

                            return (
                              <React.Fragment key={index}>
                              {showTrackHeader && (
                                <div className="text-xs text-gray-500 uppercase tracking-wider mt-1 mb-0.5 px-1">Song</div>
                              )}
                              {showHostHeader && (
                                <div className="text-xs text-gray-500 uppercase tracking-wider mt-2 mb-0.5 px-1">Show</div>
                              )}
                              <div
                                className="bg-gray-800 rounded-lg p-3 flex items-center justify-between gap-2 min-w-0"
                              >
                                <div className="flex items-center gap-2 flex-1 min-w-0 overflow-hidden">
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
                                <div className="text-right flex-shrink-0 whitespace-nowrap pl-2">
                                  <div className="text-white text-sm font-semibold">
                                    {amount > 0 ? `${amount} sats` : `${totalSplitWeight > 0 ? Math.round((split.split / totalSplitWeight) * 100) : split.split}%`}
                                  </div>
                                  {amount > 0 && (
                                    <div className="text-xs text-gray-500">
                                      {totalSplitWeight > 0 ? Math.round((split.split / totalSplitWeight) * 100) : split.split}%
                                    </div>
                                  )}
                                </div>
                              </div>
                              </React.Fragment>
                            );
                          })}
                          {/* StableKraft Platform Fee */}
                          <div className="bg-gray-800/50 rounded-lg p-3 flex items-center justify-between gap-2 border border-gray-700/50 min-w-0">
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
                            <div className="text-right flex-shrink-0 whitespace-nowrap pl-2">
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
                  ) : activeLightningAddress && LNURLService.isLightningAddress(activeLightningAddress) ? (
                    <>
                      <Mail className="w-3 h-3 text-blue-400" />
                      <span className="text-blue-400">Lightning Address: {activeLightningAddress}</span>
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
              {/* `name` + autoComplete="off": as an unnamed text input this field was
                  fair game for autofill, which happily stuffed it with a saved value
                  from a Nostr login box — an npub, truncated to maxLength. */}
              <input
                type="text"
                name="boost-sender-name"
                autoComplete="off"
                placeholder="Enter your name"
                value={senderName}
                onChange={(e) => {
                  senderNameTouchedRef.current = true;
                  setSenderName(e.target.value.slice(0, 50));
                }}
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

            {/* Post to Nostr. The row renders whether or not you are signed in — while
                it was hidden for signed-out users its absence read as a missing
                feature rather than as an unmet prerequisite. */}
            {LIGHTNING_CONFIG.features.nostrIntegration && (trackId || feedId) && (
              <div className="mb-6">
                <div className="flex items-center gap-2">
                  <input
                    id="postToNostr"
                    type="checkbox"
                    checked={isNostrSignedIn && postToNostr}
                    disabled={!isNostrSignedIn}
                    onChange={(e) => {
                      setPostToNostr(e.target.checked);
                      localStorage.setItem('boostPostToNostr', String(e.target.checked));
                    }}
                    className="h-4 w-4 accent-yellow-500 disabled:opacity-50"
                  />
                  <label
                    htmlFor="postToNostr"
                    className={`text-sm select-none ${isNostrSignedIn ? 'text-gray-300 cursor-pointer' : 'text-gray-500 cursor-not-allowed'}`}
                  >
                    Post this boost to Nostr
                  </label>
                </div>
                {!isNostrSignedIn && (
                  <p className="text-xs text-gray-500 mt-1 ml-6">
                    Sign in with Nostr to post your boosts.
                  </p>
                )}
              </div>
            )}

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
            {LIGHTNING_CONFIG.features.nostrIntegration && isNostrSignedIn && (trackId || feedId) && (
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
                      Tip: Try logging out and reconnecting your signer to restore the connection.
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