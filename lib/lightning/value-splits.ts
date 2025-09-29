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
    helipadMetadata?: any
  ): Promise<MultiRecipientResult> {
    const splitAmounts = this.calculateSplitAmounts(recipients, totalAmount);
    const successfulPayments: ValueSplitPayment[] = [];
    const failedPayments: ValueSplitPayment[] = [];
    const errors: string[] = [];

    console.log(`⚡ Sending multi-recipient payment: ${totalAmount} sats to ${splitAmounts.length} recipients`);

    // Process each recipient
    for (let i = 0; i < splitAmounts.length; i++) {
      const { recipient, amount } = splitAmounts[i];
      console.log(`💸 Processing ${recipient.name || 'Unknown'}: ${amount} sats (${recipient.split}%) to ${recipient.address.slice(0, 20)}...`);

      // Add delay between payments to prevent rapid sequential keysend failures
      if (i > 0) {
        console.log(`⏳ Waiting 2 seconds before next payment...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      let result: PaymentResult;

      try {
        if (recipient.type === 'lnaddress' && LNURLService.isLightningAddress(recipient.address)) {
          // Pay via Lightning Address
          result = await this.payLightningAddress(recipient, amount, message, sendPayment);
        } else if (recipient.type === 'node') {
          // Pay via keysend (with Helipad metadata)
          result = await this.payKeysend(recipient, amount, message, sendKeysend, helipadMetadata);
        } else {
          result = {
            success: false,
            error: `Unsupported recipient type: ${recipient.type}`,
            recipient: recipient.address,
            amount
          };
        }

        const payment: ValueSplitPayment = { recipient, amount, result };

        if (result.success) {
          successfulPayments.push(payment);
          console.log(`✅ Successfully sent ${amount} sats to ${recipient.name || recipient.address.slice(0, 20)}...`);
        } else {
          failedPayments.push(payment);
          errors.push(`${recipient.name || recipient.address}: ${result.error}`);
          console.error(`❌ Failed to send ${amount} sats to ${recipient.name || recipient.address}: ${result.error}`);
        }
      } catch (error) {
        // Extract the actual Lightning error message
        let errorMessage = 'Unknown error';
        if (error instanceof Error) {
          errorMessage = error.message;
          // Check for common Lightning errors and provide clearer messages
          if (errorMessage.includes('no route')) {
            errorMessage = 'No route found to recipient';
          } else if (errorMessage.includes('insufficient')) {
            errorMessage = 'Insufficient balance or liquidity';
          } else if (errorMessage.includes('timeout')) {
            errorMessage = 'Payment timeout';
          } else if (errorMessage.includes('rejected')) {
            errorMessage = 'Payment rejected by recipient';
          } else if (errorMessage.includes('NetworkError')) {
            errorMessage = 'Network error - recipient server unreachable';
          } else if (errorMessage.includes('CORS')) {
            errorMessage = 'CORS error - recipient server configuration issue';
          }
        }
        
        const payment: ValueSplitPayment = { 
          recipient, 
          amount, 
          result: { success: false, error: errorMessage, recipient: recipient.address, amount }
        };
        
        failedPayments.push(payment);
        errors.push(`${recipient.name || recipient.address}: ${errorMessage}`);
        console.error(`❌ Exception sending to ${recipient.name || recipient.address}:`, error);
      }
    }

    const success = successfulPayments.length > 0;
    const primaryPreimage = successfulPayments[0]?.result?.preimage;

    console.log(`📊 Multi-recipient payment complete: ${successfulPayments.length}/${splitAmounts.length} successful`);

    return {
      success,
      totalAmount,
      successfulPayments,
      failedPayments,
      errors,
      primaryPreimage
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
        if (errorMessage.includes('no route')) {
          errorMessage = 'No route found to recipient';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance or liquidity';
        } else if (errorMessage.includes('timeout')) {
          errorMessage = 'Payment timeout';
        } else if (errorMessage.includes('rejected')) {
          errorMessage = 'Payment rejected by recipient';
        } else if (errorMessage.includes('NetworkError')) {
          errorMessage = 'Network error - recipient server unreachable';
        } else if (errorMessage.includes('CORS')) {
          errorMessage = 'CORS error - recipient server configuration issue';
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
        if (errorMessage.includes('no route')) {
          errorMessage = 'No route found to recipient';
        } else if (errorMessage.includes('insufficient')) {
          errorMessage = 'Insufficient balance or liquidity';
        } else if (errorMessage.includes('timeout')) {
          errorMessage = 'Payment timeout';
        } else if (errorMessage.includes('rejected')) {
          errorMessage = 'Payment rejected by recipient';
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
