// Lightning Network Configuration
export const LIGHTNING_CONFIG = {
  // Platform configuration for fee collection
  platform: {
    nodePublicKey: process.env.NEXT_PUBLIC_PLATFORM_NODE_PUBKEY || '',
    fee: 2, // Platform fee in sats per boost
    splitPercentage: 1, // Platform gets 1% of value splits
  },

  // Default boost amounts (in sats)
  defaultAmounts: {
    small: 21,
    medium: 100,
    large: 500,
    autoBoost: 25, // Auto-boost amount when song ends
  },

  // Boost presets for quick selection
  boostPresets: [21, 50, 100, 250, 500, 1000, 5000, 10000],

  // Message configuration
  boostagram: {
    maxLength: 250,
    placeholder: 'Send a message with your boost...',
  },


  // UI Configuration
  ui: {
    showBalance: true,
    showPaymentHistory: true,
    allowCustomAmounts: true,
    showValueSplits: true,
  },

  // Feature flags
  features: {
    webln: true,
    nwc: true,
    lightningAddress: true,
    keysend: true,
    autoBoost: false, // Disabled by default, user must enable
    boostagrams: true,
    nostrIntegration: false, // Disabled until configured
    helipadIntegration: false, // Disabled until configured
  },
};

// Type definitions
export interface LightningPayment {
  amount: number; // in sats
  recipient: string; // Lightning address, node pubkey, or LNURL
  message?: string;
  customKey?: string;
  customValue?: string;
  timestamp?: number;
}

export interface ValueSplit {
  name?: string;
  address: string; // Lightning address or node pubkey
  split: number; // Percentage 0-100
  type: 'node' | 'lnaddress';
  fee?: boolean;
  customKey?: string;
  customValue?: string;
}

export interface BoostTransaction {
  id: string;
  trackId?: string;
  feedId?: string;
  amount: number;
  message?: string;
  senderName?: string;
  paymentHash?: string;
  preimage?: string;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';
  source: 'webln' | 'nwc' | 'helipad' | 'manual';
}

export interface PaymentResult {
  success: boolean;
  preimage?: string;
  paymentHash?: string;
  error?: string;
  details?: any;
}