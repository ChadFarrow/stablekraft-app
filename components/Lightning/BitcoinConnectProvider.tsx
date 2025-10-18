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
      message?: string;
      name?: string;
      value_msat?: number;
      value_msat_total?: number;
      sender_name?: string;
      feed?: string;
      feedId?: string;
      episode_guid?: string;
      remote_item_guid?: string;
      remote_feed_guid?: string;
      album?: string;
      uuid?: string;
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
    console.log('BitcoinConnectProvider useEffect - initializing Bitcoin Connect...');

    // Initialize Bitcoin Connect on component mount (client-side only)
    if (typeof window !== 'undefined') {
      import('@getalby/bitcoin-connect').then(({ init, onConnected, onDisconnected }) => {
        console.log('Initializing Bitcoin Connect early for browser extension detection');
        init({
          appName: 'StableKraft',
          showBalance: true, // Show balance in the modal
          // Don't specify filters to allow all connection methods including browser extensions
        });
        console.log('Bitcoin Connect initialized');

        // Listen for connection events
        onConnected((provider) => {
          console.log('Bitcoin Connect: Wallet connected event received');
          setProvider(provider);
          setIsConnected(true);
          setIsLoading(false);
        });

        onDisconnected(() => {
          console.log('Bitcoin Connect: Wallet disconnected event received');
          setProvider(null);
          setIsConnected(false);
        });

        // Check for existing connection from localStorage
        // Bitcoin Connect automatically persists connections
        import('@getalby/bitcoin-connect').then(({ requestProvider }) => {
          // Don't launch modal, just check if provider exists
          // Use a try-catch to avoid triggering the modal
          try {
            const checkProvider = async () => {
              try {
                // Check if webln is already available (browser extension)
                if ((window as any).webln) {
                  console.log('Found existing WebLN provider');
                  const existingProvider = (window as any).webln;
                  setProvider(existingProvider);
                  setIsConnected(true);
                }
              } catch (err) {
                console.log('No WebLN provider available');
              } finally {
                setIsLoading(false);
              }
            };
            checkProvider();
          } catch (error) {
            console.log('Error checking for provider:', error);
            setIsLoading(false);
          }
        });
      }).catch((error) => {
        console.error('Failed to load Bitcoin Connect:', error);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }

    // Add global CSS to ensure Bitcoin Connect modal is immediately interactive
    const style = document.createElement('style');
    style.textContent = `
      bc-modal-wrapper,
      bc-modal-wrapper *,
      bc-modal,
      bc-modal * {
        pointer-events: auto !important;
      }

      /* Ensure modal overlay allows clicks through to the modal */
      bc-modal-wrapper::part(overlay) {
        pointer-events: auto !important;
      }

      /* Ensure close button is immediately clickable */
      bc-modal::part(close-button),
      bc-modal [part="close-button"],
      bc-modal button[aria-label*="Close"],
      bc-modal button[aria-label*="close"] {
        pointer-events: auto !important;
        cursor: pointer !important;
        z-index: 9999 !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const connect = async () => {
    try {
      console.log('Attempting to connect wallet...');
      setIsLoading(true);

      // Use requestProvider() which automatically shows modal if no provider exists
      // This is the recommended approach per Bitcoin Connect docs
      const bitcoinConnect = await import('@getalby/bitcoin-connect');
      console.log('Bitcoin Connect imported, requesting provider...');

      try {
        // requestProvider will automatically launch modal if needed
        // If already connected, it returns existing provider
        const newProvider = await bitcoinConnect.requestProvider();
        console.log('Provider request result:', newProvider);

        if (newProvider) {
          console.log('Wallet connected successfully');
          setProvider(newProvider);
          setIsConnected(true);
        } else {
          console.log('No provider returned - user may have cancelled');
        }
      } catch (providerError) {
        console.error('Provider request error:', providerError);
        // User may have cancelled or there was an error
        throw providerError;
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
    console.log(`🔄 Starting invoice payment: ${invoice.slice(0, 50)}...`);
    
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        console.log('🔐 No provider, attempting to connect...');
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          console.error('❌ Failed to connect wallet for payment');
          return { error: 'No wallet connected' };
        }
      }

      console.log('⚡ Executing invoice payment');
      const result = await currentProvider.sendPayment(invoice);
      
      console.log('✅ Invoice payment successful:', { preimage: result.preimage?.slice(0, 20) + '...' });
      return { preimage: result.preimage };
    } catch (error) {
      console.error('❌ Invoice payment failed with error:', error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
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
      message?: string;
      name?: string;
      value_msat?: number;
      value_msat_total?: number;
      sender_name?: string;
      feed?: string;
      feedId?: string;
      episode_guid?: string;
      remote_item_guid?: string;
      remote_feed_guid?: string;
      album?: string;
      uuid?: string;
    }
  ): Promise<{ preimage?: string; error?: string }> => {
    console.log(`🔄 Starting keysend: ${amount} sats to ${pubkey.slice(0, 20)}...`);
    
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        console.log('🔐 No provider, attempting to connect...');
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          console.error('❌ Failed to connect wallet for keysend');
          return { error: 'No wallet connected' };
        }
      }

      const customRecords: Record<string, string> = {};

      // Add boostagram message if provided
      if (message) {
        // TLV record 34349334 is used for boostagram messages
        customRecords['34349334'] = Buffer.from(message).toString('hex');
        console.log('📝 Added boostagram message TLV');
      }

      // Add Helipad metadata if provided
      if (helipadMetadata) {
        try {
          // Clean the metadata object to remove any undefined/null values that could cause issues
          const cleanMetadata = Object.fromEntries(
            Object.entries(helipadMetadata).filter(([_, value]) => value !== undefined && value !== null)
          );
          
          // TLV record 7629169 is used for Helipad metadata (JSON)
          const helipadJson = JSON.stringify(cleanMetadata);
          // Try sending as raw JSON string instead of hex-encoded
          customRecords['7629169'] = helipadJson;
          
          console.log('📋 Helipad metadata TLV:', helipadJson);
        } catch (jsonError) {
          console.error('Failed to stringify Helipad metadata:', jsonError, helipadMetadata);
          // Continue without Helipad metadata if JSON fails
        }
      }

      if (!currentProvider.keysend) {
        console.error('❌ Wallet does not support keysend');
        return { error: 'Keysend not supported by wallet' };
      }

      console.log(`⚡ Executing keysend with ${Object.keys(customRecords).length} TLV records`);
      
      const keysendPayload = {
        destination: pubkey,
        amount: amount.toString(),
        customRecords,
      };
      
      console.log('📤 Keysend payload:', { 
        destination: pubkey, 
        amount: amount.toString(), 
        recordCount: Object.keys(customRecords).length 
      });

      const result = await currentProvider.keysend(keysendPayload);
      
      console.log('✅ Keysend successful:', { preimage: result.preimage?.slice(0, 20) + '...' });
      return { preimage: result.preimage };
    } catch (error) {
      console.error('❌ Keysend failed with error:', error);
      console.error('Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace'
      });
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