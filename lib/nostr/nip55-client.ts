/**
 * NIP-55 (Android Signer Application) Client
 * Implements client-side protocol for communicating with Android signer apps like Amber
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/55.md
 */

import { Event, EventTemplate, UnsignedEvent, getEventHash } from 'nostr-tools';
import { isAndroid } from '@/lib/utils/device';

export interface NIP55Connection {
  pubkey?: string;
  connected: boolean;
  connectedAt?: number;
}

export interface NIP55SignRequest {
  event: EventTemplate;
  type: 'sign_event';
}

/**
 * NIP-55 Client for Android signer applications
 * Uses Android Intents for direct app-to-app communication
 */
export class NIP55Client {
  private connection: NIP55Connection | null = null;
  private pendingSignatures: Map<string, { 
    resolve: (value: string) => void; 
    reject: (error: Error) => void;
    resolveEvent?: (value: Event) => void; // For initial connection that needs full event
    eventTemplate?: EventTemplate; // Store template for reconstruction
  }> = new Map();
  private callbackUrl: string = '';

  constructor() {
    // Set up callback URL handler
    if (typeof window !== 'undefined') {
      this.callbackUrl = `${window.location.origin}${window.location.pathname}#nip55-callback`;
      console.log('📱 NIP-55: Initialized with callback URL:', this.callbackUrl);
      this.setupCallbackHandler();
    }
  }

  /**
   * Check if NIP-55 is available (Android device with signer app installed)
   */
  static isAvailable(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return isAndroid();
  }

  /**
   * Check if a specific signer app (like Amber) is installed
   * Note: This requires Android bridge or checking via Intent
   */
  static async isSignerInstalled(packageName: string = 'com.greenart7c3.amber'): Promise<boolean> {
    if (!this.isAvailable()) {
      return false;
    }

    // In a TWA/PWA, we can't directly check if an app is installed
    // We'll attempt to open the intent and see if it succeeds
    // For now, assume it's available if on Android
    return true;
  }

