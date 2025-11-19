'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { WebLNProvider } from '@webbtc/webln-types';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { useNostr } from '@/contexts/NostrContext';

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
  const { isAuthenticated: isNostrAuthenticated, user: nostrUser } = useNostr();

  // Debug logging
  console.log('BitcoinConnectProvider render:', { isConnected, isLoading, isNostrAuthenticated });

  useEffect(() => {
    console.log('BitcoinConnectProvider useEffect - initializing Bitcoin Connect...');

    // CRITICAL: Check login type FIRST - skip WebLN initialization if user logged in with Amber (NIP-46/NIP-55)
    const loginType = typeof window !== 'undefined' ? localStorage.getItem('nostr_login_type') : null;
    if (loginType === 'nip46' || loginType === 'nip55' || loginType === 'amber') {
      console.log(`ℹ️ Amber login detected (${loginType}) - skipping WebLN initialization to prevent Alby popups`);
      setIsLoading(false);
      return;
    }

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
                // Double-check login type before enabling WebLN (in case it changed)
                const currentLoginType = typeof window !== 'undefined' ? localStorage.getItem('nostr_login_type') : null;
                if (currentLoginType === 'nip46') {
                  console.log('ℹ️ NIP-46 login detected during provider check - skipping WebLN enable');
                  setIsLoading(false);
                  return;
                }

                // Check if webln is already available (browser extension)
                // Don't auto-enable it to prevent popup on page load - wait for user action
                if ((window as any).webln) {
                  console.log('Found existing WebLN provider (will enable on user action)');
                  const existingProvider = (window as any).webln;
                  // Just detect it, don't enable yet - enable will happen when user clicks
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

  // Auto-connect WebLN when Nostr user is authenticated (Alby extension)
  // This will override any existing wallet connection to use the same Alby wallet for Lightning
  // Skip auto-connect for NIP-05 and NIP-46 logins (they don't use Alby extension)
  useEffect(() => {
    // Skip if user logged in with NIP-05 (read-only mode, no extension)
    const isNip05Login = nostrUser?.loginType === 'nip05';
    if (isNip05Login) {
      console.log('ℹ️ NIP-05 login detected - skipping WebLN auto-connect (read-only mode)');
      return;
    }

    // Skip if user logged in with NIP-46 (Amber) - they're not using Alby extension
    const isNip46Login = nostrUser?.loginType === 'nip46';
    if (isNip46Login) {
      console.log('ℹ️ NIP-46 login detected - skipping WebLN auto-connect (user chose Amber, not Alby)');
      return;
    }

    // Only auto-connect if user logged in with extension (NIP-07/Alby)
    const isExtensionLogin = nostrUser?.loginType === 'extension';
    if (!isExtensionLogin) {
      console.log('ℹ️ Not an extension login - skipping WebLN auto-connect');
      return;
    }

    // If Nostr user is authenticated with extension, detect WebLN (same wallet as Nostr)
    // Don't auto-enable to prevent popup - wait for user to click wallet button
    if (isNostrAuthenticated && typeof window !== 'undefined') {
      // Check if WebLN is available (Alby extension provides both Nostr and WebLN)
      if ((window as any).webln) {
        const weblnProvider = (window as any).webln;

        // Only switch if we're not already using this provider
        if (provider !== weblnProvider) {
          console.log('🔗 Nostr user authenticated with extension - WebLN detected (will enable on user action)');
          // Just set the provider, don't enable yet - enable will happen when user clicks
          setProvider(weblnProvider);
          setIsConnected(true);
          setIsLoading(false);
        }
      }
    }
  }, [isNostrAuthenticated, provider, nostrUser]);

  const connect = async () => {
    try {
      console.log('Attempting to connect wallet...');
      setIsLoading(true);

      // If Nostr user is authenticated, check for WebLN first (Alby extension)
      // Skip if user logged in with NIP-05 (read-only mode)
      const isNip05Login = nostrUser?.loginType === 'nip05';
      if (isNostrAuthenticated && !isNip05Login && typeof window !== 'undefined' && (window as any).webln) {
        console.log('🔗 Nostr user authenticated - using WebLN from Alby extension');
        try {
          const weblnProvider = (window as any).webln;
          
          // Enable WebLN if needed
          if (weblnProvider.enable) {
            await weblnProvider.enable();
          }
          
          console.log('✅ WebLN connected for Nostr user');
          setProvider(weblnProvider);
          setIsConnected(true);
          setIsLoading(false);
          return;
        } catch (weblnError) {
          console.warn('⚠️ Failed to connect WebLN for Nostr user:', weblnError);
          // Fall through to standard Bitcoin Connect flow
        }
      }

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

  const sendPayment = async (invoice: string, retryCount = 0): Promise<{ preimage?: string; error?: string }> => {
    console.log(`🔄 Starting invoice payment (attempt ${retryCount + 1}/3): ${invoice.slice(0, 50)}...`);

    try {
      let currentProvider = provider;

      if (!currentProvider) {
        console.log('🔐 No provider, attempting to connect...');
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          console.error('❌ Failed to connect wallet for payment');
          return { error: 'No wallet connected - please connect your Lightning wallet' };
        }
      }

      // Ensure provider is enabled before using it
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          await currentProvider.enable();
          console.log('✅ Provider enabled for payment');
        } catch (enableError) {
          console.warn('⚠️ Failed to enable provider:', enableError);
          return { error: 'Wallet must be unlocked - please check your Lightning wallet' };
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

      const errorMessage = error instanceof Error ? error.message : 'Payment failed';

      // Parse common Lightning errors and provide helpful feedback
      if (errorMessage.includes('FAILURE_REASON_NO_ROUTE') || errorMessage.includes('no route')) {
        // Retry once for routing failures (routes can be temporarily unavailable)
        if (retryCount < 2) {
          console.log(`⚠️ No route found, retrying in 1 second (attempt ${retryCount + 2}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendPayment(invoice, retryCount + 1);
        }
        return {
          error: 'Cannot find payment route to recipient - they may be offline or unreachable via Lightning Network'
        };
      } else if (errorMessage.includes('FAILURE_REASON_INSUFFICIENT_BALANCE') || errorMessage.includes('insufficient')) {
        return { error: 'Insufficient balance in your Lightning wallet' };
      } else if (errorMessage.includes('FAILURE_REASON_TIMEOUT') || errorMessage.includes('timeout')) {
        if (retryCount < 1) {
          console.log(`⚠️ Payment timeout, retrying in 1 second (attempt ${retryCount + 2}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendPayment(invoice, retryCount + 1);
        }
        return { error: 'Payment timed out - the recipient may be experiencing issues' };
      } else if (errorMessage.includes('FAILURE_REASON_INVOICE_EXPIRED') || errorMessage.includes('expired')) {
        return { error: 'Invoice has expired - please request a new invoice' };
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('user cancelled')) {
        return { error: 'Payment cancelled by user' };
      }

      return { error: errorMessage };
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
    },
    retryCount = 0
  ): Promise<{ preimage?: string; error?: string }> => {
    console.log(`🔄 Starting keysend (attempt ${retryCount + 1}/3): ${amount} sats to ${pubkey.slice(0, 20)}...`);

    try {
      let currentProvider = provider;

      if (!currentProvider) {
        console.log('🔐 No provider, attempting to connect...');
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          console.error('❌ Failed to connect wallet for keysend');
          return { error: 'No wallet connected - please connect your Lightning wallet' };
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

      // Ensure provider is enabled before using it
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          console.log('🔓 Enabling WebLN provider for keysend...');
          await currentProvider.enable();
          console.log('✅ Provider enabled for keysend');
        } catch (enableError) {
          console.warn('⚠️ Failed to enable provider:', enableError);
          // Check if Alby extension is being used by Nostr at the same time
          const loginType = typeof window !== 'undefined' ? localStorage.getItem('nostr_login_type') : null;
          if (loginType === 'extension') {
            return { error: 'Wallet locked - if using Alby for both Nostr and Lightning, try closing any Nostr popups first' };
          }
          return { error: 'Wallet must be unlocked - please check your Lightning wallet' };
        }
      }

      if (!currentProvider.keysend) {
        console.error('❌ Wallet does not support keysend');
        return { error: 'Keysend not supported by wallet - try connecting a different wallet' };
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

      const errorMessage = error instanceof Error ? error.message : 'Keysend failed';

      // Parse common Lightning errors and provide helpful feedback
      if (errorMessage.includes('FAILURE_REASON_NO_ROUTE') || errorMessage.includes('no route')) {
        // Retry once for routing failures (routes can be temporarily unavailable)
        if (retryCount < 2) {
          console.log(`⚠️ No route found, retrying in 1 second (attempt ${retryCount + 2}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendKeysend(pubkey, amount, message, helipadMetadata, retryCount + 1);
        }
        return {
          error: 'Cannot find payment route to recipient - they may be offline or unreachable via Lightning Network'
        };
      } else if (errorMessage.includes('FAILURE_REASON_INSUFFICIENT_BALANCE') || errorMessage.includes('insufficient')) {
        return { error: 'Insufficient balance in your Lightning wallet' };
      } else if (errorMessage.includes('FAILURE_REASON_TIMEOUT') || errorMessage.includes('timeout')) {
        if (retryCount < 1) {
          console.log(`⚠️ Payment timeout, retrying in 1 second (attempt ${retryCount + 2}/3)...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendKeysend(pubkey, amount, message, helipadMetadata, retryCount + 1);
        }
        return { error: 'Payment timed out - the recipient may be experiencing issues' };
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('user cancelled')) {
        return { error: 'Payment cancelled by user' };
      }

      return { error: errorMessage };
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