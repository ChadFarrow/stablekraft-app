/**
 * NIP-46 Connection Storage
 * Handles persistence of NIP-46 connections in localStorage
 */

import { NIP46Connection } from './nip46-client';

const STORAGE_KEY = 'nostr_nip46_connection';
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface StoredConnection {
  signerUrl: string;
  token: string;
  pubkey?: string;
  connectedAt?: number;
  expiresAt: number;
}

/**
 * Save NIP-46 connection to localStorage
 */
export function saveNIP46Connection(connection: NIP46Connection): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const stored: StoredConnection = {
      signerUrl: connection.signerUrl,
      token: connection.token,
      pubkey: connection.pubkey,
      connectedAt: connection.connectedAt || Date.now(),
      expiresAt: Date.now() + TOKEN_EXPIRY_MS,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (error) {
    console.error('❌ Failed to save NIP-46 connection:', error);
  }
}

/**
 * Load NIP-46 connection from localStorage
 */
export function loadNIP46Connection(): NIP46Connection | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
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
 * Update connection pubkey
 */
export function updateNIP46Pubkey(pubkey: string): void {
  const connection = loadNIP46Connection();
  if (connection) {
    connection.pubkey = pubkey;
    saveNIP46Connection(connection);
  }
}

const APP_KEY_PAIR_STORAGE_KEY = 'nostr_nip46_app_keypair';

export interface AppKeyPair {
  privateKey: string;
  publicKey: string;
  createdAt: number;
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
        return keyPair;
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to load app key pair, generating new one:', error);
  }

  // Generate new key pair if none exists or if loading failed
  const { generateKeyPair } = require('./keys');
  const { privateKey, publicKey } = generateKeyPair();
  
  const keyPair: AppKeyPair = {
    privateKey,
    publicKey,
    createdAt: Date.now(),
  };

  // Store in localStorage for persistence
  try {
    localStorage.setItem(APP_KEY_PAIR_STORAGE_KEY, JSON.stringify(keyPair));
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

