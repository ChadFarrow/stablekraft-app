import { bech32 } from 'bech32';

export interface LNURLPayParams {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  tag: string;
  commentAllowed?: number;
  payerData?: {
    name?: { mandatory: boolean };
    pubkey?: { mandatory: boolean };
    identifier?: { mandatory: boolean };
    email?: { mandatory: boolean };
    auth?: { mandatory: boolean; k1: string };
  };
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

export interface LNURLPayResponse {
  pr: string; // Lightning invoice
  successAction?: {
    tag: string;
    message?: string;
    url?: string;
    description?: string;
  };
  routes?: any[];
}

/**
 * Combined Lightning Address details (LNURL, keysend, and Nostr info)
 * 
 * This interface represents the comprehensive information returned by the Lightning Address
 * details API, which combines data from multiple sources:
 * - LNURL-pay parameters for invoice-based payments
 * - Keysend fallback information for direct node-to-node payments with Helipad metadata
 * - Nostr pubkeys from NIP-05 verification for social tagging
 * 
 * Works with any Lightning Address provider: Alby, Fountain, Strike, etc.
 */
export interface LightningAddressDetails {
  /** LNURL-pay parameters for generating invoices */
  lnurlp?: LNURLPayParams & { status?: 'OK' | 'ERROR'; reason?: string };
  /** 
   * Keysend fallback information when the Lightning Address supports direct keysend payments
   * Keysend is preferred over LNURL because it supports Helipad metadata for podcast apps
   */
  keysend?: {
    pubkey: string;
    customData: Array<{ customKey: string; customValue: string }>;
    status: 'OK' | 'ERROR';
    tag?: string;
    reason?: string;
  };
  /** 
   * Nostr information from NIP-05 verification
   * The names object maps Lightning Address usernames to their Nostr pubkeys (hex format)
   * Used for tagging musicians in Nostr boost posts
   */
  nostr?: {
    names: Record<string, string>;
    relays?: Record<string, string[]>;
  };
}

export class LNURLService {
  /**
   * Check if running in browser environment
   */
  private static isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  /**
   * Check if a string is a valid Lightning Address (email format)
   */
  static isLightningAddress(address: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(address);
  }

  /**
   * Check if a string is a valid LNURL
   */
  static isLNURL(lnurl: string): boolean {
    try {
      const decoded = bech32.decode(lnurl, 2000);
      return decoded.prefix === 'lnurl';
    } catch {
      return false;
    }
  }

