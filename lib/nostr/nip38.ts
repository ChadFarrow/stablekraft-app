/**
 * NIP-38: User Statuses
 * Handles publishing user status events to Nostr relays
 * Spec: https://github.com/nostr-protocol/nips/blob/master/38.md
 */

import { Event } from 'nostr-tools';
import { EventTemplate } from './events';
import { RelayManager, getDefaultRelays } from './relay';
import { getUserWriteRelays } from './nip65';

export interface UserStatusOptions {
  trackTitle?: string;
  artistName?: string;
  albumTitle?: string;
  trackUrl?: string;
  trackGuid?: string;
  feedGuid?: string;
  durationSeconds?: number;
  currentTimeSeconds?: number;
  imageUrl?: string;
}

/**
 * Create a NIP-38 user status event template (unsigned)
 * Kind 30315 - User Status (addressable, optionally expiring)
 *
 * @param statusType - Status type ("music" or "general")
 * @param content - Status message (empty string clears status)
 * @param options - Additional metadata for the status
 * @returns Unsigned event template
 */
export function createUserStatusTemplate(
  statusType: 'music' | 'general',
  content: string,
  options: UserStatusOptions = {}
): EventTemplate {
  const tags: string[][] = [
    ['d', statusType], // Status type identifier (makes event addressable)
  ];

  // Add track URL reference (NIP-38 r tag)
  if (options.trackUrl) {
    tags.push(['r', options.trackUrl]);
  }

  // Add track metadata tags
  if (options.trackTitle) {
    tags.push(['title', options.trackTitle]);
  }

  if (options.artistName) {
    tags.push(['artist', options.artistName]);
  }

  if (options.albumTitle) {
    tags.push(['album', options.albumTitle]);
  }

  if (options.trackGuid) {
    tags.push(['track-guid', options.trackGuid]);
  }

  if (options.feedGuid) {
    tags.push(['feed-guid', options.feedGuid]);
  }

  if (options.imageUrl) {
    tags.push(['image', options.imageUrl]);
  }

  // Calculate expiration timestamp based on remaining track duration
  // This prevents stale "now playing" statuses if user closes app
  const now = Math.floor(Date.now() / 1000);
  if (options.durationSeconds && options.currentTimeSeconds !== undefined) {
    const remainingSeconds = options.durationSeconds - options.currentTimeSeconds;
    if (remainingSeconds > 0) {
      // Add 30 second buffer for network delays
      const expirationTime = now + Math.floor(remainingSeconds) + 30;
      tags.push(['expiration', expirationTime.toString()]);
    }
  }

  return {
    kind: 30315, // NIP-38 User Status
    tags,
    content,
    created_at: now,
  };
}

/**
 * Publish a user status event to Nostr relays
 * Automatically uses unified signer for signing (NIP-07, NIP-46, or NIP-55)
 *
 * @param statusType - Status type ("music" or "general")
 * @param content - Status message (empty string clears status)
 * @param options - Additional metadata for the status
 * @param relays - Optional relay URLs (defaults to user's configured relays)
 * @returns Published event ID or null on failure
 */
export async function publishUserStatus(
  statusType: 'music' | 'general',
  content: string,
  options: UserStatusOptions = {},
  relays?: string[]
): Promise<string | null> {
  try {
    // Only works in browser environment
    if (typeof window === 'undefined') {
      console.warn('⚠️ NIP-38: Cannot publish status in server-side context');
      return null;
    }

    // Get unified signer
    const { getUnifiedSigner } = await import('./signer');
    const signer = getUnifiedSigner();

    // Check if signer is available
    if (!signer.isAvailable()) {
      const loginType = localStorage.getItem('nostr_login_type');

      // Try to reconnect NIP-55 if that's what user is using
      if (loginType === 'nip55') {
        console.log('🔄 NIP-38: NIP-55 signer not available, attempting to reconnect...');
        try {
          const { NIP55Client } = await import('./nip55-client');
          const nip55Client = new NIP55Client();
          await nip55Client.connect();
          await signer.setNIP55Signer(nip55Client);
          console.log('✅ NIP-38: NIP-55 reconnected successfully');
        } catch (reconnectError) {
          console.warn('⚠️ NIP-38: Failed to reconnect NIP-55:', reconnectError);
          return null;
        }
      } else {
        console.log('ℹ️ NIP-38: No signer available, status not published');
        return null;
      }
    }

    // Create event template
    const template = createUserStatusTemplate(statusType, content, options);

    // Sign event using unified signer
    const signedEvent = await signer.signEvent(template as any);

    // Publish to relays - use user's write relays if available
    const relayUrls = relays || getUserWriteRelays();
    const relayManager = new RelayManager();

    await Promise.all(
      relayUrls.map(url =>
        relayManager.connect(url, { read: false, write: true }).catch(() => {})
      )
    );

    const results = await relayManager.publish(signedEvent);
    const hasSuccess = results.some(r => r.status === 'fulfilled');

    if (hasSuccess) {
      console.log('✅ NIP-38: Published user status:', signedEvent.id);
      return signedEvent.id;
    } else {
      console.warn('⚠️ NIP-38: Failed to publish status to any relay');
      return null;
    }
  } catch (error) {
    console.error('❌ NIP-38: Error publishing user status:', error);
    return null;
  }
}

/**
 * Publish a "now playing" music status
 * Convenience wrapper for music status with formatted content
 *
 * @param trackTitle - Track title
 * @param artistName - Artist name
 * @param options - Additional metadata (duration, URL, etc.)
 * @param relays - Optional relay URLs
 * @returns Published event ID or null on failure
 */
export async function publishNowPlayingStatus(
  trackTitle: string,
  artistName: string,
  options: UserStatusOptions = {},
  relays?: string[]
): Promise<string | null> {
  const content = `🎵 ${trackTitle} by ${artistName}`;

  return publishUserStatus('music', content, {
    trackTitle,
    artistName,
    ...options,
  }, relays);
}

/**
 * Clear user status by publishing empty status
 * Per NIP-38 spec, empty content signals client to clear status
 *
 * @param statusType - Status type to clear ("music" or "general")
 * @param relays - Optional relay URLs
 * @returns Published event ID or null on failure
 */
export async function clearUserStatus(
  statusType: 'music' | 'general' = 'music',
  relays?: string[]
): Promise<string | null> {
  return publishUserStatus(statusType, '', {}, relays);
}
