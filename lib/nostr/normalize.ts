import { nip19 } from 'nostr-tools';

export function normalizePubkey(pubkey?: string | null): string | null {
  if (!pubkey || typeof pubkey !== 'string') return null;

  pubkey = pubkey.trim();

  if (pubkey.startsWith('npub')) {
    try {
      const { data } = nip19.decode(pubkey);
      return typeof data === 'string' ? data.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  const hex = pubkey.toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hex)) return hex;

  return null;
}