'use client';

import React, { createContext, useContext, ReactNode } from 'react';

// Stub Lightning Context for Bitcoin payments - removes ITDV-Lightning dependency
// This provides compatibility for code that was ported from ITDV-Lightning project

interface LightningContextType {
  // Stub Lightning payment functions
  sendPayment?: (invoice: string) => Promise<any>;
  generateInvoice?: (amount: number, memo?: string) => Promise<any>;
  getBalance?: () => Promise<number>;
  // Any other Lightning functions that might be used
  [key: string]: any;
}

const LightningContext = createContext<LightningContextType | null>(null);

export const LightningProvider = ({ children }: { children: ReactNode }) => {
  // Stub implementation - no actual Lightning functionality
  const value: LightningContextType = {
    sendPayment: async () => ({ success: false, message: 'Lightning payments disabled' }),
    generateInvoice: async () => ({ success: false, message: 'Lightning payments disabled' }),
    getBalance: async () => 0,
  };

  return (
    <LightningContext.Provider value={value}>
      {children}
    </LightningContext.Provider>
  );
};

export const useLightning = () => {
  const context = useContext(LightningContext);
  // Return empty object if no provider (prevents the error)
  return context || {};
};