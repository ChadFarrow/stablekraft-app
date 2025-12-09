/**
 * NIP-65: Relay List Metadata
 * Handles fetching and storing user's relay preferences
 * Spec: https://github.com/nostr-protocol/nips/blob/master/65.md
 */

import { getDefaultRelays, filterReachableRelays } from './relay';

export interface RelayInfo {
  url: string;
  read: boolean;
  write: boolean;
}

export interface UserRelays {
  all: string[];
  read: string[];
  write: string[];
  fetchedAt: number;
}

const USER_RELAYS_KEY = 'nostr_user_relays';

/**
 * Fetch user's NIP-65 relay list from Nostr relays
 * @param pubkey - User's public key (hex)
 * @returns UserRelays object or null if not found
 */
export async function fetchUserRelays(pubkey: string): Promise<UserRelays | null> {
  try {
    console.log('🔍 NIP-65: Fetching relay list for', pubkey.slice(0, 16) + '...');

    // Use default relays to query for the user's relay list
    const queryRelays = getDefaultRelays();

    // Import nostr-tools for subscription
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();

    // Query for kind 10002 (relay list metadata)
    const events = await pool.querySync(queryRelays, {
      kinds: [10002],
      authors: [pubkey],
      limit: 1,
    });

    pool.close(queryRelays);

    if (!events || events.length === 0) {
      console.log('ℹ️ NIP-65: No relay list found for user');
      return null;
    }

    // Get the most recent event
    const event = events.sort((a, b) => b.created_at - a.created_at)[0];

    // Parse relay tags
    // NIP-65 format: ["r", "wss://relay.url", "read"/"write" (optional)]
    // If no marker, relay is used for both read and write
    const relays: RelayInfo[] = [];

    for (const tag of event.tags) {
      if (tag[0] === 'r' && tag[1]) {
        const url = tag[1];
        // Validate relay URL format
        if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
          continue;
        }

        const marker = tag[2]?.toLowerCase();
        relays.push({
          url,
          read: marker === 'read' || !marker,  // Default to both if no marker
          write: marker === 'write' || !marker, // Default to both if no marker
        });
      }
    }

    if (relays.length === 0) {
      console.log('ℹ️ NIP-65: Relay list event found but no valid relays');
      return null;
    }

    const userRelays: UserRelays = {
      all: relays.map(r => r.url),
      read: relays.filter(r => r.read).map(r => r.url),
      write: relays.filter(r => r.write).map(r => r.url),
      fetchedAt: Date.now(),
    };

    console.log(`✅ NIP-65: Found ${relays.length} relays (${userRelays.read.length} read, ${userRelays.write.length} write)`);

    return userRelays;
  } catch (error) {
    console.error('❌ NIP-65: Error fetching relay list:', error);
    return null;
  }
}

/**
 * Fetch and store user's relay list
 * Call this after Nostr login
 * @param pubkey - User's public key (hex)
 * @returns UserRelays object or null
 */
export async function fetchAndStoreUserRelays(pubkey: string): Promise<UserRelays | null> {
  const relays = await fetchUserRelays(pubkey);

  if (relays) {
    try {
      localStorage.setItem(USER_RELAYS_KEY, JSON.stringify({
        pubkey,
        ...relays,
      }));
      console.log('💾 NIP-65: Saved user relays to localStorage');
    } catch (error) {
      console.error('❌ NIP-65: Failed to save relays to localStorage:', error);
    }
  }

  return relays;
}

/**
 * Get stored user relays from localStorage
 * @param pubkey - Optional pubkey to validate against stored data
 * @returns UserRelays object or null
 */
export function getStoredUserRelays(pubkey?: string): UserRelays | null {
  try {
    const stored = localStorage.getItem(USER_RELAYS_KEY);
    if (!stored) return null;

    const data = JSON.parse(stored);

    // Validate pubkey if provided
    if (pubkey && data.pubkey !== pubkey) {
      console.log('⚠️ NIP-65: Stored relays are for different user');
      return null;
    }

    // Check if data is stale (older than 24 hours)
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    if (Date.now() - data.fetchedAt > maxAge) {
      console.log('ℹ️ NIP-65: Stored relays are stale');
      // Return stale data but could trigger refresh
    }

    return {
      all: data.all || [],
      read: data.read || [],
      write: data.write || [],
      fetchedAt: data.fetchedAt,
    };
  } catch (error) {
    console.error('❌ NIP-65: Error reading stored relays:', error);
    return null;
  }
}

/**
 * Get user's write relays for publishing events
 * Falls back to default relays if user has none stored
 * Automatically filters out unreachable relays (localhost, .local, etc.)
 * @param pubkey - Optional pubkey to validate
 * @returns Array of relay URLs
 */
export function getUserWriteRelays(pubkey?: string): string[] {
  const stored = getStoredUserRelays(pubkey);

  if (stored && stored.write.length > 0) {
    const filtered = filterReachableRelays(stored.write);
    console.log(`📡 NIP-65: Using ${filtered.length} user write relays (filtered from ${stored.write.length})`);
    return filtered;
  }

  console.log('📡 NIP-65: No user relays, using defaults');
  return getDefaultRelays();
}

/**
 * Get user's read relays for querying events
 * Falls back to default relays if user has none stored
 * Automatically filters out unreachable relays (localhost, .local, etc.)
 * @param pubkey - Optional pubkey to validate
 * @returns Array of relay URLs
 */
export function getUserReadRelays(pubkey?: string): string[] {
  const stored = getStoredUserRelays(pubkey);

  if (stored && stored.read.length > 0) {
    const filtered = filterReachableRelays(stored.read);
    return filtered;
  }

  return getDefaultRelays();
}

/**
 * Clear stored user relays (call on logout)
 */
export function clearStoredUserRelays(): void {
  try {
    localStorage.removeItem(USER_RELAYS_KEY);
    console.log('🗑️ NIP-65: Cleared stored user relays');
  } catch (error) {
    console.error('❌ NIP-65: Error clearing stored relays:', error);
  }
}
