import { ValueRecipient, ValueTag } from './value-parser';
import { LNURLService } from './lnurl';
import { LIGHTNING_CONFIG } from './config';

export interface PaymentResult {
  success: boolean;
  preimage?: string;
  error?: string;
  recipient?: string;
  amount?: number;
}

export interface ValueSplitPayment {
  recipient: ValueRecipient;
  amount: number;
  result?: PaymentResult;
}

export interface MultiRecipientResult {
  success: boolean;
  totalAmount: number;
  successfulPayments: ValueSplitPayment[];
  failedPayments: ValueSplitPayment[];
  errors: string[];
  primaryPreimage?: string; // First successful preimage
  isPartialSuccess?: boolean; // True if 50%+ succeeded but not 100%
  successRate?: number; // 0-1 ratio of successful payments
}

export class ValueSplitsService {
  /**
   * Calculate payment amounts for each recipient based on their split percentages
   */
  static calculateSplitAmounts(
    recipients: ValueRecipient[],
    totalAmount: number
  ): Array<{ recipient: ValueRecipient; amount: number }> {
    const totalSplits = recipients.reduce((sum, r) => sum + r.split, 0);

    if (totalSplits === 0) {
      console.warn('No splits defined for recipients');
      return [];
    }

    // Calculate amounts and ensure minimum 1 sat per recipient
    const splits = recipients.map(recipient => ({
      recipient,
      amount: Math.max(1, Math.floor((recipient.split / totalSplits) * totalAmount)),
    }));

    // Adjust for rounding errors by adding remaining sats to largest recipient
    const totalCalculated = splits.reduce((sum, s) => sum + s.amount, 0);
    const difference = totalAmount - totalCalculated;

    if (difference !== 0) {
      const largestSplit = splits.reduce((max, current) =>
        current.amount > max.amount ? current : max
      );
      largestSplit.amount += difference;
    }

    return splits.filter(split => split.amount > 0);
  }

