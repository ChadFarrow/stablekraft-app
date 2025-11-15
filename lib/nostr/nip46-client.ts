/**
 * NIP-46 (Remote Signing) Client
 * Implements client-side protocol for communicating with remote signers like Amber
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/46.md
 */

import { Event, getEventHash, Filter, EventTemplate, finalizeEvent } from 'nostr-tools';
import { NostrClient } from './client';
import { RelayManager } from './relay';

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

export interface NIP46Connection {
  signerUrl: string;
  token: string;
  pubkey?: string;
  connected: boolean;
  connectedAt?: number;
}

export interface NIP46Request {
  id: string;
  method: string;
  params: any[];
}

export interface NIP46Response {
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

export class NIP46Client {
  private connection: NIP46Connection | null = null;
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private relayClient: NostrClient | null = null;
  private relaySubscription: (() => void) | null = null;
  private onConnectionCallback: ((pubkey: string) => void) | null = null;

  /**
   * Connect to a NIP-46 signer
   * @param signerUrl - WebSocket URL of the signer (e.g., wss://signer.example.com) or relay URL
   * @param token - Connection token (nsecBunker token)
   * @param connectImmediately - Whether to connect immediately (default: false, wait for signer to initiate)
   */
  async connect(signerUrl: string, token: string, connectImmediately: boolean = false): Promise<void> {
    if (this.connection && this.connection.connected) {
      await this.disconnect();
    }

    this.connection = {
      signerUrl,
      token,
      connected: false,
    };

    // Only connect immediately if requested (for direct WebSocket connections)
    // For relay-based connections, wait for the signer to initiate
    if (connectImmediately && signerUrl.startsWith('wss://') && !signerUrl.includes('relay')) {
      return this.establishConnection();
    }
    
    // For relay-based connections, we'll wait for the signer to connect
    // The connection will be established when we receive a connection request
    if (signerUrl.includes('relay') || signerUrl.startsWith('wss://') && signerUrl.includes('relay')) {
      // Start listening for connection events on the relay
      return this.startRelayConnection(signerUrl);
    }
    
    return Promise.resolve();
  }

  /**
   * Start listening for NIP-46 connection events on a relay
   * @param relayUrl - Relay URL to listen on
   */
  private async startRelayConnection(relayUrl: string): Promise<void> {
    if (!this.connection) {
      throw new Error('No connection configured');
    }

    // Initialize relay client
    this.relayClient = new NostrClient([relayUrl]);
    await this.relayClient.connectToRelays([relayUrl]);

    // Get the app's public key from sessionStorage (stored during connection initiation)
    const pendingConnection = typeof window !== 'undefined' 
      ? sessionStorage.getItem('nip46_pending_connection')
      : null;
    
    if (!pendingConnection) {
      throw new Error('No pending connection found');
    }

    const connectionInfo = JSON.parse(pendingConnection);
    const appPubkey = connectionInfo.publicKey;

    // Subscribe to NIP-46 events (kind 24133) directed to our app
    // NIP-46 uses kind 24133 for request/response events
    // We need to listen for events where we are the recipient (tagged with our pubkey)
    // Also listen for all kind 24133 events in case the tagging is different
    const filters: Filter[] = [
      {
        kinds: [24133], // NIP-46 request/response events
        '#p': [appPubkey], // Events tagged with our public key (recipient)
      },
      // Also subscribe to all kind 24133 events to catch any connection attempts
      // We'll filter them in handleRelayEvent
      {
        kinds: [24133],
      },
    ];

    console.log('🔍 NIP-46: Subscribing to relay events:', {
      relayUrl,
      appPubkey: appPubkey.slice(0, 16) + '...',
      filters,
    });

    this.relaySubscription = this.relayClient.subscribe({
      relays: [relayUrl],
      filters,
      onEvent: (event: Event) => {
        console.log('📨 NIP-46: Received event from relay:', {
          id: event.id.slice(0, 16) + '...',
          pubkey: event.pubkey.slice(0, 16) + '...',
          kind: event.kind,
          tags: event.tags,
          content: event.content.substring(0, 100),
        });
        
        // Check if this event is for us (tagged with our pubkey)
        const isForUs = event.tags.some(tag => tag[0] === 'p' && tag[1] === appPubkey);
        if (isForUs || event.kind === 24133) {
          this.handleRelayEvent(event, connectionInfo);
        } else {
          console.log('ℹ️ NIP-46: Event received but not for us, skipping');
        }
      },
      onEose: () => {
        console.log('✅ NIP-46: Subscription EOSE (End of Stored Events)');
      },
      onError: (error) => {
        console.error('❌ NIP-46: Relay subscription error:', error);
      },
    });

    console.log('✅ NIP-46: Listening for connection on relay:', relayUrl);
  }

