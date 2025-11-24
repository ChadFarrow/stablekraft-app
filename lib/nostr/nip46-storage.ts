/**
 * NIP-46 Connection Storage
 * Handles persistence of NIP-46 connections in localStorage
 * 
 * IMPORTANT: Connections are tied to the user's Nostr account (pubkey from Amber),
 * not the connection token. Multiple connections with the same user pubkey = same account.
 */

import { generateKeyPair } from './keys';

/**
 * NIP-46 Connection interface
 * Represents a connection to a remote signer (like Amber)
 */
export interface NIP46Connection {
  signerUrl: string;
  token: string;
  pubkey?: string;
  connected: boolean;
  connectedAt?: number;
}

const STORAGE_KEY = 'nostr_nip46_connection';
const STORAGE_KEY_BY_PUBKEY = 'nostr_nip46_connections_by_pubkey'; // Store multiple connections per user
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface StoredConnection {
  signerUrl: string;
  token: string;
  pubkey?: string; // User's Nostr account pubkey (from Amber)
  connectedAt?: number;
  expiresAt: number;
}

/**
 * Save NIP-46 connection to localStorage
 * Connections are stored by user pubkey (Nostr account), allowing multiple connections per account
 */
export function saveNIP46Connection(connection: NIP46Connection): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const stored: StoredConnection = {
      signerUrl: connection.signerUrl,
      token: connection.token,
      pubkey: connection.pubkey, // User's Nostr account pubkey (from Amber)
      connectedAt: connection.connectedAt || Date.now(),
      expiresAt: Date.now() + TOKEN_EXPIRY_MS,
    };

    // Store the most recent connection (for backward compatibility)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    
    // Also store by user pubkey if available (allows multiple connections per account)
    if (connection.pubkey) {
      try {
        const byPubkey = JSON.parse(localStorage.getItem(STORAGE_KEY_BY_PUBKEY) || '{}');
        if (!byPubkey[connection.pubkey]) {
          byPubkey[connection.pubkey] = [];
        }
        // Add or update this connection
        const existingIndex = byPubkey[connection.pubkey].findIndex(
          (c: StoredConnection) => c.token === connection.token
        );
        if (existingIndex >= 0) {
          byPubkey[connection.pubkey][existingIndex] = stored;
        } else {
          byPubkey[connection.pubkey].push(stored);
        }
        // Keep only the most recent 5 connections per pubkey
        byPubkey[connection.pubkey] = byPubkey[connection.pubkey]
          .sort((a: StoredConnection, b: StoredConnection) => 
            (b.connectedAt || 0) - (a.connectedAt || 0)
          )
          .slice(0, 5);
        localStorage.setItem(STORAGE_KEY_BY_PUBKEY, JSON.stringify(byPubkey));
        console.log(`💾 NIP-46: Saved connection for user pubkey ${connection.pubkey.slice(0, 16)}... (total connections for this account: ${byPubkey[connection.pubkey].length})`);
      } catch (err) {
        console.warn('⚠️ Failed to save connection by pubkey:', err);
      }
    }
    
    console.log('💾 NIP-46: Saved connection to localStorage:', {
      userPubkey: connection.pubkey ? connection.pubkey.slice(0, 16) + '...' : 'N/A',
      relayUrl: connection.signerUrl,
      note: 'Connection tied to user\'s Nostr account (pubkey), not connection token',
    });
  } catch (error) {
    console.error('❌ Failed to save NIP-46 connection:', error);
  }
}

/**
 * Load NIP-46 connection from localStorage
 * If userPubkey is provided, loads the most recent connection for that user account
 * Otherwise, loads the most recent connection (backward compatibility)
 */
