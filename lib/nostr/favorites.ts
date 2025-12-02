/**
 * Nostr favorites utilities
 * Handles publishing favorites to Nostr relays for decentralized storage
 * Also stored in database for fast queries
 */

import { Event } from 'nostr-tools';
import { createFavoriteTrackEvent, createFavoriteAlbumEvent, createFavoriteDeletionEvent } from './events';
import { RelayManager, getDefaultRelays } from './relay';

/**
 * Publish a favorite track event to Nostr relays
 * @param trackId - Track ID
 * @param privateKey - Private key (hex) or use extension if available
 * @param trackTitle - Optional track title
 * @param artistName - Optional artist name
 * @param relays - Optional relay URLs (defaults to user's configured relays or default relays)
 * @returns Published event ID
 */
export async function publishFavoriteTrackToNostr(
  trackId: string,
  privateKey: string | null,
  trackTitle?: string,
  artistName?: string,
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
            console.log('ℹ️ Favorite track not posted to Nostr: NIP-55 reconnection failed');
            return null;
          }
        } else {
          console.log('ℹ️ Favorite track not posted to Nostr: No signer available');
          return null;
        }
      }

      if (signer.isAvailable()) {
        const event = {
          kind: 30001,
          tags: [
            ['t', 'favorite-track'],
            ['trackId', trackId],
            ...(trackTitle ? [['title', trackTitle]] : []),
            ...(artistName ? [['artist', artistName]] : []),
          ],
          content: JSON.stringify({
            trackId,
            ...(trackTitle && { title: trackTitle }),
            ...(artistName && { artist: artistName }),
          }),
          created_at: Math.floor(Date.now() / 1000),
        };

        const signedEvent = await signer.signEvent(event as any);
        
        // Publish to relays
        const relayUrls = relays || getDefaultRelays();
        const relayManager = new RelayManager();
        
        await Promise.all(
          relayUrls.map(url =>
            relayManager.connect(url, { read: false, write: true }).catch(() => {})
          )
        );

        const results = await relayManager.publish(signedEvent);
        const hasSuccess = results.some(r => r.status === 'fulfilled');
        
        if (hasSuccess) {
          console.log('✅ Published favorite track to Nostr:', signedEvent.id);
          return signedEvent.id;
        } else {
          console.warn('⚠️ Failed to publish favorite track to any relay');
          return null;
        }
      }
    }

    // For manual key logins, sign with the private key
    if (privateKey) {
      const event = createFavoriteTrackEvent(trackId, privateKey, trackTitle, artistName);
      
      const relayUrls = relays || getDefaultRelays();
      const relayManager = new RelayManager();
      
      await Promise.all(
        relayUrls.map(url =>
          relayManager.connect(url, { read: false, write: true }).catch(() => {})
        )
      );

      const results = await relayManager.publish(event);
      const hasSuccess = results.some(r => r.status === 'fulfilled');
      
      if (hasSuccess) {
        console.log('✅ Published favorite track to Nostr:', event.id);
        return event.id;
      } else {
        console.warn('⚠️ Failed to publish favorite track to any relay');
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error publishing favorite track to Nostr:', error);
    return null;
  }
}

/**
 * Publish a favorite album event to Nostr relays
 * @param feedId - Feed/Album ID
 * @param privateKey - Private key (hex) or use extension if available
 * @param albumTitle - Optional album title
 * @param artistName - Optional artist name
 * @param relays - Optional relay URLs
 * @returns Published event ID
 */
