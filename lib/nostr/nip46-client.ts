/**
 * NIP-46 (Remote Signing) Client
 * Implements client-side protocol for communicating with remote signers like Amber
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/46.md
 */

import { Event, getEventHash } from 'nostr-tools';

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
    return Promise.resolve();
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
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      try {
        this.ws!.send(JSON.stringify(request));
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(error);
      }
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
    if (!this.connection?.connected) {
      await this.authenticate();
    }

    return this.sendRequest('get_public_key', []);
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

    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests.entries()) {
      reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    if (this.connection) {
      this.connection.connected = false;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection?.connected === true && this.ws?.readyState === WebSocket.OPEN;
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

