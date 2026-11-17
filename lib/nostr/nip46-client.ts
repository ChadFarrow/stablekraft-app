/**
 * NIP-46 (Remote Signing) Client
 * Implements client-side protocol for communicating with remote signers like Amber
 * 
 * Protocol: https://github.com/nostr-protocol/nips/blob/master/46.md
 */

import { Event, getEventHash, Filter, EventTemplate, finalizeEvent } from 'nostr-tools';
import { nip44 } from 'nostr-tools';
import { paceRequest } from './nip46-pacing';
import { NostrClient } from './client';
import { RelayManager } from './relay';
import { saveNIP46Connection, loadNIP46Connection, getOrCreateAppKeyPair, clearNIP46Connection, NIP46Connection, getAppKeyPairHistory, AppKeyPair } from './nip46-storage';
import { npubToPublicKey, publicKeyToNpub, hexToBytes } from './keys';
import { isIOS } from '@/lib/utils/device';

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
  // Debug logging - only active when localStorage flag is set
  // Enable with: localStorage.setItem('nip46_debug', 'true')
  private static DEBUG = typeof window !== 'undefined' && localStorage.getItem('nip46_debug') === 'true';
  private debugLog(...args: any[]) {
    if (NIP46Client.DEBUG) console.log(...args);
  }

  // iOS Safari kills WebSocket connections after ~30 seconds when backgrounded
  // Use shorter threshold for iOS to detect stale connections faster
  private static readonly IOS_STALE_THRESHOLD_MS = 15000; // 15 seconds
  private static readonly DEFAULT_STALE_THRESHOLD_MS = 60000; // 60 seconds

  private connection: NIP46Connection | null = null;
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, { method: string; resolve: (value: any) => void; reject: (error: Error) => void; startTime?: number }> = new Map();
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
  private eventsByRelay: Map<string, number> = new Map(); // Track events by relay URL for debugging
  private lastRequestTime: Map<string, number> = new Map(); // Track last request time per method for rate limiting
  // Adaptive rate limiting: tracks actual signer response times
  private avgResponseTimeMs: number = 2000; // Start conservative
  private readonly MIN_RATE_LIMIT_MS = 500;  // Floor for fast signers (e.g., Primal with Full trust)
  private readonly MAX_RATE_LIMIT_MS = 2000; // Cap for slow signers
  private rateLimitedRelays: Map<string, { until: number; backoffMs: number }> = new Map(); // Track rate-limited relays with backoff
  private readonly RATE_LIMIT_BACKOFF_BASE_MS = 60000; // Start with 1 minute backoff
  private readonly RATE_LIMIT_BACKOFF_MAX_MS = 600000; // Max 10 minutes backoff
  private pubkeyMismatchCount: number = 0; // Track pubkey mismatch occurrences
  private mismatchDetected: boolean = false; // Flag to stop processing after mismatch
  private detectedOldPubkey: string | null = null; // Store the old pubkey we detected
  private connectionStartTime: number = 0; // Track when connection attempt started to filter old events
  private aggressiveModeLogged: boolean = false; // Track if we've already logged aggressive mode message
  private pendingRequestCleanupInterval: NodeJS.Timeout | null = null; // Periodic cleanup for orphaned requests
  private lastSuccessfulKeyPairIndex: number = -1; // Cache last-successful decryption keypair index
  private subscriptionSetupTime: number = 0; // Track when relay subscription was created
  // Known Amber pubkey from user's npub: npub12xwrqqxuee2k3452uuae7kp0g5yxgpapjrrrz2r0wx7v8pdqynqqc0ez5k
  private readonly knownAmberPubkey: string | null = (() => {
    try {
      const pubkey = npubToPublicKey('npub12xwrqqxuee2k3452uuae7kp0g5yxgpapjrrrz2r0wx7v8pdqynqqc0ez5k');
      this.debugLog(`[NIP46] Loaded known Amber pubkey: ${pubkey.slice(0, 16)}...`);
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
  async connect(signerUrl: string, token: string, connectImmediately: boolean = false, signerPubkey?: string, signerAppPubkey?: string): Promise<void> {
    if (this.connection && this.connection.connected) {
      await this.disconnect();
    }

    // Reset mismatch detection state for new connection attempt
    this.mismatchDetected = false;
    this.pubkeyMismatchCount = 0;
    this.eventCounter = 0;
    this.connectionStartTime = Date.now();
    this.debugLog('🔄 NIP-46: Reset mismatch detection state for new connection attempt');

    // Detect URI scheme: bunker:// vs nostrconnect:// vs direct URL
    if (signerUrl.startsWith('bunker://')) {
      this.debugLog('🔌 NIP-46: Detected bunker:// URI, parsing for nsecbunker connection');
      return this.connectBunker(signerUrl);
    } else if (signerUrl.startsWith('nostrconnect://')) {
      this.debugLog('🔌 NIP-46: Detected nostrconnect:// URI, using relay-based connection');
      // Extract relay URL from nostrconnect:// URI if needed
      // For now, assume signerUrl is already the relay URL
      // Pass signerPubkey if provided (for restoring saved connections)
      return this.connectNostrConnect(signerUrl, token, signerPubkey, signerAppPubkey);
    } else {
      // Direct URL connection (existing logic)
      return this.connectDirect(signerUrl, token, connectImmediately, signerPubkey, signerAppPubkey);
    }
  }

  /**
   * Get the actual relay URL from the connection
   * For bunker:// connections, use relayUrl if available, otherwise parse from signerUrl
   */
  private getRelayUrl(): string {
    if (!this.connection) {
      throw new Error('No connection configured');
    }
    
    // If relayUrl is stored separately (for bunker:// connections), use it
    const storedRelayUrl = (this.connection as any).relayUrl;
    if (storedRelayUrl) {
      // Validate it's a valid WebSocket URL
      if (storedRelayUrl.startsWith('wss://')) {
        return storedRelayUrl;
      }
      // If it's a bunker:// URI, we need to parse it (shouldn't happen, but handle it)
      if (storedRelayUrl.startsWith('bunker://')) {
        console.warn('⚠️ NIP-46: relayUrl field contains bunker:// URI, parsing...');
        // Fall through to parsing logic below
      } else {
        console.error('❌ NIP-46: Invalid relayUrl format:', storedRelayUrl);
        throw new Error(`Invalid relayUrl format: ${storedRelayUrl}. Expected wss:// URL.`);
      }
    }
    
    // If signerUrl is a bunker:// URI, parse it to get the relay URL
    if (this.connection.signerUrl?.startsWith('bunker://')) {
      try {
        const bunkerInfo = parseBunkerUri(this.connection.signerUrl);
        const relayUrl = bunkerInfo.relays[0];
        if (relayUrl && relayUrl.startsWith('wss://')) {
          // Store it for future use
          (this.connection as any).relayUrl = relayUrl;
          this.debugLog('✅ NIP-46: Parsed and stored relay URL from bunker:// URI:', relayUrl);
          return relayUrl;
        }
        throw new Error('No valid relay URL found in bunker:// URI');
      } catch (err) {
        console.error('❌ NIP-46: Failed to parse bunker:// URI to get relay URL:', err);
        throw new Error(`Failed to get relay URL from bunker:// URI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    // Otherwise, assume signerUrl is the relay URL (for non-bunker connections)
    // But validate it's a valid WebSocket URL
    if (this.connection.signerUrl && this.connection.signerUrl.startsWith('wss://')) {
      return this.connection.signerUrl;
    }

    // If signerUrl is a nostrconnect:// URI, extract relay from query params
    // Primal and other NIP-46 signers use: nostrconnect://<pubkey>?relay=wss://...
    if (this.connection.signerUrl?.startsWith('nostrconnect://')) {
      try {
        const url = new URL(this.connection.signerUrl.replace('nostrconnect://', 'http://'));
        const relayParam = url.searchParams.get('relay');
        if (relayParam) {
          const relayUrl = decodeURIComponent(relayParam);
          if (relayUrl.startsWith('wss://')) {
            // Store it for future use so we don't re-parse every time
            (this.connection as any).relayUrl = relayUrl;
            return relayUrl;
          }
        }
      } catch (err) {
        console.error('❌ NIP-46: Failed to parse nostrconnect:// URI to get relay URL:', err);
      }
      throw new Error(`Failed to extract relay URL from nostrconnect:// URI`);
    }

    // Last resort: if signerUrl is a bunker:// URI but we got here, something went wrong
    if (this.connection.signerUrl?.startsWith('bunker://')) {
      // Try one more time to parse it
      try {
        const bunkerInfo = parseBunkerUri(this.connection.signerUrl);
        const relayUrl = bunkerInfo.relays[0];
        if (relayUrl && relayUrl.startsWith('wss://')) {
          // Store it for future use
          (this.connection as any).relayUrl = relayUrl;
          this.debugLog('✅ NIP-46: Last resort - parsed and stored relay URL from bunker:// URI:', relayUrl);
          return relayUrl;
        }
      } catch (err) {
        console.error('❌ NIP-46: Failed to parse bunker:// URI as last resort:', err);
      }
      throw new Error(`Failed to extract relay URL from bunker:// URI: ${this.connection.signerUrl}`);
    }

    throw new Error(`Invalid relay URL: ${this.connection.signerUrl}. Expected wss://, nostrconnect://, or bunker:// URI.`);
  }

  /**
   * Connect using bunker:// URI (relay-based for mobile signers like Aegis)
   */
  private async connectBunker(bunkerUri: string): Promise<void> {
    // Clear rate limits for fresh connection attempt
    this.lastRequestTime.clear();
    this.debugLog('🔄 NIP-46: Cleared rate limits for fresh bunker connection');

    try {
      const bunkerInfo = parseBunkerUri(bunkerUri);
      this.debugLog('🔌 NIP-46: Parsed bunker:// URI:', {
        pubkey: bunkerInfo.pubkey.slice(0, 16) + '...',
        relayCount: bunkerInfo.relays.length,
        relays: bunkerInfo.relays,
        hasSecret: !!bunkerInfo.secret,
      });

      // Amber embeds multiple relays in its bunker:// URIs. Use ALL of them
      // for subscribe/publish so that if one relay is blocked (e.g. Firefox
      // blocks relay.primal.net) the connection still succeeds via another.
      const allBunkerRelays = bunkerInfo.relays;
      const primaryRelayUrl = allBunkerRelays[0];

      // Store connection info
      // Note: bunkerInfo.pubkey is the signer app's pubkey, not the user's Nostr account pubkey
      // We'll get the user's pubkey later via get_public_key request
      this.connection = {
        signerUrl: bunkerUri, // Store original bunker:// URI for restoration
        token: bunkerInfo.secret || '', // Use empty string if no secret provided
        pubkey: '', // Will be fetched via get_public_key
        connected: false,
        signerPubkey: bunkerInfo.pubkey, // Store signer app pubkey separately for targeting messages
        relayUrl: primaryRelayUrl, // Store primary relay URL for getRelayUrl()
        bunkerRelays: allBunkerRelays, // Store ALL relays for subscribe/publish
      } as any;

      // Warn about secretless bunker URIs (Aegis-style) — these require
      // manual approval in the signer app and are slower to connect.
      if (!bunkerInfo.secret) {
        console.warn('⚠️ NIP-46: Bunker URI has no secret= parameter. The signer will need to manually approve the connection request.');
      }

      // Use relay-based connection (not direct WebSocket) for mobile signers
      this.debugLog('🔌 NIP-46: Connecting via relay for mobile signer:', allBunkerRelays);
      this.debugLog('🔌 NIP-46: Signer app pubkey:', bunkerInfo.pubkey.slice(0, 16) + '...');

      // Connect ALL bunker relays in parallel, succeed if ANY opens.
      // startRelayConnection awaits only the primary relay; backup relays
      // connect in the background (see Fix 2). For bunker URIs we override
      // that: we connect all URI relays simultaneously and only require at
      // least one to open.
      this.debugLog('🔌 NIP-46: Connecting to all bunker relays in parallel:', allBunkerRelays);

      // Initialize relay client for all bunker relays
      if (this.relaySubscription) {
        try { this.relaySubscription(); this.relaySubscription = null; } catch {} // cleanup
      }
      if (this.relayClient) {
        try { await this.relayClient.disconnect(); } catch {} // cleanup
      }
      this.relayClient = new NostrClient(allBunkerRelays);

      // Connect all relays in parallel
      await this.relayClient.connectToRelays(allBunkerRelays);
      const connectedRelays = this.relayClient?.getConnectedRelays?.() || [];
      this.debugLog('🔌 NIP-46: Connected bunker relays:', connectedRelays);

      if (connectedRelays.length === 0) {
        throw new Error(`Failed to connect to any bunker relay. Tried: ${allBunkerRelays.join(', ')}`);
      }
      this.debugLog(`✅ NIP-46: ${connectedRelays.length}/${allBunkerRelays.length} bunker relays connected`);

      // Set up subscription on ALL connected bunker relays
      // (startRelayConnection handles subscription setup; we call it with the
      // primary relay but the relay client already has all relays connected)
      await this.startRelayConnection(primaryRelayUrl);

      // Log the app pubkey we're using so user can compare with signer
      const currentAppKeyPair = getOrCreateAppKeyPair();
      this.debugLog('🔑 NIP-46: Our app pubkey:', currentAppKeyPair.publicKey);

      // Track events received after this point
      const eventsBeforeConnect = this.eventCounter;

      // For bunker:// URIs, the CLIENT should initiate by sending a 'connect' request
      this.debugLog('📤 NIP-46: Sending connect request to signer (bunker:// flow)...');
      try {
        const appKeyPair = getOrCreateAppKeyPair();
        const appPubkey = appKeyPair.publicKey;

        const permissions = 'sign_event:22242,sign_event:1,sign_event:7,get_public_key';
        const connectParams = bunkerInfo.secret
          ? [appPubkey, bunkerInfo.secret, permissions]
          : [appPubkey, '', permissions];

        this.debugLog('📤 NIP-46: Connect params:', {
          appPubkey: appPubkey.slice(0, 16) + '...',
          hasSecret: !!bunkerInfo.secret,
          signerPubkey: bunkerInfo.pubkey.slice(0, 16) + '...',
          relays: allBunkerRelays,
        });

        // For secretless bunker URIs, use a shorter fail-fast timeout (25s)
        // since the signer must manually approve — if it doesn't respond
        // quickly, something is wrong.
        const connectTimeout = bunkerInfo.secret ? undefined : 25000;
        const connectPromise = this.sendRequest('connect', connectParams);

        let response: any;
        if (connectTimeout) {
          response = await Promise.race([
            connectPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(
                `Bunker connection timed out after ${connectTimeout / 1000}s. ` +
                `This bunker URI has no secret= parameter — the signer app must manually approve. ` +
                `Check your signer for a pending connection request.`
              )), connectTimeout)
            ),
          ]);
        } else {
          response = await connectPromise;
        }
        this.debugLog('✅ NIP-46: Connect request acknowledged by signer:', response);

        // Mark as connected after successful connect
        if (this.connection) {
          this.connection.connected = true;
          this.connection.connectedAt = Date.now();
        }

        // After connect succeeds, immediately fetch the user's pubkey
        this.debugLog('📤 NIP-46: Now requesting user pubkey via get_public_key...');
        try {
          const userPubkey = await this.sendRequest('get_public_key', []);
          this.debugLog('✅ NIP-46: Got user pubkey:', userPubkey?.slice(0, 16) + '...');
          if (this.connection && userPubkey) {
            this.connection.pubkey = userPubkey;
            this.debugLog('✅ NIP-46: Stored user pubkey in connection');
          }
        } catch (pubkeyError) {
          console.warn('⚠️ NIP-46: Failed to get pubkey after connect:', pubkeyError);
        }
      } catch (connectError) {
        console.warn('⚠️ NIP-46: Connect request failed or timed out:', connectError);

        const eventsAfterConnect = this.eventCounter;
        const eventsReceived = eventsAfterConnect - eventsBeforeConnect;
        const postConnectRelays = this.relayClient?.getConnectedRelays?.() || [];
        this.debugLog('📊 NIP-46: Post-connect diagnostics:', {
          eventsReceivedDuringConnect: eventsReceived,
          relaysStillConnected: postConnectRelays,
          lastEventTime: this.lastEventTime > 0 ? `${Math.floor((Date.now() - this.lastEventTime) / 1000)}s ago` : 'never',
        });

        if (postConnectRelays.length === 0) {
          console.warn('⚠️ NIP-46: All bunker relays disconnected during connect request!');
        }

        // Don't throw - the signer might still respond to get_public_key
      }
    } catch (error) {
      console.error('❌ NIP-46: Failed to parse bunker:// URI:', error);
      throw new Error(`Failed to parse bunker:// URI: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Connect using nostrconnect:// URI (relay-based)
   */
  private async connectNostrConnect(nostrConnectUri: string, token: string, savedPubkey?: string, savedSignerAppPubkey?: string): Promise<void> {
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

    // Restore the signer service's actual pubkey if available (from previous session)
    // This is critical for sign_event requests — without it, restored connections
    // encrypt/tag to the user's pubkey instead of the signer's, causing timeouts.
    if (savedSignerAppPubkey) {
      (this.connection as any).signerPubkey = savedSignerAppPubkey;
      (this.connection as any).actualSignerAppPubkey = savedSignerAppPubkey;
      this.debugLog('✅ NIP-46: Restored signer app pubkey:', savedSignerAppPubkey.slice(0, 16) + '...');
    }

    if (savedPubkey) {
      this.debugLog('✅ NIP-46: Restoring connection with saved user pubkey:', savedPubkey.slice(0, 16) + '...');
      this.debugLog('ℹ️ NIP-46: Connection will be verified after relay connects');
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

    // Store the extracted relay URL on the connection so getRelayUrl() can find it
    // Without this, getRelayUrl() can't resolve nostrconnect:// URIs and all
    // downstream relay checks (isConnected, ensureSubscription, sendRequest) fail
    if (relayUrl.startsWith('wss://') && this.connection) {
      (this.connection as any).relayUrl = relayUrl;
    }

    return this.startRelayConnection(relayUrl);
  }

  /**
   * Connect using direct URL (existing logic)
   */
  private async connectDirect(signerUrl: string, token: string, connectImmediately: boolean, signerPubkey?: string, signerAppPubkey?: string): Promise<void> {
    this.connection = {
      signerUrl,
      token,
      pubkey: signerPubkey,
      connected: false,
    };

    // Restore the signer service's actual pubkey if available (from previous session)
    if (signerAppPubkey) {
      (this.connection as any).signerPubkey = signerAppPubkey;
      (this.connection as any).actualSignerAppPubkey = signerAppPubkey;
      this.debugLog('✅ NIP-46: Restored signer app pubkey for direct connection:', signerAppPubkey.slice(0, 16) + '...');
    }

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
    
    // CRITICAL: Ensure we're using a valid WebSocket URL, not a bunker:// URI
    // If relayUrl is a bunker:// URI, extract the actual relay URL
    if (relayUrl.startsWith('bunker://')) {
      console.warn('⚠️ NIP-46: startRelayConnection received bunker:// URI, extracting relay URL...');
      relayUrl = this.getRelayUrl(); // This will parse and return the actual wss:// URL
    }
    
    // Validate it's a valid WebSocket URL
    if (!relayUrl.startsWith('wss://')) {
      throw new Error(`Invalid relay URL passed to startRelayConnection: ${relayUrl}. Expected wss:// URL.`);
    }

    // Clean up any existing relay subscription first
    if (this.relaySubscription) {
      this.debugLog('🧹 NIP-46: Cleaning up existing relay subscription');
      try {
        this.relaySubscription();
        this.relaySubscription = null;
      } catch (err) {
        console.warn('Failed to cleanup existing subscription:', err);
      }
    }

    // Clean up existing relay client if any
    if (this.relayClient) {
      this.debugLog('🧹 NIP-46: Disconnecting existing relay client');
      try {
        await this.relayClient.disconnect();
      } catch (err) {
        console.warn('Failed to disconnect existing relay client:', err);
      }
    }

    // Initialize relay client
    this.debugLog('🔌 NIP-46: Initializing relay client for:', relayUrl);
    this.relayClient = new NostrClient([relayUrl]);
    
    this.debugLog('🔌 NIP-46: Connecting to relay...');
    try {
      await this.relayClient.connectToRelays([relayUrl]);
      this.debugLog('✅ NIP-46: Successfully connected to relay');
      
      // Verify connection by checking if relay is actually connected
      const connectedRelays = this.relayClient.getConnectedRelays?.() || [];
      this.debugLog('🔍 NIP-46: Connected relays:', connectedRelays);
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
        this.debugLog('✅ NIP-46: Using persistent app key pair for connection');
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
    this.debugLog('📡 NIP-46: Setting up subscription filters:', {
      appPubkey: appPubkey.slice(0, 16) + '...',
      appPubkeyFull: appPubkey,
      relayUrl: relayUrl,
      note: 'App pubkey is for NIP-46 communication. User\'s Nostr account pubkey will be received from Amber later.',
    });
    this.debugLog('🎯 NIP-46: We will listen for events tagged with OUR pubkey:', appPubkey);
    this.debugLog('   - If Aegis responds to a DIFFERENT pubkey, we will NOT receive it!');
    
    // Build subscription filters based on what we know about the signer
    const knownSignerPubkey = (this.connection as any)?.signerPubkey;
    const filters: Filter[] = [
      {
        kinds: [24133], // NIP-46 request/response events
        '#p': [appPubkey], // Events tagged with our app public key (recipient)
      },
    ];

    if (knownSignerPubkey) {
      // We know the signer pubkey — add a tight filter for events from them
      filters.push({
        kinds: [24133],
        authors: [knownSignerPubkey],
      });
    } else {
      // During initial connection (waiting for QR scan), use broad filter
      // to catch connection events from unknown signers
      filters.push({
        kinds: [24133],
      });
    }

    this.debugLog('🔍 NIP-46: Subscribing to relay events:', {
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
    this.debugLog('⏳ NIP-46: Waiting for connection event from signer...');

    // Check if this is a bunker:// connection (has signerPubkey)
    const isBunkerConnection = !!(this.connection as any).signerPubkey;

    // For bunker connections, use ALL relays from the bunker URI.
    // Amber embeds multiple relays and if the first is blocked (e.g. Firefox
    // blocks relay.primal.net), subscribing to all gives us a fallback.
    const allBunkerRelays: string[] = (this.connection as any).bunkerRelays || [];

    // Get backup relays for non-bunker connections
    const { getDefaultRelays } = await import('./relay');
    const defaultRelays = getDefaultRelays();
    const backupRelays = isBunkerConnection ? [] : defaultRelays.filter(url => url !== relayUrl).slice(0, 2);

    let subscribeRelays: string[];
    if (isBunkerConnection && allBunkerRelays.length > 0) {
      // For bunker connections, subscribe to ALL relays from the URI
      subscribeRelays = allBunkerRelays;
      this.debugLog(`✅ NIP-46: Bunker connection - subscribing to ALL URI relays:`, {
        relays: allBunkerRelays,
        count: allBunkerRelays.length,
      });
    } else if (isBunkerConnection) {
      // Fallback for bunker connections without stored relays
      subscribeRelays = [relayUrl];
      this.debugLog(`✅ NIP-46: Bunker connection - subscribing to primary relay only:`, relayUrl);
    } else {
      // For other connections (nostrconnect://), subscribe to primary relay AND backup relays
      // This increases the chance of receiving events if relay connectivity is inconsistent
      subscribeRelays = [relayUrl, ...backupRelays]; // Primary first, then backups

      this.debugLog(`✅ NIP-46: Subscribing to MULTIPLE RELAYS for better connectivity:`, {
        primary: relayUrl,
        backups: backupRelays,
        total: subscribeRelays.length,
        note: 'Primary relay is from QR code. Backup relays help if primary fails or signer uses a different relay.',
      });
    }
    
    // Await ONLY the primary relay — this is the critical path for QR display speed.
    // Backup relays are connected in the background so they don't block the UI.
    this.debugLog(`🔌 NIP-46: Connecting to primary relay:`, relayUrl);
    try {
      await this.relayClient.connectToRelays([relayUrl]);
      const connectedRelays = this.relayClient.getConnectedRelays();

      // Verify the primary relay is actually connected
      if (!connectedRelays.includes(relayUrl)) {
        const helpMessage = `Try regenerating your bunker:// URI in your signer app with a different relay like wss://nos.lol or wss://relay.damus.io`;
        const errorMsg = `Primary relay ${relayUrl} failed to connect. ${helpMessage}`;
        console.error(`❌ NIP-46: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      this.debugLog(`✅ NIP-46: Primary relay ${relayUrl} is connected and ready`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`❌ NIP-46: Failed to connect to primary relay ${relayUrl}:`, errorMsg);
      const helpMessage = `The relay "${relayUrl}" may be offline or unreachable. Try regenerating your bunker:// URI in your signer app (Aegis/Amber) with a different relay like wss://nos.lol or wss://relay.damus.io`;
      throw new Error(`Failed to connect to relay ${relayUrl}. ${helpMessage}`);
    }

    // Fire backup relay connections in background — don't block QR display
    if (backupRelays.length > 0) {
      this.relayClient.connectToRelays(backupRelays).then(() => {
        const connectedBackups = backupRelays.filter(url =>
          (this.relayClient?.getConnectedRelays() || []).includes(url)
        );
        if (connectedBackups.length > 0) {
          this.debugLog(`✅ NIP-46: Background-connected ${connectedBackups.length} backup relay(s):`, connectedBackups);
        }
      }).catch((err) => {
        console.warn('⚠️ NIP-46: Backup relay connection failed (non-fatal):', err);
      });
    }

    // Track subscription start time for debugging
    const subscriptionStartTime = Date.now();
    this.debugLog('📡 NIP-46: Creating subscription at', new Date(subscriptionStartTime).toISOString());
    
    
    this.subscriptionSetupTime = Date.now();
    this.relaySubscription = this.relayClient.subscribe({
      relays: subscribeRelays,
      filters,
      onEvent: (event: Event) => {
        try {
          // LOG EVERY EVENT RECEIVED (for debugging Aegis connection)
          const eventPTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
          this.debugLog('📨 NIP-46: RAW EVENT RECEIVED:', {
            eventId: event.id.slice(0, 16) + '...',
            kind: event.kind,
            from: event.pubkey.slice(0, 16) + '...',
            fromFull: event.pubkey,
            pTags: eventPTags,
            pTagsFull: eventPTags.map(p => p),
            contentPreview: event.content.substring(0, 100),
            ourPubkey: appPubkey,
            isTaggedForUs: eventPTags.includes(appPubkey),
          });

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

          // Log for bunker relay debugging
          const bunkerRelayUrl = (this.connection as any)?.relayUrl;
          if (bunkerRelayUrl && bunkerRelayUrl.includes('localrelay')) {
            this.debugLog('🎯 NIP-46: Event received (bunker relay in use):', {
              eventId: event.id.slice(0, 16) + '...',
              totalEventsNow: this.eventCounter,
              bunkerRelay: bunkerRelayUrl,
              note: 'This is good! We ARE receiving events while waiting for bunker response.',
            });
          }
          
          // Check if this event is for us (tagged with our pubkey) BEFORE doing expensive logging
          const isForUs = event.tags.some(tag => tag[0] === 'p' && tag[1] === appPubkey);
          const isFromUs = event.pubkey === appPubkey;
          
          // Check connection state
          const hasPendingRequests = this.pendingRequests.size > 0;
          const hasActiveConnection = this.connection?.connected && this.connection?.pubkey;
          const isWaitingForConnection = !hasActiveConnection && !hasPendingRequests;

          // Get the known signer pubkey (stored after successful connect)
          // NOTE: For bunker:// connections, signerPubkey is initially set to the USER's pubkey from URI
          // But the actual SIGNER APP pubkey is different - we learn it from the first response
          const knownSignerPubkey = (this.connection as any)?.signerPubkey;
          const actualSignerAppPubkey = (this.connection as any)?.actualSignerAppPubkey; // Set after first response
          const isFromKnownSigner = (knownSignerPubkey && event.pubkey === knownSignerPubkey) ||
                                    (actualSignerAppPubkey && event.pubkey === actualSignerAppPubkey);

          // Check if this is a bunker:// connection (bunker connections have signerPubkey set from URI)
          const isBunkerConnection = !!(this.connection as any)?.signerPubkey &&
                                     this.connection?.signerUrl?.startsWith('bunker://');

          // CRITICAL: After connection is established, ONLY process events from the known signer
          // This prevents processing noise from other NIP-46 signers on public relays
          // BUT: For bunker:// connections waiting for first response, be more permissive
          const shouldFilterBySigner = hasActiveConnection && !isBunkerConnection && knownSignerPubkey;
          if (shouldFilterBySigner && !isFromKnownSigner && !isFromUs) {
            // Event is from an unknown signer - silently ignore it
            // Only log occasionally to avoid spam
            if (this.eventCounter % 10 === 0) {
              this.debugLog(`🚫 NIP-46: Ignoring event from unknown signer ${event.pubkey.slice(0, 16)}... (expected ${knownSignerPubkey.slice(0, 16)}...)`);
            }
            return;
          }

          // For bunker:// connections, store the actual signer app pubkey from the first response we can decrypt
          if (isBunkerConnection && !actualSignerAppPubkey && hasPendingRequests && !isFromUs) {
            // This might be the signer's response - try to decrypt and if successful, store their pubkey
            this.debugLog(`🔍 NIP-46: Bunker connection - checking if event from ${event.pubkey.slice(0, 16)}... is from our signer`);
          }

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
          
          // Check if this event is from the known signer (either hardcoded or from connection)
          const isFromKnownAmber = this.knownAmberPubkey && event.pubkey === this.knownAmberPubkey;
          // Also check dynamic signer pubkey from connection
          const isFromConnectedSigner = isFromKnownSigner;
          
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
          
          // Process events from known signer (either hardcoded Amber or connected signer)
          if (isFromKnownAmber || isFromConnectedSigner) {
            this.debugLog(`✅ NIP-46: Processing event from known signer: ${event.pubkey.slice(0, 16)}...`);
            this.handleRelayEvent(event, connectionInfo, decryptionSucceeded ? decryptedContent : undefined);
            return;
          }

          // Process connection events
          if (decryptionSucceeded && looksLikeConnectionEvent) {
            this.handleRelayEvent(event, connectionInfo, decryptedContent);
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
          this.debugLog('✅ NIP-46: Event passed filter, processing...');
          this.handleRelayEvent(event, connectionInfo, decryptionSucceeded ? decryptedContent : undefined);
        } else if (isFromUs) {
          this.debugLog('ℹ️ NIP-46: Ignoring event from us (our own request)');
        } else if (!isForUs && !isFromUs) {
          // Event not tagged for us - when waiting for connection, be more permissive
          // Process events with encrypted content that might be connection events
          // This is critical for detecting Amber's connection when events aren't properly tagged
          const isWaitingForConnection = !hasActiveConnection && !hasPendingRequests;

          if (isWaitingForConnection) {
            // When waiting for connection, process events with encrypted content
            // They might be connection events from Amber that aren't tagged properly
            if (decryptionSucceeded && looksLikeConnectionEvent) {
              this.debugLog('🔍 NIP-46: Processing untagged event while waiting for connection (looks like connection event)');
              this.handleRelayEvent(event, connectionInfo, decryptedContent);
              return;
            } else if (hasEncryptedContent && !decryptionSucceeded) {
              // Try to decrypt - might be a connection event
              this.debugLog('🔍 NIP-46: Attempting to process untagged encrypted event while waiting for connection');
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
            this.debugLog('ℹ️ NIP-46: Event received but not tagged for us. Event details:', {
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
                      this.debugLog('📋 NIP-46: Parsed untagged event as plain JSON');
                    } catch (jsonErr) {
                      throw decryptErr; // Re-throw original error
                    }
                  }
                } else {
                  // Try plain JSON
                  try {
                    content = JSON.parse(event.content);
                    this.debugLog('📋 NIP-46: Parsed untagged event as plain JSON');
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
                this.debugLog('⚠️ NIP-46: Event looks like a connection/response event but not tagged for us. Processing anyway...', {
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
                this.handleRelayEvent(event, connectionInfo, content);
              } else if (hasPendingGetPublicKey && content.result) {
                // AGGRESSIVE: If we have pending get_public_key and this has ANY result, try processing it
                this.handleRelayEvent(event, connectionInfo, content);
              } else if (hasPendingSignEvent && content.result && looksLikeSignature) {
                // AGGRESSIVE: If we have pending sign_event and this looks like a signature, try processing it
                this.handleRelayEvent(event, connectionInfo, content);
              } else {
                const hasPendingSignEvent = Array.from(this.pendingRequests.values()).some(p => p.method === 'sign_event');
                if (hasPendingSignEvent) {
                  this.debugLog('⚠️ NIP-46: Event is not for us and not a connection/response event, but we have pending sign_event. Event details:', {
                    eventId: event.id.slice(0, 16) + '...',
                    eventPubkey: event.pubkey.slice(0, 16) + '...',
                    kind: event.kind,
                    contentLength: event.content.length,
                    tags: event.tags.map(t => [t[0], t[1]?.slice(0, 16) + '...']),
                    note: 'This event was ignored, but we are waiting for a sign_event response. If Amber sent a response, it might be in a different format.',
                  });
                } else {
                  this.debugLog('ℹ️ NIP-46: Event is not for us and not a connection/response event, ignoring');
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
              
              this.debugLog('ℹ️ NIP-46: Event content is not parseable, ignoring:', e instanceof Error ? e.message : String(e));
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
        this.debugLog('✅ NIP-46: Subscription EOSE (End of Stored Events)');
        this.debugLog('📊 NIP-46: Subscription statistics:', {
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

    this.debugLog('✅ NIP-46: Subscription created successfully. Listening for connection on relay:', relayUrl);

    // Start periodic cleanup for orphaned pending requests
    this.startPendingRequestCleanup();

    // For bunker:// URIs (Aegis, nsecbunker), the connect request is sent in connectBunker()
    // For nostrconnect:// URIs, wait for the signer to initiate the connection
    if ((this.connection as any).signerPubkey && !this.connection.pubkey) {
      this.debugLog('🔑 NIP-46: Bunker connection - subscription ready, connect request will be sent by connectBunker()');
    } else if (!this.connection.pubkey) {
      this.debugLog('⏳ NIP-46: Waiting for signer to initiate connection (nostrconnect:// flow)...');
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
      this.debugLog('🔓 NIP-46: Using PLAIN TEXT for connect request (no signer pubkey available):', {
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
        
        this.debugLog('🔐 NIP-46: Encrypted request content with NIP-44:', {
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

    this.debugLog('🏗️ NIP-46: Creating event with:', {
      method,
      requestId,
      hasPTag: !!signerPubkey,
      pTagValue: signerPubkey || 'none',
      tags: tags,
      appPubkey: appPubkey.slice(0, 16) + '...',
    });

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
  private handleRelayEvent(event: Event, connectionInfo: any, preDecrypted?: any): void {
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
      // Use pre-decrypted content if available (avoids double decryption)
      let content;
      let decryptedContent: string | null = null;

      if (preDecrypted) {
        content = preDecrypted;
        decryptedContent = JSON.stringify(preDecrypted);
      }

      if (!content) {
      try {
        // First, try to decrypt as NIP-44 encrypted content
        // The content is encrypted from signer's pubkey to our app's pubkey
        const signerPubkey = event.pubkey; // The signer's public key (who sent this event)
        const appPrivateKey = connectionInfo.privateKey; // Our app's private key

        this.debugLog('🔐 NIP-46: Attempting to decrypt NIP-44 content:', {
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

              // Try last-successful keypair first (cached index) to avoid linear search
              if (this.lastSuccessfulKeyPairIndex >= 0 && this.lastSuccessfulKeyPairIndex < keyPairHistory.length) {
                const cached = keyPairHistory[this.lastSuccessfulKeyPairIndex];
                if (pTagPubkey === cached.publicKey) {
                  try {
                    const cachedKeyBytes = hexToBytes(cached.privateKey);
                    const conversationKey = nip44.getConversationKey(cachedKeyBytes, signerPubkey);
                    decryptedContent = nip44.decrypt(event.content, conversationKey);
                    content = JSON.parse(decryptedContent);
                    // Update localStorage and connectionInfo
                    localStorage.setItem('nostr_nip46_app_keypair', JSON.stringify(cached));
                    if (connectionInfo) {
                      connectionInfo.privateKey = cached.privateKey;
                      connectionInfo.publicKey = cached.publicKey;
                    }
                  } catch {
                    // Cached keypair failed, fall through to linear search
                  }
                }
              }

              // Linear search through remaining keypairs if cache miss
              if (!decryptedContent) {
                for (let i = 0; i < keyPairHistory.length; i++) {
                  const oldKeyPair = keyPairHistory[i];
                  if (pTagPubkey === oldKeyPair.publicKey) {
                    try {
                      const oldAppPrivateKeyBytes = hexToBytes(oldKeyPair.privateKey);
                      const conversationKey = nip44.getConversationKey(oldAppPrivateKeyBytes, signerPubkey);
                      decryptedContent = nip44.decrypt(event.content, conversationKey);
                      content = JSON.parse(decryptedContent);

                      // Cache this index for next time
                      this.lastSuccessfulKeyPairIndex = i;

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
                      this.debugLog(`[NIP46-SIGNER-CACHE] ✅ Cleared saved connection - user will need to reconnect`);
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
              this.debugLog('📋 NIP-46: Parsed content as plain JSON (not encrypted):', {
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
                      this.debugLog(`[NIP46-SIGNER-CACHE] ✅ Cleared saved connection - user will need to reconnect`);
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
          this.debugLog('✅ NIP-46: Event content appears to be a signature, creating response object');
          content = { 
            id: event.id, // Use event ID as request ID
            result: event.content 
          };
        } else if (event.content === 'network-check') {
          // Ignore network-check messages
          this.debugLog('ℹ️ NIP-46: Ignoring network-check message');
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
      } // end if (!content) - pre-decrypted content was available

      // IMPORTANT: Skip events that are requests (have 'method' field) - these are our own requests
      // We only want to process responses (have 'result' or 'error' field)
      if (content.method && !content.result && !content.error) {
        this.debugLog('ℹ️ NIP-46: Ignoring request event (this is our own request, not a response):', {
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
                  this.debugLog(`[NIP46-GETPUBKEY] User\'s pubkey converts to npub: ${npub}`);
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
        this.debugLog(`[NIP46-SIGNER] Event #${this.eventCounter} is Amber-compatible response`);
        this.debugLog('🔵 [NIP46Client] Amber-compatible response (no method field), inferring type from context');
        this.debugLog('🔵 [NIP46Client] Handling Amber-compatible response', {
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
            this.debugLog(`[NIP46-CONNECT] Event #${this.eventCounter} is CONNECT response - secret matches!`);
            this.debugLog('🔵 [NIP46Client] Inferred connect response from secret match');
            // This is a connect response - the result is the secret, which confirms connection
            // We still need to get the public key, so we'll handle this in the connection event section
            // For now, mark that we've received the connect confirmation
          } 
          // Check if this is a get_public_key response (result is a 64-char hex string OR a JSON string containing the pubkey)
          else if (looksLikeGetPublicKeyResponse) {
            this.debugLog('🔵 [NIP46Client] Inferred get_public_key response from string pubkey (Amber compatibility)');
            // This is a get_public_key response - the result is the pubkey
            // Try to resolve any pending get_public_key requests immediately
            const pendingGetPublicKeyRequest = Array.from(this.pendingRequests.entries()).find(([reqId, pending]) => {
              return pending.method === 'get_public_key';
            });
            
            if (pendingGetPublicKeyRequest && extractedPubkey) {
              const [reqId, pending] = pendingGetPublicKeyRequest;
              
              this.debugLog(`[NIP46-GETPUBKEY] Resolving get_public_key with pubkey: ${extractedPubkey.slice(0, 16)}...`);
              this.debugLog('🔵 [NIP46Client] Found pending get_public_key request, resolving immediately:', {
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
        this.debugLog('🔍 NIP-46: Checking if response matches pending request:', {
          responseId: content.id,
          pendingRequestIds: Array.from(this.pendingRequests.keys()),
          pendingRequestMethods: Array.from(this.pendingRequests.values()).map(p => p.method),
          hasMatch: this.pendingRequests.has(content.id),
        });

        if (this.pendingRequests.has(content.id)) {
          // Log all pending request IDs for debugging
          const pendingRequestIds = Array.from(this.pendingRequests.keys());
          this.debugLog('🔍 NIP-46: Checking for matching pending request:', {
            responseId: content.id,
            pendingRequestIds,
            hasMatchingRequest: this.pendingRequests.has(content.id),
            allPendingIds: pendingRequestIds,
          });
          
          const pending = this.pendingRequests.get(content.id);
          if (pending) {
            this.pendingRequests.delete(content.id);

            // Adaptive rate limiting: update average response time
            const requestStartTime = (pending as any).startTime;
            if (requestStartTime) {
              const actualResponseTime = Date.now() - requestStartTime;
              this.avgResponseTimeMs = Math.max(
                this.MIN_RATE_LIMIT_MS,
                Math.min(this.MAX_RATE_LIMIT_MS, (this.avgResponseTimeMs + actualResponseTime) / 2)
              );
            }

            // Store the actual signer app pubkey from successful responses for ALL connection types
            // This allows us to filter out noise from other signers after we know who we're talking to
            // Critical for nostrconnect:// (Primal) connections too — without this, restored
            // connections lose the signer pubkey and sign_event requests get encrypted/tagged
            // with the user's pubkey instead of the signer's, causing timeouts.
            if (this.connection && !(this.connection as any).actualSignerAppPubkey) {
              (this.connection as any).actualSignerAppPubkey = event.pubkey;
              this.debugLog(`🔑 NIP-46: Stored actual signer app pubkey: ${event.pubkey.slice(0, 16)}...`);
            }

            this.debugLog('✅ NIP-46: Found matching pending request, processing response:', {
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
              this.debugLog('🎉 [NIP46-SIGN] SIGN_EVENT RESPONSE RECEIVED!', {
                requestId: content.id,
                hasResult: !!content.result,
                resultType: typeof content.result,
                resultLength: typeof content.result === 'string' ? content.result.length : 'N/A',
                resultPreview: typeof content.result === 'string' ? content.result.slice(0, 32) + '...' : JSON.stringify(content.result).slice(0, 100),
                note: 'This should be the signature string from Amber',
              });
            }
            
            if (content.error) {
              const errorMessage = content.error.message || content.error || '';
              const errorStr = typeof errorMessage === 'string' ? errorMessage.toLowerCase() : String(errorMessage).toLowerCase();

              // "already connected" is actually success for connect requests
              // Amber returns this when the connection is already approved
              if (pending.method === 'connect' && errorStr.includes('already connected')) {
                this.debugLog('✅ NIP-46: "already connected" response - treating as success for connect request');
                if ((pending as any).statusInterval) {
                  clearInterval((pending as any).statusInterval);
                }
                pending.resolve('ack'); // Treat as ACK
              } else {
                console.error('❌ NIP-46: Error in response:', content.error);
                if ((pending as any).statusInterval) {
                  clearInterval((pending as any).statusInterval);
                }
                pending.reject(new Error(`NIP-46 error: ${content.error.message || content.error} (code: ${content.error.code || 'unknown'})`));
              }
            } else {
              this.debugLog('✅ NIP-46: Resolving pending request:', {
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
                      this.debugLog('✅ NIP-46: Found result in parsed event.content:', parsedContent.result);
                      if ((pending as any).statusInterval) {
                        clearInterval((pending as any).statusInterval);
                      }
                      pending.resolve(parsedContent.result);
                      return;
                    }
                  } catch (e) {
                    // Not JSON, might be plain text
                    if (event.content.length === 64 && /^[a-f0-9]{64}$/i.test(event.content)) {
                      this.debugLog('✅ NIP-46: Event content appears to be a signature:', event.content.slice(0, 16) + '...');
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
                // For connect requests with "ack" result, resolve immediately so authenticate() can proceed
                if (pending.method === 'connect' && content.result === 'ack') {
                  this.debugLog('✅ NIP-46: Connect request received "ack" - resolving to proceed with get_public_key');
                  if ((pending as any).statusInterval) {
                    clearInterval((pending as any).statusInterval);
                  }
                  pending.resolve('ack');
                  return;
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
          this.debugLog('⚠️ NIP-46: Response ID does not match any pending request:', {
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
              this.debugLog('🔵 [NIP46Client] Amber fallback: Resolving get_public_key request despite ID mismatch:', {
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
                  this.debugLog('🔵 [NIP46Client] Amber fallback: Detected sign_event response as JSON string with full event');
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
              this.debugLog('🔵 [NIP46Client] Amber fallback: Resolving sign_event request (ID may not match):', {
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

      this.debugLog('🔍 NIP-46: Checking if event is connection event:', {
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

      // Check if there's already a pending get_public_key request (authenticate() already sent one)
      const hasPendingGetPublicKey = Array.from(this.pendingRequests.values()).some(req => req.method === 'get_public_key');

      if (isConnectResponse && !hasUserPubkey && !alreadyProcessedConnect && !hasPendingGetPublicKey) {
        this.debugLog(`[NIP46-CONNECT] Event #${this.eventCounter} - CONNECT response detected! Requesting public key...`);
        this.debugLog('🔵 [NIP46Client] Connect response received, requesting public key from', event.pubkey.slice(0, 16) + '...');

        // CRITICAL: Store the SIGNER's pubkey from the connect response event so we can filter subsequent events
        // This is the signer app's pubkey (Primal, Amber, etc.) - NOT the user's Nostr account pubkey
        // We must store this separately because the user's pubkey will be retrieved via get_public_key
        if (this.connection) {
          // Store signer's pubkey in signerPubkey field (same as bunker:// connections use)
          (this.connection as any).signerPubkey = event.pubkey;
          this.connection.connected = true; // Mark as connected
          console.log(`[NIP46-CONNECT] Stored signer's pubkey for event filtering: ${event.pubkey.slice(0, 16)}...`);
          this.debugLog(`🔑 NIP-46: Will only process events from this signer pubkey: ${event.pubkey}`);
        }

        // Request public key and wait for it to complete
        // CRITICAL: We need to resolve any pending connect requests with the actual pubkey, not "ack"
        this.sendRequest('get_public_key', []).then((pubkey: string) => {
          console.log(`[NIP46-SUCCESS] Got public key from Amber: ${pubkey.slice(0, 16)}...`);
          this.debugLog('🔵 [NIP46Client] Successfully authenticated with Amber pubkey:', pubkey);
          
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
            console.log(`[NIP46-SUCCESS] Using user's pubkey: ${pubkey.slice(0, 16)}... (Amber's pubkey was: ${amberPubkey.slice(0, 16)}...)`);
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
                this.debugLog(`🔄 NIP-46: New connection created for existing user account (pubkey: ${pubkey.slice(0, 16)}...)`);
                this.debugLog(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
                this.debugLog(`✅ NIP-46: Recognizing as same account - user pubkey matches: ${pubkey.slice(0, 16)}...`);
              }
              
              saveNIP46Connection({
                token: this.connection.token,
                pubkey: pubkey, // User's Nostr account pubkey (from Amber)
                signerUrl: this.connection.signerUrl,
                connected: true,
                connectedAt: Date.now(),
                relayUrl: (this.connection as any).relayUrl, // Save relay URL for bunker:// connections
                signerAppPubkey: (this.connection as any).signerPubkey || (this.connection as any).actualSignerAppPubkey, // Signer's actual pubkey
              });
              this.debugLog('💾 NIP-46: Saved connection to localStorage:', {
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
            this.debugLog('🔵 [NIP46Client] Resolving pending connect request with user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
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
            this.debugLog('🔵 [NIP46Client] Completing authentication with server for user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
            this.debugLog('📋 NIP-46: This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.');
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
      } else if (isConnectResponse && hasPendingGetPublicKey) {
        // authenticate() already sent get_public_key, skip duplicate request from event handler
        this.debugLog('ℹ️ NIP-46: Skipping duplicate get_public_key request (authenticate() already sent one)');
      }
      
      // Handle Amber get_public_key response - complete connection
      // Only handle if it wasn't already processed via pending request mechanism
      // (check if there's no matching pending request, or if we don't have pubkey yet)
      const wasProcessedAsPendingRequest = content.id && this.pendingRequests.has(content.id);
      if (isGetPublicKeyResponse && content.result && !this.connection?.pubkey && !wasProcessedAsPendingRequest) {
        const pubkey = content.result;
        this.debugLog('🔵 [NIP46Client] Successfully authenticated with Amber pubkey:', pubkey);
        
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
              this.debugLog(`🔄 NIP-46: New connection created for existing user account (pubkey: ${pubkey.slice(0, 16)}...)`);
              this.debugLog(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
            }
            
            saveNIP46Connection({
              token: this.connection.token,
              pubkey: pubkey, // User's Nostr account pubkey (from Amber)
              signerUrl: this.connection.signerUrl,
              connected: true,
              connectedAt: Date.now(),
              relayUrl: (this.connection as any).relayUrl, // Save relay URL for bunker:// connections
              signerAppPubkey: (this.connection as any).signerPubkey || (this.connection as any).actualSignerAppPubkey,
            });
            this.debugLog('💾 NIP-46: Saved connection to localStorage:', {
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
          this.debugLog('🔵 [NIP46Client] Completing authentication with server for user pubkey (Nostr account):', pubkey.slice(0, 16) + '...');
          this.debugLog('📋 NIP-46: This is the user\'s Nostr account pubkey from Amber. Multiple connections with same pubkey = same account.');
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

        this.debugLog('✅ NIP-46: Connected via relay, signer pubkey (user\'s Nostr account):', signerPubkey);
        this.debugLog('📋 NIP-46: Connection details:', {
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
          this.debugLog('💾 NIP-46: Stored user pubkey in connection object:', {
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
              this.debugLog(`🔄 NIP-46: New connection created for existing user account (pubkey: ${signerPubkey.slice(0, 16)}...)`);
              this.debugLog(`📋 NIP-46: This is the same Nostr account, just a new connection token. Old token: ${existingConnection.token.slice(0, 20)}..., New token: ${this.connection.token.slice(0, 20)}...`);
              this.debugLog(`✅ NIP-46: Recognizing as same account - user pubkey matches: ${signerPubkey.slice(0, 16)}...`);
            }
            
            saveNIP46Connection({
              token: this.connection.token,
              pubkey: signerPubkey, // User's Nostr account pubkey (from Amber)
              signerUrl: this.connection.signerUrl,
              connected: true,
              connectedAt: Date.now(),
              relayUrl: (this.connection as any).relayUrl, // Save relay URL for bunker:// connections
              signerAppPubkey: (this.connection as any).signerPubkey || (this.connection as any).actualSignerAppPubkey,
            });
            this.debugLog('💾 NIP-46: Saved connection to localStorage:', {
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
          this.debugLog('📞 NIP-46: Calling connection callback with user pubkey (Nostr account):', signerPubkey.slice(0, 16) + '...');
          this.debugLog('📞 NIP-46: Connection state before callback:', {
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
              this.debugLog('✅ NIP-46: Pubkey confirmed in connection, invoking callback');
              callback(signerPubkey);
            } else {
              console.error('❌ NIP-46: Pubkey not available when calling callback. Connection state:', {
                hasConnection: !!this.connection,
                hasPubkey: !!this.connection?.pubkey,
              });
            }
          }, 100); // Increased delay to ensure pubkey is stored
        } else if (this.connection?.connected && this.connection?.pubkey) {
          this.debugLog('ℹ️ NIP-46: Connection already established, skipping callback (already connected)');
        }
      } else {
        this.debugLog('ℹ️ NIP-46: Event received but not a connection event:', content);
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
   * Get the time of the last received event
   * Used by visibility change handlers to check connection staleness
   */
  getLastEventTime(): number {
    return this.lastEventTime;
  }

  /**
   * Check if the connection is stale and reconnect if needed
   * Called proactively when the app returns from background (visibility change)
   * @param isIOS - Whether the device is iOS (uses shorter threshold)
   * @returns true if reconnection was performed
   */
  async checkAndReconnectIfNeeded(_isIOS: boolean = false): Promise<boolean> {
    try {
      const relayUrl = this.getRelayUrl();
      if (!relayUrl || !relayUrl.startsWith('wss://')) return false;

      // Check actual WebSocket state (getConnectedRelays now filters by relay.connected)
      const connectedRelays = this.relayClient?.getConnectedRelays?.() || [];
      if (connectedRelays.includes(relayUrl)) {
        // WebSocket is alive — no reconnection needed
        return false;
      }

      // WebSocket is dead — full reconnect required (relay + subscription)
      this.debugLog('🔄 NIP-46: Relay WebSocket dead on visibility change, reconnecting');
      await this.startRelayConnection(relayUrl);
      this.lastEventTime = Date.now();
      this.debugLog('✅ NIP-46: Proactive reconnection successful');
      return true;
    } catch (err) {
      console.error('❌ NIP-46: Proactive reconnection failed:', err);
    }

    return false;
  }

  /**
   * Establish WebSocket connection
   */
  private async establishConnection(): Promise<void> {
    if (!this.connection) {
      throw new Error('No connection configured');
    }

    // Check if this is a nsecbunker connection (pubkey already known from bunker:// URI)
    // For bunker:// connections, use getRelayUrl() to get the actual relay URL
    const relayUrl = this.getRelayUrl();
    const isNsecbunker = !!this.connection.pubkey && relayUrl.startsWith('wss://');

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(relayUrl);

        ws.onopen = () => {
          this.debugLog('✅ NIP-46: WebSocket connected');
          this.ws = ws;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          
          // For nsecbunker, pubkey is already known from URI
          // Mark as connected and trigger callback immediately
          if (isNsecbunker && this.connection?.pubkey) {
            this.debugLog('🔌 NIP-46: nsecbunker connection - pubkey already known from URI:', this.connection.pubkey.slice(0, 16) + '...');
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
                  signerAppPubkey: (this.connection as any).signerPubkey || (this.connection as any).actualSignerAppPubkey,
                });
                this.debugLog('💾 NIP-46: Saved nsecbunker connection to localStorage');
              } catch (err) {
                console.error('❌ NIP-46: Failed to save connection:', err);
              }
            }
            
            // Trigger connection callback if set
            if (this.onConnectionCallback && this.connection.pubkey) {
              this.debugLog('📞 NIP-46: Calling nsecbunker connection callback with pubkey:', this.connection.pubkey.slice(0, 16) + '...');
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
          this.debugLog('⚠️ NIP-46: WebSocket closed');
          this.ws = null;
          if (this.connection) {
            this.connection.connected = false;
          }
          this.stopHeartbeat();

          // Attempt to reconnect if connection was established
          if (this.connection?.connected && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.debugLog(`🔄 NIP-46: Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
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
        this.debugLog('✅ NIP-46: Authenticated, pubkey:', response.result);
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
      // For bunker connections, ensure the bunker relay specifically is connected
      const isBunkerConnection = !!(this.connection as any)?.signerPubkey;
      const bunkerRelayUrl = (this.connection as any)?.relayUrl;

      // Ensure relay is actually connected before sending request
      const connectedRelays = this.relayClient.getConnectedRelays?.() || [];

      // Check if bunker relay is connected (for bunker:// connections)
      if (isBunkerConnection && bunkerRelayUrl) {
        const bunkerRelayConnected = connectedRelays.includes(bunkerRelayUrl);
        // Check if the relay WebSocket is actually dead (not just idle)
        // NIP-46 communication is sporadic — minutes of silence between auth and signing is normal.
        // Only reconnect if the relay WebSocket is genuinely dead, not just because no events arrived.
        const relayManager = (this.relayClient as any)?.relayManager;
        const isRelayWebSocketAlive = relayManager?.isConnected?.(bunkerRelayUrl) === true;

        // Only consider stale if relay is disconnected OR WebSocket is dead
        // Don't force reconnection just because of idle time — that disrupts the subscription
        const needsReconnection = !bunkerRelayConnected || !isRelayWebSocketAlive;

        if (needsReconnection) {
          const reason = !bunkerRelayConnected ? 'disconnected' : 'WebSocket dead';
          console.warn(`⚠️ NIP-46: Bunker relay ${bunkerRelayUrl} is ${reason}. Reconnecting with full subscription...`);
          try {
            // Use startRelayConnection which handles BOTH relay connection AND subscription setup
            await this.startRelayConnection(bunkerRelayUrl);

            // Verify connection
            const updatedRelays = this.relayClient?.getConnectedRelays?.() || [];
            if (!updatedRelays.includes(bunkerRelayUrl)) {
              console.error(`❌ NIP-46: Failed to reconnect to bunker relay ${bunkerRelayUrl}`);
              throw new Error(`Bunker relay disconnected and reconnection failed. Please try reconnecting with your signer.`);
            }
            this.debugLog(`✅ NIP-46: Reconnected to bunker relay ${bunkerRelayUrl} with fresh subscription`);

            // Update lastEventTime to prevent immediate stale detection
            this.lastEventTime = Date.now();

            // Wait a moment for subscription to be fully active
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (reconnectErr) {
            console.error('❌ NIP-46: Bunker relay reconnection failed:', reconnectErr);
            throw new Error(`Bunker relay connection lost. Please try reconnecting with your signer.`);
          }
        }
      } else if (connectedRelays.length === 0) {
        console.warn('⚠️ NIP-46: Relay client exists but not connected, waiting...');
        // Wait up to 2 seconds for relay to connect
        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const retryRelays = this.relayClient.getConnectedRelays?.() || [];
          if (retryRelays.length > 0) {
            this.debugLog('✅ NIP-46: Relay connected, proceeding with request');
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
      this.pendingRequests.set(id, { method, resolve, reject, startTime: Date.now() });

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

    // Use the signer service's actual pubkey for targeting sign_event requests.
    // Priority: signerPubkey (from connect response or bunker URI) > actualSignerAppPubkey
    // (from first successful response) > user's pubkey (fallback, may not work for all signers)
    const signerPubkey = (this.connection as any).signerPubkey || (this.connection as any).actualSignerAppPubkey || this.connection.pubkey;

    // Ensure relay is still connected - reconnect if needed (before creating Promise)
    try {
      const relayManager = (this.relayClient as any).relayManager;
      if (relayManager) {
        let relayUrl = this.getRelayUrl();
        // Debug: Log what we're checking
        this.debugLog('🔍 NIP-46: Checking relay connection status:', {
          relayUrl: relayUrl,
          signerUrl: this.connection.signerUrl,
          hasRelayUrlField: !!(this.connection as any).relayUrl,
          relayUrlField: (this.connection as any).relayUrl,
        });
        
        // CRITICAL: Double-check that relayUrl is valid - if getRelayUrl() somehow returned bunker://, fix it
        if (relayUrl.startsWith('bunker://')) {
          console.error('❌ NIP-46: getRelayUrl() returned bunker:// URI! This should never happen. Attempting to fix...');
          // Try to get relayUrl from connection object directly
          const storedRelayUrl = (this.connection as any).relayUrl;
          if (storedRelayUrl && storedRelayUrl.startsWith('wss://')) {
            relayUrl = storedRelayUrl;
            this.debugLog('✅ NIP-46: Fixed relayUrl from connection object:', relayUrl);
          } else {
            // Parse from signerUrl
            try {
              const bunkerInfo = parseBunkerUri(this.connection.signerUrl);
              relayUrl = bunkerInfo.relays[0];
              // Store it for future use
              (this.connection as any).relayUrl = relayUrl;
              this.debugLog('✅ NIP-46: Fixed relayUrl by parsing bunker:// URI:', relayUrl);
            } catch (parseErr) {
              throw new Error(`Failed to extract relay URL from bunker:// URI: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
            }
          }
        }
        
        // Final validation
        if (!relayUrl.startsWith('wss://')) {
          throw new Error(`Invalid relay URL: ${relayUrl}. Expected wss:// URL.`);
        }
        
        const isRelayConnected = relayManager.isConnected(relayUrl);

        if (!isRelayConnected) {
          this.debugLog('⚠️ NIP-46: Relay WebSocket is dead, reconnecting:', {
            relayUrl: relayUrl,
          });
          await this.startRelayConnection(relayUrl);
          // Update lastEventTime after successful reconnection
          this.lastEventTime = Date.now();
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

    this.debugLog('📤 NIP-46: Creating relay request:', {
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

    // Adaptive pacing: requests of one method go at least one window apart
    // (500–2000ms, from the signer's measured response time). A request that
    // comes too soon WAITS for its slot — it used to throw, which failed the
    // list publish of every heart tap and every Private-mode sync. The slot is
    // reserved before the wait, so callers that queue up go in order. `connect`
    // is never paced. See lib/nostr/nip46-pacing.ts.
    const currentRateLimit = Math.max(this.MIN_RATE_LIMIT_MS, Math.min(this.MAX_RATE_LIMIT_MS, this.avgResponseTimeMs));
    const { sendAt, waitMs } = paceRequest({
      method,
      now: Date.now(),
      last: this.lastRequestTime.get(method),
      limitMs: currentRateLimit,
    });
    this.lastRequestTime.set(method, sendAt);
    if (waitMs > 0) {
      this.debugLog(`⏳ NIP-46: ${method} waits ${waitMs}ms for its slot (adaptive limit ${currentRateLimit}ms)`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

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

      this.debugLog('⏳ NIP-46: Waiting for response to request:', {
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
          this.debugLog('⏳ NIP-46: Still waiting for response...', {
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
        this.debugLog(`ℹ️ NIP-46: Calling ${method} without signer pubkey (this is expected for initial connection)`);
        this.debugLog('   - Request will be published without p tag (or with app pubkey as placeholder)');
        this.debugLog('   - Signer should find it by listening to all kind 24133 events');
        this.debugLog('   - Encryption uses app pubkey as placeholder (signer may not decrypt, but should still respond)');
      }
      
      // Per NIP-46 spec and nostrify implementation:
      // - ALWAYS tag events with signer pubkey when we have it (from bunker:// URI)
      // - This is how Amber/signers find the requests meant for them
      // - For bunker:// connections, signerPubkey comes from the URI itself
      const pubkeyForRequest = signerPubkey;  // Tag with signer pubkey if we have it

      this.debugLog('📋 NIP-46: Request details:', {
        method,
        hasSignerPubkey: !!signerPubkey,
        usingPubkeyForRequest: pubkeyForRequest ? 'signer' : 'none (no p tag)',
        pubkeyForRequest: pubkeyForRequest ? pubkeyForRequest.slice(0, 16) + '...' : 'N/A (no p tag)',
        signerUrl: this.connection?.signerUrl?.slice(0, 50) + '...',
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
      
      this.debugLog('📤 NIP-46: Publishing request event:', {
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
          
          // CRITICAL: Get the actual relay URL (not bunker:// URI)
          // For bunker:// connections, signerUrl is the bunker:// URI, not the relay URL
          // We need to use getRelayUrl() to get the actual wss:// URL
          let primaryRelay = this.getRelayUrl();
          
          // CRITICAL SAFETY CHECK: Ensure primaryRelay is never a bunker:// URI
          if (primaryRelay.startsWith('bunker://')) {
            console.error('❌ NIP-46: getRelayUrl() returned bunker:// URI! This should never happen. Attempting to fix...');
            // Try to get relayUrl from connection object directly
            const storedRelayUrl = (this.connection as any).relayUrl;
            if (storedRelayUrl && storedRelayUrl.startsWith('wss://')) {
              primaryRelay = storedRelayUrl;
              this.debugLog('✅ NIP-46: Fixed primaryRelay from connection object:', primaryRelay);
            } else {
              // Parse from signerUrl as last resort
              try {
                const bunkerInfo = parseBunkerUri(this.connection.signerUrl);
                primaryRelay = bunkerInfo.relays[0];
                this.debugLog('✅ NIP-46: Fixed primaryRelay by parsing bunker:// URI:', primaryRelay);
              } catch (parseErr) {
                throw new Error(`Failed to extract relay URL from bunker:// URI: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
              }
            }
          }
          
          // Final validation
          if (!primaryRelay.startsWith('wss://') && !primaryRelay.startsWith('ws://')) {
            throw new Error(`Invalid primaryRelay URL: ${primaryRelay}. Expected wss:// or ws:// URL.`);
          }
          
          // For 'connect' requests, only use primary relay (Amber is listening here)
          // Publishing to multiple relays causes rate limits and doesn't help
          // For other requests, we can use backup relays for redundancy
          // wss://relay.nsec.app dropped 2026-07-26 — returning 502; see the
          // note in lib/nostr/relay.ts getDefaultRelays().
          const backupRelays = [
            'wss://nos.lol',              // Popular and stable
            'wss://relay.snort.social',   // Snort's relay
            'wss://nostr.oxtr.dev',       // Alternative relay
            'wss://relay.primal.net',     // Primal relay
            'wss://theforest.nostr1.com', // Forest relay
            'wss://relay.damus.io',       // Damus relay (moved to end due to frequent rate limiting)
          ].filter(r => r !== primaryRelay); // Remove primary if it's in the backup list
          
          // Check if this is a bunker:// connection (has signerPubkey)
          const isBunkerConnection = !!(this.connection as any).signerPubkey;
          // For bunker connections, publish to ALL relays from the URI
          const bunkerRelays: string[] = (this.connection as any).bunkerRelays || [];

          let publishRelays: string[];
          if (isBunkerConnection && bunkerRelays.length > 0) {
            // Bunker connections: publish to ALL URI relays for redundancy
            // If the first relay is blocked (e.g. Firefox blocks relay.primal.net),
            // the signer will still get the request via another relay.
            publishRelays = bunkerRelays;
            this.debugLog('📤 NIP-46: Bunker connection - publishing to ALL URI relays:', bunkerRelays);
          } else if (method === 'connect' || isBunkerConnection) {
            // Connect requests or bunker fallback: primary relay only
            publishRelays = [primaryRelay];
            this.debugLog('📤 NIP-46: Publishing to primary relay only:', primaryRelay);
          } else {
            // Other requests (nostrconnect://): primary + backups for redundancy
            publishRelays = [primaryRelay, ...backupRelays];
          }
          
          // Remove duplicates
          publishRelays = Array.from(new Set(publishRelays));
          
          this.debugLog(`📤 NIP-46: Publishing request to relays (primary: ${primaryRelay}):`, {
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
              this.debugLog(`✅ NIP-46: Rate limit backoff expired for ${relay}, re-enabling`);
              return true;
            }
            
            // Still rate-limited, skip this relay
            const remainingMs = rateLimitInfo.until - now;
            this.debugLog(`⏸️ NIP-46: Skipping rate-limited relay ${relay} (backoff expires in ${Math.ceil(remainingMs / 1000)}s)`);
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
          this.debugLog(`📤 NIP-46: Primary relay (from QR code): ${primaryRelay}`);
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
          
          // CRITICAL SAFETY CHECK: Ensure all relay URLs are valid wss:// URLs, not bunker:// URIs
          const invalidRelays = publishRelays.filter(relay => !relay.startsWith('wss://') && !relay.startsWith('ws://'));
          if (invalidRelays.length > 0) {
            console.error('❌ NIP-46: Invalid relay URLs detected in publishRelays!', {
              invalidRelays,
              allRelays: publishRelays,
              primaryRelay,
            });
            // Fix invalid relays by using getRelayUrl() or parsing bunker:// URIs
            publishRelays = publishRelays.map(relay => {
              if (relay.startsWith('bunker://')) {
                console.warn(`⚠️ NIP-46: Found bunker:// URI in publishRelays, fixing: ${relay}`);
                const fixedRelay = this.getRelayUrl();
                this.debugLog(`✅ NIP-46: Fixed relay URL: ${relay} -> ${fixedRelay}`);
                return fixedRelay;
              }
              if (!relay.startsWith('wss://') && !relay.startsWith('ws://')) {
                console.error(`❌ NIP-46: Invalid relay URL format: ${relay}`);
                // Use primaryRelay as fallback
                return primaryRelay;
              }
              return relay;
            });
            // Remove duplicates after fixing
            publishRelays = Array.from(new Set(publishRelays));
            this.debugLog('✅ NIP-46: Fixed publishRelays:', publishRelays);
          }
          
          this.debugLog('📡 NIP-46: Publishing to relays:', {
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
            this.debugLog('✅ NIP-46: Event successfully published to relays:', successfulRelays);
            // Clear rate limit backoff for successfully published relays (they're working again)
            successfulRelays.forEach(relay => {
              if (this.rateLimitedRelays.has(relay)) {
                this.rateLimitedRelays.delete(relay);
                this.debugLog(`✅ NIP-46: Cleared rate limit backoff for ${relay} (publish succeeded)`);
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
          

          this.debugLog('✅ NIP-46: Request event published:', {
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
            this.debugLog('📱 NIP-46: Sign event request published to multiple relays. Important notes:');
            this.debugLog('   1. Event published to relays:', publishRelays);
            this.debugLog('   2. Successfully published to:', successfulRelays.length, 'relays');
            this.debugLog('   3. Failed to publish to:', failedRelays.length, 'relays');
            this.debugLog('   4. Event ID:', requestEvent.id);
            this.debugLog('   5. Event pubkey (your app):', requestEvent.pubkey);
            this.debugLog('   6. Event tags:', JSON.stringify(requestEvent.tags, null, 2));
            this.debugLog('   7. Request ID (for matching response):', id);
            this.debugLog('   8. ⚠️ CRITICAL: Signer must be subscribed to events with:');
            this.debugLog('      - kind: 24133');
            this.debugLog('      - #p tag matching signer\'s pubkey:', signerPubkey ? signerPubkey : 'N/A');
            this.debugLog('   9. Check signer app on your phone RIGHT NOW:');
            this.debugLog('      - Open signer app (Amber/Aegis/etc)');
            this.debugLog('      - Check for notifications');
            this.debugLog('      - Look for approval prompts');
            this.debugLog('      - Check "Recent Requests" or activity log');
            this.debugLog('   10. If signer doesn\'t show anything:');
            this.debugLog('      - Signer might not be connected to any of these relays:', successfulRelays.join(', '));
            this.debugLog('      - Signer might not be subscribed to events tagged with its pubkey');
            this.debugLog('      - Check signer\'s relay connection status');
            this.debugLog('   11. We\'re waiting for a response event with request ID:', id);
            this.debugLog('   12. Response should come within 120 seconds if signer received and processed the request');
          }
          
          // Log a reminder about what we're waiting for
          this.debugLog('⏳ NIP-46: Now waiting for response event with matching request ID:', {
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
              this.debugLog(`🔄 NIP-46: Connection error detected, retrying (attempt ${attempt + 1}/2)...`);
              try {
                await this.startRelayConnection(this.getRelayUrl());
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
            this.debugLog(`🔄 NIP-46: Connection error caught, retrying (attempt ${attempt + 1}/2)...`);
            try {
              await this.startRelayConnection(this.getRelayUrl());
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
      this.debugLog('✅ NIP-46: Found saved user pubkey, ensuring relay is ready (will verify on first use)');
      this.debugLog('✅ NIP-46: Using saved user pubkey (not app pubkey):', this.connection.pubkey.slice(0, 16) + '...');
      
      // For relay-based connections, ensure the relay client is initialized and connected
      const relayUrl = this.getRelayUrl();
      if (!this.ws && relayUrl && relayUrl.startsWith('wss://')) {
        // If relay client doesn't exist yet, wait for it to be initialized
        // This can happen if authenticate() is called before startRelayConnection() completes
        if (!this.relayClient) {
          this.debugLog('⏳ NIP-46: Relay client not initialized yet, waiting for connection setup...');
          // Wait up to 5 seconds for relay client to be initialized
          for (let i = 0; i < 50; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (this.relayClient) {
              this.debugLog('✅ NIP-46: Relay client initialized');
              break;
            }
          }
          
          // If still not initialized, try to initialize it now
          if (!this.relayClient) {
            this.debugLog('⚠️ NIP-46: Relay client still not initialized, initializing now...');
            await this.startRelayConnection(relayUrl);
          }
        }
        
        // Now ensure relay is connected — check actual WebSocket state, not just
        // the relayClient object.  iOS Safari kills WebSockets when the PWA is
        // backgrounded; the relayClient object survives but its socket is CLOSED.
        // In that case we must call startRelayConnection() to create a fresh socket.
        if (this.relayClient) {
          let relayAlive = false;

          // Primary check: ask the relay manager for real WebSocket readyState
          try {
            const relayManager = (this.relayClient as any).relayManager;
            relayAlive = relayManager?.isConnected?.(relayUrl) === true;
          } catch {
            // Fall back to the connected-relays list
            const connectedRelays = this.relayClient.getConnectedRelays?.() || [];
            relayAlive = connectedRelays.length > 0;
          }

          if (!relayAlive) {
            this.debugLog('⏳ NIP-46: Relay not connected, waiting briefly before forcing reconnect...');
            // Give the existing socket a short chance (e.g. reconnect in progress)
            for (let i = 0; i < 15; i++) {
              await new Promise(resolve => setTimeout(resolve, 100));
              try {
                const rm = (this.relayClient as any).relayManager;
                if (rm?.isConnected?.(relayUrl) === true) {
                  relayAlive = true;
                  this.debugLog('✅ NIP-46: Relay reconnected on its own');
                  break;
                }
              } catch { /* ignore */ }
            }

            // If still dead after 1.5 s, force a fresh relay connection
            if (!relayAlive) {
              this.debugLog('⚠️ NIP-46: Relay WebSocket is dead, forcing reconnection...');
              try {
                await this.startRelayConnection(relayUrl);
                this.debugLog('✅ NIP-46: Relay reconnected via startRelayConnection');
              } catch (reconnectErr) {
                console.warn('⚠️ NIP-46: Failed to force-reconnect relay in authenticate():', reconnectErr);
                // Don't throw — let the caller decide what to do when
                // isConnected() returns false after we set connected=true below.
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
      this.debugLog('⏳ NIP-46: Client-initiated connection (nostrconnect://) - waiting for signer to send connect response...');
      this.debugLog('ℹ️ NIP-46: Client does NOT send connect requests per NIP-46 spec');
      this.debugLog('ℹ️ NIP-46: Please ensure the signer has scanned the QR code and is connected');

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
          this.debugLog(`⏳ NIP-46: Still waiting for signer response... (${Math.floor(elapsed / 1000)}s elapsed)`);
        }

        // Check if connection was established
        if (this.connection.pubkey) {
          this.debugLog('✅ NIP-46: Connection established by signer, pubkey:', this.connection.pubkey.slice(0, 16) + '...');
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
    // Per NIP-46 spec and nostrify implementation:
    // 1. Send a 'connect' request with [appPubkey, secret] as params
    // 2. Signer responds with 'ack' if secret matches
    // 3. Then call 'get_public_key' to get user's npub
    this.debugLog('🔑 NIP-46: Bunker connection - sending connect request to signer...', {
      hasToken: !!this.connection.token,
      relayUrl: this.getRelayUrl(),
      signerPubkey: (this.connection as any).signerPubkey?.slice(0, 16) + '...',
    });

    // Get app pubkey for connect request params
    const { getOrCreateAppKeyPair } = await import('./nip46-storage');
    const appKeyPair = getOrCreateAppKeyPair();
    const appPubkey = appKeyPair.publicKey;

    try {
      // Step 1: Send connect request with [appPubkey, secret]
      // This is how the signer knows to show a notification to approve the connection
      const connectParams = [appPubkey];
      if (this.connection.token) {
        connectParams.push(this.connection.token);
      }

      this.debugLog('📤 NIP-46: Sending connect request with params:', {
        appPubkey: appPubkey.slice(0, 16) + '...',
        hasSecret: !!this.connection.token,
      });

      const connectResult = await this.sendRequest('connect', connectParams);
      this.debugLog('✅ NIP-46: Connect request acknowledged:', connectResult);

      // Step 2: Get the user's public key
      const pubkey = await this.sendRequest('get_public_key', []);
      this.debugLog('✅ NIP-46: Received user public key:', pubkey?.slice(0, 16) + '...');

      if (this.connection && pubkey) {
        this.connection.pubkey = pubkey;
        this.connection.connected = true;
        this.connection.connectedAt = Date.now();
      }

      return pubkey;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Provide helpful error message
      throw new Error(
        `Bunker connection failed: ${errorMessage}\n\n` +
        'Please ensure:\n' +
        '1. Amber app is open on your device\n' +
        '2. Amber is connected to the relay: ' + this.getRelayUrl() + '\n' +
        '3. Approve the connection request when it appears in Amber\n' +
        '4. The secret in the bunker:// URI is correct'
      );
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
      this.debugLog('🔑 NIP-46: Requesting user public key from signer via relay...');
      
      // For bunker:// connections, NEVER try connect as fallback
      // The connection is already established by the signer
      const isBunkerConnection = !!(this.connection as any)?.signerPubkey || 
                                  (this.connection?.signerUrl && this.connection.signerUrl.startsWith('bunker://'));
      
      try {
        // Request the public key via relay (this is the user's Nostr pubkey, not the signer app pubkey)
        const pubkey = await this.sendRequest('get_public_key', []);
        this.debugLog('✅ NIP-46: Received user public key:', pubkey?.slice(0, 16) + '...');

        // Store it in the connection
        if (this.connection && pubkey) {
          this.connection.pubkey = pubkey; // User's Nostr account pubkey
          this.connection.connected = true;
          if (!this.connection.connectedAt) {
            this.connection.connectedAt = Date.now();
          }
        }
        return pubkey;
      } catch (error) {
        // For bunker:// connections, do NOT try connect as fallback
        // Just re-throw the error - the authenticate() method will handle it properly
        if (isBunkerConnection) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          // If it's a rate limit error, provide helpful message
          if (errorMessage.includes('Rate limit') || errorMessage.includes('rate limit')) {
            throw new Error(`Rate limit: Please wait before requesting public key again. For bunker:// connections, do not use connect as fallback - just wait for approval in Amber.`);
          }
          // Re-throw the original error
          throw error;
        }
        // For non-bunker connections, re-throw (let caller handle fallback if needed)
        throw error;
      }
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
   * Send a NIP-46 `ping` request with a short timeout to verify the signer
   * is actually reachable end-to-end (not just that our relay socket is up).
   *
   * Resolves on any response — including an error like "unknown method" —
   * because any reply proves the signer received the event and processed it.
   * Rejects only on timeout, so callers can fail fast (~5s) instead of
   * waiting the full 120s sign_event timeout when the signer is offline
   * (e.g. Primal was killed by iOS and hasn't reconnected its own relay
   * subscription).
   */
  async pingSigner(timeoutMs: number = 5000): Promise<void> {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error(`Signer ping timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    const pingPromise = this.sendRequest('ping', []).then(
      () => undefined,
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('timeout')) {
          throw err;
        }
        // Non-timeout errors (e.g. "unknown method") still prove reachability.
        return undefined;
      },
    );
    await Promise.race([pingPromise, timeoutPromise]);
  }

  /**
   * Ensure the relay subscription is active before signing.
   * iOS Safari kills WebSocket connections after ~30s of backgrounding.
   * When the WebSocket dies, the Nostr subscription (REQ) dies with it.
   * RelayManager.isConnected() now checks actual WebSocket state, so we
   * can reliably detect dead connections and re-establish everything.
   */
  private async ensureSubscription(): Promise<void> {
    if (!this.relayClient || !this.connection) return;

    try {
      const relayUrl = this.getRelayUrl();
      if (!relayUrl || relayUrl.startsWith('bunker://')) return;

      // Check if the relay WebSocket is actually alive (not just if the object exists)
      const relayManager = (this.relayClient as any).relayManager;
      const isRelayAlive = relayManager?.isConnected?.(relayUrl) === true;

      if (!isRelayAlive) {
        // WebSocket is dead (iOS backgrounding, network change, etc.)
        // Need full reconnection: new relay client + new subscription
        console.warn('⚠️ NIP-46: Relay WebSocket is dead, re-establishing connection and subscription for signing');
        await this.startRelayConnection(relayUrl);
      }
    } catch (err) {
      // CRITICAL: Propagate relay reconnection errors instead of swallowing them.
      // If the relay is dead and reconnection fails, signing will hang for 120s
      // waiting for a response that never comes (causing the app to appear frozen).
      // Better to fail fast with a clear error so the user sees it immediately.
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ NIP-46: Relay reconnection failed in ensureSubscription:', errorMsg);
      throw new Error(`Relay connection lost and reconnection failed: ${errorMsg}. Please try again.`);
    }
  }

  /**
   * Sign an event using the remote signer
   */
  /**
   * Shared preamble for any remote request: connected, pubkey known, and the
   * relay subscription live. iOS PWA kills WebSockets when backgrounded and the
   * REQ is lost on reconnect, so responses would never arrive without this.
   */
  private async ensureReadyForRequest(): Promise<void> {
    if (!this.connection?.connected) {
      await this.authenticate();
    }
    if (!this.connection?.pubkey) {
      await this.getPublicKey();
    }
    if (!this.connection?.pubkey) {
      throw new Error('Signer public key not available. Please wait for the connection to be established.');
    }
    await this.ensureSubscription();
  }

  /**
   * NIP-44 encrypt via the remote signer.
   *
   * Response routing note: replies resolve on the id path
   * (`pendingRequests.get(content.id)`). The shape-based fallbacks further down
   * only fire when the id does NOT match, and each is gated on the pending
   * request's method being 'get_public_key' or 'sign_event' — so a base64
   * NIP-44 result can neither be stolen by them nor satisfied by a stray hex
   * reply. A signer that mangles request ids fails by timing out, which is the
   * correct behaviour here rather than resolving with the wrong payload.
   */
  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    await this.ensureReadyForRequest();
    const result = await this.sendRequest('nip44_encrypt', [pubkey, plaintext]);
    if (typeof result !== 'string' || !result) {
      throw new Error('Signer returned no ciphertext for nip44_encrypt');
    }
    return result;
  }

  /** NIP-44 decrypt via the remote signer. See nip44Encrypt for routing notes. */
  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    await this.ensureReadyForRequest();
    const result = await this.sendRequest('nip44_decrypt', [pubkey, ciphertext]);
    if (typeof result !== 'string') {
      throw new Error('Signer returned no plaintext for nip44_decrypt');
    }
    return result;
  }

  async signEvent(event: Event): Promise<Event> {
    this.debugLog('🔵 [NIP46-SIGN] signEvent called - starting signature request');

    if (!this.connection?.connected) {
      this.debugLog('⚠️ [NIP46-SIGN] Connection not marked as connected, calling authenticate()');
      await this.authenticate();
    }

    // Get pubkey if not already available
    if (!this.connection?.pubkey) {
      this.debugLog('⚠️ [NIP46-SIGN] Pubkey not available, calling getPublicKey()');
      await this.getPublicKey();
    } else {
      this.debugLog('✅ [NIP46-SIGN] Pubkey already available, skipping getPublicKey()');
    }

    // Validate we have the pubkey
    if (!this.connection?.pubkey) {
      throw new Error('Signer public key not available. Please wait for the connection to be established.');
    }

    // CRITICAL: Ensure relay subscription is active before signing.
    // iOS PWA kills WebSockets when backgrounded; relay may auto-reconnect
    // but the Nostr subscription (REQ) is lost, so responses never arrive.
    await this.ensureSubscription();

    const signerPubkey = this.connection.pubkey;
    this.debugLog('✅ [NIP46-SIGN] Proceeding with signEvent - pubkey confirmed:', signerPubkey.slice(0, 16) + '...');

    // CRITICAL: Verify we're using the user's pubkey, not Amber's pubkey
    console.log(`[NIP46-SIGN] Using pubkey for signing: ${signerPubkey.slice(0, 16)}...`);
    try {
      const npub = publicKeyToNpub(signerPubkey);
      console.log(`[NIP46-SIGN] Pubkey converts to npub: ${npub}`);
    } catch (e) {
      console.log(`[NIP46-SIGN] Failed to convert pubkey to npub:`, e);
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

    this.debugLog('✍️ NIP-46: Requesting signature for event:', {
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

    this.debugLog('📱 NIP-46: Sending sign_event request to signer. Check your phone for:');
    this.debugLog('   1. Notification from signer app');
    this.debugLog('   2. Approval prompt in signer (if set to manual)');
    this.debugLog('   3. Event is being published to multiple relays (see logs above)');
    this.debugLog('   4. ⚠️ If signer crashes, the event format might be incompatible - try a different event kind');
    this.debugLog('   5. If you don\'t see a prompt, check:');
    this.debugLog('      - Signer is connected to at least one of the relays we published to');
    this.debugLog('      - Signer notification permissions are enabled');
    this.debugLog('      - Signer is not auto-approving (check settings)');
    this.debugLog('   6. The working app prompts every time - if ours doesn\'t, events may not be reaching signer');

    // Log the exact JSON being sent to help debug
    const eventJson = JSON.stringify(eventForSigner);
    this.debugLog('📋 NIP-46: Exact event JSON being sent to signer:', eventJson);
    this.debugLog('📋 NIP-46: This will be sent as sign_event([eventJson]) to signer via NIP-46');

    // Log connection details for bunker debugging
    const bunkerRelayUrl = (this.connection as any)?.relayUrl;
    const isBunkerConnection = !!(this.connection as any)?.signerPubkey;
    this.debugLog('🔌 NIP-46: Sign request connection details:', {
      isBunkerConnection,
      bunkerRelayUrl,
      signerUrl: this.connection?.signerUrl?.slice(0, 50) + '...',
      connectedRelays: this.relayClient?.getConnectedRelays?.() || [],
      lastEventTime: this.lastEventTime > 0 ? `${Math.floor((Date.now() - this.lastEventTime) / 1000)}s ago` : 'never',
      eventCounter: this.eventCounter,
    });

    const signatureResponse = await this.sendRequest('sign_event', [eventJson]);

    this.debugLog('🔍 NIP-46: Raw signature response:', {
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
      
      this.debugLog('🔍 NIP-46: Checking if response is JSON event string:', {
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
            this.debugLog('✅ NIP-46: Signer returned a full signed event JSON string');
            this.debugLog('✅ NIP-46: Parsed full event structure:', {
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
            this.debugLog('✅ NIP-46: Extracted signature from full event:', {
              eventId: parsed.id?.slice(0, 16) + '...',
              signatureLength: signature?.length,
              signaturePreview: signature?.slice(0, 16) + '...',
            });
          } else {
            this.debugLog('⚠️ NIP-46: String looks like JSON but not a full event, treating as signature');
            signature = signatureResponse;
          }
        } catch (e) {
          this.debugLog('⚠️ NIP-46: Failed to parse as JSON, treating as signature string:', e instanceof Error ? e.message : String(e));
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
      this.debugLog('✅ NIP-46: Using full signed event from signer (early return):', {
        id: fullSignedEvent.id.slice(0, 16) + '...',
        kind: fullSignedEvent.kind,
        hasSig: !!fullSignedEvent.sig,
        sigLength: fullSignedEvent.sig.length,
        sigPreview: fullSignedEvent.sig.slice(0, 16) + '...',
        fullEvent: fullSignedEvent,
      });

      // Validate the event structure
      if (fullSignedEvent.sig && typeof fullSignedEvent.sig === 'string' && fullSignedEvent.sig.length >= 64 && /^[a-f0-9]+$/i.test(fullSignedEvent.sig)) {
        this.debugLog('✅ NIP-46: Full event signature is valid, returning complete event from signer');
        return fullSignedEvent as Event;
      } else {
        console.warn('⚠️ NIP-46: Full event from signer has invalid signature, falling back to reconstruction:', {
          sigLength: fullSignedEvent.sig?.length,
          sigType: typeof fullSignedEvent.sig,
          sigPreview: fullSignedEvent.sig?.slice(0, 32),
        });
      }
    } else {
      this.debugLog('ℹ️ NIP-46: No full signed event detected, will reconstruct from signature:', {
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

    this.debugLog('✅ NIP-46: Received and validated signature:', {
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

    this.debugLog('✅ NIP-46: Constructed signed event - Final event structure:', {
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
   * Start periodic cleanup for orphaned pending requests
   * Removes requests older than 120 seconds that were never resolved
   */
  private startPendingRequestCleanup(): void {
    // Don't start multiple cleanup intervals
    if (this.pendingRequestCleanupInterval) return;

    this.pendingRequestCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, pending] of this.pendingRequests.entries()) {
        const startTime = (pending as any).startTime || 0;
        if (startTime > 0 && now - startTime > 120000) {
          this.pendingRequests.delete(id);
          // Clear any associated timers
          if ((pending as any).statusInterval) clearInterval((pending as any).statusInterval);
          if ((pending as any).timeout) clearTimeout((pending as any).timeout);
          pending.reject(new Error('Request expired (cleanup)'));
          this.debugLog(`🧹 NIP-46: Cleaned up orphaned ${pending.method} request ${id}`);
        }
      }
    }, 60000);
  }

  /**
   * Stop pending request cleanup
   */
  private stopPendingRequestCleanup(): void {
    if (this.pendingRequestCleanupInterval) {
      clearInterval(this.pendingRequestCleanupInterval);
      this.pendingRequestCleanupInterval = null;
    }
  }

  /**
   * Disconnect from signer
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.stopPendingRequestCleanup();

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

    // For relay-based connections, also check if relay is actually connected
    // This is important for iOS Safari which kills WebSocket connections when backgrounded
    if (this.relayClient && this.connection?.connected) {
      try {
        const relayManager = (this.relayClient as any).relayManager;
        if (relayManager) {
          const relayUrl = this.getRelayUrl();
          const isRelayConnected = relayManager.isConnected(relayUrl);
          if (!isRelayConnected) {
            this.debugLog('⚠️ NIP-46: Relay connection lost (iOS background?), marking as disconnected');
            // Don't update the flag here - let the reconnection logic handle it
            return false;
          }
        }
      } catch (err) {
        // If we can't check relay status, fall back to connection flag
        console.warn('⚠️ NIP-46: Could not check relay connection status:', err);
      }
    }

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


