/**
 * Unified Nostr Signer Interface
 * Abstracts NIP-07 (browser extensions) and NIP-46 (remote signing)
 */

import { Event, EventTemplate } from 'nostr-tools';
import { NIP46Client } from './nip46-client';
import { NIP55Client } from './nip55-client';
import { loadNIP46Connection, saveNIP46Connection, clearNIP46Connection, getPreferredSigner, savePreferredSigner } from './nip46-storage';
import { isAndroid, isIOS } from '@/lib/utils/device';

export type SignerType = 'nip07' | 'nip46' | 'nip55' | 'nsecbunker' | null;

export interface Signer {
  type: SignerType;
  getPublicKey: () => Promise<string>;
  signEvent: (event: Event) => Promise<Event>;
  isAvailable: () => boolean;
}

/**
 * NIP-07 Signer (Browser Extension)
 */
class NIP07Signer implements Signer {
  type: SignerType = 'nip07';
  private nostr: any | null = null;
  private _checkedAvailability: boolean = false;

  constructor() {
    // Don't access window.nostr in constructor - do it lazily in isAvailable()
    // This prevents triggering Alby popups when the signer is created
  }

  isAvailable(): boolean {
    // Lazy check - only access window.nostr when explicitly checked
    // This prevents triggering popups when the signer is created but not used
    if (!this._checkedAvailability && typeof window !== 'undefined') {
      this.nostr = (window as any).nostr;
      this._checkedAvailability = true;
    }
    return typeof window !== 'undefined' && !!this.nostr;
  }

  async getPublicKey(): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('NIP-07 extension not available');
    }
    return this.nostr.getPublicKey();
  }

  async signEvent(event: Event): Promise<Event> {
    if (!this.isAvailable()) {
      throw new Error('NIP-07 extension not available');
    }

    // Prepare event template (without id and sig)
    const eventTemplate = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
    };

    return this.nostr.signEvent(eventTemplate);
  }
}

/**
 * NIP-46 Signer (Remote Signing)
 */
class NIP46Signer implements Signer {
  type: SignerType = 'nip46';
  private client: NIP46Client;
  private pubkey: string | null = null;

  constructor(client: NIP46Client) {
    this.client = client;
  }

  isAvailable(): boolean {
    return this.client.isConnected();
  }

  async getPublicKey(): Promise<string> {
    if (!this.pubkey) {
      this.pubkey = await this.client.getPublicKey();
    }
    return this.pubkey;
  }

  async signEvent(event: Event): Promise<Event> {
    if (!this.isAvailable()) {
      throw new Error('NIP-46 client not connected');
    }
    return this.client.signEvent(event);
  }

  getClient(): NIP46Client {
    return this.client;
  }
}

/**
 * NIP-55 Signer (Android Intent-based Signing)
 */
class NIP55Signer implements Signer {
  type: SignerType = 'nip55';
  private client: NIP55Client;
  private pubkey: string | null = null;

  constructor(client: NIP55Client) {
    this.client = client;
  }

  isAvailable(): boolean {
    return NIP55Client.isAvailable() && this.client.isConnected();
  }

  async getPublicKey(): Promise<string> {
    if (!this.pubkey) {
      this.pubkey = await this.client.getPublicKey();
    }
    return this.pubkey;
  }

  async signEvent(event: Event): Promise<Event> {
    if (!this.isAvailable()) {
      throw new Error('NIP-55 client not connected');
    }
    
    // Convert Event to EventTemplate for signing
    const eventTemplate: EventTemplate = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
    };
    
    return this.client.signEvent(eventTemplate);
  }

  getClient(): NIP55Client {
    return this.client;
  }
}

/**
 * Unified Signer Manager
 * Automatically selects the best available signer
 * Priority: NIP-07 > NIP-55 (Android) > NIP-46
 */
