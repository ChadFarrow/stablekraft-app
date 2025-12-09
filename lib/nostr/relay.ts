import { Relay } from 'nostr-tools';

/**
 * Relay connection management
 * Handles connections to Nostr relays and manages relay pools
 */

export interface RelayConfig {
  url: string;
  read: boolean;
  write: boolean;
}

export class RelayManager {
  private relays: Map<string, Relay> = new Map();
  private configs: Map<string, RelayConfig> = new Map();

  /**
   * Connect to a relay
   * @param url - Relay URL
   * @param options - Connection options
   * @returns Relay instance
   */
  async connect(url: string, options: { read?: boolean; write?: boolean } = {}): Promise<Relay> {
    if (this.relays.has(url)) {
      return this.relays.get(url)!;
    }

    // Filter out unreachable relays before attempting connection
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('127.0.0.1') ||
        lowerUrl.includes('localhost') ||
        lowerUrl.includes('.local') ||
        lowerUrl.endsWith('/chat') ||
        lowerUrl.endsWith('/private') ||
        lowerUrl.endsWith('/outbox')) {
      throw new Error(`Skipping unreachable relay: ${url}`);
    }

    try {
      const relay = await Relay.connect(url);

      const config: RelayConfig = {
        url,
        read: options.read !== false,
        write: options.write !== false,
      };

      this.relays.set(url, relay);
      this.configs.set(url, config);

      return relay;
    } catch (error) {
      // Log connection errors but don't throw - let callers handle failures gracefully
      console.warn(`⚠️ Failed to connect to relay ${url}:`, error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Disconnect from a relay
   * @param url - Relay URL
   */
  async disconnect(url: string): Promise<void> {
    const relay = this.relays.get(url);
    if (relay) {
      await relay.close();
      this.relays.delete(url);
      this.configs.delete(url);
    }
  }

  /**
   * Disconnect from all relays
   */
  async disconnectAll(): Promise<void> {
    const urls = Array.from(this.relays.keys());
    await Promise.all(urls.map(url => this.disconnect(url)));
  }

  /**
   * Get a connected relay
   * @param url - Relay URL
   * @returns Relay instance or undefined
   */
  getRelay(url: string): Relay | undefined {
    return this.relays.get(url);
  }

  /**
   * Get all connected relay URLs
   * @returns Array of relay URLs
   */
  getConnectedRelays(): string[] {
    return Array.from(this.relays.keys());
  }

  /**
   * Check if a relay is connected
   * @param url - Relay URL
   * @returns true if connected, false otherwise
   */
  isConnected(url: string): boolean {
    const relay = this.relays.get(url);
    // Check if relay is connected by trying to access its readyState
    // Relay class doesn't expose status directly, so we check if it exists
    return relay !== undefined;
  }

  /**
   * Publish an event to all connected write relays
   * @param event - Nostr event
   * @returns Array of promises that resolve when published to each relay
   */
  async publish(event: any): Promise<PromiseSettledResult<any>[]> {
    const writeRelays = Array.from(this.configs.entries())
      .filter(([_, config]) => config.write)
      .map(([url]) => this.relays.get(url))
      .filter((relay): relay is Relay => relay !== undefined);

    const publishPromises = writeRelays.map(relay => relay.publish(event));
    return Promise.allSettled(publishPromises);
  }

  /**
   * Subscribe to events from connected read relays
   * @param filters - Array of filters
   * @param onEvent - Callback for each event
   * @param specificRelays - Optional array of specific relay URLs to subscribe to. If not provided, subscribes to all read relays.
   * @returns Function to unsubscribe
   */
  subscribe(
    filters: any[],
    onEvent: (event: any) => void,
    specificRelays?: string[]
  ): () => void {
    // If specific relays are provided, only subscribe to those (if they're configured for reading)
    // Otherwise, subscribe to all read relays
    let readRelays: Relay[];
    
    if (specificRelays && specificRelays.length > 0) {
      // Filter to only the specified relays that are configured for reading
      readRelays = specificRelays
        .map(url => {
          const config = this.configs.get(url);
          if (config && config.read) {
            return this.relays.get(url);
          }
          return undefined;
        })
        .filter((relay): relay is Relay => relay !== undefined);
    } else {
      // Subscribe to all read relays (original behavior)
      readRelays = Array.from(this.configs.entries())
        .filter(([_, config]) => config.read)
        .map(([url]) => this.relays.get(url))
        .filter((relay): relay is Relay => relay !== undefined);
    }

    const subs = readRelays.map(relay => {
      const sub = relay.subscribe(filters, {
        onevent: onEvent,
      });
      return { relay, sub };
    });

    return () => {
      subs.forEach(({ sub }) => sub.close());
    };
  }
}

/**
 * Filter out unreachable relay URLs (localhost, .local, etc.)
 * @param urls - Array of relay URLs
 * @returns Filtered array of reachable relay URLs
 */
export function filterReachableRelays(urls: string[]): string[] {
  return urls.filter(url => {
    if (!url || typeof url !== 'string') return false;
    
    const lowerUrl = url.toLowerCase();
    
    // Filter out obviously unreachable relays
    return !lowerUrl.includes('127.0.0.1') &&
           !lowerUrl.includes('localhost') &&
           !lowerUrl.includes('.local') &&
           !lowerUrl.endsWith('/chat') &&
           !lowerUrl.endsWith('/private') &&
           !lowerUrl.endsWith('/outbox');
  });
}

/**
 * Get default relay URLs from environment or use common defaults
 * Automatically filters out unreachable relays (localhost, .local, etc.)
 * @returns Array of relay URLs
 */
export function getDefaultRelays(): string[] {
  let relays: string[] = [];
  
  if (typeof window !== 'undefined') {
    // Client-side: use environment variable
    const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
    if (envRelays) {
      relays = envRelays.split(',').map(url => url.trim()).filter(Boolean);
    }
  }

  // If no env relays, use defaults
  if (relays.length === 0) {
    // Default relays (commonly used public relays)
    // Note: relay.damus.io is often rate-limited, so we prioritize other relays
    relays = [
      'wss://relay.nsec.app',      // More reliable, less rate-limited
      'wss://nos.lol',              // Popular and stable
      'wss://relay.snort.social',   // Snort's relay
      'wss://nostr.oxtr.dev',       // Alternative relay
      'wss://relay.primal.net',     // Primal relay
      'wss://theforest.nostr1.com', // Forest relay
      'wss://relay.damus.io',       // Damus relay (moved to end due to frequent rate limiting)
    ];
  }

  // Filter out unreachable relays before returning
  return filterReachableRelays(relays);
}

/**
 * Validate a relay URL
 * @param url - Relay URL to validate
 * @returns true if valid, false otherwise
 */
export function isValidRelayUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'wss:' || parsed.protocol === 'ws:';
  } catch {
    return false;
  }
}

