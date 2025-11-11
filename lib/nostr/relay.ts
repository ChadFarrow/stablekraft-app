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

    const relay = await Relay.connect(url);

    const config: RelayConfig = {
      url,
      read: options.read !== false,
      write: options.write !== false,
    };

    this.relays.set(url, relay);
    this.configs.set(url, config);

    return relay;
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
   * Subscribe to events from all connected read relays
   * @param filters - Array of filters
   * @param onEvent - Callback for each event
   * @returns Function to unsubscribe
   */
  subscribe(
    filters: any[],
    onEvent: (event: any) => void
  ): () => void {
    const readRelays = Array.from(this.configs.entries())
      .filter(([_, config]) => config.read)
      .map(([url]) => this.relays.get(url))
      .filter((relay): relay is Relay => relay !== undefined);

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
 * Get default relay URLs from environment or use common defaults
 * @returns Array of relay URLs
 */
export function getDefaultRelays(): string[] {
  if (typeof window !== 'undefined') {
    // Client-side: use environment variable
    const envRelays = process.env.NEXT_PUBLIC_NOSTR_RELAYS;
    if (envRelays) {
      return envRelays.split(',').map(url => url.trim()).filter(Boolean);
    }
  }

  // Default relays (commonly used public relays)
  return [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.snort.social',
    'wss://primal.net',
  ];
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

