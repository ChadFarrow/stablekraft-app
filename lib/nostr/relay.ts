// Deliberately the `relay` subpath, not the `nostr-tools` barrel. The barrel
// INLINES its own copy of this class with its own captured `_WebSocket`, which
// no `useWebSocketImplementation` can reach, so the Node harnesses could not
// keep this off undici's WebSocket. See lib/nostr/node-websocket.ts.
import { Relay } from 'nostr-tools/relay';

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
  async connect(url: string, options: { read?: boolean; write?: boolean; timeout?: number } = {}): Promise<Relay> {
    if (this.relays.has(url)) {
      return this.relays.get(url)!;
    }

    // Filter out unreachable relays before attempting connection
    // Exception: localrelay.link is used by Aegis (iOS Nostr signer) for NIP-46
    const lowerUrl = url.toLowerCase();
    const isKnownSignerRelay = lowerUrl.includes('localrelay.link');

    // The OTHER exception: a build deliberately pointed at a local relay.
    //
    // This guard exists to skip junk in relay lists we did not write, where a
    // loopback URL is someone's leftover config and will never answer. It is
    // wrong about the one case where a loopback URL is the entire point, and it
    // is the THIRD place that had to learn the difference — `getDefaultRelays`
    // and `resolvePublishRelays` were the other two.
    //
    // It cost a full test cycle: the read goes through SimplePool and worked, so
    // the app came up, seeded its mode off the wire and reconciled — and every
    // publish failed here with "Skipping unreachable relay", surfacing as
    // "Couldn't reach the relays" while the relay was running and answering
    // reads on the same URL.
    const isConfiguredLocalRelay = relaysAreIsolated() && getDefaultRelays().includes(url);

    if (!isKnownSignerRelay && !isConfiguredLocalRelay && (
        lowerUrl.includes('127.0.0.1') ||
        lowerUrl.includes('localhost') ||
        lowerUrl.includes('.local') ||
        lowerUrl.endsWith('/chat') ||
        lowerUrl.endsWith('/private') ||
        lowerUrl.endsWith('/outbox'))) {
      throw new Error(`Skipping unreachable relay: ${url}`);
    }

    const timeoutMs = options.timeout ?? 5000;

    // Losing the race abandons the connect, it does not cancel it. A relay
    // that answers after the timeout used to stay open with nothing holding it
    // — nothing ever closed it, since it never reached `this.relays` — which on
    // a long-running server is one leaked socket per slow relay per request.
    const pending = Relay.connect(url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const relay = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Connection timeout: ${url}`)), timeoutMs);
      }),
    ])
      .catch((error) => {
        pending.then((late) => late.close()).catch(() => {});
        throw error;
      })
      .finally(() => clearTimeout(timer));

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
   * Only returns relays with live WebSocket connections
   * @returns Array of relay URLs
   */
  getConnectedRelays(): string[] {
    return Array.from(this.relays.entries())
      .filter(([_, relay]) => this.isRelayConnected(relay))
      .map(([url]) => url);
  }

  /**
   * Check if a relay's WebSocket is actually open.
   * nostr-tools v2 Relay has a `connected` getter that checks readyState.
   * Falls back to assuming connected if the property doesn't exist (older versions).
   */
  private isRelayConnected(relay: Relay): boolean {
    // nostr-tools v2.x: relay.connected checks ws.readyState === WebSocket.OPEN
    if ('connected' in relay) {
      return relay.connected === true;
    }
    // Fallback: if property doesn't exist, assume connected (relay object exists)
    return true;
  }

  /**
   * Check if a relay is connected
   * @param url - Relay URL
   * @returns true if connected, false otherwise
   */
  isConnected(url: string): boolean {
    const relay = this.relays.get(url);
    if (!relay) return false;
    return this.isRelayConnected(relay);
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
      .filter((relay): relay is Relay => relay !== undefined)
      // Skip relays whose WebSocket has closed between connect() and publish().
      // Without this, nostr-tools throws SendingOnClosedConnection synchronously,
      // which surfaces as an unhandled-rejection in the console. The user's
      // personal relays in particular (via NIP-65) are often flaky.
      .filter(relay => (relay as any).connected !== false);

    const publishPromises = writeRelays.map(relay =>
      // Wrap in a try/catch to convert synchronous throws into rejected
      // promises so Promise.allSettled sees them cleanly.
      Promise.resolve().then(() => relay.publish(event)),
    );
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
 * Is this build pointed exclusively at a LOCAL relay?
 *
 * True only when every configured default is a loopback address, which nothing
 * but a deliberate test setup ever is. It means "publish nowhere but here".
 */
export function relaysAreIsolated(): boolean {
  const relays = getDefaultRelays();
  return (
    relays.length > 0 &&
    relays.every((url) => {
      const u = url.toLowerCase();
      return u.includes('127.0.0.1') || u.includes('localhost');
    })
  );
}

/**
 * The relay set for an operation that publishes under the user's key: their own
 * relays, plus the defaults.
 *
 * **Defaults are unioned in** because a dead or AUTH-gated relay in someone's
 * NIP-65 list otherwise produces "published to 0 relays".
 *
 * **Unless the build is pointed at a local relay, in which case ONLY that is
 * returned** — and this exception is the whole reason the helper exists.
 * Pointing `NEXT_PUBLIC_NOSTR_RELAYS` at 127.0.0.1 looks like it isolates the
 * app, and without this it does not: the union quietly adds the user's real
 * NIP-65 relays back, so a "local" test publishes a real event under their real
 * key, to their real relays, on a replaceable event that keeps no history. That
 * is the exact accident the local relay exists to prevent, and it fails silently
 * — the publish succeeds and looks like the test working.
 *
 * Use this for anything that PUBLISHES. A read can union freely.
 */
export function resolvePublishRelays(userRelays?: string[]): string[] {
  const defaults = getDefaultRelays();
  if (relaysAreIsolated()) return defaults;
  return [...new Set([...filterReachableRelays(userRelays || []), ...defaults])];
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
      // Returned WITHOUT filterReachableRelays, and that is the point.
      //
      // The filter exists to prune junk out of relay lists we did not write —
      // a user's NIP-65 list, a relay's own recommendations. This list is
      // deliberate build-time configuration, so second-guessing it is wrong on
      // its face, and it silently broke the only way to test this app offline:
      // the filter drops every loopback URL, so NEXT_PUBLIC_NOSTR_RELAYS set to
      // ws://127.0.0.1:7777 resolved to an EMPTY relay list. Not an error — an
      // empty list, which reads as "no relay answered", i.e. a degraded read.
      //
      // This repo has no preview environment, so a local relay is the only
      // place a favorites publish can be tested without writing to the real
      // event under the user's real key. See scripts/local-relay.mjs.
      return relays;
    }
  }

  // If no env relays, use defaults
  if (relays.length === 0) {
    // Default relays (commonly used public relays)
    // Note: relay.damus.io is often rate-limited, so we prioritize other relays
    // Dropped 2026-07-26: wss://relay.nsec.app. It sat first here, labelled
    // "more reliable", while actually returning 502 — costing ~0.5–1.4s on
    // every relay operation (NIP-65 fetch, publish queue, boost notes).
    // filterReachableRelays only pattern-matches localhost-style URLs, so
    // nothing pruned it automatically.
    //
    // Dropped 2026-08-12: wss://nostr.oxtr.dev, the same failure a second time
    // and worse. DNS still resolves (144.76.199.124) but nothing accepts a
    // connection — 3/3 WebSocket attempts timed out at 8s and its NIP-11 info
    // document returned nothing. A blackholed host is the expensive kind: it
    // never refuses, so every caller pays its full connect timeout. It made the
    // cross-app favorites read take 5s instead of ~1s, and that read runs on
    // every page load for a signed-in user.
    //
    // ADDING ONE? Check it first — nothing here prunes a dead host
    // automatically, and both removals above were live for months. Connect,
    // send a REQ, and require a real EOSE; the recipe is in
    // lib/nostr/relay-read.test.ts.
    relays = [
      'wss://nos.lol',              // Popular and stable
      'wss://relay.snort.social',   // Snort's relay
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