  /**
   * Create a NIP-46 request event (kind 24133)
   */
  private createNIP46RequestEvent(
    method: string,
    params: any[],
    requestId: string,
    appPubkey: string,
    signerPubkey: string,
    appPrivateKey: string
  ): Event {
    const request: NIP46Request = {
      id: requestId,
      method,
      params,
    };

    const template: EventTemplate = {
      kind: 24133, // NIP-46 request/response event kind
      tags: [
        ['p', signerPubkey], // Tag the signer
      ],
      content: JSON.stringify(request),
      created_at: Math.floor(Date.now() / 1000),
    };

    // Sign with app's temporary private key
    const secretKey = hexToBytes(appPrivateKey);
    return finalizeEvent(template, secretKey);
  }

  /**
   * Handle events received from the relay
   */
  private handleRelayEvent(event: Event, connectionInfo: any): void {
    try {
      console.log('🔍 NIP-46: Processing relay event:', {
        id: event.id.slice(0, 16) + '...',
        pubkey: event.pubkey.slice(0, 16) + '...',
        kind: event.kind,
        tags: event.tags,
        contentLength: event.content.length,
      });

      // Parse NIP-46 event content
      let content;
      try {
        content = JSON.parse(event.content);
      } catch (parseError) {
        console.warn('⚠️ NIP-46: Event content is not JSON, treating as string:', event.content.substring(0, 100));
        // Some NIP-46 implementations might send plain text
        content = { method: 'connect', params: [] };
      }

      console.log('📋 NIP-46: Parsed content:', content);

      // Check if this is a response to a pending request
      if (content.id && this.pendingRequests.has(content.id)) {
        const pending = this.pendingRequests.get(content.id);
        if (pending) {
          this.pendingRequests.delete(content.id);
          if (content.error) {
            pending.reject(new Error(`NIP-46 error: ${content.error.message || content.error} (code: ${content.error.code || 'unknown'})`));
          } else {
            pending.resolve(content.result);
          }
          return;
        }
      }

      // Check if this is a connection/authentication response
      // NIP-46 connection events can have different structures:
      // 1. Method-based: { method: 'connect', params: [...] }
      // 2. Response-based: { id: '...', result: 'pubkey' }
      // 3. Direct pubkey in content
      
      const isConnectionEvent = 
        content.method === 'connect' || 
        content.method === 'get_public_key' ||
        (content.result && typeof content.result === 'string' && content.result.length === 64) ||
        (event.content && event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content));

      if (isConnectionEvent) {
        // Extract signer's public key
        let signerPubkey = event.pubkey; // Default to event author
        
        if (content.result && typeof content.result === 'string') {
          signerPubkey = content.result;
        } else if (event.content && /^[a-f0-9]{64}$/i.test(event.content)) {
          signerPubkey = event.content;
        }

        // This is a connection from the signer
        if (this.connection) {
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
          this.connection.pubkey = signerPubkey;
        }

        // Save connection to localStorage for persistence
        if (typeof window !== 'undefined' && this.connection) {
          try {
            const { saveNIP46Connection } = require('./nip46-storage');
            saveNIP46Connection({
              token: this.connection.token,
              pubkey: signerPubkey,
              signerUrl: this.connection.signerUrl,
              connectedAt: Date.now(),
            });
            console.log('💾 NIP-46: Saved connection to localStorage');
          } catch (err) {
            console.error('❌ NIP-46: Failed to save connection:', err);
          }
        }

        console.log('✅ NIP-46: Connected via relay, signer pubkey:', signerPubkey);

        // Call the connection callback if set
        if (this.onConnectionCallback && signerPubkey) {
          this.onConnectionCallback(signerPubkey);
        }
      } else {
        console.log('ℹ️ NIP-46: Event received but not a connection event:', content);
      }
    } catch (error) {
      console.error('❌ NIP-46: Failed to handle relay event:', error);
    }
  }