  /**
   * Send payments to multiple recipients using value splits
   */
  static async sendMultiRecipientPayment(
    recipients: ValueRecipient[],
    totalAmount: number,
    sendPayment: (invoice: string) => Promise<{ preimage?: string; error?: string }>,
    sendKeysend: (pubkey: string, amount: number, message?: string, helipadMetadata?: any) => Promise<{ preimage?: string; error?: string }>,
    message?: string,
    helipadMetadata?: any,
    onProgress?: (recipientAddress: string, status: 'sending' | 'success' | 'failed', error?: string, amount?: number) => void
  ): Promise<MultiRecipientResult> {
    const splitAmounts = this.calculateSplitAmounts(recipients, totalAmount);
    const successfulPayments: ValueSplitPayment[] = [];
    const failedPayments: ValueSplitPayment[] = [];
    const errors: string[] = [];

    console.log(`⚡ Sending ${totalAmount} sats to ${splitAmounts.length} recipients`);

    // Process each recipient
    for (let i = 0; i < splitAmounts.length; i++) {
      const { recipient, amount } = splitAmounts[i];

      // Add delay between payments to prevent overwhelming custodial wallets
      // Custodial services like Alby need time to process each payment on their backend
      if (i > 0) {
        const delay = 1500; // 1.5 seconds - gives custodial wallets time to process
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Notify that this payment is starting
      if (onProgress) {
        onProgress(recipient.address, 'sending', undefined, amount);
      }

      let result: PaymentResult;

      try {
        // Add timeout wrapper for faster failures
        const paymentPromise = (async () => {
          if (recipient.type === 'lnaddress' && LNURLService.isLightningAddress(recipient.address)) {
            // Pay via Lightning Address
            return await this.payLightningAddress(recipient, amount, message, sendPayment);
          } else if (recipient.type === 'node') {
            // Pay via keysend (with Helipad metadata)
            return await this.payKeysend(recipient, amount, message, sendKeysend, helipadMetadata);
          } else {
            return {
              success: false,
              error: `Unsupported recipient type: ${recipient.type}`,
              recipient: recipient.address,
              amount
            };
          }
        })();

        // Add 20 second timeout for individual payments
        // Custodial wallets may take longer due to backend processing and retries
        const timeoutPromise = new Promise<PaymentResult>((_, reject) => {
          setTimeout(() => reject(new Error('Payment timeout after 20 seconds')), 20000);
        });

        result = await Promise.race([paymentPromise, timeoutPromise]);

        const payment: ValueSplitPayment = { recipient, amount, result };

        if (result.success) {
          successfulPayments.push(payment);
          // Notify success
          if (onProgress) {
            onProgress(recipient.address, 'success', undefined, amount);
          }
        } else {
          failedPayments.push(payment);
          errors.push(`${recipient.name || recipient.address}: ${result.error}`);
          console.error(`❌ ${recipient.name || recipient.address.slice(0, 20)}: ${result.error}`);
          // Notify failure
          if (onProgress) {
            onProgress(recipient.address, 'failed', result.error, amount);
          }
        }
      } catch (error) {
        // Extract the actual Lightning error message
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
          errorMessage = error.message;
          // Check for common Lightning errors and provide clearer messages
          if (errorMessage.includes('no route') || errorMessage.includes('unreachable via Lightning Network')) {
            errorMessage = 'Cannot find payment route - recipient may be offline';
          } else if (errorMessage.includes('insufficient')) {
            errorMessage = 'Insufficient balance in wallet';
          } else if (errorMessage.includes('timeout') || errorMessage.includes('experiencing issues')) {
            errorMessage = 'Payment timeout - recipient may be experiencing issues';
          } else if (errorMessage.includes('rejected') || errorMessage.includes('cancelled')) {
            errorMessage = 'Payment rejected or cancelled';
          } else if (errorMessage.includes('NetworkError') || errorMessage.includes('fetch')) {
            errorMessage = 'Network error - check your connection';
          } else if (errorMessage.includes('HTTP 4') || errorMessage.includes('HTTP 5')) {
            errorMessage = 'Recipient server error - they may be experiencing downtime';
          }
        }

        const payment: ValueSplitPayment = {
          recipient,
          amount,
          result: { success: false, error: errorMessage, recipient: recipient.address, amount }
        };

        failedPayments.push(payment);
        errors.push(`${recipient.name || recipient.address}: ${errorMessage}`);
        console.error(`❌ ${recipient.name || recipient.address.slice(0, 20)}: ${errorMessage}`);
        // Notify failure
        if (onProgress) {
          onProgress(recipient.address, 'failed', errorMessage, amount);
        }
      }
    }

    const success = successfulPayments.length > 0;
    const primaryPreimage = successfulPayments[0]?.result?.preimage;
    const successRate = successfulPayments.length / splitAmounts.length;

    console.log(`📊 Multi-recipient payment complete: ${successfulPayments.length}/${splitAmounts.length} successful (${Math.round(successRate * 100)}%)`);

    // Consider partial success (>= 50%) as overall success for better UX
    const isPartialSuccess = successRate >= 0.5 && successRate < 1.0;

    return {
      success,
      totalAmount,
      successfulPayments,
      failedPayments,
      errors: isPartialSuccess ? 
        [`Partial success: ${successfulPayments.length}/${splitAmounts.length} recipients received payment`] : 
        errors,
      primaryPreimage,
      isPartialSuccess,
      successRate
    };
  }

