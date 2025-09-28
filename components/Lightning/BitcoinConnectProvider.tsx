'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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

  // Debug logging
  console.log('BitcoinConnectProvider render:', { isConnected, isLoading });

  useEffect(() => {
    console.log('BitcoinConnectProvider useEffect - initializing...');
    // Only initialize on client-side
    if (typeof window !== 'undefined') {
      // Use a more robust dynamic import approach
      const initializeBitcoinConnect = async () => {
        try {
          const bitcoinConnect = await import('@getalby/bitcoin-connect');
          console.log('Bitcoin Connect loaded successfully');
          
          // Initialize Bitcoin Connect
          bitcoinConnect.init({
            appName: 'FUCKIT Music',
            // Allow all connection methods by not specifying filters
          });

          // Check if already connected
          await checkConnection();
        } catch (error) {
          console.error('Failed to load Bitcoin Connect:', error);
          setIsLoading(false);
        }
      };
      
      initializeBitcoinConnect();
    } else {
      console.log('Server-side rendering, skipping Bitcoin Connect init');
      setIsLoading(false);
    }
  }, []);

  const checkConnection = async () => {
    try {
      console.log('Checking existing connection...');

      // Only check for existing Bitcoin Connect connections, skip auto WebLN
      // This allows users to choose their preferred wallet via the modal
      console.log('Checking Bitcoin Connect for existing provider...');
      const bitcoinConnect = await import('@getalby/bitcoin-connect');
      const existingProvider = await bitcoinConnect.requestProvider();
      if (existingProvider) {
        console.log('Found existing Bitcoin Connect provider, setting connected state');
        setProvider(existingProvider);
        setIsConnected(true);
      } else {
        console.log('No existing Bitcoin Connect provider found');
        setIsConnected(false);
      }
    } catch (error) {
      console.log('No existing connection:', error);
      setIsConnected(false);
    } finally {
      console.log('Finished checking connection, setting loading to false');
      setIsLoading(false);
    }
  };

  const connect = async () => {
    try {
      console.log('Attempting to connect wallet...');
      setIsLoading(true);

      // Import Bitcoin Connect and wait for it to be ready
      const bitcoinConnect = await import('@getalby/bitcoin-connect');

      // Simple direct approach - just launch the modal immediately
      try {
        console.log('Launching Bitcoin Connect modal...');

        // Check if Bitcoin Connect is properly initialized
        console.log('Bitcoin Connect object:', bitcoinConnect);

        // Launch modal and wait for it to actually appear
        const modalPromise = bitcoinConnect.launchModal();
        console.log('Modal launch promise created');

        await modalPromise;
        console.log('Modal launched successfully');

        // Add a small delay to ensure modal is visible
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log('Post-modal delay complete');

        // Try to get provider after modal interaction
        const newProvider = await bitcoinConnect.requestProvider();
        console.log('Provider request result:', newProvider);

        if (newProvider) {
          console.log('Wallet connected successfully');
          setProvider(newProvider);
          setIsConnected(true);
        } else {
          console.log('No provider returned - user may have cancelled');
        }
      } catch (modalError) {
        console.error('Modal error:', modalError);
        throw modalError;
      }

    } catch (error) {
      console.error('Failed to connect:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      const bitcoinConnect = await import('@getalby/bitcoin-connect');
      await bitcoinConnect.disconnect();
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