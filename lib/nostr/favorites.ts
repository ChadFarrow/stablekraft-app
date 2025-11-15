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