  /**
   * Set callback for when connection is established
   */
  setOnConnection(callback: (pubkey: string) => void): void {
    this.onConnectionCallback = callback;
  }

  /**
   * Establish WebSocket connection
   */
  private async establishConnection(): Promise<void> {
    if (!this.connection) {
      throw new Error('No connection configured');
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.connection!.signerUrl);

        ws.onopen = () => {
          console.log('✅ NIP-46: WebSocket connected');
          this.ws = ws;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          resolve();
        };

        ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        ws.onerror = (error) => {
          console.error('❌ NIP-46: WebSocket error:', error);
          reject(new Error('WebSocket connection error'));
        };

        ws.onclose = () => {
          console.log('⚠️ NIP-46: WebSocket closed');
          this.ws = null;
          if (this.connection) {
            this.connection.connected = false;
          }
          this.stopHeartbeat();

          // Attempt to reconnect if connection was established
          if (this.connection?.connected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`🔄 NIP-46: Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            setTimeout(() => {
              this.establishConnection().catch(console.error);
            }, this.reconnectDelay * this.reconnectAttempts);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const response: NIP46Response = JSON.parse(data);

      // Handle authentication response
      if (response.id === 'auth' && response.result) {
        if (this.connection) {
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
          this.connection.pubkey = response.result;
        }
        console.log('✅ NIP-46: Authenticated, pubkey:', response.result);
        return;
      }

      // Handle regular request/response
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`NIP-46 error: ${response.error.message} (code: ${response.error.code})`));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch (error) {
      console.error('❌ NIP-46: Failed to parse message:', error);
    }
  }

  /**
   * Send a request to the signer
   */
  private async sendRequest(method: string, params: any[]): Promise<any> {
    // For relay-based connections, we need to publish a NIP-46 request event
    if (!this.ws && this.relayClient && this.connection) {
      return this.sendRelayRequest(method, params);
    }

    // For WebSocket connections
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.connection && !this.connection.connected) {
        await this.establishConnection();
      } else {
        throw new Error('WebSocket not connected');
      }
    }

    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const request: NIP46Request = {
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout after 30 seconds'));
        }
      }, 30000);

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Send a request via relay (for relay-based NIP-46 connections)
   */
  private async sendRelayRequest(method: string, params: any[]): Promise<any> {
    if (!this.relayClient || !this.connection) {
      throw new Error('Relay client not initialized');
    }

    // Get connection info
    const pendingConnection = typeof window !== 'undefined' 
      ? sessionStorage.getItem('nip46_pending_connection')
      : null;
    
    if (!pendingConnection) {
      throw new Error('No pending connection found');
    }

    const connectionInfo = JSON.parse(pendingConnection);
    const appPubkey = connectionInfo.publicKey;
    const signerPubkey = this.connection.pubkey;

    // For get_public_key, we can proceed even without the pubkey (we're requesting it)
    // For other methods, we need the pubkey to be available
    if (method !== 'get_public_key' && !signerPubkey) {
      throw new Error('Signer public key not available. Please wait for the connection to be established.');
    }

    // Create NIP-46 request event (kind 24133)
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const request: NIP46Request = {
      id,
      method,
      params,
    };

    // For relay-based requests, we need to wait for the response event
    // This is a simplified implementation - in production, you'd want to
    // properly handle the request/response cycle via relay events
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 60 seconds for relay requests (longer than WebSocket)
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method} - Relay requests may take longer. Please ensure Amber is connected and try again.`));
        }
      }, 60000);

      // If it's get_public_key and we already have the pubkey, return it immediately
      if (method === 'get_public_key' && signerPubkey) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        resolve(signerPubkey);
        return;
      }

      // For get_public_key without pubkey, we need to use the app's pubkey as a placeholder
      // The signer will respond with their actual pubkey
      const pubkeyForRequest = signerPubkey || appPubkey;

      // For other methods, publish a request event and wait for response
      // 1. Create and publish a kind 24133 event with the request
      // 2. Listen for a response event with matching ID
      // 3. Resolve/reject based on the response
      
      // Create NIP-46 request event
      // For get_public_key, we use appPubkey as placeholder if signerPubkey isn't available yet
      const requestEvent = this.createNIP46RequestEvent(method, params, id, appPubkey, pubkeyForRequest, connectionInfo.privateKey);
      
      // Publish the request event
      if (!this.connection) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error('Connection not initialized'));
        return;
      }
      
      this.relayClient!.publish(requestEvent, {
        relays: [this.connection.signerUrl],
        waitForRelay: false,
      }).catch(err => {
        console.error('❌ NIP-46: Failed to publish request event:', err);
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to publish request: ${err instanceof Error ? err.message : 'Unknown error'}`));
      });

      // The response will be handled by handleRelayEvent when we receive it
      // We store the pending request so it can be resolved when the response arrives
    });
  }

  /**
   * Authenticate with the signer
   */
  async authenticate(): Promise<string> {
    if (!this.connection) {
      throw new Error('Not connected');
    }

    // Send connect request with token
    const pubkey = await this.sendRequest('connect', [this.connection.token]);
    
    if (this.connection) {
      this.connection.pubkey = pubkey;
      this.connection.connected = true;
      this.connection.connectedAt = Date.now();
    }

    return pubkey;
  }

  /**
   * Get public key from signer
   */
  async getPublicKey(): Promise<string> {
    // For relay-based connections, we already have the pubkey from the connection event
    if (this.connection?.pubkey && !this.ws) {
      return this.connection.pubkey;
    }

    if (!this.connection?.connected) {
      await this.authenticate();
    }

    // For WebSocket connections, request it
    if (this.ws) {
      return this.sendRequest('get_public_key', []);
    }

    // Fallback: return stored pubkey if available
    if (this.connection?.pubkey) {
      return this.connection.pubkey;
    }

    throw new Error('No public key available and unable to request it');
  }

  /**
   * Sign an event using the remote signer
   */
  async signEvent(event: Event): Promise<Event> {
    if (!this.connection?.connected) {
      await this.authenticate();
    }

    // Get pubkey if not already available
    if (!this.connection?.pubkey) {
      await this.getPublicKey();
    }

    // Prepare event for signing (without id and sig, but with pubkey for hash calculation)
    const eventToSign = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
      pubkey: this.connection!.pubkey!,
    };

    // Request signature from signer (send without pubkey as per NIP-46 spec)
    const eventForSigner = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
    };
    const signature = await this.sendRequest('sign_event', [JSON.stringify(eventForSigner)]);

    // Calculate event ID (requires pubkey)
    const id = getEventHash(eventToSign);

    // Return complete signed event
    return {
      ...eventToSign,
      id,
      pubkey: this.connection!.pubkey!,
      sig: signature,
    };
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send ping (some implementations use ping/pong)
        try {
          this.ws.send(JSON.stringify({ method: 'ping', params: [] }));
        } catch (error) {
          console.warn('⚠️ NIP-46: Heartbeat failed:', error);
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Disconnect from signer
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Unsubscribe from relay
    if (this.relaySubscription) {
      this.relaySubscription();
      this.relaySubscription = null;
    }

    if (this.relayClient) {
      await this.relayClient.disconnect();
      this.relayClient = null;
    }

    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests.entries()) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.connection) {
      this.connection.connected = false;
    }

    this.onConnectionCallback = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    // For WebSocket connections
    if (this.ws) {
      return this.connection?.connected === true && this.ws.readyState === WebSocket.OPEN;
    }
    // For relay-based connections
    return this.connection?.connected === true;
  }

  /**
   * Get connection info
   */
  getConnection(): NIP46Connection | null {
    return this.connection;
  }

  /**
   * Get public key from connection
   */
  getPubkey(): string | undefined {
    return this.connection?.pubkey;
  }
}

