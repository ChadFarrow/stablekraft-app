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

    // Clean up any existing relay subscription first
    if (this.relaySubscription) {
      console.log('🧹 NIP-46: Cleaning up existing relay subscription');
      try {
        this.relaySubscription();
        this.relaySubscription = null;
      } catch (err) {
        console.warn('Failed to cleanup existing subscription:', err);
      }
    }

    // Clean up existing relay client if any
    if (this.relayClient) {
      console.log('🧹 NIP-46: Disconnecting existing relay client');
      try {
        await this.relayClient.disconnect();
      } catch (err) {
        console.warn('Failed to disconnect existing relay client:', err);
      }
    }

    // Initialize relay client
    console.log('🔌 NIP-46: Initializing relay client for:', relayUrl);
    this.relayClient = new NostrClient([relayUrl]);
    
    console.log('🔌 NIP-46: Connecting to relay...');
    try {
      await this.relayClient.connectToRelays([relayUrl]);
      console.log('✅ NIP-46: Successfully connected to relay');
    } catch (err) {
      console.error('❌ NIP-46: Failed to connect to relay:', err);
      throw err;
    }

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
      connectionState: {
        hasConnection: !!this.connection,
        hasPubkey: !!this.connection?.pubkey,
        connected: this.connection?.connected,
      },
    });
    
    // Log that we're waiting for connection
    console.log('⏳ NIP-46: Waiting for connection event from signer...');

    console.log('📡 NIP-46: Creating subscription...');
    this.relaySubscription = this.relayClient.subscribe({
      relays: [relayUrl],
      filters,
      onEvent: (event: Event) => {
        console.log('🎯 NIP-46: onEvent callback triggered!');
        console.log('📨 NIP-46: Received event from relay:', {
          id: event.id.slice(0, 16) + '...',
          pubkey: event.pubkey.slice(0, 16) + '...',
          kind: event.kind,
          tags: event.tags,
          content: event.content.substring(0, 200),
          contentLength: event.content.length,
        });
        
        // Check if this event is for us (tagged with our pubkey)
        const isForUs = event.tags.some(tag => tag[0] === 'p' && tag[1] === appPubkey);
        // Check if event is from us (our own requests) - we should ignore these
        const isFromUs = event.pubkey === appPubkey;
        
        console.log('🔍 NIP-46: Event filtering check:', {
          isForUs,
          isFromUs,
          appPubkey: appPubkey.slice(0, 16) + '...',
          eventPubkey: event.pubkey.slice(0, 16) + '...',
          tags: event.tags,
          willProcess: isForUs && !isFromUs,
        });
        
        if (isForUs && !isFromUs) {
          // Only process events that are for us AND not from us (responses from signer)
          console.log('✅ NIP-46: Event passed filter, processing...');
          this.handleRelayEvent(event, connectionInfo);
        } else {
          if (isFromUs) {
            console.log('ℹ️ NIP-46: Ignoring event from us (our own request)');
          } else if (!isForUs) {
            console.log('ℹ️ NIP-46: Event received but not tagged for us, skipping. Event tags:', event.tags);
            // For connection events, Amber might not tag us - let's check if it's a connection event anyway
            try {
              const content = JSON.parse(event.content);
              const mightBeConnection = content.method === 'connect' || 
                                       content.method === 'get_public_key' ||
                                       (content.result && typeof content.result === 'string' && content.result.length === 64);
              if (mightBeConnection) {
                console.log('⚠️ NIP-46: Event looks like a connection event but not tagged for us. Processing anyway...');
                this.handleRelayEvent(event, connectionInfo);
              }
            } catch (e) {
              // Not JSON, ignore
            }
          }
        }
      },
      onEose: () => {
        console.log('✅ NIP-46: Subscription EOSE (End of Stored Events)');
      },
      onError: (error) => {
        console.error('❌ NIP-46: Relay subscription error:', error);
      },
    });

    console.log('✅ NIP-46: Subscription created successfully. Listening for connection on relay:', relayUrl);
    console.log('📋 NIP-46: Subscription details:', {
      relayUrl,
      filtersCount: filters.length,
      appPubkey: appPubkey.slice(0, 16) + '...',
      hasSubscription: !!this.relaySubscription,
    });
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
    // finalizeEvent will automatically derive the pubkey from the secret key
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
        console.log('📋 NIP-46: Parsed content (JSON):', {
          hasId: 'id' in content,
          hasResult: 'result' in content,
          hasError: 'error' in content,
          hasMethod: 'method' in content,
          id: content.id,
          resultType: typeof content.result,
          resultValue: content.result,
          error: content.error,
          method: content.method,
          fullContent: JSON.stringify(content, null, 2),
        });
      } catch (parseError) {
        // Check if it's a plain text signature (64 char hex)
        if (event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content)) {
          console.log('✅ NIP-46: Event content appears to be a signature, creating response object');
          content = { 
            id: event.id, // Use event ID as request ID
            result: event.content 
          };
        } else if (event.content === 'network-check') {
          // Ignore network-check messages
          console.log('ℹ️ NIP-46: Ignoring network-check message');
          return;
        } else {
          console.warn('⚠️ NIP-46: Event content is not JSON, treating as string:', {
            content: event.content.substring(0, 100),
            contentLength: event.content.length,
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
          });
          content = { method: 'connect', params: [] };
        }
      }

      // IMPORTANT: Skip events that are requests (have 'method' field) - these are our own requests
      // We only want to process responses (have 'result' or 'error' field)
      if (content.method && !content.result && !content.error) {
        console.log('ℹ️ NIP-46: Ignoring request event (this is our own request, not a response):', {
          method: content.method,
          id: content.id,
        });
        return;
      }

      // Check if this is a response to a pending request
      if (content.id) {
        console.log('🔍 NIP-46: Checking if response matches pending request:', {
          responseId: content.id,
          pendingRequestIds: Array.from(this.pendingRequests.keys()),
          hasMatch: this.pendingRequests.has(content.id),
        });

        if (this.pendingRequests.has(content.id)) {
          const pending = this.pendingRequests.get(content.id);
          if (pending) {
            this.pendingRequests.delete(content.id);
            console.log('✅ NIP-46: Found matching pending request, processing response');
            
            if (content.error) {
              console.error('❌ NIP-46: Error in response:', content.error);
              pending.reject(new Error(`NIP-46 error: ${content.error.message || content.error} (code: ${content.error.code || 'unknown'})`));
            } else {
              console.log('✅ NIP-46: Resolving pending request:', {
                id: content.id,
                resultType: typeof content.result,
                resultIsString: typeof content.result === 'string',
                resultIsUndefined: content.result === undefined,
                resultIsNull: content.result === null,
                resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
                resultPreview: typeof content.result === 'string' 
                  ? content.result.slice(0, 32) + '...' 
                  : content.result === undefined 
                    ? 'UNDEFINED' 
                    : content.result === null 
                      ? 'NULL'
                      : JSON.stringify(content.result).slice(0, 200),
                fullContent: JSON.stringify(content, null, 2),
              });
              
              // Handle case where result might be undefined
              if (content.result === undefined) {
                console.error('❌ NIP-46: Response result is undefined! Full content:', JSON.stringify(content, null, 2));
                console.error('❌ NIP-46: Event content:', event.content);
                console.error('❌ NIP-46: Parsed content:', content);
                // Try to extract result from different possible locations
                if (event.content && typeof event.content === 'string') {
                  try {
                    const parsedContent = JSON.parse(event.content);
                    if (parsedContent.result !== undefined) {
                      console.log('✅ NIP-46: Found result in parsed event.content:', parsedContent.result);
                      pending.resolve(parsedContent.result);
                      return;
                    }
                  } catch (e) {
                    // Not JSON, might be plain text
                    if (event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content)) {
                      console.log('✅ NIP-46: Event content appears to be a signature:', event.content.slice(0, 16) + '...');
                      pending.resolve(event.content);
                      return;
                    }
                  }
                }
                pending.reject(new Error('Response result is undefined - no signature received from signer'));
              } else {
                pending.resolve(content.result);
              }
            }
            return;
          }
        } else {
          console.log('⚠️ NIP-46: Response ID does not match any pending request:', {
            responseId: content.id,
            pendingRequestIds: Array.from(this.pendingRequests.keys()),
            hasResult: 'result' in content,
            hasError: 'error' in content,
          });
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

      console.log('🔍 NIP-46: Checking if event is connection event:', {
        isConnectionEvent,
        hasMethod: !!content.method,
        method: content.method,
        hasResult: !!content.result,
        resultType: typeof content.result,
        resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
        contentIsHex: event.content && /^[a-f0-9]{64}$/i.test(event.content),
      });

      if (isConnectionEvent) {
        // Extract signer's public key
        let signerPubkey = event.pubkey; // Default to event author
        
        if (content.result && typeof content.result === 'string') {
          signerPubkey = content.result;
        } else if (event.content && /^[a-f0-9]{64}$/i.test(event.content)) {
          signerPubkey = event.content;
        }

        console.log('✅ NIP-46: Connected via relay, signer pubkey:', signerPubkey);

        // Store pubkey in connection object BEFORE calling callback
        if (this.connection && signerPubkey) {
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
          this.connection.pubkey = signerPubkey;
          console.log('💾 NIP-46: Stored pubkey in connection object:', {
            hasConnection: !!this.connection,
            hasPubkey: !!this.connection.pubkey,
            pubkeyPreview: this.connection.pubkey.slice(0, 16) + '...',
          });
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

        // Call the connection callback if set (pubkey is now guaranteed to be stored)
        if (this.onConnectionCallback && signerPubkey) {
          console.log('📞 NIP-46: Calling connection callback with pubkey:', signerPubkey.slice(0, 16) + '...');
          console.log('📞 NIP-46: Connection state before callback:', {
            hasConnection: !!this.connection,
            hasPubkey: !!this.connection?.pubkey,
            pubkeyMatches: this.connection?.pubkey === signerPubkey,
            connected: this.connection?.connected,
          });
          
          // Use setTimeout to ensure pubkey is fully stored before callback
          setTimeout(() => {
            if (this.connection?.pubkey) {
              console.log('✅ NIP-46: Pubkey confirmed in connection, invoking callback');
              this.onConnectionCallback!(signerPubkey);
            } else {
              console.error('❌ NIP-46: Pubkey not available when calling callback. Connection state:', {
                hasConnection: !!this.connection,
                hasPubkey: !!this.connection?.pubkey,
              });
            }
          }, 100); // Increased delay to ensure pubkey is stored
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

    console.log('📤 NIP-46: Creating relay request:', {
      method,
      requestId: id,
      hasSignerPubkey: !!signerPubkey,
      signerPubkey: signerPubkey ? signerPubkey.slice(0, 16) + '...' : 'N/A',
      appPubkey: appPubkey.slice(0, 16) + '...',
      pendingRequestsCount: this.pendingRequests.size,
    });

    // For relay-based requests, we need to wait for the response event
    // This is a simplified implementation - in production, you'd want to
    // properly handle the request/response cycle via relay events
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      console.log('⏳ NIP-46: Waiting for response to request:', {
        requestId: id,
        method,
        totalPendingRequests: this.pendingRequests.size,
      });

      // Timeout after 90 seconds for relay requests (longer than WebSocket)
      // Relay-based communication can be slower
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          console.error('❌ NIP-46: Request timeout:', {
            requestId: id,
            method,
            timeoutMs: 90000,
            pendingRequestsCount: this.pendingRequests.size,
            allPendingIds: Array.from(this.pendingRequests.keys()),
          });
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method} - No response received from signer after 90 seconds. Please ensure Amber is connected and try again.`));
        }
      }, 90000);

      // If it's get_public_key and we already have the pubkey, return it immediately
      if (method === 'get_public_key' && signerPubkey) {
        console.log('✅ NIP-46: Already have signer pubkey, returning immediately:', signerPubkey.slice(0, 16) + '...');
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        resolve(signerPubkey);
        return;
      }

      // For get_public_key without pubkey, we can't tag the signer (we don't know their pubkey yet)
      // According to NIP-46, for relay-based connections, the signer should be listening for
      // events tagged with their own pubkey. But for get_public_key, we don't have it yet.
      // 
      // The solution: For get_public_key, we should NOT tag a specific signer.
      // Instead, we publish the request and the signer should respond based on the connection token.
      // However, since we're using relay-based communication, we need to tag it somehow.
      // 
      // Actually, when Amber connects, they send us their pubkey. So if we're calling get_public_key
      // after connection, we should have the pubkey. If we're calling it before connection,
      // we need to wait for the connection first.
      
      // For now, if we don't have the signer pubkey, we'll use an empty tag or the app pubkey
      // The signer should be able to identify the request based on the connection token in the URI
      const pubkeyForRequest = signerPubkey || appPubkey;
      
      console.log('📋 NIP-46: Request details:', {
        method,
        hasSignerPubkey: !!signerPubkey,
        usingPubkeyForRequest: pubkeyForRequest === signerPubkey ? 'signer' : 'app (placeholder)',
        pubkeyForRequest: pubkeyForRequest.slice(0, 16) + '...',
      });

      // For other methods, publish a request event and wait for response
      // 1. Create and publish a kind 24133 event with the request
      // 2. Listen for a response event with matching ID
      // 3. Resolve/reject based on the response
      
      // Create NIP-46 request event
      // For get_public_key, we use appPubkey as placeholder if signerPubkey isn't available yet
      const requestEvent = this.createNIP46RequestEvent(method, params, id, appPubkey, pubkeyForRequest, connectionInfo.privateKey);
      
      console.log('📤 NIP-46: Publishing request event:', {
        eventId: requestEvent.id.slice(0, 16) + '...',
        eventPubkey: requestEvent.pubkey.slice(0, 16) + '...',
        requestId: id,
        method,
        tags: requestEvent.tags,
        contentPreview: requestEvent.content.substring(0, 100),
        relayUrl: this.connection?.signerUrl,
      });
      
      // Publish the request event
      if (!this.connection) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error('Connection not initialized'));
        return;
      }

      // Check if relay client exists
      if (!this.relayClient) {
        console.error('❌ NIP-46: Relay client is null, cannot publish');
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(new Error('Relay client not connected. Please try connecting again.'));
        return;
      }

      // Ensure relay is still connected - reconnect if needed
      try {
        // Check if relay manager has the relay connected
        const relayManager = (this.relayClient as any).relayManager;
        if (relayManager) {
          const isRelayConnected = relayManager.isConnected(this.connection.signerUrl);
          if (!isRelayConnected) {
            console.log('⚠️ NIP-46: Relay appears disconnected, reconnecting...', {
              relayUrl: this.connection.signerUrl,
            });
            await this.startRelayConnection(this.connection.signerUrl);
          }
        }
      } catch (reconnectErr) {
        console.error('❌ NIP-46: Failed to reconnect to relay:', reconnectErr);
        // Continue anyway - might still work
      }
      
      this.relayClient!.publish(requestEvent, {
        relays: [this.connection.signerUrl],
        waitForRelay: true, // Wait for relay confirmation to ensure it's published
        timeout: 10000, // 10 second timeout for publish confirmation
      }).then(results => {
        console.log('✅ NIP-46: Request event published:', {
          requestId: id,
          method,
          publishResults: results.map(r => ({
            status: r.status,
            value: r.status === 'fulfilled' ? 'published' : r.reason,
          })),
        });
        
        // Check if at least one relay accepted the event
        const hasSuccess = results.some(r => r.status === 'fulfilled');
        if (!hasSuccess) {
          console.error('❌ NIP-46: Failed to publish to any relay:', results);
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          reject(new Error('Failed to publish request to relay'));
        }
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
    // For relay-based connections, check if we already have the pubkey
    if (this.connection?.pubkey && !this.ws) {
      return this.connection.pubkey;
    }

    // For WebSocket connections, authenticate first if needed
    if (this.ws && !this.connection?.connected) {
      await this.authenticate();
    }

    // For relay-based connections without pubkey, request it via relay
    if (!this.ws && this.relayClient) {
      // Request the public key via relay
      const pubkey = await this.sendRequest('get_public_key', []);
      // Store it in the connection
      if (this.connection && pubkey) {
        this.connection.pubkey = pubkey;
        this.connection.connected = true;
        if (!this.connection.connectedAt) {
          this.connection.connectedAt = Date.now();
        }
      }
      return pubkey;
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

    // Validate we have the pubkey
    if (!this.connection?.pubkey) {
      throw new Error('Signer public key not available. Please wait for the connection to be established.');
    }

    const signerPubkey = this.connection.pubkey;

    // Prepare event for signing (without id and sig, but with pubkey for hash calculation)
    const eventToSign = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
      pubkey: signerPubkey,
    };

    // Request signature from signer (send without pubkey as per NIP-46 spec)
    const eventForSigner = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
    };

    console.log('✍️ NIP-46: Requesting signature for event:', {
      kind: eventForSigner.kind,
      tags: eventForSigner.tags,
      contentLength: eventForSigner.content.length,
      createdAt: eventForSigner.created_at,
    });

    const signatureResponse = await this.sendRequest('sign_event', [JSON.stringify(eventForSigner)]);

    console.log('🔍 NIP-46: Raw signature response:', {
      type: typeof signatureResponse,
      isString: typeof signatureResponse === 'string',
      isObject: typeof signatureResponse === 'object',
      value: typeof signatureResponse === 'string' 
        ? signatureResponse.slice(0, 32) + '...' 
        : JSON.stringify(signatureResponse).slice(0, 200),
    });

    // Handle different response formats
    let signature: string;
    if (typeof signatureResponse === 'string') {
      signature = signatureResponse;
    } else if (signatureResponse && typeof signatureResponse === 'object') {
      // Some implementations might return { sig: "..." } or { signature: "..." }
      if ('sig' in signatureResponse && typeof signatureResponse.sig === 'string') {
        signature = signatureResponse.sig;
      } else if ('signature' in signatureResponse && typeof signatureResponse.signature === 'string') {
        signature = signatureResponse.signature;
      } else if (Array.isArray(signatureResponse) && signatureResponse.length > 0 && typeof signatureResponse[0] === 'string') {
        signature = signatureResponse[0];
      } else {
        console.error('❌ NIP-46: Signature response is an object but no valid signature field found:', signatureResponse);
        throw new Error('Invalid signature format received from signer');
      }
    } else {
      console.error('❌ NIP-46: Invalid signature received:', {
        type: typeof signatureResponse,
        value: signatureResponse,
      });
      throw new Error('Invalid signature received from signer');
    }

    // Validate signature format (should be 64 character hex string)
    if (!signature || typeof signature !== 'string' || signature.length === 0) {
      console.error('❌ NIP-46: Signature is empty or not a string:', signature);
      throw new Error('Invalid signature received from signer: signature is empty');
    }

    // Normalize signature (remove any whitespace)
    signature = signature.trim();

    if (signature.length < 64) {
      console.error('❌ NIP-46: Signature too short:', {
        length: signature.length,
        preview: signature.slice(0, 32),
      });
      throw new Error(`Invalid signature received from signer: signature too short (${signature.length} chars, expected 64+)`);
    }

    console.log('✅ NIP-46: Received and validated signature:', {
      length: signature.length,
      preview: signature.slice(0, 16) + '...',
    });

    // Calculate event ID (requires pubkey)
    const id = getEventHash(eventToSign);

    // Return complete signed event
    const signedEvent = {
      ...eventToSign,
      id,
      pubkey: signerPubkey,
      sig: signature,
    };

    console.log('✅ NIP-46: Constructed signed event:', {
      id: signedEvent.id.slice(0, 16) + '...',
      pubkey: signedEvent.pubkey.slice(0, 16) + '...',
      sig: signedEvent.sig.slice(0, 16) + '...',
      created_at: signedEvent.created_at,
    });

    return signedEvent;
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

