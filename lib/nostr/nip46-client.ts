/**
 * NIP-46 (Remote Signing) Client
 * Implements client-side protocol for communicating with remote signers like Amber
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/46.md
 */

import { Event, getEventHash, Filter, EventTemplate, finalizeEvent } from 'nostr-tools';
import { nip44 } from 'nostr-tools';
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

/**
 * Parse bunker:// URI to extract connection information
 * Format: bunker://<pubkey>?relay=<relay_url>&relay=<relay_url2>&secret=<secret>
 * @param uri - The bunker:// URI string
 * @returns Parsed connection info with pubkey, relay URLs, and secret
 */
export interface BunkerConnectionInfo {
  pubkey: string;
  relays: string[];
  secret: string;
}

export function parseBunkerUri(uri: string): BunkerConnectionInfo {
  if (!uri.startsWith('bunker://')) {
    throw new Error('Invalid bunker:// URI format - must start with bunker://');
  }

  // Remove bunker:// prefix
  const withoutScheme = uri.substring(9);
  
  // Split on ? to separate pubkey from query params
  const [pubkeyPart, queryString] = withoutScheme.split('?');
  
  if (!pubkeyPart || pubkeyPart.length !== 64) {
    throw new Error('Invalid bunker:// URI - pubkey must be 64 hex characters');
  }

  const pubkey = pubkeyPart;
  const relays: string[] = [];
  let secret = '';

  // Parse query parameters
  if (queryString) {
    const params = new URLSearchParams(queryString);
    
    // Get all relay parameters (can be multiple)
    params.getAll('relay').forEach(relay => {
      if (relay) {
        relays.push(decodeURIComponent(relay));
      }
    });
    
    // Get secret parameter (required)
    const secretParam = params.get('secret');
    if (secretParam) {
      secret = decodeURIComponent(secretParam);
    } else {
      throw new Error('Invalid bunker:// URI - secret parameter is required');
    }
  } else {
    throw new Error('Invalid bunker:// URI - query parameters are required');
  }

  if (relays.length === 0) {
    throw new Error('Invalid bunker:// URI - at least one relay URL is required');
  }

  return {
    pubkey,
    relays,
    secret,
  };
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
  private eventCounter: number = 0; // Track total events received
  private lastEventTime: number = 0; // Track when last event was received

  /**
   * Connect to a NIP-46 signer
   * @param signerUrl - WebSocket URL of the signer, relay URL, or bunker:// URI
   * @param token - Connection token (nsecBunker token or secret)
   * @param connectImmediately - Whether to connect immediately (default: false, wait for signer to initiate)
   * @param signerPubkey - Optional signer pubkey (for bunker:// connections, extracted from URI)
   */
  async connect(signerUrl: string, token: string, connectImmediately: boolean = false, signerPubkey?: string): Promise<void> {
    if (this.connection && this.connection.connected) {
      await this.disconnect();
    }

    // Detect URI scheme: bunker:// vs nostrconnect:// vs direct URL
    if (signerUrl.startsWith('bunker://')) {
      console.log('🔌 NIP-46: Detected bunker:// URI, parsing for nsecbunker connection');
      return this.connectBunker(signerUrl);
    } else if (signerUrl.startsWith('nostrconnect://')) {
      console.log('🔌 NIP-46: Detected nostrconnect:// URI, using relay-based connection');
      // Extract relay URL from nostrconnect:// URI if needed
      // For now, assume signerUrl is already the relay URL
      return this.connectNostrConnect(signerUrl, token);
    } else {
      // Direct URL connection (existing logic)
      return this.connectDirect(signerUrl, token, connectImmediately, signerPubkey);
    }
  }

  /**
   * Connect using bunker:// URI (nsecbunker WebSocket)
   */
  private async connectBunker(bunkerUri: string): Promise<void> {
    try {
      const bunkerInfo = parseBunkerUri(bunkerUri);
      console.log('🔌 NIP-46: Parsed bunker:// URI:', {
        pubkey: bunkerInfo.pubkey.slice(0, 16) + '...',
        relayCount: bunkerInfo.relays.length,
        relays: bunkerInfo.relays,
        hasSecret: !!bunkerInfo.secret,
      });

      // Use the first relay URL as the WebSocket endpoint
      const wsUrl = bunkerInfo.relays[0];
      
      // Store connection info with signer pubkey from URI
      this.connection = {
        signerUrl: wsUrl,
        token: bunkerInfo.secret,
        pubkey: bunkerInfo.pubkey, // Pubkey is known from URI
        connected: false,
      };

      // Connect immediately via WebSocket for nsecbunker
      console.log('🔌 NIP-46: Connecting to nsecbunker via WebSocket:', wsUrl);
      return this.establishConnection();
    } catch (error) {
      console.error('❌ NIP-46: Failed to parse bunker:// URI:', error);
      throw new Error(`Failed to parse bunker:// URI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Connect using nostrconnect:// URI (relay-based)
   */
  private async connectNostrConnect(nostrConnectUri: string, token: string): Promise<void> {
    // For nostrconnect://, we need to extract the relay URL
    // The URI format is: nostrconnect://<pubkey>?relay=<relay_url>&secret=<secret>
    // For now, we'll use the existing relay-based connection logic
    // The signerUrl parameter should already be the relay URL
    this.connection = {
      signerUrl: nostrConnectUri, // Will be parsed in startRelayConnection if needed
      token,
      connected: false,
    };

    // Extract relay URL from URI if it's a full nostrconnect:// URI
    let relayUrl = nostrConnectUri;
    if (nostrConnectUri.startsWith('nostrconnect://')) {
      try {
        const url = new URL(nostrConnectUri.replace('nostrconnect://', 'http://'));
        const relayParam = url.searchParams.get('relay');
        if (relayParam) {
          relayUrl = decodeURIComponent(relayParam);
        }
      } catch (err) {
        console.warn('⚠️ NIP-46: Failed to parse nostrconnect:// URI, using as-is:', err);
      }
    }

    return this.startRelayConnection(relayUrl);
  }

  /**
   * Connect using direct URL (existing logic)
   */
  private async connectDirect(signerUrl: string, token: string, connectImmediately: boolean, signerPubkey?: string): Promise<void> {
    this.connection = {
      signerUrl,
      token,
      pubkey: signerPubkey,
      connected: false,
    };

    // Only connect immediately if requested (for direct WebSocket connections)
    // For relay-based connections, wait for the signer to initiate
    if (connectImmediately && signerUrl.startsWith('wss://') && !signerUrl.includes('relay')) {
      return this.establishConnection();
    }
    
    // For relay-based connections, we'll wait for the signer to connect
    // The connection will be established when we receive a connection request
    if (signerUrl.includes('relay') || (signerUrl.startsWith('wss://') && signerUrl.includes('relay'))) {
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
        // Increment event counter
        this.eventCounter++;
        this.lastEventTime = Date.now();
        
        console.log(`🎯 NIP-46: onEvent callback triggered! (Event #${this.eventCounter})`);
        console.log('📨 NIP-46: Received event from relay:', {
          eventNumber: this.eventCounter,
          id: event.id.slice(0, 16) + '...',
          pubkey: event.pubkey.slice(0, 16) + '...',
          kind: event.kind,
          tags: event.tags,
          tagsCount: event.tags.length,
          contentLength: event.content.length,
          contentPreview: event.content.substring(0, 200),
          timestamp: new Date(event.created_at * 1000).toISOString(),
          timeSinceLastEvent: this.eventCounter > 1 ? `${Date.now() - this.lastEventTime}ms` : 'first event',
        });
        
        // Check if this event is for us (tagged with our pubkey)
        const isForUs = event.tags.some(tag => tag[0] === 'p' && tag[1] === appPubkey);
        // Check if event is from us (our own requests) - we should ignore these
        const isFromUs = event.pubkey === appPubkey;
        
        // Also check all 'p' tags to see what pubkeys are tagged
        const allPTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
        
        console.log('🔍 NIP-46: Event filtering check:', {
          eventId: event.id.slice(0, 16) + '...',
          eventPubkey: event.pubkey.slice(0, 16) + '...',
          allPTags: allPTags.map(p => p.slice(0, 16) + '...'),
          appPubkey: appPubkey.slice(0, 16) + '...',
          isForUs,
          isFromUs,
          willProcess: isForUs && !isFromUs,
          reason: isFromUs ? 'Event is from us (our own request)' : !isForUs ? 'Event not tagged for us' : 'Event is for us and not from us - will process',
        });
        
        if (isForUs && !isFromUs) {
          // Only process events that are for us AND not from us (responses from signer)
          console.log('✅ NIP-46: Event passed filter, processing...');
          this.handleRelayEvent(event, connectionInfo);
        } else {
          if (isFromUs) {
            console.log('ℹ️ NIP-46: Ignoring event from us (our own request)');
          } else if (!isForUs) {
            console.log('ℹ️ NIP-46: Event received but not tagged for us. Event details:', {
              eventId: event.id.slice(0, 16) + '...',
              eventPubkey: event.pubkey.slice(0, 16) + '...',
              allPTags: allPTags.map(p => p.slice(0, 16) + '...'),
              appPubkey: appPubkey.slice(0, 16) + '...',
              tags: event.tags,
            });
            
            // For connection events, Amber might not tag us - let's check if it's a connection event anyway
            // Try to decrypt and parse the content
            try {
              // First try NIP-44 decryption
              let content: any;
              try {
                const appPrivateKeyBytes = hexToBytes(connectionInfo.privateKey);
                const eventPubkeyBytes = hexToBytes(event.pubkey);
                const decrypted = nip44.decrypt(appPrivateKeyBytes, event.pubkey, event.content);
                content = JSON.parse(decrypted);
                console.log('📋 NIP-46: Successfully decrypted untagged event content');
              } catch (decryptErr) {
                // Try plain JSON
                content = JSON.parse(event.content);
                console.log('📋 NIP-46: Parsed untagged event as plain JSON');
              }
              
              const mightBeConnection = content.method === 'connect' || 
                                       content.method === 'get_public_key' ||
                                       (content.result && typeof content.result === 'string' && content.result.length === 64);
              
              // Also check if it's a response to one of our pending requests
              const isResponseToPending = content.id && this.pendingRequests.has(content.id);
              
              if (mightBeConnection || isResponseToPending) {
                console.log('⚠️ NIP-46: Event looks like a connection/response event but not tagged for us. Processing anyway...', {
                  mightBeConnection,
                  isResponseToPending,
                  requestId: content.id,
                  hasPendingRequest: isResponseToPending,
                });
                this.handleRelayEvent(event, connectionInfo);
              } else {
                console.log('ℹ️ NIP-46: Event is not for us and not a connection/response event, ignoring');
              }
            } catch (e) {
              // Not JSON or can't decrypt, ignore
              console.log('ℹ️ NIP-46: Event content is not parseable, ignoring:', e instanceof Error ? e.message : String(e));
            }
          }
        }
      },
      onEose: () => {
        console.log('✅ NIP-46: Subscription EOSE (End of Stored Events)');
        console.log('📊 NIP-46: Subscription statistics:', {
          pendingRequests: this.pendingRequests.size,
          pendingRequestIds: Array.from(this.pendingRequests.keys()),
          hasConnection: !!this.connection,
          connectionPubkey: this.connection?.pubkey?.slice(0, 16) + '...',
          connected: this.connection?.connected,
        });
      },
      onError: (error) => {
        console.error('❌ NIP-46: Relay subscription error:', error);
        console.error('❌ NIP-46: Subscription error details:', {
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : 'N/A',
          relayUrl,
          hasSubscription: !!this.relaySubscription,
        });
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
   * According to NIP-46 spec, content must be NIP-44 encrypted
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

    // Encrypt the request using NIP-44
    // Encrypt from app's private key to signer's public key
    // NIP-44 v2 API requires: getConversationKey(privkeyA: Uint8Array, pubkeyB: string) -> conversationKey
    // Then: encrypt(plaintext: string, conversationKey: Uint8Array) -> encrypted string
    const requestJson = JSON.stringify(request);
    let encryptedContent: string;
    
    try {
      // Convert private key from hex string to Uint8Array
      const appPrivateKeyBytes = hexToBytes(appPrivateKey);
      
      // Get conversation key using NIP-44 v2 API
      const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, signerPubkey);
      
      // Encrypt using the conversation key
      encryptedContent = nip44.encrypt(requestJson, conversationKey);
      
      console.log('🔐 NIP-46: Encrypted request content with NIP-44:', {
        method,
        requestId,
        originalLength: requestJson.length,
        encryptedLength: encryptedContent.length,
        signerPubkey: signerPubkey.slice(0, 16) + '...',
        appPubkey: appPubkey.slice(0, 16) + '...',
      });
    } catch (encryptError) {
      console.error('❌ NIP-46: Failed to encrypt request with NIP-44:', {
        error: encryptError instanceof Error ? encryptError.message : String(encryptError),
        method,
        requestId,
      });
      throw new Error(`Failed to encrypt NIP-46 request: ${encryptError instanceof Error ? encryptError.message : String(encryptError)}`);
    }

    const template: EventTemplate = {
      kind: 24133, // NIP-46 request/response event kind
      tags: [
        ['p', signerPubkey], // Tag the signer
      ],
      content: encryptedContent, // NIP-44 encrypted JSON-RPC request
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
      // According to NIP-46 spec, content is NIP-44 encrypted JSON-RPC message
      // We need to decrypt it first using the app's private key and signer's public key
      let content;
      let decryptedContent: string | null = null;
      
      try {
        // First, try to decrypt as NIP-44 encrypted content
        // The content is encrypted from signer's pubkey to our app's pubkey
        const signerPubkey = event.pubkey; // The signer's public key (who sent this event)
        const appPrivateKey = connectionInfo.privateKey; // Our app's private key
        
        console.log('🔐 NIP-46: Attempting to decrypt NIP-44 content:', {
          signerPubkey: signerPubkey.slice(0, 16) + '...',
          hasAppPrivateKey: !!appPrivateKey,
          contentLength: event.content.length,
          contentPreview: event.content.substring(0, 50) + '...',
        });
        
        try {
          // Decrypt using NIP-44 v2 API
          // Convert private key from hex string to Uint8Array
          const appPrivateKeyBytes = hexToBytes(appPrivateKey);
          
          // Get conversation key using NIP-44 v2 API
          // The content is encrypted from signer's pubkey to our app's pubkey
          const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, signerPubkey);
          
          // Decrypt using the conversation key
          decryptedContent = nip44.decrypt(event.content, conversationKey);
          console.log('✅ NIP-46: Successfully decrypted NIP-44 content');
          
          // Now parse the decrypted JSON
          content = JSON.parse(decryptedContent);
          console.log('📋 NIP-46: Parsed decrypted content (JSON):', {
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
        } catch (decryptError) {
          console.warn('⚠️ NIP-46: Failed to decrypt as NIP-44, trying plain JSON:', {
            decryptError: decryptError instanceof Error ? decryptError.message : String(decryptError),
            contentPreview: event.content.substring(0, 100),
          });
          
          // Fallback: try parsing as plain JSON (for backwards compatibility or non-encrypted responses)
          content = JSON.parse(event.content);
          console.log('📋 NIP-46: Parsed content as plain JSON (not encrypted):', {
            hasId: 'id' in content,
            hasResult: 'result' in content,
            hasError: 'error' in content,
            hasMethod: 'method' in content,
          });
        }
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
          console.error('❌ NIP-46: Failed to parse event content (neither NIP-44 encrypted nor plain JSON):', {
            content: event.content.substring(0, 100),
            contentLength: event.content.length,
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
            signerPubkey: event.pubkey.slice(0, 16) + '...',
            hasAppPrivateKey: !!connectionInfo?.privateKey,
            note: 'Content should be NIP-44 encrypted JSON-RPC message per NIP-46 spec',
          });
          // Don't create fake content - return early to avoid processing invalid events
          return;
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
              if ((pending as any).statusInterval) {
                clearInterval((pending as any).statusInterval);
              }
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
                      if ((pending as any).statusInterval) {
                        clearInterval((pending as any).statusInterval);
                      }
                      pending.resolve(parsedContent.result);
                      return;
                    }
                  } catch (e) {
                    // Not JSON, might be plain text
                    if (event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content)) {
                      console.log('✅ NIP-46: Event content appears to be a signature:', event.content.slice(0, 16) + '...');
                      if ((pending as any).statusInterval) {
                        clearInterval((pending as any).statusInterval);
                      }
                      pending.resolve(event.content);
                      return;
                    }
                  }
                }
                if ((pending as any).statusInterval) {
                  clearInterval((pending as any).statusInterval);
                }
                pending.reject(new Error('Response result is undefined - no signature received from signer'));
              } else {
                if ((pending as any).statusInterval) {
                  clearInterval((pending as any).statusInterval);
                }
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
        // Only call once - clear the callback after use to prevent duplicate calls
        if (this.onConnectionCallback && signerPubkey) {
          console.log('📞 NIP-46: Calling connection callback with pubkey:', signerPubkey.slice(0, 16) + '...');
          console.log('📞 NIP-46: Connection state before callback:', {
            hasConnection: !!this.connection,
            hasPubkey: !!this.connection?.pubkey,
            pubkeyMatches: this.connection?.pubkey === signerPubkey,
            connected: this.connection?.connected,
          });
          
          // Store callback and clear it immediately to prevent duplicate calls
          const callback = this.onConnectionCallback;
          this.onConnectionCallback = null; // Clear immediately to prevent re-triggering
          
          // Use setTimeout to ensure pubkey is fully stored before callback
          setTimeout(() => {
            if (this.connection?.pubkey) {
              console.log('✅ NIP-46: Pubkey confirmed in connection, invoking callback');
              callback(signerPubkey);
            } else {
              console.error('❌ NIP-46: Pubkey not available when calling callback. Connection state:', {
                hasConnection: !!this.connection,
                hasPubkey: !!this.connection?.pubkey,
              });
            }
          }, 100); // Increased delay to ensure pubkey is stored
        } else if (this.connection?.connected && this.connection?.pubkey) {
          console.log('ℹ️ NIP-46: Connection already established, skipping callback (already connected)');
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

    // Check if this is a nsecbunker connection (pubkey already known from bunker:// URI)
    const isNsecbunker = !!this.connection.pubkey && this.connection.signerUrl.startsWith('wss://');

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.connection!.signerUrl);

        ws.onopen = () => {
          console.log('✅ NIP-46: WebSocket connected');
          this.ws = ws;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          
          // For nsecbunker, pubkey is already known from URI
          // Mark as connected and trigger callback immediately
          if (isNsecbunker && this.connection?.pubkey) {
            console.log('🔌 NIP-46: nsecbunker connection - pubkey already known from URI:', this.connection.pubkey.slice(0, 16) + '...');
            this.connection.connected = true;
            this.connection.connectedAt = Date.now();
            
            // Save connection to localStorage
            if (typeof window !== 'undefined') {
              try {
                const { saveNIP46Connection } = require('./nip46-storage');
                saveNIP46Connection({
                  token: this.connection.token,
                  pubkey: this.connection.pubkey,
                  signerUrl: this.connection.signerUrl,
                  connectedAt: Date.now(),
                });
                console.log('💾 NIP-46: Saved nsecbunker connection to localStorage');
              } catch (err) {
                console.error('❌ NIP-46: Failed to save connection:', err);
              }
            }
            
            // Trigger connection callback if set
            if (this.onConnectionCallback && this.connection.pubkey) {
              console.log('📞 NIP-46: Calling nsecbunker connection callback with pubkey:', this.connection.pubkey.slice(0, 16) + '...');
              const callback = this.onConnectionCallback;
              this.onConnectionCallback = null; // Clear to prevent duplicate calls
              setTimeout(() => {
                callback(this.connection!.pubkey!);
              }, 100);
            }
          }
          
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

    // Ensure relay is still connected - reconnect if needed (before creating Promise)
    try {
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
      throw new Error('Failed to connect to relay. Please try again.');
    }

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
      const startTime = Date.now();
      const pendingRequest: PendingRequest & { startTime?: number; statusInterval?: NodeJS.Timeout } = { 
        resolve, 
        reject,
        startTime,
      };
      this.pendingRequests.set(id, pendingRequest);

      console.log('⏳ NIP-46: Waiting for response to request:', {
        requestId: id,
        method,
        totalPendingRequests: this.pendingRequests.size,
        eventsReceivedSoFar: this.eventCounter,
        lastEventReceived: this.lastEventTime > 0 ? `${Math.floor((Date.now() - this.lastEventTime) / 1000)}s ago` : 'never',
      });

      // Set up periodic status logging while waiting
      const statusInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > 10000 && elapsed % 30000 < 1000) { // Log every 30 seconds after 10 seconds
          console.log('⏳ NIP-46: Still waiting for response...', {
            requestId: id,
            method,
            elapsedSeconds: Math.floor(elapsed / 1000),
            eventsReceivedTotal: this.eventCounter,
            lastEventReceived: this.lastEventTime > 0 ? `${Math.floor((Date.now() - this.lastEventTime) / 1000)}s ago` : 'never',
            pendingRequestsCount: this.pendingRequests.size,
            subscriptionActive: !!this.relaySubscription,
            relayUrl: this.connection?.signerUrl,
            warning: this.eventCounter === 0 
              ? '⚠️ No events received at all - subscription might not be working'
              : this.lastEventTime > 0 && Date.now() - this.lastEventTime > 60000
              ? '⚠️ No events received in last 60s - relay might be disconnected'
              : undefined,
          });
        }
      }, 1000);
      
      // Store interval for cleanup
      pendingRequest.statusInterval = statusInterval;

      // Timeout after 90 seconds for relay requests (longer than WebSocket)
      // Relay-based communication can be slower
      const timeout = setTimeout(() => {
        clearInterval(statusInterval);
        if (this.pendingRequests.has(id)) {
          console.error('❌ NIP-46: Request timeout:', {
            requestId: id,
            method,
            timeoutMs: 90000,
            pendingRequestsCount: this.pendingRequests.size,
            allPendingIds: Array.from(this.pendingRequests.keys()),
            eventsReceivedTotal: this.eventCounter,
            lastEventReceived: this.lastEventTime > 0 ? `${Math.floor((Date.now() - this.lastEventTime) / 1000)}s ago` : 'never',
            subscriptionActive: !!this.relaySubscription,
          });
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method} - No response received from signer after 90 seconds. Please ensure Amber is connected and try again.`));
        }
      }, 90000);

      // If it's get_public_key and we already have the pubkey, return it immediately
      if (method === 'get_public_key' && signerPubkey) {
        console.log('✅ NIP-46: Already have signer pubkey, returning immediately:', signerPubkey.slice(0, 16) + '...');
        clearTimeout(timeout);
        clearInterval(statusInterval);
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
        tagsDetail: requestEvent.tags.map(tag => ({
          type: tag[0],
          value: tag[1]?.slice(0, 16) + '...',
          fullTag: tag,
        })),
        contentPreview: requestEvent.content.substring(0, 100),
        fullContent: requestEvent.content,
        relayUrl: this.connection?.signerUrl,
        connectionToken: this.connection?.token?.slice(0, 20) + '...',
        hasSignerPubkey: !!signerPubkey,
        warning: !signerPubkey && method === 'get_public_key' 
          ? '⚠️ WARNING: Tagging with app pubkey - Amber might not see this if not subscribed to app pubkey events'
          : undefined,
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

      // Double-check relay connection before publishing
      // Note: We can't use await here since we're in a Promise constructor
      // The connection check was already done before creating this Promise
      // If connection fails during publish, the retry logic will handle it
      
      // Publish with retry logic
      const attemptPublish = async (attempt: number = 1): Promise<void> => {
        // Ensure connection still exists
        if (!this.connection) {
          clearTimeout(timeout);
          clearInterval(statusInterval);
          this.pendingRequests.delete(id);
          reject(new Error('Connection lost during publish attempt'));
          return;
        }
        
        try {
          const results = await this.relayClient!.publish(requestEvent, {
            relays: [this.connection.signerUrl],
            waitForRelay: true, // Wait for relay confirmation to ensure it's published
            timeout: 15000, // 15 second timeout for publish confirmation (increased from 10s)
          });
          
          console.log('✅ NIP-46: Request event published:', {
            requestId: id,
            method,
            attempt,
            publishResults: results.map(r => ({
              status: r.status,
              value: r.status === 'fulfilled' ? 'published' : (r.reason instanceof Error ? r.reason.message : String(r.reason)),
            })),
            eventId: requestEvent.id.slice(0, 16) + '...',
            eventTags: requestEvent.tags,
            eventTagsDetail: requestEvent.tags.map(tag => ({
              type: tag[0],
              value: tag[1]?.slice(0, 16) + '...',
              fullTag: tag,
            })),
            relayUrl: this.connection?.signerUrl,
            eventPubkey: requestEvent.pubkey.slice(0, 16) + '...',
            note: !signerPubkey && method === 'get_public_key'
              ? '⚠️ Request tagged with app pubkey - ensure Amber is subscribed to events from this app pubkey'
              : 'Request tagged with signer pubkey',
            subscriptionActive: !!this.relaySubscription,
            pendingRequestsCount: this.pendingRequests.size,
            waitingForResponse: true,
          });
          
          // Log a reminder about what we're waiting for
          console.log('⏳ NIP-46: Now waiting for response event with matching request ID:', {
            requestId: id,
            method,
            expectedResponseFormat: 'Event with kind 24133, content containing { id: "' + id + '", result: "..." }',
            subscriptionFilters: 'Listening for kind 24133 events',
            note: 'If no response is received, check: 1) Amber is connected to the same relay, 2) Amber has approved the connection, 3) Relay is working correctly',
          });
          
          // Check if at least one relay accepted the event
          const hasSuccess = results.some(r => r.status === 'fulfilled');
          if (!hasSuccess) {
            // Check if it's a connection issue
            const isConnectionError = results.some(r => 
              r.status === 'rejected' && 
              (r.reason instanceof Error && (
                r.reason.name === 'SendingOnClosedConnection' ||
                r.reason.message?.includes('closed') ||
                r.reason.message?.includes('timeout')
              ))
            );
            
            if (isConnectionError && attempt < 2 && this.connection) {
              // Retry once after reconnecting
              console.log(`🔄 NIP-46: Connection error detected, retrying (attempt ${attempt + 1}/2)...`);
              try {
                await this.startRelayConnection(this.connection.signerUrl);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for reconnection
                return attemptPublish(attempt + 1);
              } catch (reconnectErr) {
                console.error('❌ NIP-46: Failed to reconnect for retry:', reconnectErr);
              }
            }
            
            console.error('❌ NIP-46: Failed to publish to any relay:', results);
            console.error('❌ NIP-46: Relay connection may be closed. Error details:', {
              results: results.map(r => ({
                status: r.status,
                reason: r.status === 'rejected' ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : 'N/A',
              })),
            });
            clearTimeout(timeout);
            clearInterval(statusInterval);
            this.pendingRequests.delete(id);
            reject(new Error('Failed to publish request to relay. The relay connection may be closed. Please try connecting again.'));
            return;
          }
        } catch (err) {
          const isConnectionError = err instanceof Error && (
            err.name === 'SendingOnClosedConnection' ||
            err.message?.includes('closed') ||
            err.message?.includes('timeout')
          );
          
          if (isConnectionError && attempt < 2 && this.connection) {
            // Retry once after reconnecting
            console.log(`🔄 NIP-46: Connection error caught, retrying (attempt ${attempt + 1}/2)...`);
            try {
              await this.startRelayConnection(this.connection.signerUrl);
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for reconnection
              return attemptPublish(attempt + 1);
            } catch (reconnectErr) {
              console.error('❌ NIP-46: Failed to reconnect for retry:', reconnectErr);
            }
          }
          
          console.error('❌ NIP-46: Failed to publish request event:', err);
          console.error('❌ NIP-46: Publish error details:', {
            errorName: err instanceof Error ? err.name : 'Unknown',
            errorMessage: err instanceof Error ? err.message : String(err),
            errorStack: err instanceof Error ? err.stack : 'N/A',
            attempt,
          });
          clearTimeout(timeout);
          this.pendingRequests.delete(id);
          const errorMessage = err instanceof Error 
            ? (err.name === 'SendingOnClosedConnection' 
                ? 'Relay connection is closed. Please try connecting again.'
                : err.message)
            : 'Unknown error';
          reject(new Error(`Failed to publish request: ${errorMessage}`));
        }
      };
      
      // Start the publish attempt
      attemptPublish().catch(err => {
        // This should already be handled in attemptPublish, but just in case
        console.error('❌ NIP-46: Unexpected error in publish attempt:', err);
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
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
    Array.from(this.pendingRequests.entries()).forEach(([id, { reject }]) => {
      reject(new Error('Connection closed'));
    });
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