export function loadNIP46Connection(userPubkey?: string): NIP46Connection | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // If userPubkey is provided, try to load from pubkey-indexed storage first
    if (userPubkey) {
      try {
        const byPubkey = JSON.parse(localStorage.getItem(STORAGE_KEY_BY_PUBKEY) || '{}');
        const userConnections = byPubkey[userPubkey] || [];
        if (userConnections.length > 0) {
          // Get the most recent connection for this user
          const mostRecent = userConnections
            .filter((c: StoredConnection) => !c.expiresAt || Date.now() < c.expiresAt)
            .sort((a: StoredConnection, b: StoredConnection) => 
              (b.connectedAt || 0) - (a.connectedAt || 0)
            )[0];
          
          if (mostRecent) {
            console.log(`✅ NIP-46: Loaded connection for user pubkey ${userPubkey.slice(0, 16)}... (found ${userConnections.length} connection(s) for this account)`);
            return {
              signerUrl: mostRecent.signerUrl,
              token: mostRecent.token,
              pubkey: mostRecent.pubkey,
              connected: false, // Always start disconnected, need to reconnect
              connectedAt: mostRecent.connectedAt,
            };
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to load connection by pubkey, falling back to default:', err);
      }
    }
    
    // Fall back to default storage (backward compatibility)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return null;
    }

    const parsed: StoredConnection = JSON.parse(stored);

    // Check if connection has expired
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      console.log('⚠️ NIP-46 connection expired, removing');
      clearNIP46Connection();
      return null;
    }

    // If userPubkey was provided but doesn't match, return null
    // This ensures we only use connections for the correct user account
    if (userPubkey && parsed.pubkey && parsed.pubkey !== userPubkey) {
      console.log(`⚠️ NIP-46: Stored connection is for different user pubkey (stored: ${parsed.pubkey.slice(0, 16)}..., requested: ${userPubkey.slice(0, 16)}...). Returning null.`);
      return null;
    }

    return {
      signerUrl: parsed.signerUrl,
      token: parsed.token,
      pubkey: parsed.pubkey,
      connected: false, // Always start disconnected, need to reconnect
      connectedAt: parsed.connectedAt,
    };
  } catch (error) {
    console.error('❌ Failed to load NIP-46 connection:', error);
    return null;
  }
}

/**
 * Clear NIP-46 connection from localStorage
 */
export function clearNIP46Connection(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('❌ Failed to clear NIP-46 connection:', error);
  }
}

/**
 * Clear NIP-46 connections for a specific user pubkey
 * This removes all connections stored for the given user
 */
export function clearNIP46ConnectionForUser(userPubkey: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    // Clear from pubkey-indexed storage
    const byPubkey = JSON.parse(localStorage.getItem(STORAGE_KEY_BY_PUBKEY) || '{}');
    if (byPubkey[userPubkey]) {
      delete byPubkey[userPubkey];
      localStorage.setItem(STORAGE_KEY_BY_PUBKEY, JSON.stringify(byPubkey));
      console.log(`✅ NIP-46: Cleared connections for user pubkey ${userPubkey.slice(0, 16)}...`);
    }

    // Also clear default storage if it matches this user
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: StoredConnection = JSON.parse(stored);
        if (parsed.pubkey === userPubkey) {
          localStorage.removeItem(STORAGE_KEY);
          console.log(`✅ NIP-46: Cleared default connection for user pubkey ${userPubkey.slice(0, 16)}...`);
        }
      } catch (err) {
        // Ignore parse errors
      }
    }
  } catch (error) {
    console.error('❌ Failed to clear NIP-46 connections for user:', error);
  }
}

/**
 * Check if there's a valid existing NIP-46 connection
 * @returns true if a connection exists with valid pubkey and connection data
 */
export function hasValidConnection(): boolean {
  const connection = loadNIP46Connection();

  if (!connection) {
    return false;
  }

  // Check if connection has required fields
  const hasRequiredFields = !!(
    connection.pubkey &&
    connection.signerUrl &&
    connection.connected
  );

  if (!hasRequiredFields) {
    console.log('ℹ️ NIP-46: Stored connection is missing required fields');
    return false;
  }

  // Connection exists and looks valid
  console.log('✅ NIP-46: Found valid stored connection for pubkey:', connection.pubkey?.slice(0, 16) + '...');
  return true;
}

/**
 * Update connection pubkey (user's Nostr account pubkey from Amber)
 * This is called when we receive the user's pubkey from Amber
 */