export class UnifiedSigner {
  private nip07Signer: NIP07Signer | null = null;
  private nip46Signer: NIP46Signer | null = null;
  private nip55Signer: NIP55Signer | null = null;
  private activeSigner: Signer | null = null;
  private signerType: SignerType = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Don't create NIP07Signer here - create it lazily only when needed
    // This prevents triggering Alby popups on page load
    // Store the promise so we can wait for initialization to complete
    this.initPromise = this.initialize();
  }

  /**
   * Wait for initialization to complete
   * Call this before checking isAvailable() to avoid race conditions
   */
  async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Get or create NIP-07 signer (lazy initialization)
   * Only creates it if we actually need it (user didn't log in with NIP-46)
   */
  private getNIP07Signer(): NIP07Signer {
    if (!this.nip07Signer) {
      this.nip07Signer = new NIP07Signer();
    }
    return this.nip07Signer;
  }

  /**
   * Get current user's pubkey from localStorage
   * Returns null if no user is logged in
   */
  private getCurrentUserPubkey(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const storedUser = localStorage.getItem('nostr_user');
      if (!storedUser) {
        return null;
      }

      const userData = JSON.parse(storedUser);
      return userData.nostrPubkey || null;
    } catch (error) {
      console.warn('⚠️ UnifiedSigner: Failed to get current user pubkey:', error);
      return null;
    }
  }

  /**
   * Initialize signer - use the signer that matches the user's login choice
   * Respects what the user selected when they clicked "log in to Nostr"
   * Also checks for preferred signer if no explicit login type is set
   */
  private async initialize(): Promise<void> {
    // Get current user's pubkey for validation
    const currentUserPubkey = this.getCurrentUserPubkey();
    
    // Get the login type the user chose FIRST - before any NIP-07 checks
    let userLoginType: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null = null;
    if (typeof window !== 'undefined') {
      userLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
    }

    // If no explicit login type, check for preferred signer
    if (!userLoginType && currentUserPubkey) {
      const preferredSigner = getPreferredSigner(currentUserPubkey);
      if (preferredSigner) {
        userLoginType = preferredSigner;
        console.log(`✅ UnifiedSigner: Using preferred signer: ${preferredSigner}`);
      }
    }

    // CRITICAL: If user logged in with NIP-46 or nsecBunker, skip ALL NIP-07 checks to prevent Alby popups
    if (userLoginType === 'nip46' || userLoginType === 'nsecbunker') {
      // User logged in with NIP-46/nsecBunker - use that, don't check NIP-07 at all
      // Always pass current user pubkey to ensure we only load connections for this user
      const savedConnection = loadNIP46Connection(currentUserPubkey || undefined);
      
      if (savedConnection) {
        // Validate that the connection matches the current user
        if (currentUserPubkey && savedConnection.pubkey && savedConnection.pubkey !== currentUserPubkey) {
          console.warn(`⚠️ UnifiedSigner: Stored connection is for different user (stored: ${savedConnection.pubkey.slice(0, 16)}..., current: ${currentUserPubkey.slice(0, 16)}...). Clearing stale connection.`);
          clearNIP46Connection();
          return;
        }

        try {
          const client = new NIP46Client();
          // Pass saved pubkey to connect() so it's included in the connection object from the start
          // This allows authenticate() to skip the connect request if we're already authenticated
          await client.connect(savedConnection.signerUrl, savedConnection.token, false, savedConnection.pubkey);
          
          // authenticate() will now see the pubkey and skip the connect request
          await client.authenticate();
          
          this.nip46Signer = new NIP46Signer(client);
          this.activeSigner = this.nip46Signer;
          // Detect nsecBunker by checking if signerUrl is a bunker:// URI or if login type is nsecbunker
          const isNsecBunker = userLoginType === 'nsecbunker' || savedConnection.signerUrl.includes('bunker://');
          this.signerType = isNsecBunker ? 'nsecbunker' : 'nip46';
          console.log(`✅ UnifiedSigner: Using ${isNsecBunker ? 'nsecBunker' : 'NIP-46'} remote signer (user chose ${userLoginType} login - skipping NIP-07 checks)`);
          return;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.warn('⚠️ UnifiedSigner: Failed to restore NIP-46/nsecBunker connection:', error);
          
          // Check if the error is due to p-tag mismatch (old connection)
          if (errorMessage.includes('Signer public key not available') || 
              errorMessage.includes('different app pubkey') ||
              errorMessage.includes('p tag')) {
            console.warn('⚠️ UnifiedSigner: Detected stale NIP-46/nsecBunker connection. Connection has been cleared. Please reconnect with a fresh QR code.');
          }
          
          clearNIP46Connection();
          // Don't fall through - user chose NIP-46/nsecBunker, so don't try NIP-07
          return;
        }
      } else {
        console.warn(`⚠️ UnifiedSigner: User chose ${userLoginType} login but no saved connection found`);
        return;
      }
    }

    // User didn't choose NIP-46, so we can check other signers
    if (userLoginType === 'extension') {
      // User logged in with NIP-07 extension (Alby) - use that
      const nip07 = this.getNIP07Signer();
      if (nip07.isAvailable()) {
        this.activeSigner = nip07;
        this.signerType = 'nip07';
        console.log('✅ UnifiedSigner: Using NIP-07 extension (user chose extension login)');
        return;
      } else {
        console.warn('⚠️ UnifiedSigner: User chose extension login but NIP-07 extension is not available');
        // Fall through to try other signers as fallback
      }
    } else if (userLoginType === 'nip55') {
      // User logged in with NIP-55 (Android) - this requires explicit connection
      // NIP-55 connections are session-based, so we can't restore them automatically

      // IMPORTANT: Check if user is on iOS - NIP-55 doesn't work on iOS
      if (isIOS()) {
        console.warn('⚠️ UnifiedSigner: User chose NIP-55 login but iOS is not supported. Attempting to use NIP-46/nsecBunker fallback...');
        // Try to use NIP-46/nsecBunker if available (user might have connected via NIP-46)
        const savedConnection = loadNIP46Connection(currentUserPubkey || undefined);
        if (savedConnection) {
          // Validate connection matches current user
          if (currentUserPubkey && savedConnection.pubkey && savedConnection.pubkey !== currentUserPubkey) {
            console.warn('⚠️ UnifiedSigner: Stored connection is for different user. Clearing stale connection.');
            clearNIP46Connection();
          } else {
            try {
              const client = new NIP46Client();
              await client.connect(savedConnection.signerUrl, savedConnection.token, false, savedConnection.pubkey);
              await client.authenticate();

              this.nip46Signer = new NIP46Signer(client);
              this.activeSigner = this.nip46Signer;
              const isNsecBunker = savedConnection.signerUrl.includes('bunker://');
              this.signerType = isNsecBunker ? 'nsecbunker' : 'nip46';
              console.log(`✅ UnifiedSigner: Using ${isNsecBunker ? 'nsecBunker' : 'NIP-46'} remote signer (iOS fallback from NIP-55)`);
              return;
            } catch (error) {
              console.warn('⚠️ UnifiedSigner: Failed to use NIP-46/nsecBunker fallback on iOS:', error);
              clearNIP46Connection();
            }
          }
        }
        console.warn('⚠️ UnifiedSigner: No NIP-46/nsecBunker connection available for iOS fallback');
        // Fall through to try other signers
      } else {
        // The user will be prompted to reconnect when they try to perform an action (like boosting)
        console.log('ℹ️ UnifiedSigner: User chose NIP-55 login, but NIP-55 requires explicit connection per session');
      }
      // Fall through to try other signers as fallback
    } else if (userLoginType === 'nip05') {
      // User logged in with NIP-05 (read-only) - no signer available
      console.log('ℹ️ UnifiedSigner: User chose NIP-05 login (read-only mode, no signer available)');
      return;
    }

    // Fallback: If user's chosen signer is not available, try others in priority order
    // This handles cases where the user's choice is unavailable (e.g., extension disabled)
    // BUT: We already handled NIP-46 above, so we won't get here if user chose NIP-46
    
    // Try NIP-07 extension first (most common fallback)
    const nip07 = this.getNIP07Signer();
    if (nip07.isAvailable()) {
      this.activeSigner = nip07;
      this.signerType = 'nip07';
      console.log('✅ UnifiedSigner: Using NIP-07 extension (fallback)');
      return;
    }

    // Try NIP-46/nsecBunker connection (if available) as last resort
    // Only load if we have a current user pubkey to validate against
    if (currentUserPubkey) {
      const savedConnection = loadNIP46Connection(currentUserPubkey);
      if (savedConnection) {
        // Validate connection matches current user
        if (savedConnection.pubkey && savedConnection.pubkey !== currentUserPubkey) {
          console.warn('⚠️ UnifiedSigner: Stored connection is for different user. Clearing stale connection.');
          clearNIP46Connection();
        } else {
          try {
            const client = new NIP46Client();
            await client.connect(savedConnection.signerUrl, savedConnection.token, false, savedConnection.pubkey);
            await client.authenticate();
            
            this.nip46Signer = new NIP46Signer(client);
            this.activeSigner = this.nip46Signer;
            const isNsecBunker = savedConnection.signerUrl.includes('bunker://');
            this.signerType = isNsecBunker ? 'nsecbunker' : 'nip46';
            console.log(`✅ UnifiedSigner: Using ${isNsecBunker ? 'nsecBunker' : 'NIP-46'} remote signer (fallback)`);
            return;
          } catch (error) {
            console.warn('⚠️ UnifiedSigner: Failed to restore NIP-46/nsecBunker connection:', error);
            clearNIP46Connection();
          }
        }
      }
    }

    // No signer available
    console.log('ℹ️ UnifiedSigner: No signer available');
  }

  /**
   * Reinitialize signer (useful after connection changes)
   */
  async reinitialize(): Promise<void> {
    await this.initialize();
  }

  /**
   * Set NIP-46 signer
   */
  async setNIP46Signer(client: NIP46Client): Promise<void> {
    await client.authenticate();
    this.nip46Signer = new NIP46Signer(client);
    
    // Check what login type the user chose
    let userLoginType: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null = null;
    if (typeof window !== 'undefined') {
      userLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
    }
    
    // Detect if this is nsecBunker by checking the connection URL
    const isNsecBunker = userLoginType === 'nsecbunker' || (client.getConnection()?.signerUrl?.includes('bunker://') ?? false);
    
    // Use NIP-46/nsecBunker if:
    // 1. User logged in with NIP-46/nsecBunker, OR
    // 2. User didn't choose extension login and NIP-07 is not available
    const nip07 = (userLoginType !== 'nip46' && userLoginType !== 'nsecbunker') ? this.getNIP07Signer() : null;
    if (userLoginType === 'nip46' || userLoginType === 'nsecbunker' || (userLoginType !== 'extension' && (!nip07 || !nip07.isAvailable()) && !this.nip55Signer)) {
      this.activeSigner = this.nip46Signer;
      this.signerType = isNsecBunker ? 'nsecbunker' : 'nip46';
      console.log(`✅ UnifiedSigner: Switched to ${isNsecBunker ? 'nsecBunker' : 'NIP-46'} remote signer` + ((userLoginType === 'nip46' || userLoginType === 'nsecbunker') ? ` (user chose ${userLoginType} login)` : ''));
    }
  }

  /**
   * Set NIP-55 signer
   */
  async setNIP55Signer(client: NIP55Client): Promise<void> {
    // Check if platform supports NIP-55 (Android only, not iOS)
    if (isIOS()) {
      console.warn('⚠️ UnifiedSigner: Cannot set NIP-55 signer on iOS. NIP-55 requires Android.');
      throw new Error('NIP-55 is not supported on iOS. Please use NIP-46 (Nostr Connect) instead.');
    }

    this.nip55Signer = new NIP55Signer(client);

    // Check if user logged in with NIP-46/nsecBunker - if so, don't check NIP-07
    let userLoginType: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null = null;
    if (typeof window !== 'undefined') {
      userLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
    }

    // NIP-55 takes priority over NIP-46/nsecBunker on Android, but NIP-07 is still preferred (unless user chose NIP-46/nsecBunker)
    const nip07 = (userLoginType !== 'nip46' && userLoginType !== 'nsecbunker') ? this.getNIP07Signer() : null;
    if (userLoginType === 'nip46' || userLoginType === 'nsecbunker' || !nip07 || !nip07.isAvailable()) {
      this.activeSigner = this.nip55Signer;
      this.signerType = 'nip55';
      console.log('✅ UnifiedSigner: Switched to NIP-55 Android signer');
    }
  }

  /**
   * Get current signer type
   */
  getSignerType(): SignerType {
    return this.signerType;
  }

  /**
   * Check if any signer is available
   */
  isAvailable(): boolean {
    return this.activeSigner !== null && this.activeSigner.isAvailable();
  }

  /**
   * Get public key from active signer
   */
  async getPublicKey(): Promise<string> {
    if (!this.activeSigner) {
      throw new Error('No signer available');
    }
    return this.activeSigner.getPublicKey();
  }

  /**
   * Sign an event using active signer
   */
  async signEvent(event: Event): Promise<Event> {
    if (!this.activeSigner) {
      throw new Error('No signer available. Please connect a Nostr extension or NIP-46 signer.');
    }
    return this.activeSigner.signEvent(event);
  }

  /**
   * Get NIP-46 client if available
   */
  getNIP46Client(): NIP46Client | null {
    return this.nip46Signer?.getClient() || null;
  }

  /**
   * Get NIP-55 client if available
   */
  getNIP55Client(): NIP55Client | null {
    return this.nip55Signer?.getClient() || null;
  }

  /**
   * Disconnect NIP-46 signer
   */
  async disconnectNIP46(): Promise<void> {
    if (this.nip46Signer) {
      await this.nip46Signer.getClient().disconnect();
      this.nip46Signer = null;
      clearNIP46Connection();
      
      // Check if user logged in with NIP-46/nsecBunker - if so, don't fall back to NIP-07 (prevents Alby popups)
      let userLoginType: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null = null;
      if (typeof window !== 'undefined') {
        userLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
      }

      // Only fall back to NIP-07 if user didn't explicitly choose NIP-46/nsecBunker
      if (userLoginType !== 'nip46' && userLoginType !== 'nsecbunker') {
        const nip07 = this.getNIP07Signer();
        if (nip07.isAvailable()) {
          this.activeSigner = nip07;
          this.signerType = 'nip07';
        } else if (this.nip55Signer && this.nip55Signer.isAvailable()) {
          this.activeSigner = this.nip55Signer;
          this.signerType = 'nip55';
        } else {
          this.activeSigner = null;
          this.signerType = null;
        }
      } else if (this.nip55Signer && this.nip55Signer.isAvailable()) {
        this.activeSigner = this.nip55Signer;
        this.signerType = 'nip55';
      } else {
        this.activeSigner = null;
        this.signerType = null;
      }
    }
  }

  /**
   * Disconnect NIP-55 signer
   */
  async disconnectNIP55(): Promise<void> {
    if (this.nip55Signer) {
      await this.nip55Signer.getClient().disconnect();
      this.nip55Signer = null;
      
      // Check if user logged in with NIP-46/nsecBunker - if so, prefer that over NIP-07
      let userLoginType: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null = null;
      if (typeof window !== 'undefined') {
        userLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
      }

      // Prefer NIP-46/nsecBunker if user chose it, otherwise try NIP-07
      if ((userLoginType === 'nip46' || userLoginType === 'nsecbunker') && this.nip46Signer && this.nip46Signer.isAvailable()) {
        this.activeSigner = this.nip46Signer;
        // Detect nsecBunker type
        const connection = this.nip46Signer.getClient().getConnection();
        const isNsecBunker = userLoginType === 'nsecbunker' || connection?.signerUrl?.includes('bunker://');
        this.signerType = isNsecBunker ? 'nsecbunker' : 'nip46';
      } else if (userLoginType !== 'nip46' && userLoginType !== 'nsecbunker') {
        const nip07 = this.getNIP07Signer();
        if (nip07.isAvailable()) {
          this.activeSigner = nip07;
          this.signerType = 'nip07';
        } else if (this.nip46Signer && this.nip46Signer.isAvailable()) {
          this.activeSigner = this.nip46Signer;
          this.signerType = 'nip46';
        } else {
          this.activeSigner = null;
          this.signerType = null;
        }
      } else if (this.nip46Signer && this.nip46Signer.isAvailable()) {
        this.activeSigner = this.nip46Signer;
        this.signerType = 'nip46';
      } else {
        this.activeSigner = null;
        this.signerType = null;
      }
    }
  }
}

// Singleton instance
let unifiedSignerInstance: UnifiedSigner | null = null;

/**
 * Get the global unified signer instance
 */
export function getUnifiedSigner(): UnifiedSigner {
  if (!unifiedSignerInstance) {
    unifiedSignerInstance = new UnifiedSigner();
  }
  return unifiedSignerInstance;
}

