import { Event, Filter } from 'nostr-tools';
import { RelayManager, getDefaultRelays } from './relay';
import { createEvent, EventTemplate } from './events';

/**
 * Nostr client wrapper for publishing and reading events
 * Provides a high-level interface for Nostr operations
 */

export interface PublishOptions {
  relays?: string[];
  waitForRelay?: boolean;
  timeout?: number;
}

export interface SubscribeOptions {
  relays?: string[];
  filters: Filter[];
  onEvent: (event: Event) => void;
  onEose?: () => void;
  onError?: (error: Error) => void;
}

export class NostrClient {
  private relayManager: RelayManager;
  private defaultRelays: string[];

  constructor(defaultRelays?: string[]) {
    this.relayManager = new RelayManager();
    this.defaultRelays = defaultRelays || getDefaultRelays();
  }

  /**
   * Connect to default relays
   */
  async connect(): Promise<void> {
    const relays = this.defaultRelays;
    await Promise.all(
      relays.map(url =>
        this.relayManager.connect(url, { read: true, write: true }).catch(err => {
          console.warn(`Failed to connect to relay ${url}:`, err);
        })
      )
    );
  }

  /**
   * Connect to specific relays
   * @param urls - Array of relay URLs
   */
  async connectToRelays(urls: string[]): Promise<void> {
    await Promise.all(
      urls.map(url =>
        this.relayManager.connect(url, { read: true, write: true }).catch(err => {
          console.warn(`Failed to connect to relay ${url}:`, err);
        })
      )
    );
  }

  /**
   * Disconnect from all relays
   */
  async disconnect(): Promise<void> {
    await this.relayManager.disconnectAll();
  }

  /**
   * Get list of connected relay URLs
   */
  getConnectedRelays(): string[] {
    return this.relayManager.getConnectedRelays();
  }

  /**
   * Publish an event to relays
   * @param event - Event to publish
   * @param options - Publish options
   * @returns Array of publish results
   */
  async publish(event: Event, options: PublishOptions = {}): Promise<PromiseSettledResult<any>[]> {
    const relays = options.relays || this.defaultRelays;

    // Ensure we're connected to the relays
    await this.connectToRelays(relays);

    // Publish to all relays
    const results = await this.relayManager.publish(event);

    if (options.waitForRelay) {
      // Wait for at least one relay to confirm
      const timeout = options.timeout || 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const hasSuccess = results.some(
          result => result.status === 'fulfilled'
        );
        if (hasSuccess) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Create and publish an event
   * @param template - Event template
   * @param privateKey - Private key in hex format
   * @param options - Publish options
   * @returns Published event
   */
  async createAndPublish(
    template: EventTemplate,
    privateKey: string,
    options: PublishOptions = {}
  ): Promise<Event> {
    const event = createEvent(template, privateKey);
    await this.publish(event, options);
    return event;
  }

  /**
   * Subscribe to events
   * @param options - Subscribe options
   * @returns Function to unsubscribe
   */
  subscribe(options: SubscribeOptions): () => void {
    const relays = options.relays || this.defaultRelays;

    // Ensure we're connected to the relays
    this.connectToRelays(relays).catch(err => {
      console.error('Failed to connect to relays for subscription:', err);
    });

    // Pass the specific relays to subscribe to (not all read relays)
    return this.relayManager.subscribe(options.filters, (event: Event) => {
      try {
        options.onEvent(event);
      } catch (error) {
        if (options.onError) {
          options.onError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }, relays); // Pass the specific relays to subscribe to
  }

  /**
   * Get events from relays (one-time query)
   * @param filters - Array of filters
   * @param relays - Optional relay URLs
   * @param timeout - Timeout in milliseconds
   * @returns Array of events
   */
  async getEvents(
    filters: Filter[],
    relays?: string[],
    timeout: number = 5000
  ): Promise<Event[]> {
    return new Promise((resolve, reject) => {
      const events: Event[] = [];
      const targetRelays = relays || this.defaultRelays;

      this.connectToRelays(targetRelays).then(() => {
        const unsub = this.subscribe({
          relays: targetRelays,
          filters,
          onEvent: (event) => {
            events.push(event);
          },
          onEose: () => {
            unsub();
            resolve(events);
          },
          onError: (error) => {
            unsub();
            reject(error);
          },
        });

        // Timeout fallback
        setTimeout(() => {
          unsub();
          resolve(events);
        }, timeout);
      }).catch(reject);
    });
  }

  /**
   * Get a single event by ID
   * @param eventId - Event ID
   * @param relays - Optional relay URLs
   * @returns Event or null if not found
   */
  async getEvent(eventId: string, relays?: string[]): Promise<Event | null> {
    const events = await this.getEvents(
      [{ ids: [eventId] }],
      relays,
      3000
    );
    return events[0] || null;
  }

  /**
   * Get user's profile metadata
   * @param pubkey - User's public key
   * @param relays - Optional relay URLs
   * @returns Profile metadata or null
   */
  async getProfile(pubkey: string, relays?: string[]): Promise<any | null> {
    const events = await this.getEvents(
      [{ kinds: [0], authors: [pubkey], limit: 1 }],
      relays,
      3000
    );

    if (events.length === 0) {
      return null;
    }

    try {
      return JSON.parse(events[0].content);
    } catch {
      return null;
    }
  }
}

/**
 * Create a default Nostr client instance
 * @returns NostrClient instance
 */
export function createNostrClient(defaultRelays?: string[]): NostrClient {
  return new NostrClient(defaultRelays);
}