export function updateNIP46Pubkey(pubkey: string): void {
  const connection = loadNIP46Connection();
  if (connection) {
    const oldPubkey = connection.pubkey;
    connection.pubkey = pubkey; // User's Nostr account pubkey
    saveNIP46Connection(connection);
    
    if (oldPubkey && oldPubkey !== pubkey) {
      console.log(`🔄 NIP-46: Updated connection pubkey from ${oldPubkey.slice(0, 16)}... to ${pubkey.slice(0, 16)}...`);
      console.log(`📋 NIP-46: This is the user's Nostr account pubkey. Multiple connections with same pubkey = same account.`);
    }
  }
}

/**
 * Load connection by user pubkey (Nostr account)
 * Returns the most recent connection for the given user account
 */
export function loadNIP46ConnectionByPubkey(userPubkey: string): NIP46Connection | null {
  return loadNIP46Connection(userPubkey);
}

const APP_KEY_PAIR_STORAGE_KEY = 'nostr_nip46_app_keypair';
const APP_KEY_PAIR_HISTORY_KEY = 'nostr_nip46_app_keypair_history';
const MAX_KEYPAIR_HISTORY = 10; // Keep last 10 keypairs to handle Amber's cache issues

export interface AppKeyPair {
  privateKey: string;
  publicKey: string;
  createdAt: number;
}

/**
 * Get all historical app keypairs (for handling Amber's cache)
 * Returns an array of all stored keypairs, newest first
 */
export function getAppKeyPairHistory(): AppKeyPair[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(APP_KEY_PAIR_HISTORY_KEY);
    if (stored) {
      const history: AppKeyPair[] = JSON.parse(stored);
      return history.sort((a, b) => b.createdAt - a.createdAt); // Newest first
    }
  } catch (error) {
    console.warn('⚠️ Failed to load app keypair history:', error);
  }

  return [];
}

/**
 * Add a keypair to the history
 * Keeps only the MAX_KEYPAIR_HISTORY most recent keypairs
 */
function addToKeyPairHistory(keyPair: AppKeyPair): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const history = getAppKeyPairHistory();

    // Check if this pubkey already exists in history
    const existingIndex = history.findIndex(kp => kp.publicKey === keyPair.publicKey);
    if (existingIndex >= 0) {
      // Update existing entry
      history[existingIndex] = keyPair;
    } else {
      // Add new entry
      history.unshift(keyPair);
    }

    // Keep only MAX_KEYPAIR_HISTORY most recent
    const trimmed = history.slice(0, MAX_KEYPAIR_HISTORY);

    localStorage.setItem(APP_KEY_PAIR_HISTORY_KEY, JSON.stringify(trimmed));
    console.log(`📚 NIP-46: Stored keypair in history (total: ${trimmed.length}, pubkey: ${keyPair.publicKey.slice(0, 16)}...)`);
  } catch (error) {
    console.error('❌ Failed to store keypair history:', error);
  }
}

/**
 * Get or generate a persistent app key pair for NIP-46
 * This ensures the same key pair is used across sessions, preventing pubkey mismatches
 */
