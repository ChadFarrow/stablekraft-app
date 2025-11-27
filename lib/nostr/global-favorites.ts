import { Event, Filter } from 'nostr-tools';
import { NostrClient } from './client';
import { getDefaultRelays } from './relay';
import { publicKeyToNpub } from './keys';

// Event kinds for favorites
export const FAVORITE_TRACK_KIND = 30001;
export const FAVORITE_ALBUM_KIND = 30002;

export interface GlobalFavorite {
  type: 'track' | 'album';
  itemId: string; // trackId or feedId
  title?: string;
  artist?: string;
  favoritedBy: {
    pubkey: string;
    npub: string;
  };
  favoritedAt: number; // Unix timestamp
  nostrEventId: string;
}

export interface FetchGlobalFavoritesOptions {
  limit?: number;
  kinds?: number[]; // [30001], [30002], or [30001, 30002]
  excludePubkey?: string; // Exclude own favorites
  relays?: string[];
  timeout?: number;
  since?: number; // Unix timestamp - only return events created after this time
}

/**
 * Parse a favorite event to extract the item ID and metadata
 */
function parseFavoriteEvent(event: Event): GlobalFavorite | null {
  try {
    const isTrack = event.kind === FAVORITE_TRACK_KIND;
    const isAlbum = event.kind === FAVORITE_ALBUM_KIND;

    if (!isTrack && !isAlbum) {
      return null;
    }

    // Try to get ID from tags first
    let itemId: string | undefined;
    let title: string | undefined;
    let artist: string | undefined;

    for (const tag of event.tags) {
      if (tag[0] === 'trackId' && isTrack) {
        itemId = tag[1];
      } else if (tag[0] === 'feedId' && isAlbum) {
        itemId = tag[1];
      } else if (tag[0] === 'title') {
        title = tag[1];
      } else if (tag[0] === 'artist') {
        artist = tag[1];
      }
    }

    // Fall back to content if tags don't have ID
    if (!itemId && event.content) {
      try {
        const content = JSON.parse(event.content);
        itemId = isTrack ? content.trackId : content.feedId;
        title = title || content.title;
        artist = artist || content.artist;
      } catch {
        // Content is not valid JSON
      }
    }

    if (!itemId) {
      return null;
    }

    return {
      type: isTrack ? 'track' : 'album',
      itemId,
      title,
      artist,
      favoritedBy: {
        pubkey: event.pubkey,
        npub: publicKeyToNpub(event.pubkey),
      },
      favoritedAt: event.created_at,
      nostrEventId: event.id,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch global favorites from Nostr relays
 * Returns favorites from any user, sorted by most recent
 */
export async function fetchGlobalFavorites(
  options: FetchGlobalFavoritesOptions = {}
): Promise<GlobalFavorite[]> {
  const {
    limit = 100,
    kinds = [FAVORITE_TRACK_KIND, FAVORITE_ALBUM_KIND],
    excludePubkey,
    relays = getDefaultRelays(),
    timeout = 8000,
    since,
  } = options;

  const client = new NostrClient(relays);

  try {
    // Build filter for favorite events
    const filter: Filter = {
      kinds,
      limit,
      ...(since && { since }), // Only return events after this timestamp
    };

    // Query relays for events
    const events = await client.getEvents([filter], relays, timeout);

    // Parse and filter events
    const favorites: GlobalFavorite[] = [];
    const seenEventIds = new Set<string>();

    for (const event of events) {
      // Skip duplicates
      if (seenEventIds.has(event.id)) {
        continue;
      }
      seenEventIds.add(event.id);

      // Skip own favorites if requested
      if (excludePubkey && event.pubkey === excludePubkey) {
        continue;
      }

      const favorite = parseFavoriteEvent(event);
      if (favorite) {
        favorites.push(favorite);
      }
    }

    // Sort by most recent first
    favorites.sort((a, b) => b.favoritedAt - a.favoritedAt);

    return favorites.slice(0, limit);
  } finally {
    await client.disconnect();
  }
}

/**
 * Fetch profiles for a list of pubkeys
 * Returns a map of pubkey -> profile data
 */
export async function fetchProfiles(
  pubkeys: string[],
  relays?: string[]
): Promise<Map<string, { displayName?: string; avatar?: string; nip05?: string }>> {
  const uniquePubkeys = [...new Set(pubkeys)];
  const profiles = new Map<string, { displayName?: string; avatar?: string; nip05?: string }>();

  if (uniquePubkeys.length === 0) {
    return profiles;
  }

  const client = new NostrClient(relays || getDefaultRelays());

  try {
    // Fetch profiles in batches to avoid overwhelming relays
    const batchSize = 20;
    for (let i = 0; i < uniquePubkeys.length; i += batchSize) {
      const batch = uniquePubkeys.slice(i, i + batchSize);

      const filter: Filter = {
        kinds: [0], // Metadata
        authors: batch,
      };

      const events = await client.getEvents([filter], relays, 5000);

      // Process profile events
      for (const event of events) {
        try {
          const content = JSON.parse(event.content);
          profiles.set(event.pubkey, {
            displayName: content.display_name || content.name,
            avatar: content.picture,
            nip05: content.nip05,
          });
        } catch {
          // Invalid profile content
        }
      }
    }

    return profiles;
  } finally {
    await client.disconnect();
  }
}
