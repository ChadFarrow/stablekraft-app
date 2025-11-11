import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

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
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a new Nostr key pair
 * @returns Object with privateKey (hex) and publicKey (hex)
 */
export function generateKeyPair(): { privateKey: string; publicKey: string } {
  const secretKey = generateSecretKey();
  const privateKey = bytesToHex(secretKey);
  const publicKey = getPublicKey(secretKey);
  return { privateKey, publicKey };
}

/**
 * Convert hex private key to nsec (bech32 encoded)
 * @param privateKeyHex - Private key in hex format
 * @returns nsec string
 */
export function privateKeyToNsec(privateKeyHex: string): string {
  try {
    const secretKey = hexToBytes(privateKeyHex);
    return nip19.nsecEncode(secretKey);
  } catch (error) {
    throw new Error(`Failed to encode private key to nsec: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert nsec (bech32 encoded) to hex private key
 * @param nsec - nsec string
 * @returns Private key in hex format
 */
export function nsecToPrivateKey(nsec: string): string {
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') {
      throw new Error('Invalid nsec format');
    }
    return bytesToHex(decoded.data);
  } catch (error) {
    throw new Error(`Failed to decode nsec: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert hex public key to npub (bech32 encoded)
 * @param publicKeyHex - Public key in hex format
 * @returns npub string
 */
export function publicKeyToNpub(publicKeyHex: string): string {
  try {
    return nip19.npubEncode(publicKeyHex);
  } catch (error) {
    throw new Error(`Failed to encode public key to npub: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Convert npub (bech32 encoded) to hex public key
 * @param npub - npub string
 * @returns Public key in hex format
 */
export function npubToPublicKey(npub: string): string {
  try {
    const decoded = nip19.decode(npub);
    if (decoded.type !== 'npub') {
      throw new Error('Invalid npub format');
    }
    return decoded.data;
  } catch (error) {
    throw new Error(`Failed to decode npub: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate a hex private key format
 * @param privateKey - Private key to validate
 * @returns true if valid, false otherwise
 */
export function isValidPrivateKey(privateKey: string): boolean {
  return /^[a-f0-9]{64}$/i.test(privateKey);
}

/**
 * Validate a hex public key format
 * @param publicKey - Public key to validate
 * @returns true if valid, false otherwise
 */
export function isValidPublicKey(publicKey: string): boolean {
  return /^[a-f0-9]{64}$/i.test(publicKey);
}

/**
 * Validate an npub format
 * @param npub - npub string to validate
 * @returns true if valid, false otherwise
 */
export function isValidNpub(npub: string): boolean {
  try {
    const decoded = nip19.decode(npub);
    return decoded.type === 'npub';
  } catch {
    return false;
  }
}

/**
 * Validate an nsec format
 * @param nsec - nsec string to validate
 * @returns true if valid, false otherwise
 */
export function isValidNsec(nsec: string): boolean {
  try {
    const decoded = nip19.decode(nsec);
    return decoded.type === 'nsec';
  } catch {
    return false;
  }
}

/**
 * Get public key from private key
 * @param privateKey - Private key in hex format
 * @returns Public key in hex format
 */
export function getPublicKeyFromPrivate(privateKey: string): string {
  if (!isValidPrivateKey(privateKey)) {
    throw new Error('Invalid private key format');
  }
  const secretKey = hexToBytes(privateKey);
  return getPublicKey(secretKey);
}