  /**
   * Connect to signer and get public key
   * For NIP-55, we get the pubkey from the callback when requesting a signature
   * We'll request a dummy signature to get the pubkey
   */
  async connect(): Promise<string> {
    if (!NIP55Client.isAvailable()) {
      throw new Error('NIP-55 is only available on Android devices');
    }

    // For NIP-55, we need to request a signature to get the pubkey
    // The pubkey will come back in the callback
    // We'll use a special "get_public_key" request or sign a dummy event
    try {
      // Request public key by signing a minimal event
      // The signer will return the pubkey in the callback
      const dummyEvent: EventTemplate = {
        kind: 0,
        tags: [],
        content: '',
        created_at: Math.floor(Date.now() / 1000),
      };

      // For initial connection, we don't have pubkey yet
      // The signer will provide it in the callback
      const signedEvent = await this.requestSignatureWithoutPubkey(dummyEvent);
      const pubkey = signedEvent.pubkey;
      
      if (!pubkey) {
        throw new Error('No pubkey returned from signer');
      }
      
      this.connection = {
        pubkey,
        connected: true,
        connectedAt: Date.now(),
      };

      return pubkey;
    } catch (error) {
      const errorDetails = error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            stack: error.stack,
          }
        : { error: String(error) };
      console.error('❌ NIP-55: Connect error:', errorDetails);
      throw new Error(`Failed to connect to NIP-55 signer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Request signature when we don't have pubkey yet (for initial connection)
   */
  private async requestSignatureWithoutPubkey(eventTemplate: EventTemplate): Promise<Event> {
    // Generate request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // Create sign request (without pubkey - signer will add it)
    const signRequest: NIP55SignRequest = {
      event: eventTemplate, // No pubkey - signer will use their own
      type: 'sign_event',
    };

    // Encode request as JSON
    const requestJson = JSON.stringify(signRequest);
    const encodedJson = encodeURIComponent(requestJson);

    // Create callback URL with request ID
    const callbackWithId = `${this.callbackUrl}?requestId=${requestId}`;

    // Build NIP-55 URI
    const nip55Uri = `nostrsigner:${encodedJson}?compressionType=none&returnType=signature&type=sign_event&callbackUrl=${encodeURIComponent(callbackWithId)}`;

    console.log('📱 NIP-55: Requesting signature (initial connection, no pubkey yet):', {
      requestId,
      eventKind: eventTemplate.kind,
      callbackUrl: callbackWithId,
    });

    // Create promise for signature
    return new Promise<Event>((resolve, reject) => {
      // Store promise resolvers - use resolveEvent for initial connection
      this.pendingSignatures.set(requestId, {
        resolve: () => {}, // Not used for initial connection
        reject,
        resolveEvent: resolve, // Use this to resolve with full event
        eventTemplate: eventTemplate, // Store template for reconstruction
      });

      // Set timeout with warning
      const warningTimeout = setTimeout(() => {
        console.warn('⚠️ NIP-55: Still waiting for signature approval (30s elapsed). Please check your Android signer app and approve the request.');
      }, 30000);

      const timeout = setTimeout(() => {
        clearTimeout(warningTimeout);
        this.pendingSignatures.delete(requestId);
        reject(new Error('NIP-55 signature request timed out after 90 seconds. Please ensure your Android signer app is open and try again.'));
      }, 90000); // Increased to 90 seconds to match NIP-46

      // Store timeouts for cleanup
      const pending = this.pendingSignatures.get(requestId);
      if (pending) {
        (pending as any).timeout = timeout;
        (pending as any).warningTimeout = warningTimeout;
      }

      // Open intent
      try {
        window.location.href = nip55Uri;
      } catch (error) {
        clearTimeout(timeout);
        clearTimeout(warningTimeout);
        this.pendingSignatures.delete(requestId);
        reject(new Error(`Failed to open NIP-55 intent: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  /**
   * Get public key from signer
   */
  async getPublicKey(): Promise<string> {
    if (this.connection?.pubkey) {
      return this.connection.pubkey;
    }

    // Connect to get pubkey
    return this.connect();
  }

  /**
   * Sign an event using NIP-55
   * @param eventTemplate - Event template to sign (without id and sig)
   * @returns Signed event with id and sig
   */
  async signEvent(eventTemplate: EventTemplate): Promise<Event> {
    if (!NIP55Client.isAvailable()) {
      throw new Error('NIP-55 is only available on Android devices');
    }

    // Ensure we have pubkey - get it if we don't
    if (!this.connection?.pubkey) {
      await this.getPublicKey();
    }

    if (!this.connection?.pubkey) {
      throw new Error('Signer public key not available. Please connect first.');
    }

    // Add pubkey to event template (required for signing)
    const eventWithPubkey: UnsignedEvent = {
      ...eventTemplate,
      pubkey: this.connection.pubkey,
    };

    // Generate request ID
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

    // Create sign request
    const signRequest: NIP55SignRequest = {
      event: eventWithPubkey,
      type: 'sign_event',
    };

    // Encode request as JSON
    const requestJson = JSON.stringify(signRequest);
    const encodedJson = encodeURIComponent(requestJson);

    // Create callback URL with request ID
    const callbackWithId = `${this.callbackUrl}?requestId=${requestId}`;

    // Build NIP-55 URI
    // Format: nostrsigner:${encodedJson}?compressionType=none&returnType=signature&type=sign_event&callbackUrl=${callback}
    const nip55Uri = `nostrsigner:${encodedJson}?compressionType=none&returnType=signature&type=sign_event&callbackUrl=${encodeURIComponent(callbackWithId)}`;

    console.log('📱 NIP-55: Requesting signature:', {
      requestId,
      eventKind: eventTemplate.kind,
      pubkey: this.connection.pubkey.slice(0, 16) + '...',
      callbackUrl: callbackWithId,
      uriPreview: nip55Uri.substring(0, 200) + '...',
    });

    // Create promise for signature
    return new Promise<Event>((resolve, reject) => {
      // Store promise resolvers
      this.pendingSignatures.set(requestId, {
        resolve: (signature: string) => {
          // Create signed event with pubkey
          const event: Event = {
            ...eventWithPubkey,
            id: getEventHash(eventWithPubkey),
            sig: signature,
            pubkey: this.connection!.pubkey!,
          };

          resolve(event);
        },
        reject,
      });

      // Set timeout with warning
      const warningTimeout = setTimeout(() => {
        console.warn('⚠️ NIP-55: Still waiting for signature approval (30s elapsed). Please check your Android signer app and approve the request.');
      }, 30000);

      const timeout = setTimeout(() => {
        clearTimeout(warningTimeout);
        this.pendingSignatures.delete(requestId);
        reject(new Error('NIP-55 signature request timed out after 90 seconds. Please ensure your Android signer app is open and try again.'));
      }, 90000); // Increased to 90 seconds to match NIP-46

      // Store timeouts for cleanup
      const pending = this.pendingSignatures.get(requestId);
      if (pending) {
        (pending as any).timeout = timeout;
        (pending as any).warningTimeout = warningTimeout;
      }

      // Open intent
      try {
        window.location.href = nip55Uri;
      } catch (error) {
        clearTimeout(timeout);
        clearTimeout(warningTimeout);
        this.pendingSignatures.delete(requestId);
        reject(new Error(`Failed to open NIP-55 intent: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  }

  /**
   * Set up callback handler for NIP-55 responses
   */
  private setupCallbackHandler(): void {
    if (typeof window === 'undefined') {
      return;
    }

    // Check if we're returning from a callback
    const handleCallback = () => {
      const hash = window.location.hash;
      const fullUrl = window.location.href;
      console.log('📱 NIP-55: Checking callback:', { hash, fullUrl });
      
      if (hash.includes('nip55-callback') || fullUrl.includes('nip55-callback')) {
        // Try both hash and query string params
        const hashPart = hash.includes('?') ? hash.split('?')[1] : '';
        const queryPart = window.location.search.substring(1);
        const urlParams = new URLSearchParams(hashPart || queryPart || '');
        
        const requestId = urlParams.get('requestId') || new URLSearchParams(window.location.search).get('requestId');
        const signature = urlParams.get('signature') || new URLSearchParams(window.location.search).get('signature');
        const pubkey = urlParams.get('pubkey') || new URLSearchParams(window.location.search).get('pubkey');
        const error = urlParams.get('error') || new URLSearchParams(window.location.search).get('error');

        console.log('📱 NIP-55: Callback params:', { requestId, hasSignature: !!signature, hasPubkey: !!pubkey, error });

        if (requestId) {
          const pending = this.pendingSignatures.get(requestId);
          if (pending) {
            // Clear timeouts
            if ((pending as any).timeout) {
              clearTimeout((pending as any).timeout);
            }
            if ((pending as any).warningTimeout) {
              clearTimeout((pending as any).warningTimeout);
            }

            if (error) {
              pending.reject(new Error(`NIP-55 error: ${error}`));
            } else if (signature) {
              // Store pubkey if provided
              if (pubkey && !this.connection?.pubkey) {
                this.connection = {
                  pubkey,
                  connected: true,
                  connectedAt: Date.now(),
                };
              }
              
              // If this is an initial connection request (has resolveEvent), resolve with full event
              if (pending.resolveEvent && pubkey && pending.eventTemplate) {
                // Reconstruct the event from the stored template
                const eventWithPubkey: UnsignedEvent = {
                  ...pending.eventTemplate,
                  pubkey: pubkey,
                };
                const event: Event = {
                  ...eventWithPubkey,
                  id: getEventHash(eventWithPubkey),
                  sig: signature,
                };
                pending.resolveEvent(event);
              } else {
                // Normal signature request
                pending.resolve(signature);
              }
            } else {
              console.error('❌ NIP-55: Callback missing signature and error:', { requestId, signature, error });
              pending.reject(new Error('No signature or error in NIP-55 callback'));
            }

            this.pendingSignatures.delete(requestId);
          } else {
            console.warn('⚠️ NIP-55: Callback received but no pending request found:', { requestId, pendingRequests: Array.from(this.pendingSignatures.keys()) });
          }

          // Clean up URL
          window.history.replaceState(null, '', window.location.pathname);
        } else {
          console.warn('⚠️ NIP-55: Callback received but no requestId found');
        }
      }
    };

    // Check immediately
    handleCallback();

    // Also listen for hash changes
    window.addEventListener('hashchange', handleCallback);
  }

  /**
   * Get connection status
   */
  getConnection(): NIP55Connection | null {
    return this.connection;
  }

  /**
   * Disconnect from signer
   */
  async disconnect(): Promise<void> {
      // Reject all pending signatures
      Array.from(this.pendingSignatures.entries()).forEach(([id, { reject }]) => {
        const pending = this.pendingSignatures.get(id);
        if (pending && (pending as any).timeout) {
          clearTimeout((pending as any).timeout);
        }
        reject(new Error('NIP-55 connection closed'));
      });
    this.pendingSignatures.clear();

    this.connection = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection?.connected === true && !!this.connection?.pubkey;
  }
}

