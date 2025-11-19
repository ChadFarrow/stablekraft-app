import { finalizeEvent, Event, EventTemplate as NostrEventTemplate } from 'nostr-tools';

// Use numeric constants instead of importing from kinds to avoid module resolution issues
const ShortTextNote = 1;
const Contacts = 3;
const Metadata = 0;

/**
 * Event creation and signing utilities
 * Handles creation of Nostr events (kind 1 notes, kind 9735 zaps, etc.)
 */

export interface EventTemplate {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Create and sign a Nostr event
 * @param template - Event template
 * @param privateKey - Private key in hex format
 * @returns Signed Nostr event
 */
export function createEvent(template: EventTemplate, privateKey: string): Event {
  const secretKey = hexToBytes(privateKey);
  const nostrTemplate: NostrEventTemplate = {
    kind: template.kind,
    tags: template.tags,
    content: template.content,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
  };
  const event = finalizeEvent(nostrTemplate, secretKey);
  return event;
}

/**
 * Create a kind 1 note template (unsigned)
 * @param content - Note content
 * @param tags - Optional tags
 * @returns Unsigned event template
 */
export function createNoteTemplate(
  content: string,
  tags: string[][] = []
): EventTemplate {
  return {
    kind: ShortTextNote,
    tags,
    content,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Create a kind 1 note (text note)
 * @param content - Note content
 * @param privateKey - Private key in hex format
 * @param tags - Optional tags
 * @returns Signed event
 */
export function createNote(
  content: string,
  privateKey: string,
  tags: string[][] = []
): Event {
  const template = createNoteTemplate(content, tags);
  return createEvent(template, privateKey);
}

/**
 * Create a zap request event template (unsigned)
 * @param recipientPubkey - Recipient's public key (hex)
 * @param amount - Amount in millisats
 * @param invoice - Lightning invoice
 * @param relays - Optional relay URLs
 * @param content - Optional zap message
 * @returns Unsigned event template
 */
export function createZapRequestTemplate(
  recipientPubkey: string,
  amount: number,
  invoice: string,
  relays?: string[],
  content: string = ''
): EventTemplate {
  const tags: string[][] = [
    ['p', recipientPubkey],
    ['amount', amount.toString()],
  ];

  // Add invoice if provided (bolt11 format per NIP-57)
  if (invoice) {
    tags.push(['bolt11', invoice]);
  }

  // Add relays if provided
  if (relays && relays.length > 0) {
    relays.forEach(relay => {
      tags.push(['relays', relay]);
    });
  }

  return {
    kind: 9735, // Zap request
    tags,
    content,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Create a kind 9735 zap request
 * @param recipientPubkey - Recipient's public key (hex)
 * @param amount - Amount in millisats
 * @param invoice - Lightning invoice
 * @param privateKey - Private key in hex format
 * @param relays - Optional relay URLs
 * @param content - Optional zap message
 * @returns Signed zap request event
 */
export function createZapRequest(
  recipientPubkey: string,
  amount: number,
  invoice: string,
  privateKey: string,
  relays?: string[],
  content: string = ''
): Event {
  const template = createZapRequestTemplate(recipientPubkey, amount, invoice, relays, content);
  return createEvent(template, privateKey);
}

/**
 * Create a kind 9736 zap receipt (after payment confirmation)
 * @param zapRequestEventId - ID of the zap request event
 * @param zapRequestEvent - The zap request event
 * @param preimage - Payment preimage
 * @param privateKey - Private key in hex format
 * @returns Signed zap receipt event
 */
export function createZapReceipt(
  zapRequestEventId: string,
  zapRequestEvent: Event,
  preimage: string,
  privateKey: string
): Event {
  const tags: string[][] = [
    ['bolt11', zapRequestEvent.tags.find(t => t[0] === 'bolt11')?.[1] || ''],
    ['description', JSON.stringify(zapRequestEvent)],
    ['p', zapRequestEvent.tags.find(t => t[0] === 'p')?.[1] || ''],
  ];

  if (preimage) {
    tags.push(['preimage', preimage]);
  }

  return createEvent(
    {
      kind: 9736, // Zap receipt
      tags,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

/**
 * Create a kind 3 contact list template (unsigned)
 * @param pubkeys - Array of public keys to follow
 * @param relays - Optional relay URLs per pubkey
 * @returns Unsigned event template
 */
export function createContactListTemplate(
  pubkeys: string[],
  relays?: Map<string, string[]>
): EventTemplate {
  const tags: string[][] = pubkeys.map(pubkey => {
    const tag: string[] = ['p', pubkey];
    if (relays && relays.has(pubkey)) {
      const relayUrls = relays.get(pubkey)!;
      relayUrls.forEach(relay => {
        tag.push(relay);
      });
    }
    return tag;
  });

  return {
    kind: Contacts,
    tags,
    content: '',
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Create a kind 3 contact list (follow list)
 * @param pubkeys - Array of public keys to follow
 * @param privateKey - Private key in hex format
 * @param relays - Optional relay URLs per pubkey
 * @returns Signed contact list event
 */
export function createContactList(
  pubkeys: string[],
  privateKey: string,
  relays?: Map<string, string[]>
): Event {
  const template = createContactListTemplate(pubkeys, relays);
  return createEvent(template, privateKey);
}

/**
 * Create a kind 0 metadata event
 * @param metadata - User metadata
 * @param privateKey - Private key in hex format
 * @returns Signed metadata event
 */
export function createMetadata(
  metadata: {
    name?: string;
    about?: string;
    picture?: string;
    nip05?: string;
    [key: string]: any;
  },
  privateKey: string
): Event {
  return createEvent(
    {
      kind: Metadata,
      tags: [],
      content: JSON.stringify(metadata),
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

/**
 * Create a kind 30001 favorite track event
 * @param trackId - Track ID
 * @param trackTitle - Track title (optional, for display)
 * @param artistName - Artist name (optional, for display)
 * @param privateKey - Private key in hex format
 * @returns Signed favorite track event
 */
export function createFavoriteTrackEvent(
  trackId: string,
  privateKey: string,
  trackTitle?: string,
  artistName?: string
): Event {
  const tags: string[][] = [
    ['t', 'favorite-track'],
    ['trackId', trackId],
  ];

  if (trackTitle) {
    tags.push(['title', trackTitle]);
  }

  if (artistName) {
    tags.push(['artist', artistName]);
  }

  const content = JSON.stringify({
    trackId,
    ...(trackTitle && { title: trackTitle }),
    ...(artistName && { artist: artistName }),
  });

  return createEvent(
    {
      kind: 30001, // Custom kind for favorite tracks
      tags,
      content,
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

/**
 * Create a kind 30002 favorite album event
 * @param feedId - Feed/Album ID
 * @param albumTitle - Album title (optional, for display)
 * @param artistName - Artist name (optional, for display)
 * @param privateKey - Private key in hex format
 * @returns Signed favorite album event
 */
export function createFavoriteAlbumEvent(
  feedId: string,
  privateKey: string,
  albumTitle?: string,
  artistName?: string
): Event {
  const tags: string[][] = [
    ['t', 'favorite-album'],
    ['feedId', feedId],
  ];

  if (albumTitle) {
    tags.push(['title', albumTitle]);
  }

  if (artistName) {
    tags.push(['artist', artistName]);
  }

  const content = JSON.stringify({
    feedId,
    ...(albumTitle && { title: albumTitle }),
    ...(artistName && { artist: artistName }),
  });

  return createEvent(
    {
      kind: 30002, // Custom kind for favorite albums
      tags,
      content,
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

/**
 * Create a deletion event for a favorite (kind 5 - deletion)
 * @param eventId - ID of the favorite event to delete
 * @param privateKey - Private key in hex format
 * @returns Signed deletion event
 */
export function createFavoriteDeletionEvent(
  eventId: string,
  privateKey: string
): Event {
  return createEvent(
    {
      kind: 5, // Deletion event (NIP-09)
      tags: [['e', eventId]],
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    },
    privateKey
  );
}

/**
 * Validate an event structure
 * @param event - Event to validate
 * @returns true if valid, false otherwise
 */
export function isValidEvent(event: any): event is Event {
  return (
    event &&
    typeof event.id === 'string' &&
    typeof event.sig === 'string' &&
    typeof event.kind === 'number' &&
    Array.isArray(event.tags) &&
    typeof event.content === 'string' &&
    typeof event.created_at === 'number' &&
    typeof event.pubkey === 'string'
  );
}

/**
 * Create a standardized login event template for authentication
 * Uses kind 1 (note) for compatibility with all signers (especially NIP-46/Amber)
 * @param challenge - Authentication challenge string from server
 * @returns Unsigned event template for login
 */
export function createLoginEventTemplate(challenge: string): EventTemplate {
  return {
    kind: ShortTextNote, // Use kind 1 for compatibility (Amber crashes with kind 22242)
    tags: [['challenge', challenge]],
    content: 'Authentication challenge', // Consistent content for all login methods
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Validate a signed event matches expected user public key
 * @param event - Signed event to validate
 * @param expectedPubkey - Expected public key (hex)
 * @returns true if valid, throws error if invalid
 */
export function validateSignedEvent(event: Event, expectedPubkey: string): boolean {
  if (!isValidEvent(event)) {
    throw new Error('Invalid event structure');
  }
  
  if (event.pubkey !== expectedPubkey) {
    throw new Error(`Event pubkey ${event.pubkey.slice(0, 16)}... does not match expected ${expectedPubkey.slice(0, 16)}...`);
  }
  
  return true;
}