  /**
   * Pay to a Lightning Address recipient
   */
  private static async payLightningAddress(
    recipient: ValueRecipient,
    amount: number,
    message: string | undefined,
    sendPayment: (invoice: string) => Promise<{ preimage?: string; error?: string }>
  ): Promise<PaymentResult> {
    try {
      const { invoice } = await LNURLService.payLightningAddress(
        recipient.address,
        amount,
        message
      );

      const result = await sendPayment(invoice);

      return {
        success: !result.error,
        preimage: result.preimage,
        error: result.error,
        recipient: recipient.address,
        amount
      };
    } catch (error) {
      // Extract the actual Lightning error message
      let errorMessage = 'Lightning Address payment failed';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Check for common Lightning errors and provide clearer messages
        if (errorMessage.includes('no route') || errorMessage.includes('unreachable via Lightning Network')) {
          errorMessage = 'Cannot find payment route - recipient may be offline';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance in wallet';
        } else if (errorMessage.includes('timeout') || errorMessage.includes('experiencing issues')) {
          errorMessage = 'Payment timeout - recipient may be experiencing issues';
        } else if (errorMessage.includes('rejected') || errorMessage.includes('cancelled')) {
          errorMessage = 'Payment rejected or cancelled';
        } else if (errorMessage.includes('NetworkError') || errorMessage.includes('fetch')) {
          errorMessage = 'Network error - check your connection';
        } else if (errorMessage.includes('HTTP 4') || errorMessage.includes('HTTP 5')) {
          errorMessage = 'Recipient server error - they may be experiencing downtime';
        } else if (errorMessage.includes('Invalid Lightning Address')) {
          errorMessage = 'Invalid Lightning Address format';
        }
      }

      return {
        success: false,
        error: errorMessage,
        recipient: recipient.address,
        amount
      };
    }
  }

  /**
   * Pay to a node recipient via keysend
   */
  private static async payKeysend(
    recipient: ValueRecipient,
    amount: number,
    message: string | undefined,
    sendKeysend: (pubkey: string, amount: number, message?: string, helipadMetadata?: any) => Promise<{ preimage?: string; error?: string }>,
    helipadMetadata?: any
  ): Promise<PaymentResult> {
    try {
      // Keysend with Helipad metadata
      const result = await sendKeysend(recipient.address, amount, message, helipadMetadata);
      
      return {
        success: !result.error,
        preimage: result.preimage,
        error: result.error,
        recipient: recipient.address,
        amount
      };
    } catch (error) {
      // Extract the actual Lightning error message
      let errorMessage = 'Keysend payment failed';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Check for common Lightning errors and provide clearer messages
        if (errorMessage.includes('no route') || errorMessage.includes('unreachable via Lightning Network')) {
          errorMessage = 'Cannot find payment route - recipient may be offline';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance in wallet';
        } else if (errorMessage.includes('timeout') || errorMessage.includes('experiencing issues')) {
          errorMessage = 'Payment timeout - recipient may be experiencing issues';
        } else if (errorMessage.includes('rejected') || errorMessage.includes('cancelled')) {
          errorMessage = 'Payment rejected or cancelled';
        } else if (errorMessage.includes('not supported')) {
          errorMessage = 'Keysend not supported by your wallet';
        }
      }

      return {
        success: false,
        error: errorMessage,
        recipient: recipient.address,
        amount
      };
    }
  }

  /**
   * Add platform fee to value splits
   */
  static addPlatformFee(
    recipients: ValueRecipient[],
    totalAmount: number
  ): { recipients: ValueRecipient[]; totalWithFee: number } {
    const platformFee = LIGHTNING_CONFIG.platform.fee || 0;
    const platformSplitPercentage = LIGHTNING_CONFIG.platform.splitPercentage || 0;

    if (platformFee === 0 && platformSplitPercentage === 0) {
      return { recipients, totalWithFee: totalAmount };
    }

    const feeAmount = Math.max(platformFee, Math.floor(totalAmount * (platformSplitPercentage / 100)));
    const totalWithFee = totalAmount + feeAmount;

    // Add platform as a fee recipient
    const platformRecipient: ValueRecipient = {
      name: 'Platform Fee',
      type: 'node',
      address: LIGHTNING_CONFIG.platform.nodePublicKey || '',
      split: (feeAmount / totalWithFee) * 100,
      fee: true
    };

    // Adjust existing recipients' splits to account for platform fee
    const adjustedRecipients = recipients.map(recipient => ({
      ...recipient,
      split: (recipient.split / 100) * (totalAmount / totalWithFee) * 100
    }));

    return {
      recipients: [...adjustedRecipients, platformRecipient],
      totalWithFee
    };
  }

  /**
   * Validate value splits configuration
   */
  static validateValueSplits(recipients: ValueRecipient[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (recipients.length === 0) {
      errors.push('No recipients defined');
      return { valid: false, errors };
    }

    const totalSplits = recipients.reduce((sum, r) => sum + r.split, 0);
    
    if (totalSplits <= 0) {
      errors.push('Total split percentage must be greater than 0');
    }

    if (totalSplits > 100) {
      errors.push('Total split percentage cannot exceed 100%');
    }

    for (const recipient of recipients) {
      if (!recipient.address) {
        errors.push(`Recipient ${recipient.name || 'Unknown'} has no address`);
      }

      if (recipient.split <= 0) {
        errors.push(`Recipient ${recipient.name || recipient.address} has invalid split percentage`);
      }

      if (recipient.type === 'lnaddress' && !LNURLService.isLightningAddress(recipient.address)) {
        errors.push(`Recipient ${recipient.name || recipient.address} has invalid Lightning Address format`);
      }

      if (recipient.type === 'node' && !this.isValidNodePubkey(recipient.address)) {
        errors.push(`Recipient ${recipient.name || recipient.address} has invalid node pubkey format`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check if a string is a valid node pubkey
   */
  private static isValidNodePubkey(pubkey: string): boolean {
    // Basic validation for 33-byte hex pubkey
    return /^[0-9a-fA-F]{66}$/.test(pubkey);
  }

  /**
   * Get summary of value splits for display
   */
  static getValueSplitsSummary(recipients: ValueRecipient[], totalAmount: number): string {
    const splitAmounts = this.calculateSplitAmounts(recipients, totalAmount);
    
    return splitAmounts
      .map(({ recipient, amount }) => 
        `${recipient.name || recipient.address.slice(0, 20)}...: ${amount} sats (${recipient.split}%)`
      )
      .join(', ');
  }
}
