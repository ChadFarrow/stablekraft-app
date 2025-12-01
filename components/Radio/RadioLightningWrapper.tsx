'use client';

import React, { createContext, useContext, ReactNode } from 'react';

// Bitcoin Connect interface for radio mode - provides dummy implementations
interface BitcoinConnectContextType {
  isConnected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendPayment: (invoice: string) => Promise<any>;
  sendKeysend: (destination: string, amount: number, message?: string, metadata?: any) => Promise<any>;
  getBalance: () => Promise<number>;
  getInfo: () => Promise<any>;
  [key: string]: any;
}

// Lightning Context for radio mode - provides no-op implementations  
interface LightningContextType {
  sendPayment?: (invoice: string) => Promise<any>;
  generateInvoice?: (amount: number, memo?: string) => Promise<any>;
  getBalance?: () => Promise<number>;
  [key: string]: any;
}

const RadioBitcoinConnectContext = createContext<BitcoinConnectContextType>({
  isConnected: false,
  connect: async () => {
    console.log('Bitcoin Connect disabled in radio mode');
  },
  disconnect: async () => {
    console.log('Bitcoin Connect disabled in radio mode');
  },
  sendPayment: async () => {
    console.log('Lightning payments disabled in radio mode');
    return { success: false, message: 'Payments disabled in radio mode' };
  },
  sendKeysend: async () => {
    console.log('Lightning keysend disabled in radio mode');
    return { success: false, message: 'Keysend disabled in radio mode' };
  },
  getBalance: async () => {
    console.log('Lightning balance check disabled in radio mode');
    return 0;
  },
  getInfo: async () => {
    console.log('Lightning info disabled in radio mode');
    return null;
  },
});

const RadioLightningContext = createContext<LightningContextType>({
  sendPayment: async () => ({ success: false, message: 'Payments disabled in radio mode' }),
  generateInvoice: async () => ({ success: false, message: 'Invoice generation disabled in radio mode' }),
  getBalance: async () => 0,
});

export function useBitcoinConnect(): BitcoinConnectContextType {
  const context = useContext(RadioBitcoinConnectContext);
  return context;
}

export function useLightning() {
  const context = useContext(RadioLightningContext);
  return context || {};
}

interface RadioLightningWrapperProps {
  children: ReactNode;
}

export default function RadioLightningWrapper({ children }: RadioLightningWrapperProps) {
  const bitcoinConnectValue: BitcoinConnectContextType = {
    isConnected: false,
    connect: async () => {
      console.log('Bitcoin Connect disabled in radio mode');
    },
    disconnect: async () => {
      console.log('Bitcoin Connect disabled in radio mode');
    },
    sendPayment: async () => {
      console.log('Lightning payments disabled in radio mode');
      return { success: false, message: 'Payments disabled in radio mode' };
    },
    sendKeysend: async () => {
      console.log('Lightning keysend disabled in radio mode');
      return { success: false, message: 'Keysend disabled in radio mode' };
    },
    getBalance: async () => {
      console.log('Lightning balance check disabled in radio mode');
      return 0;
    },
    getInfo: async () => {
      console.log('Lightning info disabled in radio mode');
      return null;
    },
  };

  const lightningValue: LightningContextType = {
    sendPayment: async () => ({ success: false, message: 'Payments disabled in radio mode' }),
    generateInvoice: async () => ({ success: false, message: 'Invoice generation disabled in radio mode' }),
    getBalance: async () => 0,
  };

  return (
    <RadioBitcoinConnectContext.Provider value={bitcoinConnectValue}>
      <RadioLightningContext.Provider value={lightningValue}>
        {children}
      </RadioLightningContext.Provider>
    </RadioBitcoinConnectContext.Provider>
  );
}