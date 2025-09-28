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
  sendKeysend: (
    pubkey: string, 
    amount: number, 
    message?: string,
    helipadMetadata?: {
      app_name?: string;
      app_version?: string;
      podcast?: string;
      episode?: string;
      ts?: number;
      action?: string;
      url?: string;
      name?: string;
      value_msat?: number;
    }
  ) => Promise<{ preimage?: string; error?: string }>;
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
    console.log('BitcoinConnectProvider useEffect - setting ready state...');
    // Don't auto-initialize Bitcoin Connect, only set loading to false
    setIsLoading(false);
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

      // Import and initialize Bitcoin Connect when user clicks
      const bitcoinConnect = await import('@getalby/bitcoin-connect');
      console.log('Bitcoin Connect imported successfully');

      // Initialize Bitcoin Connect only when needed
      bitcoinConnect.init({
        appName: 'FUCKIT Music',
        // Allow all connection methods by not specifying filters
      });
      console.log('Bitcoin Connect initialized');

      // Launch the modal
      try {
        console.log('Launching Bitcoin Connect modal...');
        await bitcoinConnect.launchModal();
        console.log('Modal launched successfully');

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
    message?: string,
    helipadMetadata?: {
      app_name?: string;
      app_version?: string;
      podcast?: string;
      episode?: string;
      ts?: number;
      action?: string;
      url?: string;
      name?: string;
      value_msat?: number;
    }
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

      // Add Helipad metadata if provided
      if (helipadMetadata) {
        // TLV record 7629169 is used for Helipad metadata
        const helipadJson = JSON.stringify(helipadMetadata);
        customRecords['7629169'] = Buffer.from(helipadJson).toString('hex');
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