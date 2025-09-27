'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { BitcoinConnectProvider } from '@/components/Lightning/BitcoinConnectProvider';

// Lightning Context for Bitcoin payments using Bitcoin Connect
interface LightningContextType {
  sendPayment?: (invoice: string) => Promise<any>;
  generateInvoice?: (amount: number, memo?: string) => Promise<any>;
  getBalance?: () => Promise<number>;
  // Any other Lightning functions that might be used
  [key: string]: any;
}

const LightningContext = createContext<LightningContextType | null>(null);

export const LightningProvider = ({ children }: { children: ReactNode }) => {
  // Provide stub implementation for backward compatibility
  const value: LightningContextType = {
    sendPayment: async () => ({ success: false, message: 'Use BitcoinConnect directly' }),
    generateInvoice: async () => ({ success: false, message: 'Use BitcoinConnect directly' }),
    getBalance: async () => 0,
  };

  return (
    <LightningContext.Provider value={value}>
      <BitcoinConnectProvider>
        {children}
      </BitcoinConnectProvider>
    </LightningContext.Provider>
  );
};

export const useLightning = () => {
  const context = useContext(LightningContext);
  // Return empty object if no provider (prevents the error)
  return context || {};
};