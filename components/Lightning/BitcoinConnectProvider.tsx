'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { init, launchModal, launchPaymentModal, requestProvider, disconnect } from '@getalby/bitcoin-connect';
import type { WebLNProvider } from '@webbtc/webln-types';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';

interface BitcoinConnectContextType {
  isConnected: boolean;
  provider: WebLNProvider | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendPayment: (invoice: string) => Promise<{ preimage?: string; error?: string }>;
  sendKeysend: (pubkey: string, amount: number, message?: string) => Promise<{ preimage?: string; error?: string }>;
  isLoading: boolean;
}

const BitcoinConnectContext = createContext<BitcoinConnectContextType | null>(null);

export function BitcoinConnectProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [provider, setProvider] = useState<WebLNProvider | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Only initialize on client-side
    if (typeof window !== 'undefined') {
      // Initialize Bitcoin Connect
      init({
        appName: 'FUCKIT Music',
        filters: ['nwc'],
      });

      // Check if already connected
      checkConnection();
    } else {
      setIsLoading(false);
    }
  }, []);

  const checkConnection = async () => {
    try {
      const existingProvider = await requestProvider();
      if (existingProvider) {
        setProvider(existingProvider);
        setIsConnected(true);
      }
    } catch (error) {
      console.log('No existing connection');
    } finally {
      setIsLoading(false);
    }
  };

  const connect = async () => {
    try {
      setIsLoading(true);
      await launchModal();
      const newProvider = await requestProvider();
      if (newProvider) {
        setProvider(newProvider);
        setIsConnected(true);
      }
    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      await disconnect();
      setProvider(null);
      setIsConnected(false);
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const sendPayment = async (invoice: string): Promise<{ preimage?: string; error?: string }> => {
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          return { error: 'No wallet connected' };
        }
      }

      const result = await currentProvider.sendPayment(invoice);
      return { preimage: result.preimage };
    } catch (error) {
      console.error('Payment failed:', error);
      return { error: error instanceof Error ? error.message : 'Payment failed' };
    }
  };

  const sendKeysend = async (
    pubkey: string,
    amount: number,
    message?: string
  ): Promise<{ preimage?: string; error?: string }> => {
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          return { error: 'No wallet connected' };
        }
      }

      const customRecords: Record<string, string> = {};

      // Add boostagram message if provided
      if (message) {
        // TLV record 34349334 is used for boostagram messages
        customRecords['34349334'] = Buffer.from(message).toString('hex');
      }

      if (!currentProvider.keysend) {
        return { error: 'Keysend not supported by wallet' };
      }

      const result = await currentProvider.keysend({
        destination: pubkey,
        amount: amount.toString(),
        customRecords,
      });

      return { preimage: result.preimage };
    } catch (error) {
      console.error('Keysend failed:', error);
      return { error: error instanceof Error ? error.message : 'Keysend failed' };
    }
  };

  return (
    <BitcoinConnectContext.Provider
      value={{
        isConnected,
        provider,
        connect,
        disconnect: disconnectWallet,
        sendPayment,
        sendKeysend,
        isLoading,
      }}
    >
      {children}
    </BitcoinConnectContext.Provider>
  );
}

export function useBitcoinConnect() {
  const context = useContext(BitcoinConnectContext);
  if (!context) {
    throw new Error('useBitcoinConnect must be used within BitcoinConnectProvider');
  }
  return context;
}