  /**
   * Resolve Lightning Address to full details (LNURL, keysend, Nostr)
   * 
   * This method fetches comprehensive information about a Lightning Address including:
   * - LNURL-pay parameters for invoice generation
   * - Keysend fallback information (node pubkey and custom records) for direct keysend payments
   * - Nostr pubkeys from NIP-05 verification for tagging musicians in social posts
   * 
   * Keysend is preferred over LNURL when available because it supports Helipad metadata
   * for podcast apps. The system will attempt keysend first and fall back to LNURL if needed.
   * 
   * @param address - Lightning Address in email format (e.g., "user@getalby.com")
   * @returns Combined details including LNURL, keysend, and Nostr information
   * @throws Error if address format is invalid or resolution fails
   * @see https://github.com/getAlby/lightning-address-details-proxy
   */
  static async resolveLightningAddressDetails(address: string): Promise<LightningAddressDetails> {
    if (!this.isLightningAddress(address)) {
      throw new Error('Invalid Lightning Address format');
    }

    try {
      // Get combined LNURL + keysend + Nostr info for any Lightning Address
      const url = `https://api.getalby.com/lnurl/lightning-address-details?ln=${encodeURIComponent(address)}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StableKraft-Lightning/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as LightningAddressDetails;
    } catch (error) {
      console.error('Failed to resolve Lightning Address details:', error);
      throw error;
    }
  }

  /**
   * Convert Lightning Address to LNURL
   */
  static lightningAddressToLNURL(address: string): string {
    if (!this.isLightningAddress(address)) {
      throw new Error('Invalid Lightning Address format');
    }

    const [username, domain] = address.split('@');
    const url = `https://${domain}/.well-known/lnurlp/${username}`;

    // Convert to bech32 LNURL
    const words = bech32.toWords(Buffer.from(url, 'utf8'));
    return bech32.encode('lnurl', words, 2000);
  }

  /**
   * Decode LNURL to URL
   */
  static decodeLNURL(lnurl: string): string {
    try {
      const decoded = bech32.decode(lnurl, 2000);
      const words = bech32.fromWords(decoded.words);
      return Buffer.from(words).toString('utf8');
    } catch (error) {
      throw new Error('Invalid LNURL format');
    }
  }

  /**
   * Resolve Lightning Address to LNURL-pay parameters
   */
  static async resolveLightningAddress(address: string): Promise<LNURLPayParams> {
    if (!this.isLightningAddress(address)) {
      throw new Error('Invalid Lightning Address format');
    }

    try {
      // Use proxy endpoint in browser to avoid CORS issues
      if (this.isBrowser()) {
        const response = await fetch('/api/lightning/lnurl/resolve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ address }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }

      // Server-side: direct fetch
      const [username, domain] = address.split('@');
      const url = `https://${domain}/.well-known/lnurlp/${username}`;

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StableKraft-Lightning/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL-pay request failed');
      }

      if (data.tag !== 'payRequest') {
        throw new Error('Invalid LNURL-pay response: wrong tag');
      }

      return data as LNURLPayParams;
    } catch (error) {
      console.error('Failed to resolve Lightning Address:', error);
      throw error;
    }
  }

  /**
   * Resolve LNURL to LNURL-pay parameters
   */
  static async resolveLNURL(lnurl: string): Promise<LNURLPayParams> {
    try {
      // Use proxy endpoint in browser to avoid CORS issues
      if (this.isBrowser()) {
        const response = await fetch('/api/lightning/lnurl/resolve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ lnurl }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }

      // Server-side: direct fetch
      const url = this.decodeLNURL(lnurl);

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StableKraft-Lightning/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL-pay request failed');
      }

      if (data.tag !== 'payRequest') {
        throw new Error('Invalid LNURL-pay response: wrong tag');
      }

      return data as LNURLPayParams;
    } catch (error) {
      console.error('Failed to resolve LNURL:', error);
      throw error;
    }
  }

  /**
   * Request invoice from LNURL-pay callback
   */
  static async requestInvoice(
    params: LNURLPayParams,
    amount: number, // in millisats
    comment?: string,
    payerData?: any
  ): Promise<LNURLPayResponse> {
    if (amount < params.minSendable || amount > params.maxSendable) {
      throw new Error(
        `Amount ${amount} msat is outside allowed range: ${params.minSendable}-${params.maxSendable} msat`
      );
    }

    if (comment && params.commentAllowed && comment.length > params.commentAllowed) {
      throw new Error(`Comment too long. Maximum ${params.commentAllowed} characters allowed`);
    }

    try {
      // Use proxy endpoint in browser to avoid CORS issues
      if (this.isBrowser()) {
        const response = await fetch('/api/lightning/lnurl/invoice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            callback: params.callback,
            amount,
            comment,
            payerData,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      }

      // Server-side: direct fetch
      const callbackUrl = new URL(params.callback);
      callbackUrl.searchParams.set('amount', amount.toString());

      if (comment) {
        callbackUrl.searchParams.set('comment', comment);
      }

      if (payerData) {
        callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
      }

      const response = await fetch(callbackUrl.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StableKraft-Lightning/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Invoice request failed');
      }

      if (!data.pr) {
        throw new Error('No payment request in response');
      }

      return data as LNURLPayResponse;
    } catch (error) {
      console.error('Failed to request invoice:', error);
      throw error;
    }
  }

  /**
   * Pay to a Lightning Address
   */
  static async payLightningAddress(
    address: string,
    amountSats: number,
    comment?: string,
    payerData?: any
  ): Promise<{ invoice: string; successAction?: any }> {
    try {
      // Resolve Lightning Address to LNURL-pay params
      const params = await this.resolveLightningAddress(address);

      // Convert sats to millisats
      const amountMsat = amountSats * 1000;

      // Request invoice
      const invoiceResponse = await this.requestInvoice(params, amountMsat, comment, payerData);

      return {
        invoice: invoiceResponse.pr,
        successAction: invoiceResponse.successAction,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Pay to an LNURL
   */
  static async payLNURL(
    lnurl: string,
    amountSats: number,
    comment?: string,
    payerData?: any
  ): Promise<{ invoice: string; successAction?: any }> {
    try {
      // Resolve LNURL to LNURL-pay params
      const params = await this.resolveLNURL(lnurl);

      // Convert sats to millisats
      const amountMsat = amountSats * 1000;

      // Request invoice
      const invoiceResponse = await this.requestInvoice(params, amountMsat, comment, payerData);

      return {
        invoice: invoiceResponse.pr,
        successAction: invoiceResponse.successAction,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Validate amount for Lightning Address or LNURL
   */
  static async validateAmount(
    addressOrLnurl: string,
    amountSats: number
  ): Promise<{ valid: boolean; min: number; max: number; error?: string }> {
    try {
      let params: LNURLPayParams;

      if (this.isLightningAddress(addressOrLnurl)) {
        params = await this.resolveLightningAddress(addressOrLnurl);
      } else if (this.isLNURL(addressOrLnurl)) {
        params = await this.resolveLNURL(addressOrLnurl);
      } else {
        return {
          valid: false,
          min: 0,
          max: 0,
          error: 'Invalid Lightning Address or LNURL format',
        };
      }

      const amountMsat = amountSats * 1000;
      const minSats = Math.ceil(params.minSendable / 1000);
      const maxSats = Math.floor(params.maxSendable / 1000);

      return {
        valid: amountMsat >= params.minSendable && amountMsat <= params.maxSendable,
        min: minSats,
        max: maxSats,
      };
    } catch (error) {
      return {
        valid: false,
        min: 0,
        max: 0,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  }
}