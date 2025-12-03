import { Event, Filter } from 'nostr-tools';
import { NostrClient } from './client';
import { getDefaultRelays } from './relay';
import { publicKeyToNpub } from './keys';

// Event kind for favorites (NIP-51 compliant - single kind with type discrimination via tags)
export const FAVORITE_KIND = 30001;
// Legacy: Keep for backward compatibility reading old events
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
  kinds?: number[]; // Default: [30001, 30002] for backward compatibility
  type?: 'track' | 'album' | 'all'; // Filter by type (parsed from tags, not kind)
  excludePubkey?: string; // Exclude own favorites
  relays?: string[];
  timeout?: number;
  since?: number; // Unix timestamp - only return events created after this time
}

/**
 * Parse a favorite event to extract the item ID and metadata
 * Supports both new NIP-51 format (type via ["t"] tag) and legacy format (type via kind)
 */
function parseFavoriteEvent(event: Event): GlobalFavorite | null {
  try {
    // Only accept kind 30001 or 30002 (legacy)
    if (event.kind !== FAVORITE_KIND && event.kind !== FAVORITE_ALBUM_KIND) {
      return null;
    }

    let itemId: string | undefined;
    let title: string | undefined;
    let artist: string | undefined;
    let type: 'track' | 'album' | undefined;

    // Parse tags
    for (const tag of event.tags) {
      if (tag[0] === 't' && (tag[1] === 'track' || tag[1] === 'album')) {
        // New NIP-51 format: type from ["t"] tag
        type = tag[1] as 'track' | 'album';
      } else if (tag[0] === 'd') {
        // NIP-51 format: item ID from ["d"] tag
        itemId = tag[1];
      } else if (tag[0] === 'trackId') {
        // Legacy format
        itemId = tag[1];
        if (!type) type = 'track';
      } else if (tag[0] === 'feedId') {
        // Legacy format
        itemId = tag[1];
        if (!type) type = 'album';
      } else if (tag[0] === 'title') {
        title = tag[1];
      } else if (tag[0] === 'artist') {
        artist = tag[1];
      }
    }

    // Legacy fallback: determine type from kind if not in tags
    if (!type) {
      if (event.kind === FAVORITE_ALBUM_KIND) {
        type = 'album';
      } else {
        type = 'track'; // Default to track for kind 30001
      }
    }

    // Fall back to content if tags don't have ID
    if (!itemId && event.content) {
      try {
        const content = JSON.parse(event.content);
        itemId = content.id || (type === 'track' ? content.trackId : content.feedId);
        title = title || content.title;
        artist = artist || content.artist;
        // Also check type in content for new format
        if (!type && content.type) {
          type = content.type;
        }
      } catch {
        // Content is not valid JSON
      }
    }

    if (!itemId || !type) {
      return null;
    }

    return {
      type,
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
    kinds = [FAVORITE_KIND, FAVORITE_ALBUM_KIND], // Query both for backward compatibility
    type = 'all',
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
      limit: limit * 2, // Fetch extra to account for type filtering
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
        // Filter by type if specified
        if (type !== 'all' && favorite.type !== type) {
          continue;
        }
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
