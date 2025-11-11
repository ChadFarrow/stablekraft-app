/**
 * NIP-05: Mapping Nostr keys to DNS-based identifiers
 * https://github.com/nostr-protocol/nips/blob/master/05.md
 */

export interface Nip05Response {
  names: {
    [name: string]: string; // name -> hex pubkey
  };
  relays?: {
    [pubkey: string]: string[]; // pubkey -> relay URLs
  };
}

/**
 * Verify a NIP-05 identifier
 * @param identifier - Identifier in format "name@domain.com"
 * @param pubkey - Public key in hex format to verify against
 * @returns true if verified, false otherwise
 */
export async function verifyNip05(identifier: string, pubkey: string): Promise<boolean> {
  try {
    const [name, domain] = identifier.split('@');
    if (!name || !domain) {
      return false;
    }

    const url = `https://${domain}/.well-known/nostr.json?name=${name}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return false;
    }

    const data: Nip05Response = await response.json();
    const verifiedPubkey = data.names[name];

    if (!verifiedPubkey) {
      return false;
    }

    // Compare pubkeys (case-insensitive)
    return verifiedPubkey.toLowerCase() === pubkey.toLowerCase();
  } catch (error) {
    console.error('NIP-05 verification error:', error);
    return false;
  }
}

/**
 * Get NIP-05 identifier for a pubkey
 * @param pubkey - Public key in hex format
 * @param domain - Domain to check
 * @returns Identifier if found, null otherwise
 */
export async function getNip05Identifier(pubkey: string, domain: string): Promise<string | null> {
  try {
    const url = `https://${domain}/.well-known/nostr.json`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: Nip05Response = await response.json();

    // Find the name that maps to this pubkey
    for (const [name, key] of Object.entries(data.names)) {
      if (key.toLowerCase() === pubkey.toLowerCase()) {
        return `${name}@${domain}`;
      }
    }

    return null;
  } catch (error) {
    console.error('NIP-05 lookup error:', error);
    return null;
  }
}

/**
 * Get relay URLs for a pubkey from NIP-05
 * @param identifier - Identifier in format "name@domain.com"
 * @returns Array of relay URLs, or empty array if not found
 */
export async function getNip05Relays(identifier: string): Promise<string[]> {
  try {
    const [name, domain] = identifier.split('@');
    if (!name || !domain) {
      return [];
    }

    const url = `https://${domain}/.well-known/nostr.json?name=${name}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    const data: Nip05Response = await response.json();
    const pubkey = data.names[name];

    if (!pubkey || !data.relays) {
      return [];
    }

    return data.relays[pubkey] || [];
  } catch (error) {
    console.error('NIP-05 relay lookup error:', error);
    return [];
  }
}

