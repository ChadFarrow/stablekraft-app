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
import { saveNIP46Connection, loadNIP46Connection, getOrCreateAppKeyPair, clearNIP46Connection, NIP46Connection, getAppKeyPairHistory, AppKeyPair } from './nip46-storage';
import { npubToPublicKey, publicKeyToNpub } from './keys';

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
 * Format: bunker://<pubkey>?relay=<relay_url>&relay=<relay_url2>&secret=<optional_secret>
 * @param uri - The bunker:// URI string
 * @returns Parsed connection info with pubkey, relay URLs, and optional secret
 */
export interface BunkerConnectionInfo {
  pubkey: string;
  relays: string[];
  secret?: string; // Optional per NIP-46 spec
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
  let secret: string | undefined = undefined;

  // Parse query parameters
  if (queryString) {
    const params = new URLSearchParams(queryString);

    // Get all relay parameters (can be multiple)
    params.getAll('relay').forEach(relay => {
      if (relay) {
        relays.push(decodeURIComponent(relay));
      }
    });

    // Get secret parameter (optional per NIP-46 spec)
    const secretParam = params.get('secret');
    if (secretParam) {
      secret = decodeURIComponent(secretParam);
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

// NIP46Connection is now exported from nip46-storage.ts to avoid circular dependency

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
  private pendingRequests: Map<string, { method: string; resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private relayClient: NostrClient | null = null;
  private relaySubscription: (() => void) | null = null;
  private onConnectionCallback: ((pubkey: string) => void) | null = null;
  private onPubkeyMismatchCallback: ((oldPubkey: string, currentPubkey: string) => void) | null = null;
  private eventCounter: number = 0; // Track total events received
  private lastEventTime: number = 0; // Track when last event was received
  private lastRequestTime: Map<string, number> = new Map(); // Track last request time per method for rate limiting
  private readonly RATE_LIMIT_MS = 5000; // 5 seconds between requests of the same method
  private rateLimitedRelays: Map<string, { until: number; backoffMs: number }> = new Map(); // Track rate-limited relays with backoff
  private readonly RATE_LIMIT_BACKOFF_BASE_MS = 60000; // Start with 1 minute backoff
  private readonly RATE_LIMIT_BACKOFF_MAX_MS = 600000; // Max 10 minutes backoff
  private pubkeyMismatchCount: number = 0; // Track pubkey mismatch occurrences
  private mismatchDetected: boolean = false; // Flag to stop processing after mismatch
  private detectedOldPubkey: string | null = null; // Store the old pubkey we detected
  private connectionStartTime: number = 0; // Track when connection attempt started to filter old events
  private aggressiveModeLogged: boolean = false; // Track if we've already logged aggressive mode message
  // Known Amber pubkey from user's npub: npub12xwrqqxuee2k3452uuae7kp0g5yxgpapjrrrz2r0wx7v8pdqynqqc0ez5k
  private readonly knownAmberPubkey: string | null = (() => {
    try {
      const pubkey = npubToPublicKey('npub12xwrqqxuee2k3452uuae7kp0g5yxgpapjrrrz2r0wx7v8pdqynqqc0ez5k');
      console.log(`[NIP46] Loaded known Amber pubkey: ${pubkey.slice(0, 16)}...`);
      return pubkey;
    } catch (err) {
      console.warn(`[NIP46] Failed to load known Amber pubkey:`, err);
      return null;
    }
  })();

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

    // Reset mismatch detection state for new connection attempt
    this.mismatchDetected = false;
    this.pubkeyMismatchCount = 0;
    this.eventCounter = 0;
    this.connectionStartTime = Date.now();
    console.log('🔄 NIP-46: Reset mismatch detection state for new connection attempt');

    // Detect URI scheme: bunker:// vs nostrconnect:// vs direct URL
    if (signerUrl.startsWith('bunker://')) {
      console.log('🔌 NIP-46: Detected bunker:// URI, parsing for nsecbunker connection');
      return this.connectBunker(signerUrl);
    } else if (signerUrl.startsWith('nostrconnect://')) {
      console.log('🔌 NIP-46: Detected nostrconnect:// URI, using relay-based connection');
      // Extract relay URL from nostrconnect:// URI if needed
      // For now, assume signerUrl is already the relay URL
      // Pass signerPubkey if provided (for restoring saved connections)
      return this.connectNostrConnect(signerUrl, token, signerPubkey);
    } else {
      // Direct URL connection (existing logic)
      return this.connectDirect(signerUrl, token, connectImmediately, signerPubkey);
    }
  }

  /**
   * Connect using bunker:// URI (relay-based for mobile signers like Aegis)
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

      // Use the first relay URL for relay-based communication
      const relayUrl = bunkerInfo.relays[0];

      // Store connection info
      // Note: bunkerInfo.pubkey is the signer app's pubkey, not the user's Nostr account pubkey
      // We'll get the user's pubkey later via get_public_key request
      this.connection = {
        signerUrl: bunkerUri, // Store original bunker:// URI for restoration
        token: bunkerInfo.secret || '', // Use empty string if no secret provided
        pubkey: '', // Will be fetched via get_public_key
        connected: false,
        signerPubkey: bunkerInfo.pubkey, // Store signer app pubkey separately for targeting messages
        relayUrl: relayUrl, // Store relay URL separately for actual connection
      } as any;

      // Use relay-based connection (not direct WebSocket) for mobile signers like Aegis
      console.log('🔌 NIP-46: Connecting via relay for mobile signer:', relayUrl);
      console.log('🔌 NIP-46: Signer app pubkey:', bunkerInfo.pubkey.slice(0, 16) + '...');
      return this.startRelayConnection(relayUrl);
    } catch (error) {
      console.error('❌ NIP-46: Failed to parse bunker:// URI:', error);
      throw new Error(`Failed to parse bunker:// URI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Connect using nostrconnect:// URI (relay-based)
   */
  private async connectNostrConnect(nostrConnectUri: string, token: string, savedPubkey?: string): Promise<void> {
    // For nostrconnect://, we need to extract the relay URL
    // The URI format is: nostrconnect://<pubkey>?relay=<relay_url>&secret=<secret>
    // For now, we'll use the existing relay-based connection logic
    // The signerUrl parameter should already be the relay URL
    this.connection = {
      signerUrl: nostrConnectUri, // Will be parsed in startRelayConnection if needed
      token,
      pubkey: savedPubkey, // Include saved pubkey if provided (for restoring connections)
      // CRITICAL: Don't set connected=true immediately - wait for relay to actually connect
      // The authenticate() method will verify the connection is still active
      connected: false, // Will be set to true after relay connects and we verify it's active
      connectedAt: undefined, // Will be set after successful authentication
    };
    
    if (savedPubkey) {
      console.log('✅ NIP-46: Restoring connection with saved user pubkey:', savedPubkey.slice(0, 16) + '...');
      console.log('ℹ️ NIP-46: Connection will be verified after relay connects');
    }

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

    // If connectImmediately is true, treat this as a relay-based connection
    // (client-initiated nostrconnect:// flow)
    if (connectImmediately && signerUrl.startsWith('wss://')) {
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
      
      // Verify connection by checking if relay is actually connected
      const connectedRelays = this.relayClient.getConnectedRelays?.() || [];
      console.log('🔍 NIP-46: Connected relays:', connectedRelays);
      if (connectedRelays.length === 0) {
        console.warn('⚠️ NIP-46: No relays connected after connectToRelays call');
      }
    } catch (err) {
      console.error('❌ NIP-46: Failed to connect to relay:', err);
      throw err;
    }

    // Get the app's key pair - prefer persistent key pair, fall back to sessionStorage
    let connectionInfo: any = null;
    let appPubkey: string;
    let appPrivateKey: string;
    
    // First, try to get persistent app key pair from localStorage
    if (typeof window !== 'undefined') {
      try {
        const keyPair = getOrCreateAppKeyPair();
        appPubkey = keyPair.publicKey;
        appPrivateKey = keyPair.privateKey;
        connectionInfo = {
          publicKey: appPubkey,
          privateKey: appPrivateKey,
        };
        console.log('✅ NIP-46: Using persistent app key pair for connection');
      } catch (keyPairError) {
        console.warn('⚠️ NIP-46: Failed to get persistent key pair, trying sessionStorage:', keyPairError);
        // Fall back to sessionStorage for backward compatibility
        const pendingConnection = sessionStorage.getItem('nip46_pending_connection');
        if (pendingConnection) {
          connectionInfo = JSON.parse(pendingConnection);
          appPubkey = connectionInfo.publicKey;
          appPrivateKey = connectionInfo.privateKey;
        } else {
          throw new Error('No app key pair found (neither persistent nor session)');
        }
      }
    } else {
      throw new Error('Cannot access localStorage on server');
    }
    
    if (!connectionInfo || !appPubkey || !appPrivateKey) {
      throw new Error('No valid app key pair found');
    }

    // Subscribe to NIP-46 events (kind 24133) directed to our app
    // NIP-46 uses kind 24133 for request/response events
    // We need to listen for events where we are the recipient (tagged with our app pubkey)
    // Also listen for all kind 24133 events to catch connection events that might not be tagged
    // 
    // IMPORTANT: appPubkey is the app's pubkey (for NIP-46 communication)
    // User's pubkey (from Amber) will be received later in the connection event
    console.log('📡 NIP-46: Setting up subscription filters:', {
      appPubkey: appPubkey.slice(0, 16) + '...',
      relayUrl: relayUrl,
      note: 'App pubkey is for NIP-46 communication. User\'s Nostr account pubkey will be received from Amber later.',
    });
    
    const filters: Filter[] = [
      {
        kinds: [24133], // NIP-46 request/response events
        '#p': [appPubkey], // Events tagged with our app public key (recipient)
      },
      // Also subscribe to all kind 24133 events to catch any connection attempts
      // We'll filter them in handleRelayEvent - this is important for detecting Amber's connection
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

    // Check if this is a bunker:// connection (has signerPubkey)
    // Bunker connections (like Aegis) use a local relay bridge that ONLY works with the specified relay
    const isBunkerConnection = !!(this.connection as any).signerPubkey;

    // Get backup relays (will be empty array for bunker connections)
    const { getDefaultRelays } = await import('./relay');
    const defaultRelays = getDefaultRelays();
    const backupRelays = isBunkerConnection ? [] : defaultRelays.filter(url => url !== relayUrl).slice(0, 2);

    let subscribeRelays: string[];
    if (isBunkerConnection) {
      // For bunker connections, ONLY subscribe to the primary relay
      // Local relay bridges (Aegis, etc) only work with their specific relay
      subscribeRelays = [relayUrl];
      console.log(`✅ NIP-46: Bunker connection - subscribing ONLY to primary relay:`, {
        primary: relayUrl,
        note: 'Bunker signers (Aegis) use local relay bridges. Backup relays would not work.',
      });
    } else {
      // For other connections (nostrconnect://), subscribe to primary relay AND backup relays
      // This increases the chance of receiving events if relay connectivity is inconsistent
      subscribeRelays = [relayUrl, ...backupRelays]; // Primary first, then backups

      console.log(`✅ NIP-46: Subscribing to MULTIPLE RELAYS for better connectivity:`, {
        primary: relayUrl,
        backups: backupRelays,
        total: subscribeRelays.length,
        note: 'Primary relay is from QR code. Backup relays help if primary fails or signer uses a different relay.',
      });
    }
    
    // CRITICAL: Verify primary relay is connected before subscribing
    // If this relay fails, connection will not work because Amber publishes to this relay
    console.log(`🔌 NIP-46: Connecting to relays:`, subscribeRelays);
    try {
      await this.relayClient.connectToRelays(subscribeRelays);
      const connectedRelays = this.relayClient.getConnectedRelays();
      console.log('✅ NIP-46: Connected to relay(s):', connectedRelays);
      
      // Verify the primary relay is actually connected
      if (!connectedRelays.includes(relayUrl)) {
        const errorMsg = `CRITICAL: Primary relay ${relayUrl} failed to connect. Amber will publish to this relay, so connection will fail.`;
        console.error(`❌ NIP-46: ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      console.log(`✅ NIP-46: Primary relay ${relayUrl} is connected and ready`);
      if (backupRelays.length > 0) {
        const connectedBackups = backupRelays.filter(url => connectedRelays.includes(url));
        if (connectedBackups.length > 0) {
          console.log(`✅ NIP-46: Also connected to ${connectedBackups.length} backup relay(s):`, connectedBackups);
        } else {
          console.warn(`⚠️ NIP-46: No backup relays connected, but primary relay is ready`);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ NIP-46: Failed to connect to primary relay ${relayUrl}:`, errorMsg);
      throw new Error(`Failed to connect to relay ${relayUrl}: ${errorMsg}. Amber will publish to this relay, so connection cannot proceed.`);
    }
    
    // Track subscription start time for debugging
    const subscriptionStartTime = Date.now();
    console.log('📡 NIP-46: Creating subscription at', new Date(subscriptionStartTime).toISOString());
    
    // CRITICAL: Ensure relay is configured for reading before subscribing
    // The relay must be connected with read: true for subscriptions to work
    // RelayManager.subscribe() filters by read relays, so we need to verify the relay is configured correctly
    console.log('🔍 NIP-46: Verifying relay configuration for subscription...', {
      relayUrl,
      subscribeRelays,
      hasRelayClient: !!this.relayClient,
      connectedRelays: this.relayClient?.getConnectedRelays?.() || [],
      note: 'Relay must be configured with read: true for subscriptions to work',
    });
    
    // IMPORTANT: Wait longer for relay to fully establish connection
    // WebSocket connections need time to fully open and be ready for subscriptions
    // Increased from 500ms to 2 seconds to ensure relay is fully ready
    console.log('⏳ NIP-46: Waiting for relay(s) to be fully ready before subscribing...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('✅ NIP-46: Relay(s) should be ready now, creating subscription...');
    
    
    this.relaySubscription = this.relayClient.subscribe({
      relays: subscribeRelays,
      filters,
      onEvent: (event: Event) => {
        try {
          // Track event reception
          const timeSinceSubscription = Date.now() - subscriptionStartTime;
          
          // Filter out events that are from before connection attempt started
          // Only filter if connectionStartTime is set (new connection attempt)
          // This is critical when switching relays - old events from the previous relay should be ignored
          if (this.connectionStartTime > 0) {
            const eventCreatedTime = event.created_at * 1000;
            const timeSinceConnectionStart = Date.now() - this.connectionStartTime;
            const eventAge = Date.now() - eventCreatedTime;
            
            // Only accept events created AFTER the connection start (with small buffer for clock skew)
            // Also reject events that are clearly old (more than 5 minutes old) regardless of when connection started
            // This prevents processing stale cached events from previous sessions
            const maxEventAgeMs = 300000; // 5 minutes - reject events older than this
            const bufferMs = 10000; // 10 seconds buffer for clock skew
            
            if (eventAge > maxEventAgeMs || eventCreatedTime < (this.connectionStartTime - bufferMs)) {
              return; // Skip old cached events
            }
          }

          // Increment event counter
          this.eventCounter++;
          this.lastEventTime = Date.now();
          
          // Check if this event is for us (tagged with our pubkey) BEFORE doing expensive logging
          const isForUs = event.tags.some(tag => tag[0] === 'p' && tag[1] === appPubkey);
          const isFromUs = event.pubkey === appPubkey;
          
          // Check connection state
          const hasPendingRequests = this.pendingRequests.size > 0;
          const hasActiveConnection = this.connection?.connected && this.connection?.pubkey;
          const isWaitingForConnection = !hasActiveConnection && !hasPendingRequests;
          
          // Also check all 'p' tags to see what pubkeys are tagged
          const allPTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
          
          // When waiting for connection, process all kind 24133 events (Amber's connect response might not be tagged correctly)
          if (isWaitingForConnection && event.kind === 24133 && !isFromUs) {
            this.handleRelayEvent(event, connectionInfo);
            return;
          }
          
          // CRITICAL: Try to decrypt and parse content to see if this is a connection event
          // We need to do this even for untagged events to detect connection events from Amber
          // Connection events might not be tagged for us initially
          let eventContentPreview = 'N/A';
          let eventContentType = 'unknown';
          let decryptedContent: any = null;
          let decryptionSucceeded = false;
          
          try {
            // Try NIP-44 decryption with event's pubkey
            try {
              const appPrivateKeyBytes = hexToBytes(connectionInfo.privateKey);
              const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, event.pubkey);
              const decrypted = nip44.decrypt(event.content, conversationKey);
              decryptedContent = JSON.parse(decrypted);
              decryptionSucceeded = true;
              eventContentPreview = JSON.stringify(decryptedContent).substring(0, 200);
              eventContentType = decryptedContent.method ? 'request' : (decryptedContent.result || decryptedContent.error ? 'response' : 'unknown');
            } catch (decryptErr) {
              // NIP-44 decryption failed - try plain JSON
              try {
                decryptedContent = JSON.parse(event.content);
                decryptionSucceeded = true;
                eventContentPreview = JSON.stringify(decryptedContent).substring(0, 200);
                eventContentType = decryptedContent.method ? 'request' : (decryptedContent.result || decryptedContent.error ? 'response' : 'unknown');
              } catch (jsonErr) {
                eventContentPreview = event.content.substring(0, 200);
                eventContentType = event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content) ? 'signature' : 'plain text';
              }
            }
          } catch (err) {
            eventContentPreview = event.content.substring(0, 200);
            eventContentType = 'unknown';
          }
          
          // Check if this event is from the known Amber pubkey
          const isFromKnownAmber = this.knownAmberPubkey && event.pubkey === this.knownAmberPubkey;
          
          // Check if content looks encrypted (usually longer than 100 chars)
          const hasEncryptedContent = event.content.length > 100;
          
          // Check if this looks like a connection event (even if not tagged for us)
          // Handle multiple formats: connect method, get_public_key response, or pubkey result
          const looksLikeConnectionEvent = decryptedContent && (
            decryptedContent.method === 'connect' ||
            decryptedContent.method === 'get_public_key' ||
            (decryptedContent.result && this.connection?.token && decryptedContent.result === this.connection.token) ||
            decryptedContent.result === 'ack' ||
            // Check if result is a 64-char hex pubkey (connection response)
            (decryptedContent.result && typeof decryptedContent.result === 'string' && decryptedContent.result.length === 64 && /^[a-f0-9]{64}$/i.test(decryptedContent.result)) ||
            // Check if result looks like a get_public_key response (pubkey)
            (decryptedContent.id && decryptedContent.result && typeof decryptedContent.result === 'string' && decryptedContent.result.length === 64)
          );
          
          // Process events from known Amber pubkey
          if (isFromKnownAmber) {
            this.handleRelayEvent(event, connectionInfo);
            return;
          }

          // Process connection events
          if (decryptionSucceeded && looksLikeConnectionEvent) {
            this.handleRelayEvent(event, connectionInfo);
            return;
          }
          
          // If event is not for us and we don't have pending requests or active connection,
          // and it's not a connection event, silently ignore it
          if (!isForUs && !isFromUs && !hasPendingRequests && !hasActiveConnection && !looksLikeConnectionEvent) {
            // Silently ignore untagged events that aren't connection events
            return;
          }
          
          // Expose event count to window for UI debugging
          if (typeof window !== 'undefined') {
            (window as any).__NIP46_EVENT_COUNT__ = this.eventCounter;
          }
        
        // Only process events if:
        // 1. Event is tagged for us (p tag matches) - this means it's for us
        // 2. We have pending requests - we're waiting for a response
        // 3. We have an active connection - Amber has connected
        // Otherwise, ignore events until Amber connects
        // (hasPendingRequests and hasActiveConnection already declared above)
        const hasPendingGetPublicKey = Array.from(this.pendingRequests.values()).some(p => p.method === 'get_public_key');
        
        if (isForUs && !isFromUs) {
          // Event is tagged for us - definitely process it
          console.log('✅ NIP-46: Event passed filter, processing...');
          this.handleRelayEvent(event, connectionInfo);
        } else if (isFromUs) {
          console.log('ℹ️ NIP-46: Ignoring event from us (our own request)');
        } else if (!isForUs && !isFromUs) {
          // Event not tagged for us - when waiting for connection, be more permissive
          // Process events with encrypted content that might be connection events
          // This is critical for detecting Amber's connection when events aren't properly tagged
          const isWaitingForConnection = !hasActiveConnection && !hasPendingRequests;
          
          if (isWaitingForConnection) {
            // When waiting for connection, process events with encrypted content
            // They might be connection events from Amber that aren't tagged properly
            if (decryptionSucceeded && looksLikeConnectionEvent) {
              console.log('🔍 NIP-46: Processing untagged event while waiting for connection (looks like connection event)');
              this.handleRelayEvent(event, connectionInfo);
              return;
            } else if (hasEncryptedContent && !decryptionSucceeded) {
              // Try to decrypt - might be a connection event
              console.log('🔍 NIP-46: Attempting to process untagged encrypted event while waiting for connection');
              this.handleRelayEvent(event, connectionInfo);
              return;
            }
            // Otherwise, ignore untagged events when waiting for connection
            return;
          }
          
          // If we have pending requests or active connection, process the event
          if (!hasPendingRequests && !hasActiveConnection) {
            // No pending requests and no active connection - silently ignore untagged events
            // This prevents processing old cached events before Amber scans the QR code
            return;
          }
          
          // We have pending requests or active connection - try to process
          const knownAmberPubkeys = [
            'f7922a0adb3fa4dd', // Known Amber pubkey from earlier logs
            '548e4e36b1ce9e8e', // Another known Amber pubkey from earlier logs
          ];
          const mightBeFromAmber = knownAmberPubkeys.some(known => event.pubkey.startsWith(known));
          // hasEncryptedContent is already declared above (line 599)
          
          // Only try aggressive processing if we have pending requests or active connection
          if (hasPendingRequests || hasActiveConnection || mightBeFromAmber || hasEncryptedContent) {
            // Check if we've already detected a mismatch - if so, stop aggressive processing to prevent log spam
            if (this.mismatchDetected) {
              // Only log once every 100 events after detection to prevent spam
              if (this.eventCounter % 100 === 0) {
                console.warn(`[NIP46] Skipping event #${this.eventCounter} - pubkey mismatch detected. Reconnection needed.`);
              }
              return; // Stop processing to prevent thousands of log entries
            }

            // Only log once for aggressive mode to reduce spam
            if (!this.aggressiveModeLogged) {
              this.aggressiveModeLogged = true;
            }

            // CRITICAL: Check the p tag value to detect pubkey mismatch
            // But DON'T skip - try to decrypt anyway in case Amber cached the old pubkey but encryption still works
            let pTagMismatch = false;
            if (allPTags.length > 0) {
              const pTagPubkey = allPTags[0];
              const pTagMatches = pTagPubkey === appPubkey;

              if (!pTagMatches) {
                pTagMismatch = true;
                // Increment mismatch counter
                this.pubkeyMismatchCount++;

                // Log first mismatch only
                if (this.pubkeyMismatchCount === 1) {
                  console.warn('NIP-46: Pubkey mismatch detected. Signer may be using a cached connection.');
                }

                // On first detection, store the old pubkey
                if (this.pubkeyMismatchCount === 1) {
                  this.detectedOldPubkey = pTagPubkey;

                  // Call the callback to notify the UI
                  if (this.onPubkeyMismatchCallback) {
                    this.onPubkeyMismatchCallback(pTagPubkey, appPubkey);
                  }

                  // Only clear the connection if we don't have an active connection
                  const hasActiveConnection = this.connection?.connected && this.connection?.pubkey;
                  if (!hasActiveConnection && typeof window !== 'undefined') {
                    try {
                      clearNIP46Connection();
                      console.warn('NIP-46: Cleared stale connection from localStorage.');
                    } catch (clearError) {
                      console.error('NIP-46: Failed to clear stale connection:', clearError);
                    }
                  }
                }

                // Only set mismatchDetected after many mismatches AND failed decryptions
                // Don't set it here - let decryption attempt happen first
              }
            }
            
            // Continue to try processing even with p tag mismatch - attempt decryption

            // Only attempt to process if mismatch not detected
            if (!this.mismatchDetected && (mightBeFromAmber || hasEncryptedContent || hasPendingRequests)) {
              // Process untagged event
              // Double-check mismatch before calling handleRelayEvent
              if (!this.mismatchDetected) {
                this.handleRelayEvent(event, connectionInfo);
              }
            }
          }
        } else if (!isForUs) {
          // Event not tagged for us - only process if we have pending requests or active connection
          if (!hasPendingRequests && !hasActiveConnection) {
            // No pending requests and no active connection - silently ignore untagged events
            return;
          }
          
          // Check if mismatch already detected - stop processing to prevent spam
          if (this.mismatchDetected) {
            if (this.eventCounter % 100 === 0) {
              console.warn(`[NIP46] Skipping untagged event #${this.eventCounter} - pubkey mismatch detected.`);
            }
            return;
          }

          // EARLY EXIT: Check p tags before attempting decryption - if they don't match, skip
          if (allPTags.length > 0) {
            const pTagPubkey = allPTags[0];
            if (pTagPubkey !== appPubkey) {
              // Event is for a different app instance
              return;
            }
          }

          // Event not tagged for us - but if we have pending requests, try to process it anyway
          if (hasPendingRequests && !this.aggressiveModeLogged) {
            this.aggressiveModeLogged = true;
          }

          if (this.pubkeyMismatchCount < 3) {
            console.log('ℹ️ NIP-46: Event received but not tagged for us. Event details:', {
              eventId: event.id.slice(0, 16) + '...',
              eventPubkey: event.pubkey.slice(0, 16) + '...',
              allPTags: allPTags.map(p => p.slice(0, 16) + '...'),
              appPubkey: appPubkey.slice(0, 16) + '...',
              tags: event.tags,
            });
          }

            // For connection events, Amber might not tag us - let's check if it's a connection event anyway
            // Try to decrypt and parse the content
            try {
              // First try NIP-44 decryption with event's pubkey
              let content: any;
              let decrypted = false;
              try {
                // Use NIP-44 v2 API: get conversation key first, then decrypt
                const appPrivateKeyBytes = hexToBytes(connectionInfo.privateKey);
                const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, event.pubkey);
                const decryptedContent = nip44.decrypt(event.content, conversationKey);
                content = JSON.parse(decryptedContent);
                decrypted = true;
              } catch (decryptErr) {
                // If decryption failed and we have Amber's pubkey from connection, try with that
                if (this.connection?.pubkey && this.connection.pubkey !== event.pubkey) {
                  try {
                    const appPrivateKeyBytes = hexToBytes(connectionInfo.privateKey);
                    const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, this.connection.pubkey);
                    const decryptedContent = nip44.decrypt(event.content, conversationKey);
                    content = JSON.parse(decryptedContent);
                    decrypted = true;
                  } catch (amberDecryptErr) {
                    // Still failed, try plain JSON
                    try {
                      content = JSON.parse(event.content);
                      console.log('📋 NIP-46: Parsed untagged event as plain JSON');
                    } catch (jsonErr) {
                      throw decryptErr; // Re-throw original error
                    }
                  }
                } else {
                  // Try plain JSON
                  try {
                    content = JSON.parse(event.content);
                    console.log('📋 NIP-46: Parsed untagged event as plain JSON');
                  } catch (jsonErr) {
                    throw decryptErr; // Re-throw original error
                  }
                }
              }
              
              const mightBeConnection = content.method === 'connect' || 
                                       content.method === 'get_public_key' ||
                                       (content.result && typeof content.result === 'string' && content.result.length === 64);
              
              // Also check if it's a response to one of our pending requests
              const isResponseToPending = content.id && this.pendingRequests.has(content.id);
              
              // Check if it looks like a get_public_key response (pubkey) and we have pending get_public_key requests
              const looksLikeGetPublicKeyResponse = content.result && 
                typeof content.result === 'string' && 
                content.result.length === 64 && 
                /^[a-f0-9]{64}$/i.test(content.result) &&
                content.result !== this.connection?.token; // Not the secret
              
              const hasPendingGetPublicKey = Array.from(this.pendingRequests.values()).some(p => p.method === 'get_public_key');
              const hasPendingSignEvent = Array.from(this.pendingRequests.values()).some(p => p.method === 'sign_event');
              const mightBeGetPublicKeyResponse = looksLikeGetPublicKeyResponse && hasPendingGetPublicKey;
              
              // Check if result looks like a signature (128 hex chars)
              const looksLikeSignature = content.result && 
                typeof content.result === 'string' && 
                (content.result.length === 128 || content.result.length === 64) &&
                /^[a-f0-9]+$/i.test(content.result);
              const mightBeSignEventResponse = looksLikeSignature && hasPendingSignEvent;
              
              if (mightBeConnection || isResponseToPending || mightBeGetPublicKeyResponse || mightBeSignEventResponse) {
                console.log('⚠️ NIP-46: Event looks like a connection/response event but not tagged for us. Processing anyway...', {
                  mightBeConnection,
                  isResponseToPending,
                  mightBeGetPublicKeyResponse,
                  mightBeSignEventResponse,
                  requestId: content.id,
                  hasPendingRequest: isResponseToPending,
                  hasPendingGetPublicKey,
                  hasPendingSignEvent,
                  looksLikeGetPublicKeyResponse,
                  looksLikeSignature,
                });
                this.handleRelayEvent(event, connectionInfo);
              } else if (hasPendingGetPublicKey && content.result) {
                // AGGRESSIVE: If we have pending get_public_key and this has ANY result, try processing it
                this.handleRelayEvent(event, connectionInfo);
              } else if (hasPendingSignEvent && content.result && looksLikeSignature) {
                // AGGRESSIVE: If we have pending sign_event and this looks like a signature, try processing it
                this.handleRelayEvent(event, connectionInfo);
              } else {
                const hasPendingSignEvent = Array.from(this.pendingRequests.values()).some(p => p.method === 'sign_event');
                if (hasPendingSignEvent) {
                  console.log('⚠️ NIP-46: Event is not for us and not a connection/response event, but we have pending sign_event. Event details:', {
                    eventId: event.id.slice(0, 16) + '...',
                    eventPubkey: event.pubkey.slice(0, 16) + '...',
                    kind: event.kind,
                    contentLength: event.content.length,
                    tags: event.tags.map(t => [t[0], t[1]?.slice(0, 16) + '...']),
                    note: 'This event was ignored, but we are waiting for a sign_event response. If Amber sent a response, it might be in a different format.',
                  });
                } else {
                  console.log('ℹ️ NIP-46: Event is not for us and not a connection/response event, ignoring');
                }
              }
            } catch (e) {
              // Not JSON or can't decrypt, but might still be a response we need
              const hasPendingSignEvent = Array.from(this.pendingRequests.values()).some(p => p.method === 'sign_event');
              
              // If we have a pending sign_event and this is a large encrypted event, it might be from an old connection
              if (hasPendingSignEvent && event.content.length > 500 && e instanceof Error && e.message.includes('invalid MAC')) {
                const pTags = event.tags.filter(t => t[0] === 'p');
                if (pTags.length > 0) {
                  const pTagPubkey = pTags[0][1];
                  // Get current app pubkey from storage
                  // Amber is responding to an old connection - skip this event
                }
              }
              
              console.log('ℹ️ NIP-46: Event content is not parseable, ignoring:', e instanceof Error ? e.message : String(e));
            }
          }
        } catch (eventError) {
          // Log error but don't spam console with verbose details
          if (this.connection?.connected && this.connection?.pubkey) {
            console.warn('⚠️ NIP-46: Error processing relay event:', eventError instanceof Error ? eventError.message : String(eventError));
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

    // For bunker:// URIs (Aegis, nsecbunker), immediately request the user's pubkey
    // This completes the connection and sets connected=true
    if ((this.connection as any).signerPubkey && !this.connection.pubkey) {
      console.log('🔑 NIP-46: Bunker connection detected, requesting user pubkey to complete connection...');
      try {
        const pubkey = await this.getPublicKey();
        console.log('✅ NIP-46: Bunker connection established with user pubkey:', pubkey.slice(0, 16) + '...');
      } catch (err) {
        console.warn('⚠️ NIP-46: Failed to get user pubkey during bunker connection setup:', err);
        console.warn('⚠️ NIP-46: Connection will continue, but pubkey will be requested later');
      }
    }
  }

  /**
   * Create a NIP-46 request event (kind 24133)
   * According to NIP-46 spec, content must be NIP-44 encrypted
   * @param signerPubkey - The signer's pubkey to tag. If undefined, no p tag will be added (for get_public_key)
   * @param pubkeyForEncryption - The pubkey to use for encryption. For get_public_key without signer pubkey, use appPubkey
   */
  private createNIP46RequestEvent(
    method: string,
    params: any[],
    requestId: string,
    appPubkey: string,
    signerPubkey: string | undefined,
    appPrivateKey: string,
    pubkeyForEncryption?: string
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
    
    // CRITICAL: For 'connect' requests, we don't have the signer's pubkey yet
    // Encrypting with the app pubkey means Amber can't decrypt (Amber doesn't have app's private key)
    // According to NIP-46, for relay-based connections, we should encrypt with the signer's pubkey
    // But for 'connect', we don't have it. Some implementations use plain text for connect requests.
    // For now, we'll try NOT encrypting connect requests to see if Amber can handle it.
    const shouldEncrypt = method !== 'connect' || !!signerPubkey;
    
    if (!shouldEncrypt && method === 'connect') {
      // For connect requests without signer pubkey, use plain JSON (not encrypted)
      // This allows Amber to read the connection token/secret and respond
      encryptedContent = requestJson;
      console.log('🔓 NIP-46: Using PLAIN TEXT for connect request (no signer pubkey available):', {
        method,
        requestId,
        contentLength: encryptedContent.length,
        note: 'Amber should be able to read the connection token/secret from plain text and respond',
      });
    } else {
      try {
        // Convert private key from hex string to Uint8Array
        const appPrivateKeyBytes = hexToBytes(appPrivateKey);
        
        // For get_public_key when we don't have the signer pubkey, we need to use a different approach
        // Since we can't encrypt with the signer's pubkey (we don't have it), we'll use the app pubkey
        // This is a workaround - ideally Amber should handle this case
        // Use the provided pubkeyForEncryption parameter, or fall back to signerPubkey or appPubkey
        const encryptionPubkey = pubkeyForEncryption || signerPubkey || appPubkey;
        
        if (!encryptionPubkey) {
          throw new Error('Cannot encrypt request: no pubkey available for encryption');
        }
        
        // Get conversation key using NIP-44 v2 API
        const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, encryptionPubkey);
        
        // Encrypt using the conversation key
        encryptedContent = nip44.encrypt(requestJson, conversationKey);
        
        console.log('🔐 NIP-46: Encrypted request content with NIP-44:', {
          method,
          requestId,
          originalLength: requestJson.length,
          encryptedLength: encryptedContent.length,
          signerPubkey: signerPubkey ? signerPubkey.slice(0, 16) + '...' : 'N/A',
          encryptionPubkey: encryptionPubkey.slice(0, 16) + '...',
          appPubkey: appPubkey.slice(0, 16) + '...',
          note: !signerPubkey ? 'Using app pubkey for encryption (get_public_key without signer pubkey)' : undefined,
        });
      } catch (encryptError) {
        console.error('❌ NIP-46: Failed to encrypt request with NIP-44:', {
          error: encryptError instanceof Error ? encryptError.message : String(encryptError),
          method,
          requestId,
        });
        throw new Error(`Failed to encrypt NIP-46 request: ${encryptError instanceof Error ? encryptError.message : String(encryptError)}`);
      }
    }

    // For get_public_key when we don't have the signer pubkey yet, don't tag with p tag
    // This allows Amber to find the request by listening to all kind 24133 events
    // and filtering by the connection token/secret in the encrypted content
    const tags: string[][] = [];
    if (signerPubkey) {
      tags.push(['p', signerPubkey]); // Tag the signer if we know their pubkey
    }
    // Note: For get_public_key without signer pubkey, we intentionally don't add a p tag
    // so that Amber can find it by listening to all kind 24133 events
    
    const template: EventTemplate = {
      kind: 24133, // NIP-46 request/response event kind
      tags,
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
      // EARLY EXIT: If we've already detected a pubkey mismatch, stop processing to prevent error loops
      if (this.mismatchDetected) {
        // Only log every 100 events to prevent spam
        if (this.eventCounter % 100 === 0) {
          console.warn(`[NIP46-SKIP] Skipping event ${event.id.slice(0, 16)}... - pubkey mismatch detected. Reconnection needed.`);
        }
        return;
      }

      // Check p tags but DON'T skip events with mismatched p tags
      // Amber might have cached an old app pubkey, but the event might still decrypt correctly
      // We'll try to decrypt first, and only skip if decryption fails
      const pTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
      let pTagMismatch = false;
      if (pTags.length > 0) {
        const pTagPubkey = pTags[0];
        const currentAppPubkey = connectionInfo.publicKey;
        
        if (pTagPubkey !== currentAppPubkey) {
          pTagMismatch = true;
          // Log the mismatch but continue to try decryption
          // Only log if we have an established connection (not during initial QR code phase)
          if (this.connection?.connected && this.connection?.pubkey) {
            if (this.pubkeyMismatchCount < 3) {
              console.warn(`[NIP46-PTAG-WARNING] Event ${event.id.slice(0, 16)}... has p tag for different app pubkey (${pTagPubkey.slice(0, 16)}... vs ${currentAppPubkey.slice(0, 16)}...). Will attempt decryption anyway - signer may have cached old pubkey.`);
            }
            this.pubkeyMismatchCount++;
          } else {
            // During initial connection, these are expected - don't spam logs
            // Just increment counter silently
            this.pubkeyMismatchCount++;
          }
        }
      }

      // Process relay event

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
          
          // Now parse the decrypted JSON
          content = JSON.parse(decryptedContent);
        } catch (decryptError) {
          // Only log decryption failures if we have an established connection
          // During initial connection (QR code shown), old cached events are expected
          if (this.connection?.connected && this.connection?.pubkey) {
            console.warn('⚠️ NIP-46: Failed to decrypt as NIP-44, trying alternatives:', {
              decryptError: decryptError instanceof Error ? decryptError.message : String(decryptError),
              contentPreview: event.content.substring(0, 100),
              signerPubkey: signerPubkey.slice(0, 16) + '...',
              appPubkey: connectionInfo.publicKey ? connectionInfo.publicKey.slice(0, 16) + '...' : 'N/A',
            });
          }

          // CRITICAL: If decryption failed, try with the pubkey from the p tag if it exists
          // BUT: Only if the p tag matches our current app pubkey (otherwise we can't decrypt)
          const pTags = event.tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
          if (pTags.length > 0 && pTags[0] !== signerPubkey) {
            const pTagPubkey = pTags[0];
            const currentAppPubkey = connectionInfo.publicKey;

            // Check if p tag matches our current app pubkey
            if (pTagPubkey === currentAppPubkey) {
              try {
                const appPrivateKeyBytes = hexToBytes(appPrivateKey);
                const conversationKey = nip44.getConversationKey(appPrivateKeyBytes, pTagPubkey);
                decryptedContent = nip44.decrypt(event.content, conversationKey);
                content = JSON.parse(decryptedContent);
              } catch (pTagDecryptErr) {
                // Failed to decrypt with p tag pubkey, continue to try historical keypairs
              }
            } else {
              // P tag doesn't match - signer is using a cached old app pubkey!
              // Try to decrypt with historical keypairs
              const keyPairHistory = getAppKeyPairHistory();

              // Try each historical keypair
              for (const oldKeyPair of keyPairHistory) {
                if (pTagPubkey === oldKeyPair.publicKey) {
                  try {
                    const oldAppPrivateKeyBytes = hexToBytes(oldKeyPair.privateKey);
                    const conversationKey = nip44.getConversationKey(oldAppPrivateKeyBytes, signerPubkey);
                    decryptedContent = nip44.decrypt(event.content, conversationKey);
                    content = JSON.parse(decryptedContent);

                    // Update localStorage to use this old keypair so future events work
                    localStorage.setItem('nostr_nip46_app_keypair', JSON.stringify(oldKeyPair));

                    // Update connectionInfo reference
                    if (connectionInfo) {
                      connectionInfo.privateKey = oldKeyPair.privateKey;
                      connectionInfo.publicKey = oldKeyPair.publicKey;
                    }

                    break; // Successfully decrypted, stop trying
                  } catch (oldKeyErr) {
                    // Continue to next keypair
                  }
                }
              }

              // If we still haven't decrypted after trying all historical keypairs
              if (!decryptedContent) {
                // Only clear connection if:
                // 1. We have an established connection (not just listening for new connections)
                // 2. We have pending requests waiting for responses (meaning this might be a response we can't decrypt)
                // 3. The pending requests are NOT authentication-related (get_public_key, connect)
                //    - During authentication, old cached events are expected and should be ignored
                // If we have no pending requests, these are just old cached events from Amber that we should ignore
                const hasPendingRequests = this.pendingRequests.size > 0;
                
                // Check if we're in the middle of authentication (get_public_key or connect requests)
                const isAuthenticating = hasPendingRequests && Array.from(this.pendingRequests.values()).some(
                  (req: any) => req.method === 'get_public_key' || req.method === 'connect'
                );
                
                if (this.connection?.connected && this.connection?.pubkey && typeof window !== 'undefined' && hasPendingRequests && !isAuthenticating) {
                  // This is an established connection with pending requests (not auth) that can't decrypt - clear it
                  console.warn(`[NIP46-SIGNER-CACHE] ⚠️ Cannot decrypt event from established connection - clearing saved connection`);
                  console.warn(`[NIP46-SIGNER-CACHE] Signer's cached pubkey: ${pTagPubkey.slice(0, 16)}... vs current: ${connectionInfo.publicKey?.slice(0, 16)}...`);
                  console.warn(`[NIP46-SIGNER-CACHE] Has ${this.pendingRequests.size} pending request(s) waiting for responses`);
                  // Use .then() instead of await since this function is not async
                  import('./nip46-storage').then(({ clearNIP46ConnectionForUser }) => {
                    try {
                      clearNIP46ConnectionForUser(this.connection!.pubkey!);
                      console.log(`[NIP46-SIGNER-CACHE] ✅ Cleared saved connection - user will need to reconnect`);
                      // Disconnect this client so it can be re-established fresh
                      if (this.connection) {
                        this.connection.connected = false;
                        this.connection.pubkey = undefined;
                      }
                    } catch (clearError) {
                      console.error(`[NIP46-SIGNER-CACHE] Failed to clear connection:`, clearError);
                    }
                  }).catch((importError) => {
                    console.error(`[NIP46-SIGNER-CACHE] Failed to import storage module:`, importError);
                  });
                } else {
                  // No pending requests, or we're authenticating - this is just an old cached event from Amber, ignore it silently
                  // During authentication/login, old cached events are expected and should be ignored
                  if (this.connection?.connected && this.connection?.pubkey && !hasPendingRequests) {
                    // Established connection but no pending requests - just an old cached event
                    // Silently ignore it (don't spam logs)
                  } else if (isAuthenticating) {
                    // We're authenticating - old cached events are expected, ignore them
                    // Silently ignore it (don't spam logs)
                  }
                }
              }
            }
          }
          
          // If still not decrypted, try plain JSON
          if (!decryptedContent) {
            try {
              content = JSON.parse(event.content);
              console.log('📋 NIP-46: Parsed content as plain JSON (not encrypted):', {
                hasId: 'id' in content,
                hasResult: 'result' in content,
                hasError: 'error' in content,
                hasMethod: 'method' in content,
              });
            } catch (jsonErr) {
              // If we have a p tag mismatch and decryption failed even with historical keypairs
              if (pTagMismatch) {
                // Only clear connection if:
                // 1. We have an established connection (not just listening for new connections)
                // 2. We have pending requests waiting for responses (meaning this might be a response we can't decrypt)
                // 3. The pending requests are NOT authentication-related (get_public_key, connect)
                //    - During authentication, old cached events are expected and should be ignored
                // If we have no pending requests, these are just old cached events from Amber that we should ignore
                const hasPendingRequests = this.pendingRequests.size > 0;
                
                // Check if we're in the middle of authentication (get_public_key or connect requests)
                const isAuthenticating = hasPendingRequests && Array.from(this.pendingRequests.values()).some(
                  (req: any) => req.method === 'get_public_key' || req.method === 'connect'
                );
                
                if (this.connection?.connected && this.connection?.pubkey && typeof window !== 'undefined' && hasPendingRequests && !isAuthenticating) {
                  // This is an established connection with pending requests (not auth) that can't decrypt - clear it
                  console.warn(`[NIP46-SIGNER-CACHE] ⚠️ Cannot decrypt event from established connection - clearing saved connection`);
                  console.warn(`[NIP46-SIGNER-CACHE] Event p tag: ${pTags[0]?.slice(0, 16)}... vs current: ${connectionInfo.publicKey?.slice(0, 16)}...`);
                  console.warn(`[NIP46-SIGNER-CACHE] Has ${this.pendingRequests.size} pending request(s) waiting for responses`);
                  // Use .then() instead of await since this function is not async
                  import('./nip46-storage').then(({ clearNIP46ConnectionForUser }) => {
                    try {
                      clearNIP46ConnectionForUser(this.connection!.pubkey!);
                      console.log(`[NIP46-SIGNER-CACHE] ✅ Cleared saved connection - user will need to reconnect`);
                      // Disconnect this client so it can be re-established fresh
                      if (this.connection) {
                        this.connection.connected = false;
                        this.connection.pubkey = undefined;
                      }
                    } catch (clearError) {
                      console.error(`[NIP46-SIGNER-CACHE] Failed to clear connection:`, clearError);
                    }
                  }).catch((importError) => {
                    console.error(`[NIP46-SIGNER-CACHE] Failed to import storage module:`, importError);
                  });
                } else {
                  // No pending requests, or we're authenticating - this is just an old cached event from Amber, ignore it silently
                  // During authentication/login, old cached events are expected and should be ignored
                  if (this.connection?.connected && this.connection?.pubkey && !hasPendingRequests) {
                    // Established connection but no pending requests - just an old cached event
                    // Silently ignore it (don't spam logs)
                  } else if (isAuthenticating) {
                    // We're authenticating - old cached events are expected, ignore them
                    // Silently ignore it (don't spam logs)
                  }
                }
                
                // Don't throw - just return to skip this event
                return;
              }
              // Will be handled below
              throw decryptError; // Re-throw original error
            }
          }
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

      // Process response event

      // 🔵 Amber-compatible response handling
      // Amber sends responses without a 'method' field, so we need to infer the response type
      const isAmberCompatible = !content.method && (content.result !== undefined || content.error !== undefined);
      
      // Check if this looks like a get_public_key response (pubkey result)
      // Could be: 1) Direct 64-char hex string, or 2) JSON string containing pubkey
      let looksLikeGetPublicKeyResponse = false;
      let extractedPubkey: string | null = null;
      
      if (content.result && typeof content.result === 'string') {
        // FIRST: Check if it's a JSON string containing a full signed event (sign_event response)
        // This takes priority over get_public_key detection
        let looksLikeSignEventResponse = false;
        if (content.result.length > 100 && content.result.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(content.result.trim());
            if (parsed && typeof parsed === 'object' && 'sig' in parsed && typeof parsed.sig === 'string') {
              // This is a sign_event response - don't treat it as get_public_key
              looksLikeSignEventResponse = true;
            }
          } catch (e) {
            // Not valid JSON, continue with other checks
          }
        }
        
        // Check if it's a direct 64-char hex pubkey (only if not a sign_event response)
        if (!looksLikeSignEventResponse && content.result.length === 64 && 
            /^[a-f0-9]{64}$/i.test(content.result) &&
            content.result !== this.connection?.token) {
          // CRITICAL: Make sure it's not Amber's pubkey (the signer)
          // Amber's pubkey is stored in connection.pubkey from the connect response
          const isAmberPubkey = this.connection?.pubkey && content.result === this.connection.pubkey;
          if (!isAmberPubkey) {
            looksLikeGetPublicKeyResponse = true;
            extractedPubkey = content.result;
          } else {
          }
        }
        // Check if it's a JSON string that might contain a pubkey (only if not a sign_event response)
        else if (!looksLikeSignEventResponse && content.result.length > 64 && content.result.startsWith('{')) {
          try {
            const parsed = JSON.parse(content.result);
            if (typeof parsed === 'object' && parsed !== null) {
              // Amber returns the user's pubkey in the 'id' field, and the signer's pubkey in 'pubkey'
              // Check 'id' first, then 'pubkey' (but skip if it's Amber's pubkey)
              let possiblePubkey: string | null = null;
              let fieldName = '';
              
              // Try 'id' field first (this is usually the user's pubkey in Amber responses)
              if (parsed.id && 
                  typeof parsed.id === 'string' &&
                  parsed.id.length === 64 && 
                  /^[a-f0-9]{64}$/i.test(parsed.id) &&
                  parsed.id !== this.connection?.token) {
                const isAmberPubkey = this.connection?.pubkey && parsed.id === this.connection.pubkey;
                if (!isAmberPubkey) {
                  possiblePubkey = parsed.id;
                  fieldName = 'id';
                }
              }
              
              // If 'id' wasn't valid or was Amber's pubkey, try other fields
              if (!possiblePubkey) {
                const candidates = [
                  { value: parsed.pubkey, name: 'pubkey' },
                  { value: parsed.publicKey, name: 'publicKey' },
                  { value: parsed.key, name: 'key' },
                ];
                
                for (const candidate of candidates) {
                  if (candidate.value && 
                      typeof candidate.value === 'string' &&
                      candidate.value.length === 64 && 
                      /^[a-f0-9]{64}$/i.test(candidate.value) &&
                      candidate.value !== this.connection?.token) {
                    const isAmberPubkey = this.connection?.pubkey && candidate.value === this.connection.pubkey;
                    if (!isAmberPubkey) {
                      possiblePubkey = candidate.value;
                      fieldName = candidate.name;
                      break;
                    }
                  }
                }
              }
              
              if (possiblePubkey) {
                looksLikeGetPublicKeyResponse = true;
                extractedPubkey = possiblePubkey;
                
                // Verify the pubkey by converting to npub for user verification
                try {
                  const npub = publicKeyToNpub(extractedPubkey);
                  console.log(`[NIP46-GETPUBKEY] User\'s pubkey converts to npub: ${npub}`);
                } catch (e) {
                  console.error(`[NIP46-GETPUBKEY] Failed to convert pubkey to npub:`, e);
                }
              } else {
                console.error(`[NIP46-GETPUBKEY] No valid user pubkey found in JSON (all candidates were Amber's pubkey or invalid)`);
              }
            }
          } catch (e) {
            console.error(`[NIP46-GETPUBKEY] Failed to parse JSON:`, e);
            // Not valid JSON, ignore
          }
        }
      }
      
      if (isAmberCompatible) {
        console.log(`[NIP46-SIGNER] Event #${this.eventCounter} is Amber-compatible response`);
        console.log('🔵 [NIP46Client] Amber-compatible response (no method field), inferring type from context');
        console.log('🔵 [NIP46Client] Handling Amber-compatible response', {
          hasResult: !!content.result,
          resultType: typeof content.result,
          resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
          resultPreview: typeof content.result === 'string' ? content.result.substring(0, 32) + '...' : 'N/A',
          connectionToken: this.connection?.token ? this.connection.token.substring(0, 32) + '...' : 'N/A',
          tokenMatches: this.connection?.token && content.result === this.connection.token,
          looksLikeGetPublicKeyResponse,
          hasPendingGetPublicKey: Array.from(this.pendingRequests.values()).some(p => p.method === 'get_public_key'),
          pendingRequestCount: this.pendingRequests.size,
        });
        
        // Infer response type based on context
        if (content.result) {
          // Check if this is a connect response (result matches the secret)
          if (this.connection?.token && content.result === this.connection.token) {
            console.log(`[NIP46-CONNECT] Event #${this.eventCounter} is CONNECT response - secret matches!`);
            console.log('🔵 [NIP46Client] Inferred connect response from secret match');
            // This is a connect response - the result is the secret, which confirms connection
            // We still need to get the public key, so we'll handle this in the connection event section
            // For now, mark that we've received the connect confirmation
          } 
          // Check if this is a get_public_key response (result is a 64-char hex string OR a JSON string containing the pubkey)
          else if (looksLikeGetPublicKeyResponse) {
            console.log('🔵 [NIP46Client] Inferred get_public_key response from string pubkey (Amber compatibility)');
            // This is a get_public_key response - the result is the pubkey
            // Try to resolve any pending get_public_key requests immediately
            const pendingGetPublicKeyRequest = Array.from(this.pendingRequests.entries()).find(([reqId, pending]) => {
              return pending.method === 'get_public_key';
            });
            
            if (pendingGetPublicKeyRequest && extractedPubkey) {
              const [reqId, pending] = pendingGetPublicKeyRequest;
              
              console.log(`[NIP46-GETPUBKEY] Resolving get_public_key with pubkey: ${extractedPubkey.slice(0, 16)}...`);
              console.log('🔵 [NIP46Client] Found pending get_public_key request, resolving immediately:', {
                requestId: reqId,
                responseId: content.id || 'no-id',
                pubkey: extractedPubkey.slice(0, 16) + '...',
              });
              
              // Clear timeout and interval if they exist
              if ((pending as any).statusInterval) {
                clearInterval((pending as any).statusInterval);
              }
              
              // Remove from pending requests
              this.pendingRequests.delete(reqId);
              
              // Resolve with the pubkey
              pending.resolve(extractedPubkey);
              return; // Don't process further
            }
          }
        }
      }

      // Check if this is a response to a pending request
      if (content.id) {
        console.log('🔍 NIP-46: Checking if response matches pending request:', {
          responseId: content.id,
          pendingRequestIds: Array.from(this.pendingRequests.keys()),
          pendingRequestMethods: Array.from(this.pendingRequests.values()).map(p => p.method),
          hasMatch: this.pendingRequests.has(content.id),
        });

        if (this.pendingRequests.has(content.id)) {
          // Log all pending request IDs for debugging
          const pendingRequestIds = Array.from(this.pendingRequests.keys());
          console.log('🔍 NIP-46: Checking for matching pending request:', {
            responseId: content.id,
            pendingRequestIds,
            hasMatchingRequest: this.pendingRequests.has(content.id),
            allPendingIds: pendingRequestIds,
          });
          
          const pending = this.pendingRequests.get(content.id);
          if (pending) {
            this.pendingRequests.delete(content.id);
            console.log('✅ NIP-46: Found matching pending request, processing response:', {
              requestId: content.id,
              requestMethod: pending.method,
              responseMethod: content.method,
              hasResult: 'result' in content,
              hasError: 'error' in content,
              resultType: typeof content.result,
              resultPreview: typeof content.result === 'string' ? content.result.slice(0, 64) + '...' : JSON.stringify(content.result).slice(0, 100),
            });
            
            // Special logging for sign_event responses
            if (pending.method === 'sign_event') {
              console.log('🎉 [NIP46-SIGN] SIGN_EVENT RESPONSE RECEIVED!', {
                requestId: content.id,
                hasResult: !!content.result,
                resultType: typeof content.result,
                resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
                resultPreview: typeof content.result === 'string' ? content.result.slice(0, 32) + '...' : JSON.stringify(content.result).slice(0, 100),
                note: 'This should be the signature string from Amber',
              });
            }
            
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
                // CRITICAL: For connect requests, if the result is "ack", don't resolve with "ack"
                // Instead, wait for get_public_key to complete (handled separately)
                if (pending.method === 'connect' && content.result === 'ack') {
                  console.log('🔵 [NIP46Client] Connect request received "ack" - this will be handled by connection event handler, not resolving promise yet');
                  // Don't resolve the promise - the connection event handler will call get_public_key
                  // and we'll resolve the connect promise with the actual pubkey later
                  return; // Don't resolve with "ack"
                }
                
                // CRITICAL: For get_public_key requests, ONLY resolve if this is actually a get_public_key response
                // Don't resolve get_public_key promises with connect responses
                if (pending.method === 'get_public_key') {
                  // Check if this is a connect response (result is the secret/token or "ack")
                  const isConnectResponseResult = (this.connection?.token && content.result === this.connection.token) || content.result === 'ack';
                  if (isConnectResponseResult) {
                    console.error(`[NIP46-ERROR] Ignoring connect response - this is NOT a get_public_key response!`);
                    return; // Don't resolve - this is a connect response, not get_public_key
                  }
                  
                  const result = content.result;
                  // Check if result is Amber's pubkey (the signer)
                  // NOTE: For new Amber accounts, the user's pubkey might be the same as Amber's pubkey
                  // This is OK - it means the user is using Amber's own account
                  const amberPubkey = event.pubkey; // This is the signer's (Amber's) pubkey from the event
                  if (amberPubkey && result === amberPubkey && typeof result === 'string' && result.length === 64) {
                    console.warn(`[NIP46-WARNING] Got pubkey that matches Amber's pubkey (${result.slice(0, 16)}...). This might be correct if the user is using Amber's own account. Accepting it.`);
                    // Continue - this might be correct for new Amber accounts
                  }
                }
                
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
            responseIdType: typeof content.id,
            responseIdLength: typeof content.id === 'string' ? content.id.length : 'N/A',
            pendingRequestIds: Array.from(this.pendingRequests.keys()),
            pendingRequestIdsTypes: Array.from(this.pendingRequests.keys()).map(id => typeof id),
            pendingRequestIdsLengths: Array.from(this.pendingRequests.keys()).map(id => typeof id === 'string' ? id.length : 'N/A'),
            hasResult: 'result' in content,
            hasError: 'error' in content,
            hasMethod: 'method' in content,
            contentKeys: Object.keys(content),
            contentPreview: JSON.stringify(content).substring(0, 300),
            note: 'This might be a response to an old request, or the request ID format is different. Check if IDs match exactly (including type and length).',
          });
          
          // 🔵 Amber fallback: If this is a get_public_key response (pubkey) and we have a pending get_public_key request,
          // resolve it even if the ID doesn't match (Amber might use different ID format)
          // This is a secondary check in case the primary check above didn't catch it
          if (looksLikeGetPublicKeyResponse) {
            const pendingGetPublicKeyRequest = Array.from(this.pendingRequests.entries()).find(([reqId, pending]) => {
              return pending.method === 'get_public_key';
            });
            
            if (pendingGetPublicKeyRequest) {
              const [reqId, pending] = pendingGetPublicKeyRequest;
              console.log('🔵 [NIP46Client] Amber fallback: Resolving get_public_key request despite ID mismatch:', {
                responseId: content.id || 'no-id',
                requestId: reqId,
                pubkey: content.result.slice(0, 16) + '...',
                note: 'Signer may use different ID format, but response is valid pubkey',
              });
              
              // Clear timeout and interval if they exist
              if ((pending as any).statusInterval) {
                clearInterval((pending as any).statusInterval);
              }
              
              // Remove from pending requests
              this.pendingRequests.delete(reqId);
              
              // Resolve with the pubkey
              pending.resolve(content.result);
              return; // Don't process further
            }
          }
          
          // 🔵 Amber fallback for sign_event: If we have a pending sign_event request and this looks like a signature response,
          // resolve it even if the ID doesn't match (Amber might use different ID format)
          // Amber can return:
          // 1. A 64/128-char hex signature string
          // 2. A JSON string containing a full signed event (with 'sig' field)
          const hasPendingSignEvent = Array.from(this.pendingRequests.values()).some(p => p.method === 'sign_event');
          let looksLikeSignatureResponse = false;
          let signatureValue: string | null = null;
          
          if (content.result && typeof content.result === 'string') {
            // Check if it's a direct signature (64 or 128 hex chars)
            if ((content.result.length === 128 || content.result.length === 64) && /^[a-f0-9]+$/i.test(content.result)) {
              looksLikeSignatureResponse = true;
              signatureValue = content.result;
            }
            // Check if it's a JSON string containing a full signed event
            else if (content.result.length > 100 && content.result.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(content.result.trim());
                if (parsed && typeof parsed === 'object' && 'sig' in parsed && typeof parsed.sig === 'string') {
                  looksLikeSignatureResponse = true;
                  signatureValue = content.result; // Pass the full JSON string, signEvent will parse it
                  console.log('🔵 [NIP46Client] Amber fallback: Detected sign_event response as JSON string with full event');
                }
              } catch (e) {
                // Not valid JSON, ignore
              }
            }
          }
          
          // Check if this is a sign_event response (even if request timed out)
          if (looksLikeSignatureResponse && signatureValue) {
            const pendingSignEventRequest = Array.from(this.pendingRequests.entries()).find(([reqId, pending]) => {
              return pending.method === 'sign_event';
            });
            
            if (pendingSignEventRequest) {
              const [reqId, pending] = pendingSignEventRequest;
              console.log('🔵 [NIP46Client] Amber fallback: Resolving sign_event request (ID may not match):', {
                responseId: content.id || 'no-id',
                requestId: reqId,
                resultLength: content.result?.length || 0,
                resultPreview: typeof content.result === 'string' ? content.result.slice(0, 100) + '...' : 'N/A',
                note: 'Signer may use different ID format, but response looks like a valid signature or signed event',
              });
              
              // Clear timeout and interval if they exist
              if ((pending as any).statusInterval) {
                clearInterval((pending as any).statusInterval);
              }
              if ((pending as any).timeout) {
                clearTimeout((pending as any).timeout);
              }
              
              // Remove from pending requests
              this.pendingRequests.delete(reqId);


              // Resolve with the signature/event (signEvent method will parse it)
              pending.resolve(signatureValue);
              return; // Don't process further
            } else {
              // Response looks like sign_event but no pending request (may have timed out)
              // Check if response ID matches a request ID pattern
              const responseId = content.id;
              if (responseId && typeof responseId === 'string') {
                // Request IDs are in format: timestamp-randomstring
                // Check if this response ID matches that pattern
                const isRequestIdPattern = /^\d{13}-[a-z0-9]+$/i.test(responseId);
                if (isRequestIdPattern) {
                  console.warn('⚠️ NIP-46: Received sign_event response but no pending request found:', {
                    responseId,
                    resultLength: content.result?.length || 0,
                    note: 'This may be a late response to a timed-out request. The request may have already been rejected.',
                  });
                }
              }
            }
          }
        }
      }

      // Check if this is a connection/authentication response
      // NIP-46 connection events can have different structures:
      // 1. Method-based: { method: 'connect', params: [...] }
      // 2. Response-based: { id: '...', result: 'pubkey' }
      // 3. Direct pubkey in content
      // 4. Amber-compatible: { id: '...', result: 'secret' } (connect response) or { id: '...', result: 'pubkey' } (get_public_key response)
      
      // Check if this is a connect response (Amber sends secret as result OR "ack")
      // Amber can respond with either the token/secret OR just "ack" to acknowledge the connection
      const isConnectResponse = isAmberCompatible && 
        this.connection?.token && 
        (content.result === this.connection.token || content.result === 'ack');
      
      // Check if this is a get_public_key response (result is a 64-char hex pubkey OR JSON containing pubkey)
      const isGetPublicKeyResponse = isAmberCompatible && looksLikeGetPublicKeyResponse && extractedPubkey !== null;
      
      const isConnectionEvent = 
        content.method === 'connect' || 
        content.method === 'get_public_key' ||
        isConnectResponse ||
        isGetPublicKeyResponse ||
        (content.result && typeof content.result === 'string' && content.result.length === 64 && /^[a-f0-9]{64}$/i.test(content.result)) ||
        (event.content && event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content));

      console.log('🔍 NIP-46: Checking if event is connection event:', {
        isConnectionEvent,
        isConnectResponse,
        isGetPublicKeyResponse,
        hasMethod: !!content.method,
        method: content.method,
        hasResult: !!content.result,
        resultType: typeof content.result,
        resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
        contentIsHex: event.content && /^[a-f0-9]{64}$/i.test(event.content),
      });

      // Handle Amber connect response - automatically request public key
      // CRITICAL: Only process connect response if we don't already have a user's pubkey
      // We temporarily store Amber's pubkey, but that's not the user's pubkey
      // Also check if we've already processed a connect response to avoid duplicate processing
      const hasUserPubkey = this.connection?.pubkey && this.connection.pubkey !== event.pubkey;
      const alreadyProcessedConnect = this.connection?.connected && this.connection.pubkey === event.pubkey;
      if (isConnectResponse && !hasUserPubkey && !alreadyProcessedConnect) {
        console.log(`[NIP46-CONNECT] Event #${this.eventCounter} - CONNECT response detected! Requesting public key...`);
        console.log('🔵 [NIP46Client] Connect response received, requesting public key from', event.pubkey.slice(0, 16) + '...');
        
        // CRITICAL: Store Amber's pubkey from the connect response event so we can identify responses from Amber
        // This is Amber's pubkey (the signer who sent the connect response)
        if (this.connection) {
          this.connection.pubkey = event.pubkey; // Store Amber's pubkey temporarily
          this.connection.connected = true; // Mark as connected
          console.error(`[NIP46-CONNECT] Stored Amber's pubkey from connect response: ${event.pubkey.slice(0, 16)}...`);
        }
        
        // Request public key and wait for it to complete
        // CRITICAL: We need to resolve any pending connect requests with the actual pubkey, not "ack"
        this.sendRequest('get_public_key', []).then((pubkey: string) => {
          console.error(`[NIP46-SUCCESS] Got public key from Amber: ${pubkey.slice(0, 16)}...`);
          console.log('🔵 [NIP46Client] Successfully authenticated with Amber pubkey:', pubkey);
          
          // CRITICAL: Make sure we're using the user's pubkey, not Amber's pubkey
          // The pubkey should be the user's pubkey from the get_public_key response
          // Amber's pubkey is stored temporarily in connection.pubkey from the connect response
          const amberPubkey = event.pubkey; // This is Amber's pubkey from the connect response event
          
          // NOTE: For new Amber accounts, the user's pubkey might be the same as Amber's pubkey
          // This is OK - it means the user is using Amber's own account
          // We should accept it and proceed with authentication
          if (pubkey === amberPubkey) {
            console.warn(`[NIP46-WARNING] Got pubkey that matches Amber's pubkey (${pubkey.slice(0, 16)}...). This might be correct if the user is using Amber's own account. Proceeding anyway.`);
            // Continue - this might be correct for new Amber accounts
          } else {
            console.error(`[NIP46-SUCCESS] Using user's pubkey: ${pubkey.slice(0, 16)}... (Amber's pubkey was: ${amberPubkey.slice(0, 16)}...)`);
          }
          
          // Store user's pubkey in connection (this replaces Amber's pubkey that was stored temporarily)
          if (this.connection) {
            this.connection.pubkey = pubkey; // This is the user's pubkey
            this.connection.connected = true;
            this.connection.connectedAt = Date.now();
          }
          
          // Save connection to localStorage
          // This is the user's Nostr account pubkey (from Amber), not the app's pubkey
          if (typeof window !== 'undefined' && this.connection) {
            try {
              // Functions are already imported at top of file
              
              // Check if we already have a connection for this user pubkey (same account, different connection)
              const existingConnection = loadNIP46Connection(pubkey);
              if (existingConnection && existingConnection.token !== this.connection.token) {
                console.log(`🔄 NIP-46: New connection created for existing user account (pubkey: ${pubkey.slice(0, 16)}...)`);
                console.log(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
                console.log(`✅ NIP-46: Recognizing as same account - user pubkey matches: ${pubkey.slice(0, 16)}...`);
              }
              
              saveNIP46Connection({
                token: this.connection.token,
                pubkey: pubkey, // User's Nostr account pubkey (from Amber)
                signerUrl: this.connection.signerUrl,
                connected: true,
                connectedAt: Date.now(),
              });
              console.log('💾 NIP-46: Saved connection to localStorage:', {
                userPubkey: pubkey.slice(0, 16) + '...',
                relayUrl: this.connection.signerUrl,
                note: 'Connection tied to user\'s Nostr account (pubkey), not connection token. Multiple connections with same pubkey = same account.',
              });
            } catch (err) {
              console.error('❌ NIP-46: Failed to save connection:', err);
            }
          }
          
          // CRITICAL: Resolve any pending connect requests with the actual pubkey (not "ack")
          // This ensures authenticate() gets the real pubkey
          // The pubkey here is the user's Nostr account pubkey (from Amber)
          const pendingConnectRequests = Array.from(this.pendingRequests.entries()).filter(
            ([reqId, req]) => req.method === 'connect'
          );
          for (const [reqId, req] of pendingConnectRequests) {
            console.log('🔵 [NIP46Client] Resolving pending connect request with user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
            this.pendingRequests.delete(reqId);
            if ((req as any).timeout) {
              clearTimeout((req as any).timeout);
            }
            if ((req as any).statusInterval) {
              clearInterval((req as any).statusInterval);
            }
            req.resolve(pubkey); // Resolve with actual pubkey (user's Nostr account), not "ack"
          }
          
          // Trigger connection callback to complete authentication with server
          // The pubkey here is the user's Nostr account pubkey (from Amber)
          if (this.onConnectionCallback) {
            console.log('🔵 [NIP46Client] Completing authentication with server for user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
            console.log('📋 NIP-46: This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.');
            const callback = this.onConnectionCallback;
            this.onConnectionCallback = null; // Clear to prevent duplicate calls
            setTimeout(() => {
              callback(pubkey);
            }, 100);
          }
        }).catch((err) => {
          console.error('❌ NIP-46: Failed to get public key after connect:', err);
          // Reject any pending connect requests
          const pendingConnectRequests = Array.from(this.pendingRequests.entries()).filter(
            ([reqId, req]) => req.method === 'connect'
          );
          for (const [reqId, req] of pendingConnectRequests) {
            this.pendingRequests.delete(reqId);
            if ((req as any).timeout) {
              clearTimeout((req as any).timeout);
            }
            if ((req as any).statusInterval) {
              clearInterval((req as any).statusInterval);
            }
            req.reject(err);
          }
        });
        return; // Don't process as regular connection event yet
      }
      
      // Handle Amber get_public_key response - complete connection
      // Only handle if it wasn't already processed via pending request mechanism
      // (check if there's no matching pending request, or if we don't have pubkey yet)
      const wasProcessedAsPendingRequest = content.id && this.pendingRequests.has(content.id);
      if (isGetPublicKeyResponse && content.result && !this.connection?.pubkey && !wasProcessedAsPendingRequest) {
        const pubkey = content.result;
        console.log('🔵 [NIP46Client] Successfully authenticated with Amber pubkey:', pubkey);
        
        // Store pubkey in connection
        if (this.connection) {
          this.connection.pubkey = pubkey;
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
        }
        
        // Save connection to localStorage
        // This is the user's Nostr account pubkey (from Amber), not the app's pubkey
        if (typeof window !== 'undefined' && this.connection) {
          try {
            // Functions are already imported at top of file
            
            // Check if we already have a connection for this user pubkey (same account, different connection)
            const existingConnection = loadNIP46Connection(pubkey);
            if (existingConnection && existingConnection.token !== this.connection.token) {
              console.log(`🔄 NIP-46: New connection created for existing user account (pubkey: ${pubkey.slice(0, 16)}...)`);
              console.log(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
            }
            
            saveNIP46Connection({
              token: this.connection.token,
              pubkey: pubkey, // User's Nostr account pubkey (from Amber)
              signerUrl: this.connection.signerUrl,
              connected: true,
              connectedAt: Date.now(),
            });
            console.log('💾 NIP-46: Saved connection to localStorage:', {
              userPubkey: pubkey.slice(0, 16) + '...',
              relayUrl: this.connection.signerUrl,
              note: 'Connection tied to user\'s Nostr account (pubkey), not connection token. Multiple connections with same pubkey = same account.',
            });
          } catch (err) {
            console.error('❌ NIP-46: Failed to save connection:', err);
          }
        }
        
        // Trigger connection callback to complete authentication with server
        // The pubkey here is the user's Nostr account pubkey (from Amber)
        if (this.onConnectionCallback) {
          console.log('🔵 [NIP46Client] Completing authentication with server for user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
          console.log('📋 NIP-46: This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.');
          const callback = this.onConnectionCallback;
          this.onConnectionCallback = null; // Clear to prevent duplicate calls
          setTimeout(() => {
            callback(pubkey);
          }, 100);
        }
        return; // Don't process as regular connection event (already handled)
      }

      if (isConnectionEvent) {
        // Extract signer's public key
        let signerPubkey = event.pubkey; // Default to event author
        
        // For get_public_key response, the result is the pubkey
        if (isGetPublicKeyResponse && content.result) {
          signerPubkey = content.result;
        } else if (content.result && typeof content.result === 'string' && content.result.length === 64 && /^[a-f0-9]{64}$/i.test(content.result)) {
          signerPubkey = content.result;
        } else if (event.content && /^[a-f0-9]{64}$/i.test(event.content)) {
          signerPubkey = event.content;
        }

        console.log('✅ NIP-46: Connected via relay, signer pubkey (user\'s Nostr account):', signerPubkey);
        console.log('📋 NIP-46: Connection details:', {
          userPubkey: signerPubkey.slice(0, 16) + '...',
          relayUrl: this.connection?.signerUrl,
          note: 'This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.',
        });

        // Store pubkey in connection object BEFORE calling callback
        // This is the user's Nostr account pubkey (from Amber), not the app's pubkey
        if (this.connection && signerPubkey) {
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
          this.connection.pubkey = signerPubkey; // User's pubkey from Amber
          console.log('💾 NIP-46: Stored user pubkey in connection object:', {
            hasConnection: !!this.connection,
            hasPubkey: !!this.connection.pubkey,
            userPubkey: this.connection.pubkey.slice(0, 16) + '...',
            relayUrl: this.connection.signerUrl,
            note: 'User pubkey (from Amber) - this identifies the Nostr account, not the connection token',
          });
        }

        // Save connection to localStorage for persistence
        // This is the user's Nostr account pubkey (from Amber), not the app's pubkey
        if (typeof window !== 'undefined' && this.connection) {
          try {
            // Functions are already imported at top of file
            
            // Check if we already have a connection for this user pubkey (same account, different connection)
            const existingConnection = loadNIP46Connection(signerPubkey);
            if (existingConnection && existingConnection.token !== this.connection.token) {
              console.log(`🔄 NIP-46: New connection created for existing user account (pubkey: ${signerPubkey.slice(0, 16)}...)`);
              console.log(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
              console.log(`✅ NIP-46: Recognizing as same account - user pubkey matches: ${signerPubkey.slice(0, 16)}...`);
            }
            
            saveNIP46Connection({
              token: this.connection.token,
              pubkey: signerPubkey, // User's Nostr account pubkey (from Amber)
              signerUrl: this.connection.signerUrl,
              connected: true,
              connectedAt: Date.now(),
            });
            console.log('💾 NIP-46: Saved connection to localStorage:', {
              userPubkey: signerPubkey.slice(0, 16) + '...',
              relayUrl: this.connection.signerUrl,
              note: 'Connection tied to user\'s Nostr account (pubkey), not connection token. Multiple connections with same pubkey = same account.',
            });
          } catch (err) {
            console.error('❌ NIP-46: Failed to save connection:', err);
          }
        }

        // Call the connection callback if set (pubkey is now guaranteed to be stored)
        // Only call once - clear the callback after use to prevent duplicate calls
        // The signerPubkey here is the user's Nostr account pubkey (from Amber)
        if (this.onConnectionCallback && signerPubkey) {
          console.log('📞 NIP-46: Calling connection callback with user pubkey (Nostr account):', signerPubkey.slice(0, 16) + '...');
          console.log('📞 NIP-46: Connection state before callback:', {
            hasConnection: !!this.connection,
            hasPubkey: !!this.connection?.pubkey,
            userPubkey: signerPubkey.slice(0, 16) + '...',
            pubkeyMatches: this.connection?.pubkey === signerPubkey,
            connected: this.connection?.connected,
            relayUrl: this.connection?.signerUrl,
            note: 'This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.',
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
   * Set callback for pubkey mismatch detection
   * Called when Amber responds with events for a different app pubkey
   */
  setOnPubkeyMismatch(callback: (oldPubkey: string, currentPubkey: string) => void): void {
    this.onPubkeyMismatchCallback = callback;
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
                // Function is already imported at top of file
                saveNIP46Connection({
                  token: this.connection.token,
                  pubkey: this.connection.pubkey,
                  signerUrl: this.connection.signerUrl,
                  connected: this.connection.connected || true,
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
      // Ensure relay is actually connected before sending request
      const connectedRelays = this.relayClient.getConnectedRelays?.() || [];
      if (connectedRelays.length === 0) {
        console.warn('⚠️ NIP-46: Relay client exists but not connected, waiting...');
        // Wait up to 2 seconds for relay to connect
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const retryRelays = this.relayClient.getConnectedRelays?.() || [];
          if (retryRelays.length > 0) {
            console.log('✅ NIP-46: Relay connected, proceeding with request');
            break;
          }
        }
        const finalRelays = this.relayClient.getConnectedRelays?.() || [];
        if (finalRelays.length === 0) {
          throw new Error('Relay not connected. Please try reconnecting with Amber.');
        }
      }
      return this.sendRelayRequest(method, params);
    }

    // For WebSocket connections
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.connection && !this.connection.connected) {
        await this.establishConnection();
      } else {
        // Check if this should be a relay connection but relay client isn't set
        if (this.connection && !this.ws && !this.relayClient) {
          throw new Error('Relay client not initialized. Please try reconnecting with Amber.');
        }
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
      this.pendingRequests.set(id, { method, resolve, reject });

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
   * Check if an error is a rate limit error
   */
  private isRateLimitError(error: string | Error): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();
    return (
      lowerMessage.includes('429') ||
      lowerMessage.includes('rate limit') ||
      lowerMessage.includes('rate-limit') ||
      lowerMessage.includes('too many requests') ||
      lowerMessage.includes('quota exceeded') ||
      lowerMessage.includes('throttled') ||
      lowerMessage.includes('slow down')
    );
  }

  /**
   * Send a request via relay (for relay-based NIP-46 connections)
   */
  private async sendRelayRequest(method: string, params: any[]): Promise<any> {
    if (!this.relayClient || !this.connection) {
      throw new Error('Relay client not initialized');
    }

    // Get connection info
    // Get the app's key pair - prefer persistent key pair, fall back to sessionStorage
    let connectionInfo: any = null;
    let appPubkey: string;
    
    // First, try to get persistent app key pair from localStorage
    if (typeof window !== 'undefined') {
      try {
        const keyPair = getOrCreateAppKeyPair();
        appPubkey = keyPair.publicKey;
        connectionInfo = {
          publicKey: appPubkey,
          privateKey: keyPair.privateKey,
        };
      } catch (keyPairError) {
        // Fall back to sessionStorage for backward compatibility
        const pendingConnection = sessionStorage.getItem('nip46_pending_connection');
        if (pendingConnection) {
          connectionInfo = JSON.parse(pendingConnection);
          appPubkey = connectionInfo.publicKey;
        } else {
          throw new Error('No app key pair found (neither persistent nor session)');
        }
      }
    } else {
      throw new Error('Cannot access localStorage on server');
    }
    
    if (!connectionInfo || !appPubkey) {
      throw new Error('No valid app key pair found');
    }

    // For bunker:// connections, use signerPubkey (signer app's pubkey) to target messages
    // For nostrconnect:// connections, use pubkey (will be fetched)
    const signerPubkey = (this.connection as any).signerPubkey || this.connection.pubkey;

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

    // For 'connect' and 'get_public_key', we can proceed without the signer pubkey
    // For other methods, we need the signer pubkey to target the request
    if (method !== 'connect' && method !== 'get_public_key' && !signerPubkey) {
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
      requestIdType: typeof id,
      requestIdLength: id.length,
      requestIdPreview: id.substring(0, 50) + '...',
      hasSignerPubkey: !!signerPubkey,
      signerPubkey: signerPubkey ? signerPubkey.slice(0, 16) + '...' : 'N/A',
      appPubkey: appPubkey.slice(0, 16) + '...',
      pendingRequestsCount: this.pendingRequests.size,
      fullRequest: JSON.stringify(request, null, 2),
      note: 'This ID will be used to match the response. Make sure response.id matches exactly.',
    });

    // Rate limiting: Check if we've sent a request of this method recently
    const lastTime = this.lastRequestTime.get(method);
    const now = Date.now();
    if (lastTime && (now - lastTime) < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - (now - lastTime);
      const errorMsg = `Rate limit: Please wait ${Math.ceil(waitTime / 1000)} seconds before sending another ${method} request. This prevents overwhelming Amber.`;
      console.warn(`⚠️ NIP-46: Rate limit - ${method} request too soon (${Math.ceil((now - lastTime) / 1000)}s ago). ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Update last request time
    this.lastRequestTime.set(method, now);

    // For relay-based requests, we need to wait for the response event
    // This is a simplified implementation - in production, you'd want to
    // properly handle the request/response cycle via relay events
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const pendingRequest: { method: string; resolve: (value: any) => void; reject: (error: Error) => void; startTime?: number; statusInterval?: NodeJS.Timeout } = { 
        method,
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
      
      // Store interval and timeout for cleanup
      pendingRequest.statusInterval = statusInterval;

      // Timeout after 120 seconds for relay requests (Amber can be slow to respond, especially on mobile)
      // Relay-based communication can be slower
      const timeout = setTimeout(() => {
        clearInterval(statusInterval);
        if (this.pendingRequests.has(id)) {
          const timeSinceLastEvent = this.lastEventTime > 0 ? Math.floor((Date.now() - this.lastEventTime) / 1000) : -1;
          const hasRecentEvents = timeSinceLastEvent >= 0 && timeSinceLastEvent < 60;
          
          console.error('❌ NIP-46: Request timeout:', {
            requestId: id,
            method,
            timeoutMs: 120000, // 120 seconds - Amber can take time to respond, especially on mobile
            pendingRequestsCount: this.pendingRequests.size,
            allPendingIds: Array.from(this.pendingRequests.keys()),
            eventsReceivedTotal: this.eventCounter,
            lastEventReceived: timeSinceLastEvent >= 0 ? `${timeSinceLastEvent}s ago` : 'never',
            subscriptionActive: !!this.relaySubscription,
            connectionState: {
              hasConnection: !!this.connection,
              connected: this.connection?.connected,
              hasPubkey: !!this.connection?.pubkey,
              pubkeyPreview: this.connection?.pubkey?.slice(0, 16) + '...',
              signerUrl: this.connection?.signerUrl,
            },
          });
          
          // Provide specific troubleshooting based on the situation
          let troubleshootingTips = '';
          if (!hasRecentEvents && this.eventCounter === 0) {
            troubleshootingTips = '\n\n🔍 TROUBLESHOOTING:\n' +
              '  • No events received at all - relay subscription might not be working\n' +
              '  • Check if Amber is connected to the same relays\n' +
              '  • Verify relay connectivity (wss://relay.damus.io, etc.)';
          } else if (!hasRecentEvents) {
            troubleshootingTips = '\n\n🔍 TROUBLESHOOTING:\n' +
              '  • No events received in the last 60+ seconds - relay might be disconnected\n' +
              '  • Amber might not be connected to any of the relays we published to\n' +
              '  • Check Amber\'s relay connection status in the app';
          } else if (method === 'sign_event') {
            troubleshootingTips = '\n\n🔍 TROUBLESHOOTING:\n' +
              '  • Check your phone - did Amber show a notification/prompt?\n' +
              '  • If no prompt: Amber might not be subscribed to events from your app\n' +
              '  • If prompt appeared but timed out: Amber might be waiting for approval\n' +
              '  • Check Amber\'s "Recent Requests" or activity log\n' +
              '  • Verify Amber is connected to at least one of these relays:\n' +
              '    - wss://relay.damus.io\n' +
              '    - wss://relay.nsec.app\n' +
              '    - wss://nostr.oxtr.dev\n' +
              '    - wss://theforest.nostr1.com\n' +
              '    - wss://relay.primal.net\n' +
              '  • If you see p-tag mismatch errors, clear Amber\'s connection cache and reconnect';
          }
          
          this.pendingRequests.delete(id);
          reject(new Error(
            `Request timeout: ${method} - No response received from signer after 120 seconds.${troubleshootingTips}\n\n` +
            `Request ID: ${id}\n` +
            `Events received: ${this.eventCounter} total, last event ${timeSinceLastEvent >= 0 ? timeSinceLastEvent + 's ago' : 'never'}\n` +
            `Subscription active: ${!!this.relaySubscription}`
          ));
        }
      }, 120000); // 120 seconds - Amber can take time to respond, especially on mobile
      
      // Store timeout reference for cleanup if response arrives
      (pendingRequest as any).timeout = timeout;

      // CRITICAL: NEVER return stored pubkey for get_public_key requests
      // The stored pubkey might be Amber's pubkey (from connect response), not the user's pubkey
      // We MUST wait for the actual get_public_key response to get the user's pubkey
      // This was causing the promise to resolve immediately with Amber's pubkey instead of waiting

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
      
      // CRITICAL: For get_public_key without signer pubkey, we have a chicken-and-egg problem:
      // - We need the signer's pubkey to encrypt the request properly
      // - But we're trying to get the signer's pubkey with this request
      // 
      // According to NIP-46, when using nostrconnect://, Amber should send a connection event first
      // that includes its pubkey. We should wait for that before calling get_public_key.
      // 
      // However, if we're calling get_public_key before connection, we have two options:
      // 1. Don't encrypt (but NIP-46 requires encryption)
      // 2. Use a workaround: encrypt with app pubkey (Amber can't decrypt, but might still respond)
      // 3. Wait for connection event first (RECOMMENDED)
      //
      // For 'connect' and 'get_public_key', we don't have the signer pubkey yet
      // - 'connect': We're establishing the connection, so we don't know the signer's pubkey
      // - 'get_public_key': We're requesting the signer's pubkey
      // For these methods, we need special handling:
      // 1. Don't tag the request with a specific signer pubkey (or use app pubkey as placeholder)
      // 2. Use app pubkey for encryption (signer can't decrypt, but might still respond)
      // 3. Amber should find the request by listening to all kind 24133 events
      if ((method === 'connect' || method === 'get_public_key') && !signerPubkey) {
        console.log(`ℹ️ NIP-46: Calling ${method} without signer pubkey (this is expected for initial connection)`);
        console.log('   - Request will be published without p tag (or with app pubkey as placeholder)');
        console.log('   - Signer should find it by listening to all kind 24133 events');
        console.log('   - Encryption uses app pubkey as placeholder (signer may not decrypt, but should still respond)');
      }
      
      // For 'connect' and 'get_public_key' without signer pubkey, don't tag with specific signer
      // This allows Amber to find it by listening to all kind 24133 events
      // Amber can then decrypt and check if it matches the connection token/secret
      const pubkeyForRequest = (method === 'connect' || method === 'get_public_key') && !signerPubkey 
        ? undefined  // No p tag - Amber finds it by listening to all events
        : (signerPubkey || appPubkey);  // Use signer pubkey if available, otherwise app pubkey
      
      console.log('📋 NIP-46: Request details:', {
        method,
        hasSignerPubkey: !!signerPubkey,
        usingPubkeyForRequest: pubkeyForRequest === signerPubkey ? 'signer' : (pubkeyForRequest === appPubkey ? 'app (placeholder)' : 'none (untagged)'),
        pubkeyForRequest: pubkeyForRequest ? pubkeyForRequest.slice(0, 16) + '...' : 'N/A (no p tag)',
        note: !pubkeyForRequest ? 'Request will be published without p tag - Amber should find it by listening to all kind 24133 events' : undefined,
      });

      // For other methods, publish a request event and wait for response
      // 1. Create and publish a kind 24133 event with the request
      // 2. Listen for a response event with matching ID
      // 3. Resolve/reject based on the response
      
      // Create NIP-46 request event
      // For 'connect' and 'get_public_key', we don't have signer pubkey yet
      // For encryption, we always need a pubkey - use app pubkey as placeholder
      // NOTE: This is expected for initial connection - Amber should still respond
      const encryptionPubkey = signerPubkey || appPubkey;
      const requestEvent = this.createNIP46RequestEvent(method, params, id, appPubkey, pubkeyForRequest, connectionInfo.privateKey, encryptionPubkey);
      
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
        warning: !signerPubkey && (method === 'connect' || method === 'get_public_key')
          ? `ℹ️ INFO: ${method} request without signer pubkey (expected for initial connection). Request may not be tagged with p tag.`
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
          // Ensure connection still exists (TypeScript guard)
          if (!this.connection) {
            clearTimeout(timeout);
            clearInterval(statusInterval);
            this.pendingRequests.delete(id);
            reject(new Error('Connection lost during relay selection'));
            return;
          }
          
          const connectionRelay = this.connection.signerUrl;
          
          // CRITICAL: Publish to the primary relay (the one in the QR code) first
          // Amber will listen on this relay, so we must publish here
          // For 'connect' requests, ONLY publish to primary relay to avoid rate limits
          // For other requests, we can use backup relays for redundancy
          const primaryRelay = connectionRelay;
          
          // For 'connect' requests, only use primary relay (Amber is listening here)
          // Publishing to multiple relays causes rate limits and doesn't help
          // For other requests, we can use backup relays for redundancy
          const backupRelays = [
            'wss://relay.nsec.app',      // More reliable, less rate-limited
            'wss://nos.lol',              // Popular and stable
            'wss://relay.snort.social',   // Snort's relay
            'wss://nostr.oxtr.dev',       // Alternative relay
            'wss://relay.primal.net',     // Primal relay
            'wss://theforest.nostr1.com', // Forest relay
            'wss://relay.damus.io',       // Damus relay (moved to end due to frequent rate limiting)
          ].filter(r => r !== primaryRelay); // Remove primary if it's in the backup list
          
          // Check if this is a bunker:// connection (has signerPubkey)
          // Bunker connections (like Aegis) use a local relay bridge that ONLY works with the specified relay
          // We must NOT use backup relays for bunker connections
          const isBunkerConnection = !!(this.connection as any).signerPubkey;

          let publishRelays: string[];
          if (method === 'connect' || isBunkerConnection) {
            // Connect requests OR bunker connections: ONLY primary relay
            // Bunker signers (Aegis, etc) only listen to their specific relay, not backup relays
            publishRelays = [primaryRelay];
            if (isBunkerConnection) {
              console.log('📤 NIP-46: Bunker connection - publishing ONLY to primary relay (signer only listens here):', primaryRelay);
            } else {
              console.log('📤 NIP-46: Connect request - publishing ONLY to primary relay to avoid rate limits:', primaryRelay);
            }
          } else {
            // Other requests (nostrconnect://): primary + backups for redundancy
            publishRelays = [primaryRelay, ...backupRelays];
          }
          
          // Remove duplicates
          publishRelays = Array.from(new Set(publishRelays));
          
          console.log(`📤 NIP-46: Publishing request to relays (primary: ${primaryRelay}):`, {
            primaryRelay,
            totalRelays: publishRelays.length,
            relays: publishRelays,
            note: 'Primary relay is the one in the QR code - Amber will listen here',
          });
          
          // Filter out rate-limited relays and reorder to prioritize non-rate-limited ones
          const now = Date.now();
          publishRelays = publishRelays.filter(relay => {
            const rateLimitInfo = this.rateLimitedRelays.get(relay);
            if (!rateLimitInfo) return true;
            
            // Check if backoff period has expired
            if (now >= rateLimitInfo.until) {
              // Backoff expired, remove from rate-limited list
              this.rateLimitedRelays.delete(relay);
              console.log(`✅ NIP-46: Rate limit backoff expired for ${relay}, re-enabling`);
              return true;
            }
            
            // Still rate-limited, skip this relay
            const remainingMs = rateLimitInfo.until - now;
            console.log(`⏸️ NIP-46: Skipping rate-limited relay ${relay} (backoff expires in ${Math.ceil(remainingMs / 1000)}s)`);
            return false;
          });
          
          // Reorder: put primary relay first, then non-rate-limited relays
          // This ensures we prioritize the primary relay (the one in QR code) and working relays
          publishRelays.sort((a, b) => {
            if (a === primaryRelay) return -1;
            if (b === primaryRelay) return 1;
            // Move Damus to the end if it's not the primary relay (it's often rate-limited)
            if (a === 'wss://relay.damus.io' && a !== primaryRelay) return 1;
            if (b === 'wss://relay.damus.io' && b !== primaryRelay) return -1;
            return 0;
          });
          
          // Log which relay is primary
          console.log(`📤 NIP-46: Primary relay (from QR code): ${primaryRelay}`);
          if (publishRelays[0] !== primaryRelay) {
            console.warn(`⚠️ NIP-46: Primary relay is not first in publish list! Primary: ${primaryRelay}, First: ${publishRelays[0]}`);
          }
          
          if (publishRelays.length === 0) {
            // All relays are rate-limited, use them anyway but log a warning
            console.warn('⚠️ NIP-46: All relays are rate-limited, attempting anyway...');
            // For connect requests, only use primary relay even if rate-limited
            // For other requests, use primary + backups
            if (method === 'connect') {
              publishRelays = [primaryRelay];
            } else {
              publishRelays = [primaryRelay, ...backupRelays];
            }
          }
          
          console.log('📡 NIP-46: Publishing to relays:', {
            primaryRelay: primaryRelay,
            totalRelays: publishRelays.length,
            relays: publishRelays,
            note: `Primary relay (${primaryRelay}) is the one in the QR code - Amber will listen here. Backup relays are for redundancy.`,
          });
          
          const results = await this.relayClient!.publish(requestEvent, {
            relays: publishRelays,
            waitForRelay: true, // Wait for relay confirmation to ensure it's published
            timeout: 15000, // 15 second timeout for publish confirmation (increased from 10s)
          });
          
          // Log which relays successfully received the event
          const successfulRelays = results
            .map((result, index) => ({ result, relay: publishRelays[index] }))
            .filter(({ result }) => result.status === 'fulfilled')
            .map(({ relay }) => relay);
          
          const failedRelays = results
            .map((result, index) => ({ result, relay: publishRelays[index] }))
            .filter((item): item is { result: PromiseRejectedResult; relay: string } => item.result.status === 'rejected')
            .map(({ relay, result }) => ({ relay, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }));
          
          // Check for rate limit errors and add relays to backoff list
          failedRelays.forEach(({ relay, error }) => {
            const isRateLimit = this.isRateLimitError(error);
            if (isRateLimit) {
              const existingBackoff = this.rateLimitedRelays.get(relay);
              // Exponential backoff: double the backoff time each time
              const backoffMs = existingBackoff 
                ? Math.min(existingBackoff.backoffMs * 2, this.RATE_LIMIT_BACKOFF_MAX_MS)
                : this.RATE_LIMIT_BACKOFF_BASE_MS;
              
              const until = now + backoffMs;
              this.rateLimitedRelays.set(relay, { until, backoffMs });
              
              console.warn(`🚫 NIP-46: Rate limit detected for ${relay}, backing off for ${Math.ceil(backoffMs / 1000)}s (until ${new Date(until).toLocaleTimeString()})`);
            }
          });
          
          if (successfulRelays.length > 0) {
            console.log('✅ NIP-46: Event successfully published to relays:', successfulRelays);
            // Clear rate limit backoff for successfully published relays (they're working again)
            successfulRelays.forEach(relay => {
              if (this.rateLimitedRelays.has(relay)) {
                this.rateLimitedRelays.delete(relay);
                console.log(`✅ NIP-46: Cleared rate limit backoff for ${relay} (publish succeeded)`);
              }
            });
          }
          if (failedRelays.length > 0) {
            const rateLimitedCount = failedRelays.filter(({ error }) => this.isRateLimitError(error)).length;
            if (rateLimitedCount > 0) {
              console.warn(`⚠️ NIP-46: Failed to publish to ${failedRelays.length} relay(s) (${rateLimitedCount} rate-limited):`, failedRelays);
            } else {
              console.warn('⚠️ NIP-46: Failed to publish to some relays:', failedRelays);
            }
          }
          

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
          
          // For sign_event requests, provide additional guidance
          if (method === 'sign_event') {
            console.log('📱 NIP-46: Sign event request published to multiple relays. Important notes:');
            console.log('   1. Event published to relays:', publishRelays);
            console.log('   2. Successfully published to:', successfulRelays.length, 'relays');
            console.log('   3. Failed to publish to:', failedRelays.length, 'relays');
            console.log('   4. Event ID:', requestEvent.id);
            console.log('   5. Event pubkey (your app):', requestEvent.pubkey);
            console.log('   6. Event tags:', JSON.stringify(requestEvent.tags, null, 2));
            console.log('   7. Request ID (for matching response):', id);
            console.log('   8. ⚠️ CRITICAL: Signer must be subscribed to events with:');
            console.log('      - kind: 24133');
            console.log('      - #p tag matching signer\'s pubkey:', signerPubkey ? signerPubkey : 'N/A');
            console.log('   9. Check signer app on your phone RIGHT NOW:');
            console.log('      - Open signer app (Amber/Aegis/etc)');
            console.log('      - Check for notifications');
            console.log('      - Look for approval prompts');
            console.log('      - Check "Recent Requests" or activity log');
            console.log('   10. If signer doesn\'t show anything:');
            console.log('      - Signer might not be connected to any of these relays:', successfulRelays.join(', '));
            console.log('      - Signer might not be subscribed to events tagged with its pubkey');
            console.log('      - Check signer\'s relay connection status');
            console.log('   11. We\'re waiting for a response event with request ID:', id);
            console.log('   12. Response should come within 120 seconds if signer received and processed the request');
          }
          
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

    // If we have a saved pubkey (from restored connection), ensure relay is ready
    // We'll verify the pubkey when we actually need to use it (e.g., when signing)
    // This avoids timeouts when restoring connections
    if (this.connection.pubkey) {
      console.log('✅ NIP-46: Found saved user pubkey, ensuring relay is ready (will verify on first use)');
      console.log('✅ NIP-46: Using saved user pubkey (not app pubkey):', this.connection.pubkey.slice(0, 16) + '...');
      
      // For relay-based connections, ensure the relay client is initialized and connected
      if (!this.ws && this.connection.signerUrl && this.connection.signerUrl.startsWith('wss://')) {
        // If relay client doesn't exist yet, wait for it to be initialized
        // This can happen if authenticate() is called before startRelayConnection() completes
        if (!this.relayClient) {
          console.log('⏳ NIP-46: Relay client not initialized yet, waiting for connection setup...');
          // Wait up to 5 seconds for relay client to be initialized
          for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (this.relayClient) {
              console.log('✅ NIP-46: Relay client initialized');
              break;
            }
          }
          
          // If still not initialized, try to initialize it now
          if (!this.relayClient) {
            console.log('⚠️ NIP-46: Relay client still not initialized, initializing now...');
            await this.startRelayConnection(this.connection.signerUrl);
          }
        }
        
        // Now ensure relay is connected
        if (this.relayClient) {
          const connectedRelays = this.relayClient.getConnectedRelays?.() || [];
          if (connectedRelays.length === 0) {
            console.log('⏳ NIP-46: Relay not connected yet, waiting briefly...');
            // Wait up to 3 seconds for relay to connect
            for (let i = 0; i < 30; i++) {
              await new Promise(resolve => setTimeout(resolve, 100));
              const retryRelays = this.relayClient.getConnectedRelays?.() || [];
              if (retryRelays.length > 0) {
                console.log('✅ NIP-46: Relay connected');
                break;
              }
            }
          }
        }
      }
      
      this.connection.connected = true;
      this.connection.connectedAt = Date.now();
      return this.connection.pubkey;
    }

    // CRITICAL: For client-initiated connections (nostrconnect://), do NOT send connect requests
    // According to NIP-46 spec, in client-initiated flow:
    // 1. Client generates nostrconnect:// URI and shows QR code
    // 2. Remote-signer (Amber) scans QR code
    // 3. Amber sends a connect RESPONSE to the client
    // 4. Client receives response and gets signer's pubkey from event author
    //
    // The client should NEVER send connect requests - only wait for Amber's response
    // Reference: https://github.com/nostr-protocol/nips/blob/master/46.md

    // Check if this is a nostrconnect:// (client-initiated) connection
    // For bunker:// URIs, we have signerPubkey set and should send connect request
    // For nostrconnect://, we don't have signerPubkey and should wait for response
    const isBunkerConnection = !!(this.connection as any).signerPubkey;
    const isClientInitiated = !this.ws && this.relayClient && !isBunkerConnection;

    if (isClientInitiated) {
      console.log('⏳ NIP-46: Client-initiated connection (nostrconnect://) - waiting for signer to send connect response...');
      console.log('ℹ️ NIP-46: Client does NOT send connect requests per NIP-46 spec');
      console.log('ℹ️ NIP-46: Please ensure the signer has scanned the QR code and is connected');

      // Wait for connection to be established by Amber/Aegis
      // The handleRelayEvent method will process the signer's connect response and set pubkey
      const maxWaitTime = 120000; // 120 seconds (mobile signers can take time to respond)
      const checkInterval = 500; // Check every 500ms
      const startTime = Date.now();

      while (!this.connection.pubkey && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, checkInterval));

        // Log progress every 15 seconds
        const elapsed = Date.now() - startTime;
        if (elapsed > 0 && elapsed % 15000 < 500) {
          console.log(`⏳ NIP-46: Still waiting for signer response... (${Math.floor(elapsed / 1000)}s elapsed)`);
        }

        // Check if connection was established
        if (this.connection.pubkey) {
          console.log('✅ NIP-46: Connection established by signer, pubkey:', this.connection.pubkey.slice(0, 16) + '...');
          return this.connection.pubkey;
        }
      }

      // Timeout - connection not established
      throw new Error(
        'Connection timeout: Signer did not respond within 120 seconds.\n' +
        'Please ensure:\n' +
        '1. The signer (Aegis/Amber) is running and has approved the connection\n' +
        '2. The signer is connected to the relay specified in the connection string\n' +
        '3. The relay is accessible from both your app and the signer'
      );
    }

    // For bunker:// (remote-signer-initiated) connections
    // The connection is already established by the signer (that's what the bunker:// URI represents)
    // We should try to get the public key directly, not send a connect request
    // The secret in the bunker:// URI is used for authentication in requests, not for connect
    console.log('🔑 NIP-46: Bunker connection - attempting to get public key (connection already established by signer)...', {
      hasToken: !!this.connection.token,
      relayUrl: (this.connection as any).relayUrl || this.connection.signerUrl,
    });
    
    try {
      // Try to get the public key directly
      // If we get "no permission", the user needs to approve the connection in Amber/Aegis first
      const pubkey = await this.getPublicKey();
      
      if (this.connection) {
        this.connection.pubkey = pubkey;
        this.connection.connected = true;
        this.connection.connectedAt = Date.now();
      }
      
      console.log('✅ NIP-46: Bunker connection authenticated, received pubkey:', pubkey ? pubkey.slice(0, 16) + '...' : 'N/A');
      return pubkey;
    } catch (error) {
      // If get_public_key fails with "no permission", provide helpful error message
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('no permission') || errorMessage.includes('permission')) {
        throw new Error(
          'Connection not approved: Please approve the connection in Amber/Aegis first.\n' +
          'The bunker:// connection requires approval in your signer app before it can be used.'
        );
      }
      // For other errors, try the connect request as a fallback
      console.log('⚠️ NIP-46: get_public_key failed, trying connect request as fallback...', errorMessage);
      try {
        const pubkey = await this.sendRequest('connect', [this.connection.token]);
        if (this.connection) {
          this.connection.pubkey = pubkey;
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
        }
        return pubkey;
      } catch (connectError) {
        // If both fail, throw the original error with better context
        throw new Error(
          `Bunker connection failed: ${errorMessage}\n` +
          'Please ensure:\n' +
          '1. The connection is approved in Amber/Aegis\n' +
          '2. Amber/Aegis is connected to the relay: ' + ((this.connection as any).relayUrl || this.connection.signerUrl) + '\n' +
          '3. The secret in the bunker:// URI is correct'
        );
      }
    }
  }

  /**
   * Get public key from signer
   */
  async getPublicKey(): Promise<string> {
    // For relay-based connections that are already connected and have the user's pubkey
    // (not just the signer pubkey from the bunker URI), return it
    if (this.connection?.pubkey && this.connection?.connected && !this.ws) {
      return this.connection.pubkey;
    }

    // For WebSocket connections, authenticate first if needed
    if (this.ws && !this.connection?.connected) {
      await this.authenticate();
    }

    // For relay-based connections, request the user's public key via relay
    if (!this.ws && this.relayClient) {
      console.log('🔑 NIP-46: Requesting user public key from signer via relay...');
      // Request the public key via relay (this is the user's Nostr pubkey, not the signer app pubkey)
      const pubkey = await this.sendRequest('get_public_key', []);
      console.log('✅ NIP-46: Received user public key:', pubkey?.slice(0, 16) + '...');

      // Store it in the connection
      if (this.connection && pubkey) {
        this.connection.pubkey = pubkey; // User's Nostr account pubkey
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
    console.log('🔵 [NIP46-SIGN] signEvent called - starting signature request');
    
    if (!this.connection?.connected) {
      console.log('⚠️ [NIP46-SIGN] Connection not marked as connected, calling authenticate()');
      await this.authenticate();
    }

    // Get pubkey if not already available
    if (!this.connection?.pubkey) {
      console.log('⚠️ [NIP46-SIGN] Pubkey not available, calling getPublicKey()');
      await this.getPublicKey();
    } else {
      console.log('✅ [NIP46-SIGN] Pubkey already available, skipping getPublicKey()');
    }

    // Validate we have the pubkey
    if (!this.connection?.pubkey) {
      throw new Error('Signer public key not available. Please wait for the connection to be established.');
    }

    const signerPubkey = this.connection.pubkey;
    console.log('✅ [NIP46-SIGN] Proceeding with signEvent - pubkey confirmed:', signerPubkey.slice(0, 16) + '...');
    
    // CRITICAL: Verify we're using the user's pubkey, not Amber's pubkey
    console.error(`[NIP46-SIGN] Using pubkey for signing: ${signerPubkey.slice(0, 16)}...`);
    try {
      const npub = publicKeyToNpub(signerPubkey);
      console.error(`[NIP46-SIGN] Pubkey converts to npub: ${npub}`);
    } catch (e) {
      console.error(`[NIP46-SIGN] Failed to convert pubkey to npub:`, e);
    }

    // Prepare event for signing (without id and sig, but with pubkey for hash calculation)
    const eventToSign = {
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      created_at: event.created_at,
      pubkey: signerPubkey,
    };

    // Request signature from signer (send without pubkey as per NIP-46 spec)
    // CRITICAL: Ensure all required fields are present and valid to prevent Amber crashes
    const eventForSigner = {
      kind: event.kind,
      tags: Array.isArray(event.tags) ? event.tags : [],
      content: typeof event.content === 'string' ? event.content : '',
      created_at: typeof event.created_at === 'number' ? event.created_at : Math.floor(Date.now() / 1000),
    };

    // Validate event structure before sending (to prevent Amber crashes)
    if (typeof eventForSigner.kind !== 'number' || eventForSigner.kind < 0) {
      throw new Error(`Invalid event kind: ${eventForSigner.kind}. Must be a non-negative number.`);
    }
    if (!Array.isArray(eventForSigner.tags)) {
      throw new Error('Invalid event tags: must be an array');
    }
    if (typeof eventForSigner.content !== 'string') {
      throw new Error('Invalid event content: must be a string');
    }
    if (typeof eventForSigner.created_at !== 'number' || eventForSigner.created_at <= 0) {
      throw new Error(`Invalid event created_at: ${eventForSigner.created_at}. Must be a positive Unix timestamp.`);
    }

    console.log('✍️ NIP-46: Requesting signature for event:', {
      kind: eventForSigner.kind,
      tags: eventForSigner.tags,
      tagsCount: eventForSigner.tags.length,
      tagsDetail: eventForSigner.tags.map((tag, i) => ({
        index: i,
        type: tag[0],
        value: tag[1]?.slice(0, 32) + (tag[1]?.length > 32 ? '...' : ''),
        fullTag: tag,
      })),
      content: eventForSigner.content,
      contentLength: eventForSigner.content.length,
      createdAt: eventForSigner.created_at,
      pubkey: signerPubkey.slice(0, 16) + '...',
      note: 'This is the event structure being sent to Amber for signing. Compare with working app examples.',
    });

    console.log('📱 NIP-46: Sending sign_event request to signer. Check your phone for:');
    console.log('   1. Notification from signer app');
    console.log('   2. Approval prompt in signer (if set to manual)');
    console.log('   3. Event is being published to multiple relays (see logs above)');
    console.log('   4. ⚠️ If signer crashes, the event format might be incompatible - try a different event kind');
    console.log('   5. If you don\'t see a prompt, check:');
    console.log('      - Signer is connected to at least one of the relays we published to');
    console.log('      - Signer notification permissions are enabled');
    console.log('      - Signer is not auto-approving (check settings)');
    console.log('   6. The working app prompts every time - if ours doesn\'t, events may not be reaching signer');

    // Log the exact JSON being sent to help debug
    const eventJson = JSON.stringify(eventForSigner);
    console.log('📋 NIP-46: Exact event JSON being sent to signer:', eventJson);
    console.log('📋 NIP-46: This will be sent as sign_event([eventJson]) to signer via NIP-46');

    const signatureResponse = await this.sendRequest('sign_event', [eventJson]);

    console.log('🔍 NIP-46: Raw signature response:', {
      type: typeof signatureResponse,
      isString: typeof signatureResponse === 'string',
      isObject: typeof signatureResponse === 'object',
      length: typeof signatureResponse === 'string' ? signatureResponse.length : 'N/A',
      value: typeof signatureResponse === 'string' 
        ? signatureResponse.slice(0, 100) + '...' 
        : JSON.stringify(signatureResponse).slice(0, 200),
      firstChar: typeof signatureResponse === 'string' ? signatureResponse[0] : 'N/A',
      startsWithBrace: typeof signatureResponse === 'string' ? signatureResponse.trim().startsWith('{') : false,
    });

    // Handle different response formats
    // Signer may return:
    // 1. Just the signature (64-char hex string)
    // 2. A full signed event JSON string (Amber's format)
    // 3. An object with sig/signature field
    let signature: string;
    let fullSignedEvent: any = null;
    
    if (typeof signatureResponse === 'string') {
      // Check if it's a JSON string containing a full event (Amber's format)
      // Amber returns the full signed event as a JSON string in the result field
      const trimmed = signatureResponse.trim();
      const isLongJsonString = trimmed.startsWith('{') && trimmed.length > 100;
      
      console.log('🔍 NIP-46: Checking if response is JSON event string:', {
        length: trimmed.length,
        startsWithBrace: trimmed.startsWith('{'),
        firstChars: trimmed.slice(0, 50),
        shouldParse: isLongJsonString,
        willAttemptParse: isLongJsonString,
      });
      
      if (isLongJsonString) {
        try {
          const parsed = JSON.parse(trimmed);
          // Check if it looks like a full event (has id, sig, pubkey, kind, etc.)
          if (parsed && typeof parsed === 'object' && 'sig' in parsed && 'id' in parsed && 'kind' in parsed) {
            console.log('✅ NIP-46: Signer returned a full signed event JSON string');
            console.log('✅ NIP-46: Parsed full event structure:', {
              hasId: !!parsed.id,
              hasSig: !!parsed.sig,
              hasKind: !!parsed.kind,
              hasPubkey: !!parsed.pubkey,
              id: parsed.id?.slice(0, 16) + '...',
              kind: parsed.kind,
              sigLength: parsed.sig?.length,
              sigPreview: parsed.sig?.slice(0, 16) + '...',
            });
            fullSignedEvent = parsed;
            signature = parsed.sig;
            console.log('✅ NIP-46: Extracted signature from full event:', {
              eventId: parsed.id?.slice(0, 16) + '...',
              signatureLength: signature?.length,
              signaturePreview: signature?.slice(0, 16) + '...',
            });
          } else {
            console.log('⚠️ NIP-46: String looks like JSON but not a full event, treating as signature');
            signature = signatureResponse;
          }
        } catch (e) {
          console.log('⚠️ NIP-46: Failed to parse as JSON, treating as signature string:', e instanceof Error ? e.message : String(e));
          // Not valid JSON, treat as signature string
          signature = signatureResponse;
        }
      } else {
        // Short string, likely just the signature
        signature = signatureResponse;
      }
    } else if (signatureResponse && typeof signatureResponse === 'object') {
      // Some implementations might return { sig: "..." } or { signature: "..." }
      if ('sig' in signatureResponse && typeof signatureResponse.sig === 'string') {
        signature = signatureResponse.sig;
        // Check if it's a full event object
        if ('id' in signatureResponse && 'kind' in signatureResponse) {
          fullSignedEvent = signatureResponse;
        }
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

    // If we got a full signed event from signer, validate and use it directly
    if (fullSignedEvent && fullSignedEvent.id && fullSignedEvent.sig && fullSignedEvent.kind) {
      console.log('✅ NIP-46: Using full signed event from signer (early return):', {
        id: fullSignedEvent.id.slice(0, 16) + '...',
        kind: fullSignedEvent.kind,
        hasSig: !!fullSignedEvent.sig,
        sigLength: fullSignedEvent.sig.length,
        sigPreview: fullSignedEvent.sig.slice(0, 16) + '...',
        fullEvent: fullSignedEvent,
      });

      // Validate the event structure
      if (fullSignedEvent.sig && typeof fullSignedEvent.sig === 'string' && fullSignedEvent.sig.length >= 64 && /^[a-f0-9]+$/i.test(fullSignedEvent.sig)) {
        console.log('✅ NIP-46: Full event signature is valid, returning complete event from signer');
        return fullSignedEvent as Event;
      } else {
        console.warn('⚠️ NIP-46: Full event from signer has invalid signature, falling back to reconstruction:', {
          sigLength: fullSignedEvent.sig?.length,
          sigType: typeof fullSignedEvent.sig,
          sigPreview: fullSignedEvent.sig?.slice(0, 32),
        });
      }
    } else {
      console.log('ℹ️ NIP-46: No full signed event detected, will reconstruct from signature:', {
        hasFullSignedEvent: !!fullSignedEvent,
        hasId: !!fullSignedEvent?.id,
        hasSig: !!fullSignedEvent?.sig,
        hasKind: !!fullSignedEvent?.kind,
      });
    }

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

    console.log('✅ NIP-46: Constructed signed event - Final event structure:', {
      id: signedEvent.id,
      kind: signedEvent.kind,
      pubkey: signedEvent.pubkey,
      tags: signedEvent.tags,
      tagsCount: signedEvent.tags.length,
      tagsDetail: signedEvent.tags.map((tag, i) => ({
        index: i,
        type: tag[0],
        value: tag[1]?.slice(0, 32) + (tag[1]?.length > 32 ? '...' : ''),
        fullTag: tag,
      })),
      content: signedEvent.content,
      contentLength: signedEvent.content.length,
      created_at: signedEvent.created_at,
      sig: signedEvent.sig,
      fullEvent: signedEvent,
      note: 'Compare this structure with working app examples (like the kind 30315 event you showed) to ensure format matches.',
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


