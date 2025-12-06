import type { WebLNProvider, RequestInvoiceArgs } from '@webbtc/webln-types';

declare global {
  interface Window {
    webln?: WebLNProvider;
  }
}

export class WebLNService {
  private provider: WebLNProvider | null = null;
  private isEnabled = false;

  /**
   * Check if WebLN is available in the browser
   */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && window.webln !== undefined;
  }

  /**
   * Enable WebLN provider
   */
  async enable(): Promise<boolean> {
    try {
      if (!this.isAvailable()) {
        console.log('WebLN not available');
        return false;
      }

      if (!this.provider) {
        this.provider = window.webln!;
      }

      if (!this.isEnabled) {
        await this.provider.enable();
        this.isEnabled = true;
        console.log('WebLN enabled successfully');
      }

      return true;
    } catch (error) {
      console.error('Failed to enable WebLN:', error);
      return false;
    }
  }

  /**
   * Send a keysend payment
   */
  async keysend(args: {
    destination: string;
    amount: number; // in sats
    customRecords?: Record<string, string>;
  }): Promise<{
    success: boolean;
    preimage?: string;
    error?: string;
  }> {
    try {
      if (!await this.enable()) {
        return { success: false, error: 'WebLN not available or not enabled' };
      }

      if (!this.provider) {
        return { success: false, error: 'WebLN provider not available' };
      }

      if (!this.provider.keysend) {
        return { success: false, error: 'Keysend is not supported by wallet' };
      }

      const result = await this.provider.keysend({
        destination: args.destination,
        amount: args.amount.toString(),
        customRecords: args.customRecords,
      });

      return {
        success: true,
        preimage: result.preimage,
      };
    } catch (error) {
      console.error('Keysend failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Keysend failed',
      };
    }
  }

  /**
   * Pay a Lightning invoice
   */
  async sendPayment(paymentRequest: string): Promise<{
    success: boolean;
    preimage?: string;
    error?: string;
  }> {
    try {
      if (!await this.enable()) {
        return { success: false, error: 'WebLN not available or not enabled' };
      }

      if (!this.provider) {
        return { success: false, error: 'WebLN provider not available' };
      }

      const result = await this.provider.sendPayment(paymentRequest);

      return {
        success: true,
        preimage: result.preimage,
      };
    } catch (error) {
      console.error('Payment failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Payment failed',
      };
    }
  }

  /**
   * Request an invoice from the user's wallet
   */
  async makeInvoice(args: {
    amount?: number; // in sats
    defaultMemo?: string;
  }): Promise<any | null> {
    try {
      if (!await this.enable()) {
        return null;
      }

      if (!this.provider) {
        return null;
      }

      const result = await this.provider.makeInvoice({
        amount: args.amount?.toString(),
        defaultMemo: args.defaultMemo,
      });

      return result;
    } catch (error) {
      console.error('Failed to create invoice:', error);
      return null;
    }
  }

  /**
   * Get node info from the connected wallet
   */
  async getInfo(): Promise<{
    node?: {
      alias: string;
      pubkey: string;
      color?: string;
    };
    methods: string[];
  } | null> {
    try {
      if (!await this.enable()) {
        return null;
      }

      if (!this.provider) {
        return null;
      }

      const info = await this.provider.getInfo();
      return info;
    } catch (error) {
      console.error('Failed to get WebLN info:', error);
      return null;
    }
  }

  /**
   * Check wallet balance (if supported)
   */
  async getBalance(): Promise<{
    balance?: number;
    currency?: string;
  } | null> {
    try {
      if (!await this.enable()) {
        return null;
      }

      // Not all WebLN providers support this
      if ('getBalance' in this.provider!) {
        const balance = await (this.provider as any).getBalance();
        return balance;
      }

      return null;
    } catch (error) {
      console.error('Failed to get balance:', error);
      return null;
    }
  }

  /**
   * Sign a message with the wallet
   */
  async signMessage(message: string): Promise<{
    signature?: string;
    error?: string;
  }> {
    try {
      if (!await this.enable()) {
        return { error: 'WebLN not available or not enabled' };
      }

      if (!this.provider) {
        return { error: 'WebLN provider not available' };
      }

      if (!this.provider.signMessage) {
        return { error: 'Message signing not supported by wallet' };
      }

      const result = await this.provider.signMessage(message);
      return { signature: result.signature };
    } catch (error) {
      console.error('Failed to sign message:', error);
      return {
        error: error instanceof Error ? error.message : 'Failed to sign message',
      };
    }
  }

  /**
   * Verify a signed message
   */
  async verifyMessage(args: {
    signature: string;
    message: string;
  }): Promise<boolean> {
    try {
      if (!await this.enable()) {
        return false;
      }

      if (!this.provider) {
        return false;
      }

      if (!this.provider.verifyMessage) {
        return false;
      }

      await this.provider.verifyMessage(args.signature, args.message);
      return true;
    } catch (error) {
      console.error('Failed to verify message:', error);
      return false;
    }
  }

  /**
   * Disable the WebLN provider
   */
  disable(): void {
    this.isEnabled = false;
    this.provider = null;
  }
}

// Create a singleton instance
export const webln = new WebLNService();