/**
 * Nostr favorites utilities
 * Handles publishing favorites to Nostr relays for decentralized storage
 * Also stored in database for fast queries
 *
 * NIP-51 compliant: Uses kind 30001 with ["d", itemId] and ["t", type] tags
 */

import { Event } from 'nostr-tools';
import { createFavoriteEvent, createFavoriteTrackEvent, createFavoriteAlbumEvent, createFavoriteDeletionEvent } from './events';
import { RelayManager, getDefaultRelays } from './relay';

// NIP-51 compliant favorite event kind
const FAVORITE_KIND = 30001;

/**
 * Create a NIP-51 compliant favorite event template (unsigned)
 */
function createFavoriteEventTemplate(
  type: 'track' | 'album',
  itemId: string,
  title?: string,
  artistName?: string
) {
  return {
    kind: FAVORITE_KIND,
    tags: [
      ['d', itemId],           // NIP-51: parameterized replaceable event identifier
      ['t', type],             // Type discriminator
      ...(title ? [['title', title]] : []),
      ...(artistName ? [['artist', artistName]] : []),
    ],
    content: JSON.stringify({
      type,
      id: itemId,
      ...(title && { title }),
      ...(artistName && { artist: artistName }),
    }),
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Publish a favorite to Nostr relays (NIP-51 compliant)
 * @param type - 'track' or 'album'
 * @param itemId - Track ID or Feed ID
 * @param privateKey - Private key (hex) or null for extension/NIP-46
 * @param title - Optional title
 * @param artistName - Optional artist name
 * @param relays - Optional relay URLs
 * @returns Published event ID
 */
export async function publishFavoriteToNostr(
  type: 'track' | 'album',
  itemId: string,
  privateKey: string | null,
  title?: string,
  artistName?: string,
  relays?: string[]
): Promise<string | null> {
  try {
    // For extension/NIP-46 logins, use unified signer
    if (!privateKey && typeof window !== 'undefined') {
      const { getUnifiedSigner } = await import('./signer');
      const signer = getUnifiedSigner();

      // Wait for signer initialization to complete
      await signer.ensureInitialized();

      // Check if signer is available, if not try to reconnect NIP-55
      if (!signer.isAvailable()) {
        const loginType = localStorage.getItem('nostr_login_type');

        if (loginType === 'nip55') {
          console.log('🔄 Favorites: NIP-55 signer not available, attempting to reconnect...');
          try {
            const { NIP55Client } = await import('./nip55-client');
            const nip55Client = new NIP55Client();
            await nip55Client.connect();
            await signer.setNIP55Signer(nip55Client);
            console.log('✅ Favorites: NIP-55 reconnected successfully!');
          } catch (reconnectError) {
            console.warn('⚠️ Favorites: Failed to reconnect NIP-55:', reconnectError);
            console.log(`ℹ️ Favorite ${type} not posted to Nostr: NIP-55 reconnection failed`);
            return null;
          }
        } else {
          console.log(`ℹ️ Favorite ${type} not posted to Nostr: No signer available`);
          return null;
        }
      }

      if (signer.isAvailable()) {
        const event = createFavoriteEventTemplate(type, itemId, title, artistName);
        const signedEvent = await signer.signEvent(event as any);

        // Publish to relays - combine user relays with reliable defaults
        // Filter out obviously unreachable relays (localhost, .local)
        const userRelays = (relays || []).filter(url => {
          const lowerUrl = url.toLowerCase();
          return !lowerUrl.includes('127.0.0.1') &&
                 !lowerUrl.includes('localhost') &&
                 !lowerUrl.includes('.local') &&
                 !lowerUrl.endsWith('/chat') &&
                 !lowerUrl.endsWith('/private') &&
                 !lowerUrl.endsWith('/outbox');
        });

        // Always include reliable defaults that accept kind 30001
        const defaultRelays = getDefaultRelays();
        const allRelays = [...new Set([...userRelays, ...defaultRelays])];

        const relayManager = new RelayManager();

        await Promise.all(
          allRelays.map(url =>
            relayManager.connect(url, { read: false, write: true }).catch(() => {})
          )
        );

        const results = await relayManager.publish(signedEvent);
        const hasSuccess = results.some(r => r.status === 'fulfilled');

        if (hasSuccess) {
          console.log(`✅ Published favorite ${type} to Nostr:`, signedEvent.id);
          return signedEvent.id;
        } else {
          console.warn(`⚠️ Failed to publish favorite ${type} to any relay`);
          return null;
        }
      }
    }

    // For manual key logins, sign with the private key
    if (privateKey) {
      const event = createFavoriteEvent(type, itemId, privateKey, title, artistName);

      // Filter out unreachable relays and combine with defaults
      const userRelays = (relays || []).filter(url => {
        const lowerUrl = url.toLowerCase();
        return !lowerUrl.includes('127.0.0.1') &&
               !lowerUrl.includes('localhost') &&
               !lowerUrl.includes('.local') &&
               !lowerUrl.endsWith('/chat') &&
               !lowerUrl.endsWith('/private') &&
               !lowerUrl.endsWith('/outbox');
      });
      const defaultRelays = getDefaultRelays();
      const allRelays = [...new Set([...userRelays, ...defaultRelays])];

      const relayManager = new RelayManager();

      await Promise.all(
        allRelays.map(url =>
          relayManager.connect(url, { read: false, write: true }).catch(() => {})
        )
      );

      const results = await relayManager.publish(event);
      const hasSuccess = results.some(r => r.status === 'fulfilled');

      if (hasSuccess) {
        console.log(`✅ Published favorite ${type} to Nostr:`, event.id);
        return event.id;
      } else {
        console.warn(`⚠️ Failed to publish favorite ${type} to any relay`);
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error(`❌ Error publishing favorite ${type} to Nostr:`, error);
    return null;
  }
}

/**
 * @deprecated Use publishFavoriteToNostr('track', ...) instead
 * Publish a favorite track event to Nostr relays
 */
export async function publishFavoriteTrackToNostr(
  trackId: string,
  privateKey: string | null,
  trackTitle?: string,
  artistName?: string,
  relays?: string[]
): Promise<string | null> {
  return publishFavoriteToNostr('track', trackId, privateKey, trackTitle, artistName, relays);
}

/**
 * @deprecated Use publishFavoriteToNostr('album', ...) instead
 * Publish a favorite album event to Nostr relays
 */
export async function publishFavoriteAlbumToNostr(
  feedId: string,
  privateKey: string | null,
  albumTitle?: string,
  artistName?: string,
  relays?: string[]
): Promise<string | null> {
  return publishFavoriteToNostr('album', feedId, privateKey, albumTitle, artistName, relays);
}

/**
 * Delete a favorite from Nostr by publishing a deletion event
 * @param eventId - ID of the favorite event to delete
 * @param privateKey - Private key (hex) or use extension if available
 * @param relays - Optional relay URLs
 * @returns Published deletion event ID
 */
export async function deleteFavoriteFromNostr(
  eventId: string,
  privateKey: string | null,
  relays?: string[]
): Promise<string | null> {
  try {
    // For extension/NIP-46 logins, use unified signer
    if (!privateKey && typeof window !== 'undefined') {
      const { getUnifiedSigner } = await import('./signer');
      const signer = getUnifiedSigner();

      // Wait for signer initialization to complete (fixes race condition)
      await signer.ensureInitialized();

      // Check if signer is available, if not try to reconnect NIP-55
      if (!signer.isAvailable()) {
        const loginType = localStorage.getItem('nostr_login_type');

        if (loginType === 'nip55') {
          console.log('🔄 Favorites: NIP-55 signer not available, attempting to reconnect...');
          try {
            const { NIP55Client } = await import('./nip55-client');
            const nip55Client = new NIP55Client();
            await nip55Client.connect();
            await signer.setNIP55Signer(nip55Client);
            console.log('✅ Favorites: NIP-55 reconnected successfully!');
          } catch (reconnectError) {
            console.warn('⚠️ Favorites: Failed to reconnect NIP-55:', reconnectError);
            console.log('ℹ️ Favorite deletion not posted to Nostr: NIP-55 reconnection failed');
            return null;
          }
        } else {
          console.log('ℹ️ Favorite deletion not posted to Nostr: No signer available');
          return null;
        }
      }

      if (signer.isAvailable()) {
        const event = {
          kind: 5, // Deletion event (NIP-09)
          tags: [['e', eventId]],
          content: '',
          created_at: Math.floor(Date.now() / 1000),
        };

        const signedEvent = await signer.signEvent(event as any);

        // Filter out unreachable relays and combine with defaults
        const userRelays = (relays || []).filter(url => {
          const lowerUrl = url.toLowerCase();
          return !lowerUrl.includes('127.0.0.1') &&
                 !lowerUrl.includes('localhost') &&
                 !lowerUrl.includes('.local') &&
                 !lowerUrl.endsWith('/chat') &&
                 !lowerUrl.endsWith('/private') &&
                 !lowerUrl.endsWith('/outbox');
        });
        const defaultRelays = getDefaultRelays();
        const allRelays = [...new Set([...userRelays, ...defaultRelays])];

        const relayManager = new RelayManager();

        await Promise.all(
          allRelays.map(url =>
            relayManager.connect(url, { read: false, write: true }).catch(() => {})
          )
        );

        const results = await relayManager.publish(signedEvent);
        const hasSuccess = results.some(r => r.status === 'fulfilled');

        if (hasSuccess) {
          console.log('✅ Published favorite deletion to Nostr:', signedEvent.id);
          return signedEvent.id;
        } else {
          console.warn('⚠️ Failed to publish favorite deletion to any relay');
          return null;
        }
      }
    }

    // For manual key logins, sign with the private key
    if (privateKey) {
      const event = createFavoriteDeletionEvent(eventId, privateKey);

      // Filter out unreachable relays and combine with defaults
      const userRelays = (relays || []).filter(url => {
        const lowerUrl = url.toLowerCase();
        return !lowerUrl.includes('127.0.0.1') &&
               !lowerUrl.includes('localhost') &&
               !lowerUrl.includes('.local') &&
               !lowerUrl.endsWith('/chat') &&
               !lowerUrl.endsWith('/private') &&
               !lowerUrl.endsWith('/outbox');
      });
      const defaultRelays = getDefaultRelays();
      const allRelays = [...new Set([...userRelays, ...defaultRelays])];

      const relayManager = new RelayManager();

      await Promise.all(
        allRelays.map(url =>
          relayManager.connect(url, { read: false, write: true }).catch(() => {})
        )
      );

      const results = await relayManager.publish(event);
      const hasSuccess = results.some(r => r.status === 'fulfilled');

      if (hasSuccess) {
        console.log('✅ Published favorite deletion to Nostr:', event.id);
        return event.id;
      } else {
        console.warn('⚠️ Failed to publish favorite deletion to any relay');
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error deleting favorite from Nostr:', error);
    return null;
  }
}

export interface BatchPublishItem {
  type: 'track' | 'album';
  id: string;
  title?: string;
  artist?: string;
}

export interface BatchPublishResult {
  successful: Array<{ id: string; nostrEventId: string }>;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Batch publish favorites to Nostr relays
 * Used to sync existing favorites that weren't published due to signer issues
 * @param favorites - Array of favorites to publish
 * @param onProgress - Optional callback for progress updates
 * @param relays - Optional relay URLs
 * @returns Results with successful and failed items
 */
export async function batchPublishFavoritesToNostr(
  favorites: BatchPublishItem[],
  onProgress?: (completed: number, total: number, current?: BatchPublishItem) => void,
  relays?: string[]
): Promise<BatchPublishResult> {
  const result: BatchPublishResult = {
    successful: [],
    failed: []
  };

  if (favorites.length === 0) {
    return result;
  }

  // Check if signer is available
  if (typeof window === 'undefined') {
    result.failed = favorites.map(f => ({ id: f.id, error: 'Not in browser environment' }));
    return result;
  }

  const { getUnifiedSigner } = await import('./signer');
  const signer = getUnifiedSigner();

  // Wait for signer initialization
  await signer.ensureInitialized();

  if (!signer.isAvailable()) {
    result.failed = favorites.map(f => ({ id: f.id, error: 'No signer available' }));
    return result;
  }

  // Filter out unreachable relays and combine with defaults
  const userRelays = (relays || []).filter(url => {
    const lowerUrl = url.toLowerCase();
    return !lowerUrl.includes('127.0.0.1') &&
           !lowerUrl.includes('localhost') &&
           !lowerUrl.includes('.local') &&
           !lowerUrl.endsWith('/chat') &&
           !lowerUrl.endsWith('/private') &&
           !lowerUrl.endsWith('/outbox');
  });
  const defaultRelays = getDefaultRelays();
  const allRelays = [...new Set([...userRelays, ...defaultRelays])];

  const relayManager = new RelayManager();

  // Connect to relays once
  await Promise.all(
    allRelays.map(url =>
      relayManager.connect(url, { read: false, write: true }).catch(() => {})
    )
  );

  // Process each favorite sequentially with delay
  for (let i = 0; i < favorites.length; i++) {
    const favorite = favorites[i];

    // Report progress
    if (onProgress) {
      onProgress(i, favorites.length, favorite);
    }

    try {
      // Use NIP-51 compliant event format (unified kind 30001 with type in tags)
      const event = createFavoriteEventTemplate(favorite.type, favorite.id, favorite.title, favorite.artist);

      const signedEvent = await signer.signEvent(event as any);
      const results = await relayManager.publish(signedEvent);
      const hasSuccess = results.some(r => r.status === 'fulfilled');

      // Log detailed relay results for debugging
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = results.filter(r => r.status === 'rejected').length;

      if (hasSuccess) {
        result.successful.push({ id: favorite.id, nostrEventId: signedEvent.id });
        console.log(`✅ Batch sync: Published ${favorite.type} ${favorite.id} to Nostr (${successCount}/${results.length} relays)`);
      } else {
        // Log why all relays failed
        const errors = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(r => r.reason?.message || String(r.reason))
          .slice(0, 3); // Only show first 3 errors
        result.failed.push({ id: favorite.id, error: `All ${failCount} relays failed: ${errors.join(', ')}` });
        console.warn(`⚠️ Batch sync: Failed to publish ${favorite.type} ${favorite.id} - ${errors.join(', ')}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.failed.push({ id: favorite.id, error: errorMessage });
      console.error(`❌ Batch sync: Error publishing ${favorite.type} ${favorite.id}:`, error);
    }

    // Add delay between publishes to prevent rate limiting (500ms)
    // Note: Some relays may still reject kind 30001 events (e.g., "only chat related events allowed")
    if (i < favorites.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Final progress update
  if (onProgress) {
    onProgress(favorites.length, favorites.length);
  }

  console.log(`📊 Batch sync complete: ${result.successful.length} successful, ${result.failed.length} failed`);
  return result;
}