export async function publishFavoriteAlbumToNostr(
  feedId: string,
  privateKey: string | null,
  albumTitle?: string,
  artistName?: string,
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
            console.log('ℹ️ Favorite album not posted to Nostr: NIP-55 reconnection failed');
            return null;
          }
        } else {
          console.log('ℹ️ Favorite album not posted to Nostr: No signer available');
          return null;
        }
      }

      if (signer.isAvailable()) {
        const event = {
          kind: 30002,
          tags: [
            ['t', 'favorite-album'],
            ['feedId', feedId],
            ...(albumTitle ? [['title', albumTitle]] : []),
            ...(artistName ? [['artist', artistName]] : []),
          ],
          content: JSON.stringify({
            feedId,
            ...(albumTitle && { title: albumTitle }),
            ...(artistName && { artist: artistName }),
          }),
          created_at: Math.floor(Date.now() / 1000),
        };

        const signedEvent = await signer.signEvent(event as any);
        
        // Publish to relays
        const relayUrls = relays || getDefaultRelays();
        const relayManager = new RelayManager();
        
        await Promise.all(
          relayUrls.map(url =>
            relayManager.connect(url, { read: false, write: true }).catch(() => {})
          )
        );

        const results = await relayManager.publish(signedEvent);
        const hasSuccess = results.some(r => r.status === 'fulfilled');
        
        if (hasSuccess) {
          console.log('✅ Published favorite album to Nostr:', signedEvent.id);
          return signedEvent.id;
        } else {
          console.warn('⚠️ Failed to publish favorite album to any relay');
          return null;
        }
      }
    }

    // For manual key logins, sign with the private key
    if (privateKey) {
      const event = createFavoriteAlbumEvent(feedId, privateKey, albumTitle, artistName);
      
      const relayUrls = relays || getDefaultRelays();
      const relayManager = new RelayManager();
      
      await Promise.all(
        relayUrls.map(url =>
          relayManager.connect(url, { read: false, write: true }).catch(() => {})
        )
      );

      const results = await relayManager.publish(event);
      const hasSuccess = results.some(r => r.status === 'fulfilled');
      
      if (hasSuccess) {
        console.log('✅ Published favorite album to Nostr:', event.id);
        return event.id;
      } else {
        console.warn('⚠️ Failed to publish favorite album to any relay');
        return null;
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error publishing favorite album to Nostr:', error);
    return null;
  }
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
        
        // Publish to relays
        const relayUrls = relays || getDefaultRelays();
        const relayManager = new RelayManager();
        
        await Promise.all(
          relayUrls.map(url =>
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
      
      const relayUrls = relays || getDefaultRelays();
      const relayManager = new RelayManager();
      
      await Promise.all(
        relayUrls.map(url =>
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

  const relayUrls = relays || getDefaultRelays();
  const relayManager = new RelayManager();

  // Connect to relays once
  await Promise.all(
    relayUrls.map(url =>
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
      const event = favorite.type === 'track'
        ? {
            kind: 30001,
            tags: [
              ['t', 'favorite-track'],
              ['trackId', favorite.id],
              ...(favorite.title ? [['title', favorite.title]] : []),
              ...(favorite.artist ? [['artist', favorite.artist]] : []),
            ],
            content: JSON.stringify({
              trackId: favorite.id,
              ...(favorite.title && { title: favorite.title }),
              ...(favorite.artist && { artist: favorite.artist }),
            }),
            created_at: Math.floor(Date.now() / 1000),
          }
        : {
            kind: 30002,
            tags: [
              ['t', 'favorite-album'],
              ['feedId', favorite.id],
              ...(favorite.title ? [['title', favorite.title]] : []),
              ...(favorite.artist ? [['artist', favorite.artist]] : []),
            ],
            content: JSON.stringify({
              feedId: favorite.id,
              ...(favorite.title && { title: favorite.title }),
              ...(favorite.artist && { artist: favorite.artist }),
            }),
            created_at: Math.floor(Date.now() / 1000),
          };

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

    // Add delay between publishes to prevent rate limiting (200ms)
    if (i < favorites.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Final progress update
  if (onProgress) {
    onProgress(favorites.length, favorites.length);
  }

  console.log(`📊 Batch sync complete: ${result.successful.length} successful, ${result.failed.length} failed`);
  return result;
}