export function getOrCreateAppKeyPair(): AppKeyPair {
  if (typeof window === 'undefined') {
    throw new Error('Cannot access localStorage on server');
  }

  try {
    // Try to load existing key pair
    const stored = localStorage.getItem(APP_KEY_PAIR_STORAGE_KEY);
    if (stored) {
      const keyPair: AppKeyPair = JSON.parse(stored);
      // Validate the key pair has required fields
      if (keyPair.privateKey && keyPair.publicKey) {
        console.log('✅ NIP-46: Using existing app key pair (pubkey:', keyPair.publicKey.slice(0, 16) + '...)');
        // Make sure it's in history
        addToKeyPairHistory(keyPair);
        return keyPair;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to load app key pair, generating new one:', error);
  }

  // Generate new key pair if none exists or if loading failed
  const { privateKey, publicKey } = generateKeyPair();

  const keyPair: AppKeyPair = {
    privateKey,
    publicKey,
    createdAt: Date.now(),
  };

  // Store in localStorage for persistence
  try {
    localStorage.setItem(APP_KEY_PAIR_STORAGE_KEY, JSON.stringify(keyPair));
    addToKeyPairHistory(keyPair);
    console.log('✅ NIP-46: Generated and stored new app key pair (pubkey:', publicKey.slice(0, 16) + '...)');
  } catch (error) {
    console.error('❌ Failed to store app key pair:', error);
  }

  return keyPair;
}

/**
 * Clear the app key pair (useful for testing or resetting)
 */
export function clearAppKeyPair(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(APP_KEY_PAIR_STORAGE_KEY);
    console.log('✅ NIP-46: Cleared app key pair');
  } catch (error) {
    console.error('❌ Failed to clear app key pair:', error);
  }
}

/**
 * Device fingerprint storage key
 */
const PREFERRED_SIGNER_STORAGE_KEY = 'nostr_preferred_signer';

/**
 * Generate a stable device fingerprint
 * Uses browser/device characteristics to create a unique but stable identifier
 */
export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') {
    return 'unknown';
  }

  try {
    // Check if we already have a device ID stored
    let deviceId = localStorage.getItem('nostr_device_id');
    if (deviceId) {
      return deviceId;
    }

    // Generate a new device ID based on available characteristics
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx?.fillText('nostr-device-id', 2, 2);
    const canvasFingerprint = canvas.toDataURL();

    // Combine with other stable characteristics
    const userAgent = navigator.userAgent;
    const language = navigator.language;
    const platform = navigator.platform;
    const screenResolution = `${screen.width}x${screen.height}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Create a hash-like identifier (simple approach)
    const combined = `${userAgent}-${language}-${platform}-${screenResolution}-${timezone}-${canvasFingerprint.slice(0, 50)}`;
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    deviceId = `device-${Math.abs(hash).toString(36)}`;
    
    // Store for future use
    localStorage.setItem('nostr_device_id', deviceId);
    
    return deviceId;
  } catch (error) {
    console.warn('⚠️ Failed to generate device fingerprint:', error);
    // Fallback to a random ID if fingerprinting fails
    const fallbackId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('nostr_device_id', fallbackId);
    return fallbackId;
  }
}

/**
 * Preferred signer preference interface
 */
export interface PreferredSigner {
  userPubkey: string;
  deviceId: string;
  signerType: 'extension' | 'nip46' | 'nip55' | 'nsecbunker';
  lastUsed: number;
}

/**
 * Save preferred signer for a user+device combination
 */
export function savePreferredSigner(userPubkey: string, signerType: 'extension' | 'nip46' | 'nip55' | 'nsecbunker'): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const deviceId = getDeviceFingerprint();
    const preferences = JSON.parse(localStorage.getItem(PREFERRED_SIGNER_STORAGE_KEY) || '{}');
    
    const key = `${userPubkey}-${deviceId}`;
    preferences[key] = {
      userPubkey,
      deviceId,
      signerType,
      lastUsed: Date.now(),
    };

    localStorage.setItem(PREFERRED_SIGNER_STORAGE_KEY, JSON.stringify(preferences));
    console.log(`💾 Saved preferred signer: ${signerType} for user ${userPubkey.slice(0, 16)}... on device ${deviceId.slice(0, 16)}...`);
  } catch (error) {
    console.error('❌ Failed to save preferred signer:', error);
  }
}

/**
 * Get preferred signer for a user+device combination
 */
export function getPreferredSigner(userPubkey: string): 'extension' | 'nip46' | 'nip55' | 'nsecbunker' | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const deviceId = getDeviceFingerprint();
    const preferences = JSON.parse(localStorage.getItem(PREFERRED_SIGNER_STORAGE_KEY) || '{}');
    
    const key = `${userPubkey}-${deviceId}`;
    const preference = preferences[key] as PreferredSigner | undefined;
    
    if (preference && preference.signerType) {
      console.log(`✅ Found preferred signer: ${preference.signerType} for user ${userPubkey.slice(0, 16)}... on device ${deviceId.slice(0, 16)}...`);
      return preference.signerType;
    }
    
    return null;
  } catch (error) {
    console.warn('⚠️ Failed to get preferred signer:', error);
    return null;
  }
}

