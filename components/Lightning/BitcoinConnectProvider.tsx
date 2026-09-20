'use client';

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { APP_NAME } from '@/lib/constants';
import type { WebLNProvider } from '@webbtc/webln-types';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { useNostr } from '@/contexts/NostrContext';
import {
  WalletProviderType,
  WalletInfo,
  detectWalletProviderType,
  inferLightningAddress,
  fetchCoinosProfile,
  fetchCoinosUserByPubkey,
} from '@/lib/lightning/wallet-detection';
import { WalletConnectModal } from './WalletConnectModal';

import { isDataSaverOn } from '@/lib/data-saver';

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
  makeInvoice: (amount: number, memo?: string) => Promise<{ invoice?: string; error?: string }>;
  isLoading: boolean;
  supportsKeysend: boolean;
  /** Open the wallet modal straight on the "save this wallet to Nostr?" step. */
  openBackupOffer: () => void;
  // Enhanced wallet info
  walletInfo: WalletInfo | null;
  balance: number | null;
  isBalanceLoading: boolean;
  refreshBalance: () => Promise<void>;
  walletProviderType: WalletProviderType;
}

const BitcoinConnectContext = createContext<BitcoinConnectContextType | null>(null);

export function BitcoinConnectProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [provider, setProvider] = useState<WebLNProvider | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [manuallyDisconnected, setManuallyDisconnected] = useState(() => {
    // Initialize from localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem('wallet_manually_disconnected') === 'true';
    }
    return false;
  });
  const { isAuthenticated: isNostrAuthenticated, user: nostrUser } = useNostr();

  // Enhanced wallet info state
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [walletProviderType, setWalletProviderType] = useState<WalletProviderType>('unknown');
  const [keysendSupported, setKeysendSupported] = useState<boolean | null>(null); // null = not probed yet
  const balanceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Wallet picker (our own modal, rendered below). connect() opens it and holds
  // the caller's resolver here until it closes.
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [walletModalView, setWalletModalView] = useState<'picker' | 'offer-backup'>('picker');
  const walletModalResolveRef = useRef<(() => void) | null>(null);
  const backupOfferCheckedRef = useRef(false);

  /**
   * Load and initialise bitcoin-connect, exactly once, whenever it is first
   * needed. Idempotent: every caller gets the same promise.
   *
   * Extracted so Data Saver can DEFER it. `init()` configures persistence, the
   * auto-reconnect from localStorage['bc:config'] and the appName handed to NWC
   * connectors, so it has to have run before any wallet action — which is why
   * every path that opens the wallet modal calls this first.
   */
  const bitcoinConnectReadyRef = useRef<Promise<void> | null>(null);
  const ensureBitcoinConnect = useCallback((): Promise<void> => {
    if (bitcoinConnectReadyRef.current) return bitcoinConnectReadyRef.current;

    bitcoinConnectReadyRef.current = import('@getalby/bitcoin-connect').then(
      ({ init, onConnected, onDisconnected }) => {
        init({
          appName: APP_NAME,
          showBalance: true,
        });

        // Listen for connection events
        onConnected((provider) => {
          console.log('\u2705 Bitcoin Connect: onConnected event', provider);
          setProvider(provider);
          setIsConnected(true);
          setIsLoading(false);
          console.log('\u2705 State updated: isConnected = true');
        });

        onDisconnected(() => {
          console.log('\ud83d\udd0c Bitcoin Connect: onDisconnected event');
          setProvider(null);
          setIsConnected(false);
        });
      }
    );

    return bitcoinConnectReadyRef.current;
  }, []);

  useEffect(() => {
    // Initialize Bitcoin Connect on component mount (client-side only)
    // Note: We always initialize Bitcoin Connect even for NIP-46/NIP-55/Amber logins
    // because users may separately connect an NWC wallet for Lightning payments.
    // init() doesn't trigger popups — only requestProvider()/launchModal() do.
    // The WebLN auto-connect for Alby is guarded separately below.
    //
    // Still required even though wallet selection is now our own modal: init()
    // configures persistence, the auto-reconnect from localStorage['bc:config'],
    // and the appName passed to NWC connectors.
    if (typeof window !== 'undefined') {
      /**
       * Data Saver defers this 398 KB chunk — but ONLY when there is provably
       * nothing for it to do.
       *
       * Everything the eager load accomplishes needs a wallet that already
       * exists: the auto-reconnect reads localStorage['bc:config'], and the
       * listeners below cannot fire without one. With neither that key nor a
       * pending post-login restore, this import is 398 KB on the critical path
       * of every page in the app in exchange for nothing at all.
       *
       * So a user who HAS connected a wallet keeps today's behaviour exactly,
       * in either mode. A user who has not gets the bytes back, and
       * `ensureBitcoinConnect` runs the moment they open the wallet modal.
       */
      const hasWalletToRestore =
        localStorage.getItem('bc:config') !== null ||
        localStorage.getItem('wallet_restore_after_login') === 'true';

      if (isDataSaverOn() && !hasWalletToRestore) {
        console.log('ℹ️ Data Saver: deferring Bitcoin Connect — no saved wallet to restore.');
        setIsLoading(false);
        return;
      }

      ensureBitcoinConnect().then(() => {
        // Handle wallet restoration after Nostr login (Android fix)
        // Check if we should restore wallet connection after page reload from Nostr login
        const shouldRestoreWallet = localStorage.getItem('wallet_restore_after_login') === 'true';
        if (shouldRestoreWallet) {
          console.log('🔄 Wallet flagged for restoration after Nostr login');
          // Clear the restore flag
          localStorage.removeItem('wallet_restore_after_login');
          // Clear manual disconnect flag to allow Bitcoin Connect to auto-reconnect
          localStorage.setItem('wallet_manually_disconnected', 'false');
          setManuallyDisconnected(false);

          // Force wallet reconnection after Nostr login by calling requestProvider.
          //
          // requestProvider() LAUNCHES THE BITCOIN CONNECT MODAL when no provider
          // is available, so it must only be called when a saved connection
          // actually exists — otherwise logging in with Nostr pops up the very
          // modal we replaced.
          //
          // The check reads localStorage['bc:config'] rather than
          // getConnectorConfig(): the library kicks off its own reconnect from
          // that key at module-load time, so the in-memory connectorConfig is
          // still undefined while that attempt is in flight. localStorage is the
          // durable signal for "this user had a wallet".
          import('@getalby/bitcoin-connect').then(async ({ requestProvider }) => {
            try {
              if (!localStorage.getItem('bc:config')) {
                console.log('ℹ️ No saved wallet config — skipping restore (would open the wallet modal)');
                return; // the finally below still clears isLoading
              }
              console.log('🔍 Restoring wallet connection after Nostr login...');
              const restoredProvider = await requestProvider();
              if (restoredProvider) {
                console.log('✅ Wallet successfully restored after Nostr login');
                setProvider(restoredProvider);
                setIsConnected(true);
              }
            } catch (err) {
              console.warn('⚠️ Failed to restore wallet after Nostr login:', err);
            } finally {
              setIsLoading(false);
            }
          });
        } else {
          // Normal page load: Don't call requestProvider to avoid unwanted popups
          // Bitcoin Connect will automatically reconnect via onConnected event if:
          // 1. A saved connection exists in localStorage
          // 2. The connection is still valid
          console.log('ℹ️ Bitcoin Connect initialized. Will auto-reconnect via onConnected event if saved connection exists.');
          setIsLoading(false);
        }
      }).catch((error) => {
        console.error('Failed to load Bitcoin Connect:', error);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }

    // No `bc-modal` CSS shim here any more: wallet selection is now our own
    // WalletConnectModal, and nothing in the app renders bitcoin-connect's web
    // components. The library is still used for the connectors themselves.
    //
    // ensureBitcoinConnect is a useCallback([]) and therefore stable; naming it
    // satisfies the exhaustive-deps rule without changing that this runs once.
  }, [ensureBitcoinConnect]);

  // Auto-connect WebLN when Nostr user is authenticated (Alby extension)
  // This will override any existing wallet connection to use the same Alby wallet for Lightning
  // Skip auto-connect for NIP-05 and NIP-46 logins (they don't use Alby extension)
  useEffect(() => {
    // Skip if user logged in with NIP-05 (read-only mode, no extension)
    const isNip05Login = nostrUser?.loginType === 'nip05';
    if (isNip05Login) {
      return;
    }

    // Skip if user logged in with NIP-46 (Amber) - they're not using Alby extension
    const isNip46Login = nostrUser?.loginType === 'nip46';
    if (isNip46Login) {
      return;
    }

    // Only auto-connect if user logged in with extension (NIP-07/Alby)
    const isExtensionLogin = nostrUser?.loginType === 'extension';
    if (!isExtensionLogin) {
      return;
    }

    // If Nostr user is authenticated with extension, detect WebLN (same wallet as Nostr)
    // Don't auto-enable to prevent popup - wait for user to click wallet button
    // ONLY auto-connect if user hasn't manually disconnected
    const wasManuallyDisconnected = typeof window !== 'undefined'
      ? localStorage.getItem('wallet_manually_disconnected') === 'true'
      : false;

    if (isNostrAuthenticated && typeof window !== 'undefined' && !wasManuallyDisconnected) {
      // Check if WebLN is available (Alby extension provides both Nostr and WebLN)
      if ((window as any).webln) {
        const weblnProvider = (window as any).webln;

        // Only auto-connect if NO wallet is connected yet
        // If user already connected via Bitcoin Connect (including NWC), respect that choice
        if (!provider && !isConnected) {
          // Just set the provider, don't enable yet - enable will happen when user clicks
          setProvider(weblnProvider);
          setIsConnected(true);
          setIsLoading(false);
        }
      }
    }
  }, [isNostrAuthenticated, provider, nostrUser]);

  // Fetch wallet balance
  const fetchBalance = useCallback(async (currentProvider: WebLNProvider): Promise<number | null> => {
    try {
      // Check if getBalance method exists
      if (!currentProvider.getBalance) {
        console.log('ℹ️ Wallet does not support getBalance');
        return null;
      }

      // Ensure provider is enabled before calling getBalance
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          await currentProvider.enable();
        } catch (enableError) {
          // Provider not enabled - silently skip balance fetch
          return null;
        }
      }

      setIsBalanceLoading(true);
      const response = await currentProvider.getBalance();
      return response.balance;
    } catch (error) {
      console.warn('Failed to fetch balance:', error);
      return null;
    } finally {
      setIsBalanceLoading(false);
    }
  }, []);

  // Refresh balance function exposed to context
  const refreshBalance = useCallback(async () => {
    if (!provider) return;
    const newBalance = await fetchBalance(provider);
    if (newBalance !== null) {
      setBalance(newBalance);
    }
  }, [provider, fetchBalance]);

  // Fetch wallet info when provider changes
  useEffect(() => {
    const fetchWalletInfo = async () => {
      if (!provider || !isConnected) {
        setWalletInfo(null);
        setBalance(null);
        setWalletProviderType('unknown');
        setKeysendSupported(null);
        return;
      }

      try {
        // Detect wallet provider type
        const { type, name, nwcPubkey } = await detectWalletProviderType();
        setWalletProviderType(type);

        const hasKeysendMethod = !!provider.keysend;
        const fallbackTypeAllowsKeysend =
          type === 'alby' || type === 'alby-hub' || type === 'extension' || type === 'coinos';

        // Phase 1: eager synchronous keysend answer before getInfo()'s relay round-trip.
        // Closes the race where the boost modal opens during the 1–5s NWC get_info window
        // and the UI banner + lnaddress keysend-fallback gate see keysendSupported === null
        // even though provider.keysend is already live. Primal (type 'nwc') stays false here
        // and gets further confirmed false by the methods-array check below.
        setKeysendSupported(hasKeysendMethod && fallbackTypeAllowsKeysend);

        // Try to get wallet info via getInfo()
        let alias = '';
        let pubkey = '';
        let advertisedMethods: string[] = [];

        try {
          if (provider.getInfo) {
            // Ensure provider is enabled before calling getInfo
            if (provider.enable && typeof provider.enable === 'function') {
              await provider.enable();
            }
            const info = await provider.getInfo();
            alias = info.node?.alias || '';
            pubkey = info.node?.pubkey || '';
            advertisedMethods = Array.isArray(info.methods) ? info.methods.map(String) : [];
          }
        } catch (infoError) {
          // Silently handle enable/getInfo failures - wallet may not be unlocked yet
          console.log('ℹ️ Could not get wallet info (wallet may need to be unlocked)');
        }

        // Infer Lightning Address based on provider type and alias
        const lightningAddress = inferLightningAddress(alias, type);

        // Check capabilities - ensure provider is enabled first
        // Some providers (like Alby extension) only expose methods after enable()
        try {
          if (provider.enable && typeof provider.enable === 'function') {
            await provider.enable();
          }
        } catch (enableError) {
          // Continue anyway - some providers don't need enable
          console.log('ℹ️ Provider enable failed or not needed');
        }

        const supportsBalance = !!provider.getBalance;

        // Phase 2: combine both signals. Either a wallet's own capability advertisement
        // (WebLN GetInfoResponse.methods — NWC uses 'pay_keysend'/'multi_pay_keysend',
        // extensions use 'keysend') OR the conservative type whitelist is enough to allow
        // keysend. Using OR instead of "methods overrides" avoids a false negative when a
        // known-good wallet's methods array is partial/stale (the original methods-first
        // version in 2a927a60 flipped Alby Hub users to unsupported when get_info omitted
        // pay_keysend). Primal stays rejected because both signals fail for it (type is
        // 'nwc', not in whitelist, and its methods array lacks pay_keysend).
        const methodsAdvertiseKeysend =
          advertisedMethods.includes('pay_keysend') ||
          advertisedMethods.includes('multi_pay_keysend') ||
          advertisedMethods.includes('keysend');
        const keysendActuallySupported =
          hasKeysendMethod && (methodsAdvertiseKeysend || fallbackTypeAllowsKeysend);
        console.log('🔌 Wallet capabilities:', {
          providerType: type,
          hasKeysendMethod,
          advertisedMethods,
          methodsAdvertiseKeysend,
          keysendActuallySupported,
        });
        setKeysendSupported(keysendActuallySupported);

        // Fetch Coinos profile for avatar and username
        let avatarUrl: string | undefined;
        let username: string | undefined;

        if (type === 'coinos') {
          // First try to auto-lookup by NWC pubkey (no user input needed!)
          if (nwcPubkey) {
            const profile = await fetchCoinosUserByPubkey(nwcPubkey);
            if (profile) {
              avatarUrl = profile.avatarUrl;
              username = profile.username;
              // Save to localStorage so WalletInfoDisplay can use it
              if (username && typeof window !== 'undefined') {
                localStorage.setItem('coinos_username', username);
              }
            }
          }

          // Fallback to alias-based lookup if pubkey lookup failed
          if (!username && alias && alias !== 'ln.coinos.io') {
            const profile = await fetchCoinosProfile(alias);
            if (profile) {
              avatarUrl = profile.avatarUrl;
              username = profile.username;
            }
          }
        }

        setWalletInfo({
          alias,
          pubkey,
          lightningAddress,
          providerType: type,
          providerName: name,
          supportsBalance,
          supportsKeysend: keysendActuallySupported,
          avatarUrl,
          username,
        });

        console.log('📋 Wallet info fetched:', {
          providerType: type,
          providerName: name,
          alias,
          lightningAddress,
          supportsBalance,
        });

        // Fetch initial balance
        if (supportsBalance) {
          const initialBalance = await fetchBalance(provider);
          if (initialBalance !== null) {
            setBalance(initialBalance);
          }
        }
      } catch (error) {
        console.error('Failed to fetch wallet info:', error);
      }
    };

    fetchWalletInfo();
  }, [provider, isConnected, fetchBalance]);

  // Set up balance polling interval (every 60 seconds)
  useEffect(() => {
    // Clear any existing interval
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current);
      balanceIntervalRef.current = null;
    }

    // Only set up polling if connected and wallet supports balance
    if (!isConnected || !provider || !provider.getBalance) {
      return;
    }

    // Poll balance every 60 seconds
    balanceIntervalRef.current = setInterval(async () => {
      const newBalance = await fetchBalance(provider);
      if (newBalance !== null) {
        setBalance(newBalance);
      }
    }, 60000);

    return () => {
      if (balanceIntervalRef.current) {
        clearInterval(balanceIntervalRef.current);
        balanceIntervalRef.current = null;
      }
    };
  }, [isConnected, provider, fetchBalance]);

  // Clear wallet info on disconnect
  useEffect(() => {
    if (!isConnected) {
      setWalletInfo(null);
      setBalance(null);
      setWalletProviderType('unknown');
      setKeysendSupported(null);
    }
  }, [isConnected]);

  /**
   * Opens StableKraft's own wallet picker (WalletConnectModal), which drives the
   * bitcoin-connect connectors directly. Connection state still arrives through
   * the onConnected subscription set up above — this function only owns the view.
   *
   * Resolves when the modal closes, which is the same fire-and-forget contract
   * callers already had: the old implementation awaited launchModal(), which
   * returns void and never waited for a connection either.
   */
  const connect = async (): Promise<void> => {
    // Clear manual disconnect flag when user explicitly connects
    setManuallyDisconnected(false);
    localStorage.setItem('wallet_manually_disconnected', 'false');

    // A second call while the picker is already open just re-uses it, and must not
    // strand the first caller's promise.
    if (walletModalResolveRef.current) {
      walletModalResolveRef.current();
      walletModalResolveRef.current = null;
    }

    setWalletModalView('picker');
    void ensureBitcoinConnect(); // Data Saver may have deferred the library; the modal needs init().
    setIsWalletModalOpen(true);

    return new Promise<void>((resolve) => {
      walletModalResolveRef.current = resolve;
    });
  };

  /**
   * Open the modal on the backup offer directly. The account menu uses this so
   * an already-connected, already-signed-in user can reach the feature — they
   * have no other trigger, since the offer otherwise fires only on a fresh NWC
   * paste or a fresh login.
   */
  const openBackupOffer = useCallback(() => {
    setWalletModalView('offer-backup');
    void ensureBitcoinConnect(); // Data Saver may have deferred the library; the modal needs init().
    setIsWalletModalOpen(true);
  }, [ensureBitcoinConnect]);

  // BoostButton and UserMenu `await connect()`, whose promise is held in a ref
  // until the modal closes. If the provider unmounts while it's open that
  // resolver is dropped and the caller waits forever, so settle it here.
  useEffect(() => {
    return () => {
      walletModalResolveRef.current?.();
      walletModalResolveRef.current = null;
    };
  }, []);

  const closeWalletModal = useCallback(() => {
    setIsWalletModalOpen(false);
    setWalletModalView('picker');
    walletModalResolveRef.current?.();
    walletModalResolveRef.current = null;
  }, []);

  /**
   * Post-login backup handling. Two directions, depending on what this device
   * already has. Login flows drop a flag before their reload; this picks it up.
   *
   * NO wallet on this device → AUTO-RESTORE the backup.
   *   This is the point of the feature: sign in on a new phone or browser and
   *   your wallet is simply there, without digging the connection string out of
   *   Alby Hub again. Deliberately NOT gated on `wallet_manually_disconnected`
   *   — see the comment at that branch for why gating on it broke the feature.
   *
   * A wallet IS connected but isn't backed up → OFFER to save it.
   *   Connecting a wallet while signed out is common (boosting works without
   *   Nostr — auth only gates posting the boost note), so the offer can't live
   *   only at connect time or those users would never see it.
   *
   * Both paths need a signer that can encrypt; NIP-55 and read-only nip05
   * cannot, and the whole thing no-ops for them.
   */
  useEffect(() => {
    if (backupOfferCheckedRef.current) return;
    if (typeof window === 'undefined') return;
    // Only log when there is actually a pending offer to act on — otherwise this
    // fires on every page load for every visitor. Every early return below this
    // point logs its reason, so a support session can still see WHY nothing
    // happened rather than facing silence.
    if (localStorage.getItem('nostr_pending_nwc_backup_offer')) {
      console.log('🔐 NWC backup check:', {
        authenticated: isNostrAuthenticated,
        hasPubkey: !!nostrUser?.nostrPubkey,
      });
    }
    if (!isNostrAuthenticated || !nostrUser?.nostrPubkey) return;

    backupOfferCheckedRef.current = true;
    const pubkey = nostrUser.nostrPubkey;
    let cancelled = false;

    (async () => {
      try {
        const { PENDING_NWC_BACKUP_OFFER_KEY } = await import('@/lib/nostr/auth-utils');
        const pending = localStorage.getItem(PENDING_NWC_BACKUP_OFFER_KEY);
        if (!pending || pending !== pubkey) {
          console.log('ℹ️ NWC backup: no pending login flag for this account, nothing to do');
          return;
        }
        console.log('🔐 NWC backup: login flag matched, checking signer…');

        const {
          getConnectedNwcUri,
          hasDeclinedBackup,
          checkBackupExists,
          fetchNwcBackup,
          signerSupportsNip44,
        } = await import('@/lib/nostr/nwc-backup');

        // Wait for the signer to actually be there before asking what it can do.
        //
        // A NIP-07 extension is available synchronously, so this used to look
        // fine on desktop. NIP-46 is not: after the post-login reload the client
        // has to be rebuilt from localStorage and reconnected to its relay,
        // which takes seconds. Asking supportsNip44() before that finishes
        // returns false — the signer isn't connected, not incapable — and the
        // whole feature silently no-opped on exactly the phone signers it
        // matters most for. ensureSignerAvailable() is the codebase's existing
        // answer to this (BoostButton and the publish queue both use it).
        const { ensureSignerAvailable } = await import('@/lib/nostr/signer-reconnect');
        let reconnect = await ensureSignerAvailable();
        // Retry for a short window rather than judging on one instant. A signer
        // can land a few seconds after mount — a NIP-46 client rebuilding its
        // relay connection, or an extension injecting late — and a single check
        // pushes the whole thing to the next page load for no reason.
        for (let attempt = 0; !reconnect.success && attempt < 5; attempt++) {
          await new Promise((r) => setTimeout(r, 3000));
          if (cancelled) return;
          reconnect = await ensureSignerAvailable();
        }
        if (cancelled) return;
        if (!reconnect.success) {
          // Still nothing after ~15s. Leave the flag in place so the next page
          // load retries rather than burning the one chance we had.
          console.warn('⚠️ NWC backup: signer not ready, will retry next load:', reconnect.error);
          return;
        }

        if (!(await signerSupportsNip44())) {
          // Permanent for this signer (NIP-55, read-only nip05, an extension
          // with no nip44) — consume the flag, there is nothing to retry.
          localStorage.removeItem(PENDING_NWC_BACKUP_OFFER_KEY);
          return;
        }
        if (cancelled) return;
        localStorage.removeItem(PENDING_NWC_BACKUP_OFFER_KEY);

        if (!getConnectedNwcUri()) {
          // ── No wallet here: bring the saved one across ──────────────────
          //
          // NOT gated on `wallet_manually_disconnected`. It used to be, on the
          // reasoning that a deliberate disconnect shouldn't be silently undone
          // — but that flag never expires, so disconnecting a wallet once killed
          // auto-restore on that device forever. Signing out and back in then
          // left the user with no wallet and no explanation, which is precisely
          // what this feature exists to prevent.
          const status = await checkBackupExists(pubkey);
          if (status !== 'saved') {
            console.log(
              status === 'none'
                ? 'ℹ️ NWC backup: no backup exists on relays for this account'
                : 'ℹ️ NWC backup: could not reach relays to check — leaving the flag for a retry'
            );
            // 'unknown' keeps the pending flag so the next load tries again;
            // 'none' is a real answer, so consume it below by falling through.
            if (status === 'unknown') {
              localStorage.setItem(PENDING_NWC_BACKUP_OFFER_KEY, pubkey);
            }
            return;
          }
          if (cancelled) return;
          console.log('🔎 NWC backup: found a backup, decrypting…');
          // A remote signer (Amber, Primal) will ask the user to approve this.
          // Say so, or an unexplained approval prompt appears out of nowhere
          // seconds after login and most people will dismiss it.
          const { toast: restoreToast } = await import('@/components/Toast');
          restoreToast.info('Restoring your wallet — approve the request in your signer.', {
            duration: 8000,
          });

          // Decrypt prompts the signer — silent on most extensions, an approval
          // on NIP-46. Worth it: the alternative is the user re-pasting a
          // connection string they already saved.
          let uri: string | null = null;
          try {
            uri = await fetchNwcBackup(pubkey);
          } catch (decryptErr) {
            // Declined, timed out, signer asleep — all recoverable. Put the flag
            // back so the next load can try again instead of losing the wallet.
            localStorage.setItem(PENDING_NWC_BACKUP_OFFER_KEY, pubkey);
            console.warn('⚠️ NWC backup: could not decrypt the backup, will retry next load:', decryptErr);
            const { toast: failToast } = await import('@/components/Toast');
            failToast.error('Could not restore your wallet — your signer did not approve the request.');
            return;
          }
          if (!uri) {
            console.warn('⚠️ NWC backup: found an event but could not read a connection string from it');
            return;
          }
          if (cancelled) return;

          // Clear the manual-disconnect flag HERE, not earlier. It's also read by
          // the WebLN extension auto-connect effect above, so clearing it before
          // we knew a backup existed meant an extension user who deliberately
          // disconnected got silently reconnected on their next sign-in even when
          // there was no backup at all — breaking behaviour that predates this
          // feature. Only an actual restore should reset it.
          localStorage.setItem('wallet_manually_disconnected', 'false');
          setManuallyDisconnected(false);

          const { connectNWC } = await import('@getalby/bitcoin-connect');
          connectNWC(uri);
          console.log('🔄 Restoring wallet from Nostr backup after sign-in');
          const { toast } = await import('@/components/Toast');
          toast.success('Wallet restored from your Nostr backup');
          return;
        }

        // ── Wallet already here: offer to back it up ─────────────────────
        if (hasDeclinedBackup(pubkey)) return;
        // Only offer when we KNOW there is no backup. On 'unknown' stay quiet
        // rather than prompting someone to re-save what they already have.
        if ((await checkBackupExists(pubkey)) !== 'none') return;
        if (cancelled) return;

        setWalletModalView('offer-backup');
        void ensureBitcoinConnect(); // Data Saver may have deferred the library; the modal needs init().
        setIsWalletModalOpen(true);
      } catch (err) {
        // Never surface — this is an optional convenience layered onto login.
        console.warn('⚠️ NWC backup post-login check failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isNostrAuthenticated, nostrUser?.nostrPubkey, ensureBitcoinConnect]);

  /**
   * Disconnecting does NOT remove the Nostr backup — deliberately.
   *
   * It used to. That made restore impossible: with a wallet connected, the menu
   * offers Switch / Disconnect / NWC Backup and no "Connect", so the only route
   * to the picker (where the "Saved wallet" restore row lives) is Disconnect —
   * or Switch Wallet, which disconnects first. Both tombstoned the backup on the
   * way, so it was always destroyed before it could ever be restored from, on
   * every device rather than just across devices.
   *
   * Removal now lives solely on the account menu's "NWC Backup" row, which shows
   * "Saved" and removes on click. That's an explicit action with a visible state,
   * which is what deleting a spending credential should require.
   */
  const disconnectWallet = async () => {
    try {
      console.log('🔌 Disconnecting wallet...');
      const bitcoinConnect = await import('@getalby/bitcoin-connect');

      // Mark as manually disconnected to prevent auto-reconnect
      setManuallyDisconnected(true);
      localStorage.setItem('wallet_manually_disconnected', 'true');

      // Call disconnect - Bitcoin Connect will handle its own localStorage
      await bitcoinConnect.disconnect();

      // Force state updates immediately
      setProvider(null);
      setIsConnected(false);

      console.log('✅ Wallet disconnected successfully');
    } catch (error) {
      console.error('❌ Failed to disconnect:', error);
      // Force disconnect even if there's an error
      setManuallyDisconnected(true);
      localStorage.setItem('wallet_manually_disconnected', 'true');

      setProvider(null);
      setIsConnected(false);
      throw error;
    }
  };

  const sendPayment = async (invoice: string, retryCount = 0): Promise<{ preimage?: string; error?: string }> => {
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          return { error: 'No wallet connected - please connect your Lightning wallet' };
        }
      }

      // Ensure provider is enabled before using it
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          await currentProvider.enable();
        } catch (enableError) {
          return { error: 'Wallet must be unlocked - please check your Lightning wallet' };
        }
      }

      const result = await currentProvider.sendPayment(invoice);
      return { preimage: result.preimage };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';

      // Parse common Lightning errors and provide helpful feedback
      if (errorMessage.includes('FAILURE_REASON_NO_ROUTE') || errorMessage.includes('no route')) {
        // Retry once for routing failures (routes can be temporarily unavailable)
        if (retryCount < 2) {
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
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          return { error: 'No wallet connected - please connect your Lightning wallet' };
        }
      }

      const customRecords: Record<string, string> = {};

      // Extract routing custom records from helipadMetadata before building the Helipad JSON.
      // These records (e.g. Alby's account-routing TLV) must appear as individual TLV entries
      // in the WebLN keysend payload so the receiving node knows which account to credit.
      // Embedding them inside the Helipad JSON blob (TLV 7629169) is not enough — the node
      // inspects raw TLV records, not the JSON payload.
      const { customRecords: routingCustomRecords, ...helipadMetadataWithoutRouting } =
        (helipadMetadata as any) || {};
      if (routingCustomRecords && typeof routingCustomRecords === 'object') {
        for (const [key, value] of Object.entries(routingCustomRecords as Record<string, string>)) {
          if (key && value != null) customRecords[key] = String(value);
        }
      }

      // Add boostagram message if provided
      if (message) {
        // TLV record 34349334 is used for boostagram messages
        // WebLN provider handles encoding - pass plain string
        customRecords['34349334'] = message;
      }

      // Add Helipad metadata if provided (routing customRecords excluded — already added above)
      if (helipadMetadata) {
        try {
          // Clean the metadata object to remove any undefined/null values that could cause issues
          const cleanMetadata = Object.fromEntries(
            Object.entries(helipadMetadataWithoutRouting).filter(([_, value]) => value !== undefined && value !== null)
          );

          // TLV record 7629169 is used for Helipad/Podcast 2.0 metadata (JSON)
          // WebLN provider handles encoding - pass plain JSON string
          customRecords['7629169'] = JSON.stringify(cleanMetadata);
        } catch (jsonError) {
          // Continue without Helipad metadata if JSON fails
        }
      }

      // Ensure provider is enabled before using it
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          await currentProvider.enable();
        } catch (enableError) {
          // Check if Alby extension is being used by Nostr at the same time
          const loginType = typeof window !== 'undefined' ? localStorage.getItem('nostr_login_type') : null;
          if (loginType === 'extension') {
            return { error: 'Wallet locked - if using Alby for both Nostr and Lightning, try closing any Nostr popups first' };
          }
          return { error: 'Wallet must be unlocked - please check your Lightning wallet' };
        }
      }

      if (!currentProvider.keysend) {
        return { error: 'Keysend is not supported by your wallet. Try Alby or Coinos via NWC.' };
      }

      const keysendPayload = {
        destination: pubkey,
        amount: amount.toString(),
        customRecords,
      };

      console.log('🔑 Sending keysend:', { destination: pubkey.slice(0, 20) + '...', amount, hasCustomRecords: Object.keys(customRecords).length > 0 });
      const result = await currentProvider.keysend(keysendPayload);
      console.log('✅ Keysend succeeded:', { preimage: result.preimage?.slice(0, 20) + '...' });
      return { preimage: result.preimage };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Keysend failed';

      // Parse common Lightning errors and provide helpful feedback
      if (errorMessage.includes('FAILURE_REASON_NO_ROUTE') || errorMessage.includes('no route')) {
        // Retry for routing failures (routes can be temporarily unavailable)
        if (retryCount < 2) {
          // Only log on first attempt, not retries
          if (retryCount === 0) {
            console.log('⚠️ Keysend: no route found, retrying...');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendKeysend(pubkey, amount, message, helipadMetadata, retryCount + 1);
        }
        // Final failure after retries
        return {
          error: 'Cannot find payment route to recipient - they may be offline or unreachable via Lightning Network'
        };
      } else if (errorMessage.includes('FAILURE_REASON_INSUFFICIENT_BALANCE') || errorMessage.includes('insufficient')) {
        return { error: 'Insufficient balance in your Lightning wallet' };
      } else if (errorMessage.includes('FAILURE_REASON_TIMEOUT') || errorMessage.includes('timeout')) {
        if (retryCount < 1) {
          console.log('⚠️ Keysend: timeout, retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          return sendKeysend(pubkey, amount, message, helipadMetadata, retryCount + 1);
        }
        return { error: 'Payment timed out - the recipient may be experiencing issues' };
      } else if (errorMessage.includes('user rejected') || errorMessage.includes('user cancelled')) {
        return { error: 'Payment cancelled by user' };
      } else if (errorMessage.includes('command not implemented') || errorMessage.includes('not implemented yet')) {
        // Runtime self-correction: disable keysend so we don't keep retrying
        console.log('⚠️ Keysend not implemented by wallet relay, disabling keysend support');
        setKeysendSupported(false);
        return {
          error: 'Your wallet doesn\'t support keysend payments. This artist only accepts keysend. Try Alby or Coinos.'
        };
      } else if (errorMessage === 'Keysend payment failed' || errorMessage.includes('Keysend payment failed')) {
        // Generic keysend failure from Coinos or other custodial wallets
        // Retry up to 3 times with increasing delays to give the wallet time to process
        // Coinos in particular benefits from longer delays between retries
        if (retryCount < 3) {
          const retryDelay = 4000 + (retryCount * 2000); // 4s, 6s, 8s
          console.log(`⚠️ Generic keysend failure, retrying in ${retryDelay/1000}s (attempt ${retryCount + 1}/3)...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return sendKeysend(pubkey, amount, message, helipadMetadata, retryCount + 1);
        }
        return { error: 'Keysend payment failed - the wallet may be busy or recipient unreachable' };
      }

      return { error: errorMessage };
    }
  };

  const makeInvoice = async (
    amount: number,
    memo?: string
  ): Promise<{ invoice?: string; error?: string }> => {
    try {
      let currentProvider = provider;

      if (!currentProvider) {
        await connect();
        currentProvider = provider;
        if (!currentProvider) {
          return { error: 'No wallet connected - please connect your Lightning wallet' };
        }
      }

      // Ensure provider is enabled before using it
      if (currentProvider.enable && typeof currentProvider.enable === 'function') {
        try {
          await currentProvider.enable();
        } catch (enableError) {
          return { error: 'Wallet must be unlocked - please check your Lightning wallet' };
        }
      }

      if (!currentProvider.makeInvoice) {
        return { error: 'Your wallet does not support creating invoices' };
      }

      const result = await currentProvider.makeInvoice({
        amount,
        defaultMemo: memo || 'StableKraft deposit',
      });

      return { invoice: result.paymentRequest };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create invoice';
      return { error: errorMessage };
    }
  };

  // Check if connected wallet supports keysend (direct node-to-node payments)
  // Use probed result if available. If not probed yet (null), assume false to avoid failed attempts
  // This prevents keysend attempts before the probe completes
  const supportsKeysend = keysendSupported === true;

  return (
    <BitcoinConnectContext.Provider
      value={{
        isConnected,
        provider,
        connect,
        disconnect: disconnectWallet,
        sendPayment,
        sendKeysend,
        makeInvoice,
        isLoading,
        supportsKeysend,
        openBackupOffer,
        // Enhanced wallet info
        walletInfo,
        balance,
        isBalanceLoading,
        refreshBalance,
        walletProviderType,
      }}
    >
      {children}
      {/* Rendered here so every connect() entry point — UserMenu on both
          breakpoints, BoostButton — shares one picker. This provider wraps the
          whole app via layout.tsx → LightningWrapper. */}
      <WalletConnectModal
        isOpen={isWalletModalOpen}
        onClose={closeWalletModal}
        initialView={walletModalView}
      />
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