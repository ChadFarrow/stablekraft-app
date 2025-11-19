import { nip19 } from 'nostr-tools';

/**
 * NIP-19 encoding/decoding utilities
 * Handles npub, nprofile, naddr, and other bech32-encoded Nostr entities
 */

export interface DecodedNpub {
  type: 'npub';
  data: string; // hex public key
}

export interface DecodedNprofile {
  type: 'nprofile';
  data: {
    pubkey: string; // hex public key
    relays?: string[];
  };
}

export interface DecodedNaddr {
  type: 'naddr';
  data: {
    pubkey: string;
    kind: number;
    identifier: string;
    relays?: string[];
  };
}

export type DecodedNostrEntity = DecodedNpub | DecodedNprofile | DecodedNaddr;

/**
 * Encode a public key to npub
 * @param pubkey - Public key in hex format
 * @returns npub string
 */
export function encodeNpub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

/**
 * Decode an npub to public key
 * @param npub - npub string
 * @returns Public key in hex format
 */
export function decodeNpub(npub: string): string {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error('Invalid npub format');
  }
  return decoded.data;
}

/**
 * Encode a profile to nprofile
 * @param pubkey - Public key in hex format
 * @param relays - Optional array of relay URLs
 * @returns nprofile string
 */
export function encodeNprofile(pubkey: string, relays?: string[]): string {
  return nip19.nprofileEncode({ pubkey, relays });
}

/**
 * Decode an nprofile
 * @param nprofile - nprofile string
 * @returns Decoded profile data
 */
export function decodeNprofile(nprofile: string): { pubkey: string; relays?: string[] } {
  const decoded = nip19.decode(nprofile);
  if (decoded.type !== 'nprofile') {
    throw new Error('Invalid nprofile format');
  }
  return decoded.data;
}

/**
 * Encode an address to naddr
 * @param pubkey - Public key in hex format
 * @param kind - Event kind
 * @param identifier - Identifier string
 * @param relays - Optional array of relay URLs
 * @returns naddr string
 */
export function encodeNaddr(
  pubkey: string,
  kind: number,
  identifier: string,
  relays?: string[]
): string {
  return nip19.naddrEncode({ pubkey, kind, identifier, relays });
}

/**
 * Decode an naddr
 * @param naddr - naddr string
 * @returns Decoded address data
 */
export function decodeNaddr(naddr: string): {
  pubkey: string;
  kind: number;
  identifier: string;
  relays?: string[];
} {
  const decoded = nip19.decode(naddr);
  if (decoded.type !== 'naddr') {
    throw new Error('Invalid naddr format');
  }
  return decoded.data;
}

/**
 * Decode any NIP-19 entity
 * @param entity - bech32-encoded entity
 * @returns Decoded entity data
 */
export function decode(entity: string): DecodedNostrEntity {
  return nip19.decode(entity) as DecodedNostrEntity;
}

/**
 * Encode an event to nevent
 * @param eventId - Event ID in hex format
 * @param relays - Optional array of relay URLs
 * @param author - Optional author public key in hex format
 * @returns nevent string
 */
export function encodeNevent(
  eventId: string,
  relays?: string[],
  author?: string
): string {
  return nip19.neventEncode({ id: eventId, relays, author });
}

/**
 * Decode a nevent
 * @param nevent - nevent string
 * @returns Decoded event data
 */
export function decodeNevent(nevent: string): {
  id: string;
  relays?: string[];
  author?: string;
} {
  const decoded = nip19.decode(nevent);
  if (decoded.type !== 'nevent') {
    throw new Error('Invalid nevent format');
  }
  return decoded.data;
}

/**
 * Check if a string is a valid NIP-19 entity
 * @param entity - String to check
 * @returns true if valid, false otherwise
 */
export function isValidNip19Entity(entity: string): boolean {
  try {
    nip19.decode(entity);
    return true;
  } catch {
    return false;
  }
}

