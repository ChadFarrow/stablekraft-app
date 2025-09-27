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

export class LNURLService {
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

    const [username, domain] = address.split('@');
    const url = `https://${domain}/.well-known/lnurlp/${username}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FUCKIT-Lightning/1.0',
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
    const url = this.decodeLNURL(lnurl);

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FUCKIT-Lightning/1.0',
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

    const callbackUrl = new URL(params.callback);
    callbackUrl.searchParams.set('amount', amount.toString());

    if (comment) {
      callbackUrl.searchParams.set('comment', comment);
    }

    if (payerData) {
      callbackUrl.searchParams.set('payerdata', JSON.stringify(payerData));
    }

    try {
      const response = await fetch(callbackUrl.toString(), {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'FUCKIT-Lightning/1.0',
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
      console.log(`⚡ Paying ${amountSats} sats to Lightning Address: ${address}`);

      // Resolve Lightning Address to LNURL-pay params
      const params = await this.resolveLightningAddress(address);
      console.log('✅ Lightning Address resolved:', params);

      // Convert sats to millisats
      const amountMsat = amountSats * 1000;

      // Request invoice
      const invoiceResponse = await this.requestInvoice(params, amountMsat, comment, payerData);
      console.log('✅ Invoice received:', invoiceResponse.pr.slice(0, 50) + '...');

      return {
        invoice: invoiceResponse.pr,
        successAction: invoiceResponse.successAction,
      };
    } catch (error) {
      console.error('❌ Lightning Address payment failed:', error);
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
      console.log(`⚡ Paying ${amountSats} sats to LNURL: ${lnurl.slice(0, 20)}...`);

      // Resolve LNURL to LNURL-pay params
      const params = await this.resolveLNURL(lnurl);
      console.log('✅ LNURL resolved:', params);

      // Convert sats to millisats
      const amountMsat = amountSats * 1000;

      // Request invoice
      const invoiceResponse = await this.requestInvoice(params, amountMsat, comment, payerData);
      console.log('✅ Invoice received:', invoiceResponse.pr.slice(0, 50) + '...');

      return {
        invoice: invoiceResponse.pr,
        successAction: invoiceResponse.successAction,
      };
    } catch (error) {
      console.error('❌ LNURL payment failed:', error);
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