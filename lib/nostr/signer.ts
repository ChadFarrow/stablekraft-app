/**
 * Unified Nostr Signer Interface
 * Abstracts NIP-07 (browser extensions) and NIP-46 (remote signing)
 */

import { Event, EventTemplate } from 'nostr-tools';
import { NIP46Client } from './nip46-client';
import { NIP55Client } from './nip55-client';
import { loadNIP46Connection, saveNIP46Connection, clearNIP46Connection } from './nip46-storage';
import { isAndroid } from '@/lib/utils/device';

export type SignerType = 'nip07' | 'nip46' | 'nip55' | null;

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
  private nostr: any;

  constructor() {
    if (typeof window !== 'undefined') {
      this.nostr = (window as any).nostr;
    }
  }

  isAvailable(): boolean {
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
  private nip07Signer: NIP07Signer;
  private nip46Signer: NIP46Signer | null = null;
  private nip55Signer: NIP55Signer | null = null;
  private activeSigner: Signer | null = null;
  private signerType: SignerType = null;

  constructor() {
    this.nip07Signer = new NIP07Signer();
    this.initialize();
  }

  /**
   * Initialize signer - try NIP-07 first, then NIP-55 (Android), then NIP-46
   */
  private async initialize(): Promise<void> {
    // Check for NIP-07 extension first (preferred)
    if (this.nip07Signer.isAvailable()) {
      this.activeSigner = this.nip07Signer;
      this.signerType = 'nip07';
      console.log('✅ UnifiedSigner: Using NIP-07 extension');
      return;
    }

    // On Android, prefer NIP-55 over NIP-46
    if (isAndroid() && NIP55Client.isAvailable()) {
      // NIP-55 connections are session-based, so we don't persist them
      // User will need to reconnect on each session
      // For now, we'll only use NIP-55 if explicitly set via setNIP55Signer
      console.log('ℹ️ UnifiedSigner: NIP-55 available on Android, but not auto-initialized (requires explicit connection)');
    }

    // Try to load saved NIP-46 connection
    const savedConnection = loadNIP46Connection();
    if (savedConnection) {
      try {
        const client = new NIP46Client();
        await client.connect(savedConnection.signerUrl, savedConnection.token);
        await client.authenticate();
        
        this.nip46Signer = new NIP46Signer(client);
        this.activeSigner = this.nip46Signer;
        this.signerType = 'nip46';
        console.log('✅ UnifiedSigner: Using NIP-46 remote signer');
      } catch (error) {
        console.warn('⚠️ UnifiedSigner: Failed to restore NIP-46 connection:', error);
        clearNIP46Connection();
      }
    }
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
    
    // Only use NIP-46 if NIP-07 and NIP-55 are not available
    if (!this.nip07Signer.isAvailable() && !this.nip55Signer) {
      this.activeSigner = this.nip46Signer;
      this.signerType = 'nip46';
      console.log('✅ UnifiedSigner: Switched to NIP-46 remote signer');
    }
  }

  /**
   * Set NIP-55 signer
   */
  async setNIP55Signer(client: NIP55Client): Promise<void> {
    this.nip55Signer = new NIP55Signer(client);
    
    // NIP-55 takes priority over NIP-46 on Android, but NIP-07 is still preferred
    if (!this.nip07Signer.isAvailable()) {
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
      
      // Fall back to NIP-07 or NIP-55 if available
      if (this.nip07Signer.isAvailable()) {
        this.activeSigner = this.nip07Signer;
        this.signerType = 'nip07';
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
      
      // Fall back to NIP-07 or NIP-46 if available
      if (this.nip07Signer.isAvailable()) {
        this.activeSigner = this.nip07Signer;
        this.signerType = 'nip07';
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

