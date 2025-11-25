'use client';

import { useCallback, useRef } from 'react';
import { useBitcoinConnect } from '@/components/Lightning/BitcoinConnectProvider';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import { ValueRecipient } from '@/lib/lightning/value-parser';
import { toast } from '@/components/Toast';

interface TrackInfo {
  id?: string;
  title?: string;
  guid?: string;
  v4vValue?: any;
  v4vRecipient?: string;
}

interface AlbumInfo {
  id?: string;
  title?: string;
  artist?: string;
  feedGuid?: string;
  feedUrl?: string;
}

interface AutoBoostResult {
  success: boolean;
  error?: string;
  amount?: number;
}

export function useAutoBoost() {
  const { isConnected, sendPayment, sendKeysend } = useBitcoinConnect();
  const { settings } = useUserSettings();
  const isProcessingRef = useRef(false);

  const triggerAutoBoost = useCallback(async (
    track: TrackInfo,
    album: AlbumInfo,
    amount?: number
  ): Promise<AutoBoostResult> => {
    // Prevent concurrent auto-boosts
    if (isProcessingRef.current) {
      console.log('⚡ Auto-boost already in progress, skipping');
      return { success: false, error: 'Already processing' };
    }

    // Check if auto-boost is enabled
    if (!settings.autoBoostEnabled) {
      return { success: false, error: 'Auto-boost disabled' };
    }

    // Check if wallet is connected
    if (!isConnected) {
      console.log('⚡ Auto-boost skipped: wallet not connected');
      return { success: false, error: 'Wallet not connected' };
    }

    // Check if track has V4V data
    const hasV4V = track.v4vValue || track.v4vRecipient;
    if (!hasV4V) {
      console.log('⚡ Auto-boost skipped: no V4V data for track');
      return { success: false, error: 'No V4V data' };
    }

    const boostAmount = amount || settings.autoBoostAmount || 50;

    isProcessingRef.current = true;

    try {
      console.log(`⚡ Auto-boost starting: ${boostAmount} sats for "${track.title}"`);

      // Build Helipad metadata
      const helipadMetadata: any = {
        podcast: album.artist || 'Unknown Artist',
        episode: track.title || 'Unknown Track',
        action: 'auto', // Helipad action type 4 = automated boost
        app_name: 'StableKraft',
        value_msat: boostAmount * 1000,
        value_msat_total: boostAmount * 1000,
        sender_name: settings.defaultBoostName ? `${settings.defaultBoostName} via StableKraft.app` : 'StableKraft.app user',
        ts: Math.floor(Date.now() / 1000),
        uuid: `auto-${Date.now()}-${Math.floor(Math.random() * 999)}`
      };

      // Add optional fields
      if (album.feedUrl) {
        helipadMetadata.url = album.feedUrl;
        helipadMetadata.feed = album.feedUrl;
      }
      if (album.id) {
        helipadMetadata.feedId = album.id;
      }
      if (album.feedGuid) {
        helipadMetadata.remote_feed_guid = album.feedGuid;
      }
      if (track.guid || track.id) {
        helipadMetadata.remote_item_guid = track.guid || track.id;
        helipadMetadata.episode_guid = track.guid || track.id;
      }
      if (album.title) {
        helipadMetadata.album = album.title;
      }

      console.log('📋 Auto-boost Helipad metadata:', helipadMetadata);

      let result: { preimage?: string; error?: string } | null = null;

      // Check if we have value splits (multiple recipients)
      if (track.v4vValue?.recipients && Array.isArray(track.v4vValue.recipients) && track.v4vValue.recipients.length > 0) {
        // Multi-recipient payment via value splits
        const recipients: ValueRecipient[] = track.v4vValue.recipients.map((r: any) => ({
          name: r.name || 'Unknown',
          type: r.type === 'lnaddress' ? 'lnaddress' : 'node',
          address: r.address,
          split: r.split || 100,
          customKey: r.customKey,
          customValue: r.customValue,
        }));

        console.log(`⚡ Auto-boost: sending to ${recipients.length} recipients`);

        const multiResult = await ValueSplitsService.sendMultiRecipientPayment(
          recipients,
          boostAmount,
          sendPayment,
          sendKeysend,
          undefined, // No message for auto-boost
          helipadMetadata
        );

        if (multiResult.success || multiResult.isPartialSuccess) {
          result = { preimage: multiResult.primaryPreimage };
        } else {
          result = { error: multiResult.errors.join(', ') };
        }
      } else if (track.v4vRecipient) {
        // Single recipient keysend
        console.log(`⚡ Auto-boost: sending to single recipient ${track.v4vRecipient}`);
        result = await sendKeysend(track.v4vRecipient, boostAmount, undefined, helipadMetadata);
      }

      if (result?.preimage) {
        console.log(`✅ Auto-boost successful: ${boostAmount} sats`);

        // Log boost to database (without Nostr posting)
        try {
          await fetch('/api/lightning/log-boost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackId: track.id,
              feedId: album.id,
              amount: boostAmount,
              message: '', // No message for auto-boost
              senderName: settings.defaultBoostName || 'StableKraft.app user',
              preimage: result.preimage,
              type: 'auto', // Mark as auto-boost
              recipient: track.v4vRecipient || 'value-splits'
            })
          });
        } catch (logError) {
          console.warn('⚠️ Failed to log auto-boost:', logError);
        }

        // Show subtle toast notification
        toast.success(`Auto-boost: ${boostAmount} sats ⚡`, {
          duration: 2000
        });

        return { success: true, amount: boostAmount };
      } else {
        console.warn(`⚠️ Auto-boost failed: ${result?.error || 'Unknown error'}`);
        return { success: false, error: result?.error || 'Payment failed' };
      }
    } catch (error) {
      console.error('❌ Auto-boost error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      isProcessingRef.current = false;
    }
  }, [isConnected, sendPayment, sendKeysend, settings]);

  return {
    triggerAutoBoost,
    isAutoBoostEnabled: settings.autoBoostEnabled,
    autoBoostAmount: settings.autoBoostAmount
  };
}
