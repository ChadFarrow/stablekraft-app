'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNostr } from '@/contexts/NostrContext';
import { NIP46Client } from '@/lib/nostr/nip46-client';
import { NIP55Client } from '@/lib/nostr/nip55-client';
import { getUnifiedSigner } from '@/lib/nostr/signer';
import { saveNIP46Connection } from '@/lib/nostr/nip46-storage';
import { isAndroid, isIOS } from '@/lib/utils/device';
import Nip46Connect from './Nip46Connect';

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasExtension, setHasExtension] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [nip05Identifier, setNip05Identifier] = useState('');
  const [loginMethod, setLoginMethod] = useState<'extension' | 'nip05' | 'amber'>('extension');
  const [showNip46Connect, setShowNip46Connect] = useState(false);
  const [nip46ConnectionToken, setNip46ConnectionToken] = useState<string>('');
  const [nip46SignerUrl, setNip46SignerUrl] = useState<string>('');
  const [nip46Client, setNip46Client] = useState<NIP46Client | null>(null);
  const nip46ClientRef = useRef<NIP46Client | null>(null);
  const [nip55Client, setNip55Client] = useState<NIP55Client | null>(null);
  const [isNip55Available, setIsNip55Available] = useState(false);
  const [pastedConnectionUri, setPastedConnectionUri] = useState<string>('');
  const [showPasteUri, setShowPasteUri] = useState(false);

  // Ensure we're mounted before rendering portal
  useEffect(() => {
    setMounted(true);
    // Close any open dropdowns when modal opens
    const closeDropdowns = () => {
      document.body.click();
    };
    closeDropdowns();
    return () => setMounted(false);
  }, []);

  // Check for NIP-07 extension (Alby, nos2x, etc.)
  // BUT: Skip this check if user is already logged in with NIP-46 to prevent Alby popups
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check if user is already logged in with NIP-46 - if so, skip extension check
      const loginType = localStorage.getItem('nostr_login_type');
      if (loginType === 'nip46') {
        console.log('ℹ️ LoginModal: User logged in with NIP-46, skipping extension check to prevent Alby popups');
        return;
      }

      // Check for standard NIP-07 interface
      if ((window as any).nostr) {
        setHasExtension(true);
        return;
      }
      
      // Also check for Alby specifically
      if ((window as any).webln || (window as any).alby) {
        // Alby might expose nostr through webln
        if ((window as any).webln?.nostr) {
          setHasExtension(true);
          return;
        }
      }
      
      // Check periodically in case extension loads after page load
      const checkInterval = setInterval(() => {
        if ((window as any).nostr) {
          setHasExtension(true);
          clearInterval(checkInterval);
        }
      }, 500);
      
      // Stop checking after 5 seconds
      setTimeout(() => clearInterval(checkInterval), 5000);
      
      return () => clearInterval(checkInterval);
    }
  }, []);

  // Check NIP-55 availability on Android and set up callback handler early
  // NIP-55 is Android-only and NOT supported on iOS
  useEffect(() => {
    // Skip NIP-55 setup entirely on iOS
    if (isIOS()) {
      console.log('ℹ️ NIP-55: Skipping NIP-55 setup on iOS (not supported)');
      setIsNip55Available(false);
      return;
    }

    if (isAndroid()) {
      const available = NIP55Client.isAvailable();
      setIsNip55Available(available);

      // IMPORTANT: Create NIP55Client instance early to set up callback handler
      // This ensures the callback handler is ready when Amber redirects back after approval
      if (available && !nip55Client) {
        console.log('📱 NIP-55: Creating client instance early to set up callback handler');
        const client = new NIP55Client();
        setNip55Client(client);
      }

      // Auto-select Amber on Android if NIP-55 available and no extension
      if (available && !hasExtension && loginMethod === 'extension') {
        setLoginMethod('amber');
      } else if (!available && !hasExtension && loginMethod === 'extension') {
        // Fall back to Amber (will use NIP-46) if NIP-55 not available
        setLoginMethod('amber');
      }
    }
  }, [hasExtension, loginMethod, nip55Client]);

  // Check for NIP-55 connection result (after page reload from Amber callback)
  useEffect(() => {
    // Skip NIP-55 callback processing on iOS - NIP-55 is Android-only
    if (isIOS()) {
      console.log('ℹ️ NIP-55: Skipping callback check on iOS (NIP-55 not supported)');
      // Clear any stale NIP-55 data
      sessionStorage.removeItem('nip55_connection_result');
      return;
    }

    const connectionResult = sessionStorage.getItem('nip55_connection_result');
    if (connectionResult) {
      console.log('🎯🎯🎯 NIP-55: Found connection result from callback, completing login...');
      alert('🎯 Found NIP-55 connection result! Completing login...');

      // Complete the login flow
      (async () => {
        try {
          const { pubkey, signature, eventTemplate } = JSON.parse(connectionResult);

          // Clear the result
          sessionStorage.removeItem('nip55_connection_result');

          setIsSubmitting(true);

          // Get challenge for authentication
          const challengeResponse = await fetch('/api/nostr/auth/challenge', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!challengeResponse.ok) {
            throw new Error('Failed to get challenge');
          }

          const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // Create standardized login event template
      const { createLoginEventTemplate } = await import('@/lib/nostr/events');
      const challengeEventTemplate = createLoginEventTemplate(challenge);

      // Create NIP-55 client and sign the challenge
      const client = new NIP55Client();
      setNip55Client(client);

      // Set connection with the pubkey we got
      (client as any).connection = {
        pubkey,
        connected: true,
        connectedAt: Date.now(),
      };

      const signedEvent = await client.signEvent(challengeEventTemplate);

          // Send login request
          const { publicKeyToNpub } = await import('@/lib/nostr/keys');
          const npub = publicKeyToNpub(pubkey);

          const loginResponse = await fetch('/api/nostr/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              publicKey: pubkey,
              npub,
              challenge,
              signature: signedEvent.sig,
              eventId: signedEvent.id,
              createdAt: signedEvent.created_at,
              kind: signedEvent.kind, // Include kind so API can verify correctly
              content: signedEvent.content, // Include content so API can verify correctly
            }),
          });

          if (!loginResponse.ok) {
            const errorData = await loginResponse.json();
            throw new Error(errorData.error || 'Login failed');
          }

          const loginData = await loginResponse.json();
          if (loginData.success && loginData.user) {
            console.log('✅ NIP-55: Login successful (after callback)!');

            // Save connection info
            localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
            localStorage.setItem('nostr_login_type', 'nip55');

            // Update signer in context
            const signer = getUnifiedSigner();
            await signer.setNIP55Signer(client);

            // Sync favorites to Nostr (fire and forget - don't block login)
            try {
              console.log('🔄 Syncing favorites to Nostr...');
              import('@/lib/nostr/sync-favorites').then(({ syncFavoritesToNostr }) => {
                syncFavoritesToNostr(loginData.user.id).then((results) => {
                  console.log('✅ Favorites synced to Nostr:', results);
                }).catch((err) => {
                  console.error('❌ Error syncing favorites:', err);
                });
              }).catch((err) => {
                console.error('❌ Error importing sync module:', err);
              });
            } catch (syncError) {
              console.error('❌ Error initiating favorites sync:', syncError);
            }

            // Close modal and reload
            onClose();
            setTimeout(() => {
              window.location.reload();
            }, 2000);
          } else {
            throw new Error(loginData.error || 'Login failed');
          }
        } catch (err) {
          console.error('❌ NIP-55: Error completing login after callback:', err);
          setError(err instanceof Error ? err.message : 'NIP-55 login failed');
          setIsSubmitting(false);
        }
      })();
    }
  }, [onClose]);

  const handleNip05Login = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      // Validate NIP-05 format
      const nip05Regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!nip05Regex.test(nip05Identifier)) {
        throw new Error('Invalid NIP-05 format. Expected: user@domain.com');
      }

      console.log('🔐 LoginModal: Starting NIP-05 login...', nip05Identifier);

      // Login with NIP-05 identifier
      const loginResponse = await fetch('/api/nostr/auth/nip05-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: nip05Identifier.trim(),
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
      }

      const loginData = await loginResponse.json();
      console.log('📥 LoginModal: NIP-05 login response', { success: loginData.success, error: loginData.error });
      
      if (loginData.success && loginData.user) {
        console.log('✅ LoginModal: NIP-05 login successful!', { userId: loginData.user?.id });
        
        // Save user data to localStorage
        try {
          localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
          localStorage.setItem('nostr_login_type', 'nip05'); // Mark as NIP-05 login
          console.log('💾 LoginModal: Saved user to localStorage (NIP-05 login)');
        } catch (storageError) {
          console.error('❌ LoginModal: Failed to save to localStorage:', storageError);
        }
        
        onClose();
        window.location.reload(); // Refresh to update context
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NIP-05 login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Connect using pasted bunker:// or nostrconnect:// URI
  const handlePastedUriConnect = async () => {
    if (!pastedConnectionUri.trim()) {
      setError('Please enter a connection URI');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const { NIP46Client } = await import('@/lib/nostr/nip46-client');

      console.log('🔌 Connecting with pasted URI:', pastedConnectionUri.substring(0, 30) + '...');

      // Parse token from URI (both bunker:// and nostrconnect:// have secret param)
      let token = '';
      try {
        const url = new URL(pastedConnectionUri.replace(/^(bunker|nostrconnect):\/\//, 'http://'));
        const secretParam = url.searchParams.get('secret');
        if (secretParam) {
          token = decodeURIComponent(secretParam);
        }
      } catch (parseErr) {
        console.warn('⚠️ Failed to parse token from URI, using empty token:', parseErr);
      }

      const client = new NIP46Client();
      // connect() signature: (signerUrl, token, connectImmediately?, signerPubkey?)
      await client.connect(pastedConnectionUri, token, false);

      setNip46Client(client);
      nip46ClientRef.current = client;

      // Show the connection UI to wait for approval
      setNip46ConnectionToken(pastedConnectionUri);
      setNip46SignerUrl(pastedConnectionUri);
      setShowNip46Connect(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect with URI');
      setIsSubmitting(false);
    }
  };

  // Unified Amber login - picks best NIP for device
  const handleAmberLogin = async () => {
    // If user wants to paste their own URI, validate and use that
    const trimmedUri = pastedConnectionUri.trim();
    if (showPasteUri && trimmedUri) {
      // Validate URI format
      if (!trimmedUri.startsWith('bunker://') && !trimmedUri.startsWith('nostrconnect://')) {
        setError('Invalid connection URI. Must start with bunker:// or nostrconnect://');
        return;
      }
      await handlePastedUriConnect();
      return;
    }

    // TEMPORARY: Force NIP-46 (QR code) on Android for testing
    // NIP-55 callbacks don't seem to work reliably on Android
    console.log('🔐 Amber: Using NIP-46 (QR code) - NIP-55 disabled for testing');
    await handleNip46Connect();

    // On Android with NIP-55 support, use NIP-55 (direct app-to-app)
    // Otherwise use NIP-46 (QR code/relay)
    // if (isAndroid() && isNip55Available) {
    //   console.log('📱 Amber: Using NIP-55 (Android direct)');
    //   await handleNip55Login();
    // } else {
    //   console.log('🔐 Amber: Using NIP-46 (QR code)');
    //   await handleNip46Connect();
    // }
  };

  const handleNip46Connect = async () => {
    // Prevent multiple simultaneous connection attempts
    if (isSubmitting) {
      console.log('⚠️ NIP-46: Connection already in progress, ignoring duplicate call');
      return;
    }

    // Check if localStorage is available and persistent
    try {
      const testKey = '_nip46_storage_test';
      localStorage.setItem(testKey, 'test');
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);

      if (retrieved !== 'test') {
        setError('⚠️ localStorage is not working properly. You may be in incognito/private mode. NIP-46 connections require persistent storage to work across sessions.');
        return;
      }
    } catch (err) {
      setError('⚠️ localStorage is blocked. You may be in incognito/private mode. NIP-46 connections require persistent storage to work across sessions.');
      return;
    }

    // Clear any existing connections to start fresh
    // This ensures we always create a new connection when user explicitly clicks NIP-46
    const { clearNIP46Connection } = await import('@/lib/nostr/nip46-storage');
    const { getUnifiedSigner } = await import('@/lib/nostr/signer');

    // Clear stored connection
    clearNIP46Connection();

    // Disconnect any active NIP-46 signer in UnifiedSigner
    const signer = getUnifiedSigner();
    try {
      await signer.disconnectNIP46();
    } catch (err) {
      // Ignore errors if not connected
      console.log('ℹ️ NIP-46: No active connection to disconnect');
    }

    console.log('🔄 NIP-46: Cleared old connections, starting fresh login flow');

    // Clean up any existing client connection
    if (nip46ClientRef.current) {
      console.log('🧹 NIP-46: Cleaning up existing client before creating new connection');
      try {
        await nip46ClientRef.current.disconnect();
      } catch (err) {
        console.warn('Failed to disconnect existing client:', err);
      }
      nip46ClientRef.current = null;
    }
    
    // Also clear the state
    setNip46Client(null);

    try {
      setIsSubmitting(true);
      setError(null);

      // Get or create a persistent app key pair (reused across sessions)
      // This ensures the same pubkey is used, preventing Amber connection mismatches
      const { getOrCreateAppKeyPair } = await import('@/lib/nostr/nip46-storage');
      const keyPair = getOrCreateAppKeyPair();
      const { privateKey, publicKey } = keyPair;
      
      // Get default relay for connection
      // Prefer relays that are less likely to be rate-limited
      const { getDefaultRelays } = await import('@/lib/nostr/relay');
      const relays = getDefaultRelays();
      // Skip Damus relay if it's first (it's often rate-limited)
      // Try nos.lol instead to bypass potential relay-side caching
      const preferredRelays = relays.filter(r => !r.includes('relay.damus.io') && !r.includes('relay.nsec.app'));
      const relayUrl = preferredRelays[0] || 'wss://nos.lol';
      
      // Generate connection token (secret for this session)
      const token = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Store connection info temporarily in sessionStorage (for backward compatibility)
      // The key pair itself is stored persistently in localStorage
      const connectionInfo = {
        token,
        privateKey, // Persistent key pair (reused across sessions)
        publicKey,
        relayUrl,
        createdAt: Date.now(),
      };
      sessionStorage.setItem('nip46_pending_connection', JSON.stringify(connectionInfo));
      
      // Initialize NIP-46 client (but don't connect yet - wait for Amber)
      const client = new NIP46Client();
      
      // Store client in ref for callback access
      nip46ClientRef.current = client;
      setNip46Client(client);
      
      // Set up connection callback - use ref to access client
      client.setOnConnection((signerPubkey: string) => {
        console.log('✅ NIP-46: Connection established with signer:', signerPubkey);
        // Hide the connection UI first
        setShowNip46Connect(false);
        // Automatically complete login when connection is established
        // Use the ref to ensure we have the client
        if (nip46ClientRef.current) {
          handleNip46ConnectedWithClient(nip46ClientRef.current);
        }
      });
      
      // Start listening on relay for connection
      // For client-initiated flow (nostrconnect://), we need to connect to the relay immediately
      // to listen for Amber's connection response
      try {
        await client.connect(relayUrl, token, true);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('❌ LoginModal: Failed to start relay connection:', {
          error: errorMessage,
          relayUrl,
          errorDetails: err,
        });
        setError(`Failed to connect to relay: ${errorMessage}. Please check your connection and try again.`);
        setIsSubmitting(false);
        return;
      }
      
      // Generate nostrconnect URI
      // NIP-46 format: nostrconnect://<client-pubkey>?relay=<relay_url>&secret=<required>&name=<optional>&url=<optional>
      // Reference: https://github.com/nostr-protocol/nips/blob/master/46.md
      // IMPORTANT: 
      // - <pubkey> should be HEX-ENCODED (not npub/bech32)
      // - secret is REQUIRED (not optional)
      // - Use separate query params (name, url) instead of metadata JSON
      
      // NIP-46 compliant format: hex pubkey with minimal required params (relay and secret)
      // According to NIP-46 spec, pubkey MUST be hex-encoded (not npub/bech32)
      // Reference: https://github.com/nostr-protocol/nips/blob/master/46.md
      const relayEncoded = encodeURIComponent(relayUrl);
      const secretEncoded = encodeURIComponent(token);
      const appName = encodeURIComponent('StableKraft');
      const appUrl = encodeURIComponent('https://stablekraft.app/');
      const nostrconnectUri = `nostrconnect://${publicKey}?relay=${relayEncoded}&secret=${secretEncoded}&name=${appName}&url=${appUrl}`;
      
      console.log('NIP-46: Generated connection URI for relay:', relayUrl);
      
      // Validate URI format
      if (!nostrconnectUri.startsWith('nostrconnect://')) {
        throw new Error('Invalid nostrconnect URI format');
      }
      if (!publicKey || publicKey.length !== 64) {
        throw new Error('Invalid pubkey format - must be 64 hex characters');
      }
      if (!token || token.length === 0) {
        throw new Error('Secret is required per NIP-46 spec');
      }
      
      setNip46ConnectionToken(nostrconnectUri);
      setNip46SignerUrl(relayUrl);
      setShowNip46Connect(true);
      setIsSubmitting(false);

      console.log('NIP-46: Connection UI displayed. Waiting for Amber to scan QR code...');
      
      // According to NIP-46 spec, when client initiates via nostrconnect://:
      // 1. Client generates QR code with nostrconnect:// URI (done above)
      // 2. User scans QR code with Amber (remote-signer)
      // 3. Amber sends a connect RESPONSE event to the client-pubkey via the specified relays
      // 4. Client receives the response and learns remote-signer-pubkey from event author
      // 5. Client validates the secret returned in the connect response
      // 
      // The client should NOT send connect requests - it should passively wait for Amber's response.
      // The connection callback (set above) will be triggered when we receive the connect response event.
      // No retry loop needed - just wait for Amber to send the response.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize NIP-46 connection');
      setIsSubmitting(false);
    }
  };


  const handleNip46Connected = async () => {
    // Use the ref to get the client
    const client = nip46ClientRef.current || nip46Client;
    if (!client) {
      setError('NIP-46 client not initialized. Please try connecting again.');
      setIsSubmitting(false);
      return;
    }
    await handleNip46ConnectedWithClient(client);
  };

  const handleNip46ConnectedWithClient = async (client: NIP46Client) => {
    try {
      setIsSubmitting(true);
      setError(null);

      // Wait a bit to ensure connection is fully established
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get public key from signer
      // For relay-based connections, Amber might not send a connection event.
      // Instead, we need to try requesting the public key and see if we get a response.
      console.log('🔍 LoginModal: Getting public key from NIP-46 client...');
      
      // Check connection status explicitly (matching test page pattern)
      const connection = client.getConnection();
      const isConnected = client.isConnected();
      const pubkey = client.getPubkey();
      
      console.log('🔍 LoginModal: Pre-sign connection check:', {
        hasClient: !!client,
        isConnected,
        hasConnection: !!connection,
        hasPubkey: !!pubkey,
        pubkey: pubkey ? pubkey.slice(0, 16) + '...' : 'N/A',
        connectionPubkey: connection?.pubkey ? connection.pubkey.slice(0, 16) + '...' : 'N/A',
        signerUrl: connection?.signerUrl || 'N/A',
      });
      
      let publicKey: string;
      
      // If we already have the pubkey, use it
      if (pubkey) {
        console.log('✅ LoginModal: Using pubkey from client:', pubkey.slice(0, 16) + '...');
        publicKey = pubkey;
      } else if (connection?.pubkey) {
        console.log('✅ LoginModal: Using pubkey from connection:', connection.pubkey.slice(0, 16) + '...');
        publicKey = connection.pubkey;
      } else {
        // Verify connection is established before requesting pubkey
        if (!isConnected || !connection) {
          throw new Error(`Not connected to Amber. Connection status: connected=${isConnected}, hasConnection=${!!connection}. Please wait for the connection to be established.`);
        }
        
        console.log('⚠️ LoginModal: No pubkey available yet. Requesting from signer...');
        console.log('📱 IMPORTANT: Watch your phone - Amber should show a notification or prompt');
        
        // Try requesting the public key - this will work if Amber is listening
        try {
          console.log('⏳ LoginModal: Waiting 2 seconds for Amber to be ready...');
          // Wait a bit for Amber to be ready
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log('📤 LoginModal: Requesting public key from Amber via relay...');
          console.log('📋 LoginModal: Connection details:', {
            relayUrl: connection?.signerUrl,
            hasRelayClient: !!client,
            isConnected,
          });
          
          // Set a timeout warning
          const timeoutWarning = setTimeout(() => {
            console.warn('⚠️ LoginModal: Still waiting for public key response (30s elapsed). This might indicate:');
            console.warn('  1. Amber hasn\'t approved the connection yet');
            console.warn('  2. Amber is not connected to the same relay');
            console.warn('  3. Network/relay connectivity issues');
          }, 30000);
          
          publicKey = await client.getPublicKey();
          clearTimeout(timeoutWarning);
          console.log('✅ LoginModal: Got public key from signer:', publicKey.slice(0, 16) + '...');
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          const errorDetails = err instanceof Error ? {
            name: err.name,
            message: err.message,
            stack: err.stack,
          } : err;
          
          console.error('❌ LoginModal: Failed to get public key:', {
            error: errorMessage,
            errorDetails,
            connectionState: {
              hasConnection: !!connection,
              hasPubkey: !!connection?.pubkey,
              connected: connection?.connected,
              relayUrl: connection?.signerUrl,
              isConnected,
            },
          });
          
          // Provide more helpful error message
          let helpfulMessage = `Unable to communicate with signer: ${errorMessage}`;
          if (errorMessage.includes('timeout')) {
            helpfulMessage += '\n\nPossible causes:\n';
            helpfulMessage += '1. Amber hasn\'t approved the connection yet - check your phone\n';
            helpfulMessage += '2. Amber is not connected to the same relay\n';
            helpfulMessage += '3. Network connectivity issues\n';
            helpfulMessage += '\nTry:\n';
            helpfulMessage += '- Make sure you scanned the QR code and approved in Amber\n';
            helpfulMessage += '- Check that Amber is using the relay: ' + (connection?.signerUrl || 'unknown') + '\n';
            helpfulMessage += '- Try clicking "Continue" button to retry';
          }
          
          throw new Error(helpfulMessage);
        }
      }
      
      if (!publicKey || publicKey.length === 0) {
        throw new Error('Failed to get public key from signer. Please try connecting again.');
      }
      
      // Verify connection is ready before signing
      console.log('✅ LoginModal: Connection verified, proceeding with challenge signing');

      // Request signature for challenge
      const challengeResponse = await fetch('/api/nostr/auth/challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!challengeResponse.ok) {
        throw new Error(`Failed to get challenge: ${challengeResponse.status}`);
      }

      const challengeData = await challengeResponse.json();
      if (!challengeData.challenge) {
        throw new Error('Invalid challenge response');
      }

      const challenge = challengeData.challenge;

      // Validate challenge
      if (!challenge || typeof challenge !== 'string' || challenge.length === 0) {
        throw new Error('Invalid challenge received from server');
      }

      // Verify connection is still valid before signing
      const finalConnectionCheck = client.getConnection();
      const finalIsConnected = client.isConnected();
      if (!finalIsConnected || !finalConnectionCheck) {
        throw new Error('Connection lost before signing. Please reconnect and try again.');
      }
      
      // Create standardized login event template
      const { createLoginEventTemplate } = await import('@/lib/nostr/events');
      const event = createLoginEventTemplate(challenge);

      console.log('✍️ LoginModal: Requesting signature from NIP-46 signer...', {
        kind: event.kind,
        tags: event.tags,
        content: event.content,
        created_at: event.created_at,
        challenge: challenge.slice(0, 16) + '...',
      });
      console.log('📱 IMPORTANT: Watch your phone - Amber should show a notification or prompt to approve the signature');

      let signedEvent: any;
      try {
        signedEvent = await client.signEvent(event as any);
      } catch (signError) {
        const errorMessage = signError instanceof Error ? signError.message : String(signError);
        const errorDetails = signError instanceof Error ? {
          name: signError.name,
          message: signError.message,
          stack: signError.stack,
        } : signError;
        
        console.error('❌ LoginModal: Error signing event:', {
          error: errorMessage,
          errorDetails,
          eventDetails: {
            kind: event.kind,
            challenge: challenge.slice(0, 16) + '...',
            created_at: event.created_at,
          },
        });
        
        throw new Error(`Failed to sign event: ${errorMessage}`);
      }
      console.log('✅ LoginModal: Got signed event', {
        id: signedEvent.id?.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey?.slice(0, 16) + '...',
        sig: signedEvent.sig?.slice(0, 16) + '...',
        created_at: signedEvent.created_at,
        kind: signedEvent.kind,
        content: signedEvent.content,
        hasAllFields: !!(signedEvent.id && signedEvent.pubkey && signedEvent.sig && signedEvent.created_at),
      });

      console.log('🔍 FULL SIGNED EVENT:', JSON.stringify(signedEvent, null, 2));

      // Validate signed event has all required fields
      if (!signedEvent) {
        console.error('❌ LoginModal: Signed event is null or undefined');
        throw new Error('Failed to sign event. Please try again.');
      }

      // Validate each required field individually with detailed error messages
      const missingFields: string[] = [];
      if (!signedEvent.pubkey || typeof signedEvent.pubkey !== 'string' || signedEvent.pubkey.length === 0) {
        missingFields.push('pubkey');
      }
      if (!signedEvent.sig || typeof signedEvent.sig !== 'string' || signedEvent.sig.length === 0) {
        missingFields.push('sig');
      }
      if (!signedEvent.id || typeof signedEvent.id !== 'string' || signedEvent.id.length === 0) {
        missingFields.push('id');
      }
      if (!signedEvent.created_at || typeof signedEvent.created_at !== 'number') {
        missingFields.push('created_at');
      }

      if (missingFields.length > 0) {
        console.error('❌ LoginModal: Signed event missing required fields:', {
          missingFields,
          hasEvent: !!signedEvent,
          pubkey: signedEvent.pubkey ? `${signedEvent.pubkey.slice(0, 16)}...` : 'MISSING',
          sig: signedEvent.sig ? `${signedEvent.sig.slice(0, 16)}...` : 'MISSING',
          id: signedEvent.id ? `${signedEvent.id.slice(0, 16)}...` : 'MISSING',
          created_at: signedEvent.created_at,
          fullEvent: JSON.stringify(signedEvent, null, 2),
        });
        throw new Error(`Signed event is missing required fields: ${missingFields.join(', ')}. Please try again.`);
      }

      // Validate challenge is present
      if (!challenge || typeof challenge !== 'string' || challenge.length === 0) {
        console.error('❌ LoginModal: Challenge is missing or invalid:', challenge);
        throw new Error('Challenge is missing. Please try again.');
      }

      // Calculate npub from public key
      const { publicKeyToNpub } = await import('@/lib/nostr/keys');
      let npub: string;
      try {
        npub = publicKeyToNpub(signedEvent.pubkey);
      } catch (error) {
        console.error('❌ LoginModal: Failed to calculate npub:', error);
        throw new Error('Failed to calculate npub from public key. Please try again.');
      }

      // Prepare login payload with explicit validation
      // Use defensive checks to avoid .trim() errors on undefined/null values
      const loginPayload = {
        publicKey: (signedEvent.pubkey || '').trim(),
        npub: (npub || '').trim(),
        challenge: (challenge || '').trim(),
        signature: (signedEvent.sig || '').trim(),
        eventId: (signedEvent.id || '').trim(),
        createdAt: signedEvent.created_at,
        kind: signedEvent.kind, // Include kind so API can reconstruct event
        content: signedEvent.content || '', // Include content so API can reconstruct event
      };

      // Final validation of payload before sending
      const payloadMissingFields: string[] = [];
      if (!loginPayload.publicKey || loginPayload.publicKey.length === 0) payloadMissingFields.push('publicKey');
      if (!loginPayload.challenge || loginPayload.challenge.length === 0) payloadMissingFields.push('challenge');
      if (!loginPayload.signature || loginPayload.signature.length === 0) payloadMissingFields.push('signature');
      if (!loginPayload.eventId || loginPayload.eventId.length === 0) payloadMissingFields.push('eventId');
      if (!loginPayload.createdAt || typeof loginPayload.createdAt !== 'number') payloadMissingFields.push('createdAt');

      if (payloadMissingFields.length > 0) {
        console.error('❌ LoginModal: Login payload missing required fields:', {
          missingFields: payloadMissingFields,
          payload: loginPayload,
        });
        throw new Error(`Login payload is missing required fields: ${payloadMissingFields.join(', ')}. Please try again.`);
      }

      console.log('📤 LoginModal: Sending login request with payload:', {
        publicKey: loginPayload.publicKey.slice(0, 16) + '...',
        npub: loginPayload.npub.slice(0, 16) + '...',
        challenge: loginPayload.challenge.slice(0, 16) + '...',
        signature: loginPayload.signature.slice(0, 16) + '...',
        eventId: loginPayload.eventId.slice(0, 16) + '...',
        createdAt: loginPayload.createdAt,
        kind: loginPayload.kind,
        content: loginPayload.content,
      });

      console.log('🌐 LOGIN REQUEST - FULL PAYLOAD:', JSON.stringify(loginPayload, null, 2));

      // Login with signed event
      console.log('📡 About to fetch /api/nostr/auth/login...');
      let loginResponse;
      try {
        loginResponse = await fetch('/api/nostr/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(loginPayload),
        });
        console.log('📡 Login response received:', loginResponse.status, loginResponse.statusText);
      } catch (fetchError) {
        console.error('❌ LoginModal: Fetch request failed:', fetchError);
        const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
        throw new Error(`Network request failed: ${errorMsg}`);
      }

      if (!loginResponse.ok) {
        let errorData;
        try {
          errorData = await loginResponse.json();
        } catch (jsonError) {
          console.error('❌ LoginModal: Failed to parse error response JSON:', jsonError);
          throw new Error(`Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
        }
        console.error('❌ LoginModal: Login request returned error:', errorData);
        throw new Error(errorData.error || `Login failed: ${loginResponse.status}`);
      }

      const loginData = await loginResponse.json();
      if (loginData.success && loginData.user) {
        // Save user data
        localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
        localStorage.setItem('nostr_login_type', 'nip46');
        
        // Save NIP-46 connection
        const connection = client.getConnection();
        if (connection) {
          saveNIP46Connection(connection);
        }
        
        // Register with unified signer
        const signer = getUnifiedSigner();
        await signer.setNIP46Signer(client);

        // Sync favorites to Nostr (fire and forget - don't block login)
        try {
          console.log('🔄 Syncing favorites to Nostr...');
          // Import dynamically to avoid issues with server-side rendering
          import('@/lib/nostr/sync-favorites').then(({ syncFavoritesToNostr }) => {
            syncFavoritesToNostr(loginData.user.id).then((results) => {
              console.log('✅ Favorites synced to Nostr:', results);
            }).catch((err) => {
              console.error('❌ Error syncing favorites:', err);
            });
          }).catch((err) => {
            console.error('❌ Error importing sync module:', err);
          });
        } catch (syncError) {
          // Don't fail login if sync fails
          console.error('❌ Error initiating favorites sync:', syncError);
        }

        // Hide NIP-46 connect UI if still showing
        setShowNip46Connect(false);

        // Close modal and reload (delay to let sync messages show)
        onClose();
        setTimeout(() => {
          window.location.reload();
        }, 2000); // 2 second delay to see sync messages
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorDetails = err instanceof Error ? {
        name: err.name,
        message: err.message,
        stack: err.stack,
      } : err;

      console.error('❌ LoginModal: NIP-46 login failed:', {
        error: errorMessage,
        errorDetails,
        connectionState: {
          hasClient: !!client,
          hasConnection: !!client?.getConnection(),
          connectionPubkey: client?.getConnection()?.pubkey?.slice(0, 16) + '...',
        },
      });

      setError(errorMessage || 'Failed to complete NIP-46 login. Please check the error log for details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNip55Login = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      if (!NIP55Client.isAvailable()) {
        throw new Error('NIP-55 is only available on Android devices');
      }

      console.log('📱 NIP-55: Starting login with Android signer...');

      // Use existing client or create new one
      // If client was created early in useEffect, reuse it to preserve callback handler
      const client = nip55Client || new NIP55Client();
      if (!nip55Client) {
        setNip55Client(client);
      }

      // Connect and get public key
      const publicKey = await client.getPublicKey();
      console.log('✅ NIP-55: Got public key:', publicKey.slice(0, 16) + '...');

      // Generate challenge for authentication
      const challengeResponse = await fetch('/api/nostr/auth/challenge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!challengeResponse.ok) {
        throw new Error('Failed to get challenge');
      }

      const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // Create standardized login event template
      const { createLoginEventTemplate } = await import('@/lib/nostr/events');
      const challengeEventTemplate = createLoginEventTemplate(challenge);

      // Sign challenge event using NIP-55
      const signedEvent = await client.signEvent(challengeEventTemplate);
      console.log('✅ NIP-55: Signed challenge event');

      // Send login request
      const { publicKeyToNpub } = await import('@/lib/nostr/keys');
      const npub = publicKeyToNpub(publicKey);

      const loginResponse = await fetch('/api/nostr/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey,
          npub,
          challenge,
          signature: signedEvent.sig,
          eventId: signedEvent.id,
          createdAt: signedEvent.created_at,
          kind: signedEvent.kind, // Include kind so API can verify correctly
          content: signedEvent.content, // Include content so API can verify correctly
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json();
        throw new Error(errorData.error || 'Login failed');
      }

      const loginData = await loginResponse.json();
      if (loginData.success && loginData.user) {
        console.log('✅ NIP-55: Login successful!');

        // Save connection info
        try {
          localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
          localStorage.setItem('nostr_login_type', 'nip55');
          
          // Store NIP-55 client reference (we'll need to recreate it on reload)
          // For now, just mark that we're using NIP-55
          console.log('💾 NIP-55: Saved user to localStorage');
        } catch (storageError) {
          console.error('❌ NIP-55: Failed to save to localStorage:', storageError);
        }

        // Update signer in context
        const signer = getUnifiedSigner();
        await signer.setNIP55Signer(client);

        // Sync favorites to Nostr (fire and forget - don't block login)
        try {
          console.log('🔄 Syncing favorites to Nostr...');
          // Import dynamically to avoid issues with server-side rendering
          import('@/lib/nostr/sync-favorites').then(({ syncFavoritesToNostr }) => {
            syncFavoritesToNostr(loginData.user.id).then((results) => {
              console.log('✅ Favorites synced to Nostr:', results);
            }).catch((err) => {
              console.error('❌ Error syncing favorites:', err);
            });
          }).catch((err) => {
            console.error('❌ Error importing sync module:', err);
          });
        } catch (syncError) {
          // Don't fail login if sync fails
          console.error('❌ Error initiating favorites sync:', syncError);
        }

        // Close modal and reload (delay to let sync messages show)
        onClose();
        setTimeout(() => {
          window.location.reload();
        }, 2000); // 2 second delay to see sync messages
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error 
        ? err.message 
        : typeof err === 'string'
        ? err
        : JSON.stringify(err, Object.getOwnPropertyNames(err));
      const errorDetails = err instanceof Error
        ? {
            message: err.message,
            name: err.name,
            stack: err.stack,
            ...(err as any).cause && { cause: (err as any).cause },
          }
        : err;
      
      setError(errorMessage || 'NIP-55 login failed');
      console.error('❌ NIP-55: Login error:', {
        error: errorDetails,
        errorMessage,
        errorType: typeof err,
        errorConstructor: err?.constructor?.name,
        stringified: JSON.stringify(err, Object.getOwnPropertyNames(err)),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtensionLogin = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      console.log('🔌 LoginModal: Starting extension login...');
      const nostr = (window as any).nostr;
      if (!nostr) {
        console.error('❌ LoginModal: Nostr extension not found');
        throw new Error('Nostr extension not found');
      }
      console.log('✅ LoginModal: Nostr extension found');

      // Get public key from extension
      console.log('🔑 LoginModal: Getting public key from extension...');
      const publicKey = await nostr.getPublicKey();
      console.log('✅ LoginModal: Got public key', publicKey.slice(0, 16) + '...');

      // Request signature for challenge
      let challengeResponse;
      try {
        challengeResponse = await fetch('/api/nostr/auth/challenge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (fetchError) {
        console.error('❌ LoginModal: Network error fetching challenge:', fetchError);
        throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to connect to server'}`);
      }

      if (!challengeResponse.ok) {
        const errorText = await challengeResponse.text().catch(() => 'Unknown error');
        console.error('❌ LoginModal: Challenge request failed:', {
          status: challengeResponse.status,
          statusText: challengeResponse.statusText,
          body: errorText,
        });
        throw new Error(`Failed to get challenge: ${challengeResponse.status} ${challengeResponse.statusText}`);
      }

      let challengeData;
      try {
        challengeData = await challengeResponse.json();
      } catch (parseError) {
        console.error('❌ LoginModal: Failed to parse challenge response:', parseError);
        throw new Error('Invalid response from server');
      }

      if (!challengeData.challenge) {
        console.error('❌ LoginModal: Challenge response missing challenge field:', challengeData);
        throw new Error('Invalid challenge response from server');
      }

      const challenge = challengeData.challenge;

      // Create standardized login event template
      const { createLoginEventTemplate } = await import('@/lib/nostr/events');
      const eventTemplate = createLoginEventTemplate(challenge);

      console.log('✍️ LoginModal: Requesting signature from extension...');
      // Use unified signer for consistency
      const signer = getUnifiedSigner();
      const signedEvent = await signer.signEvent(eventTemplate as any);
      console.log('✅ LoginModal: Got signed event', {
        id: signedEvent.id.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey.slice(0, 16) + '...',
      });

      // Calculate npub from public key
      const { publicKeyToNpub } = await import('@/lib/nostr/keys');
      const npub = publicKeyToNpub(signedEvent.pubkey);
      console.log('✅ LoginModal: Calculated npub', npub.slice(0, 16) + '...');

      // Login with signed event
      const loginResponse = await fetch('/api/nostr/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey: signedEvent.pubkey,
          npub: npub,
          challenge,
          signature: signedEvent.sig,
          eventId: signedEvent.id,
          createdAt: signedEvent.created_at,
          kind: signedEvent.kind, // Include kind so API can verify correctly
          content: signedEvent.content, // Include content so API can verify correctly
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
      }

      const loginData = await loginResponse.json();
      console.log('📥 LoginModal: Login response', { success: loginData.success, error: loginData.error });
      if (loginData.success && loginData.user) {
        console.log('✅ LoginModal: Login successful!', { userId: loginData.user?.id });
        
        // Save user data to localStorage before reload
        // Note: For extension login, we don't have the private key, so we'll need to handle this differently
        // For now, we'll save the user data and let the context handle the rest
        try {
          localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
          localStorage.setItem('nostr_login_type', 'extension'); // Mark as extension login
          console.log('💾 LoginModal: Saved user to localStorage (extension login)');
          
          // For extension login, we can't store the private key, but we can store a flag
          // The context will need to handle extension-based sessions differently
          // For now, we'll just save the user and reload
        } catch (storageError) {
          console.error('❌ LoginModal: Failed to save to localStorage:', storageError);
        }
        
        onClose();
        window.location.reload(); // Refresh to update context
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };


  const modalContent = (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" 
      style={{ zIndex: 2147483647 }}
      onClick={(e) => {
        // Close modal when clicking backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl relative max-h-[90vh] overflow-y-auto" 
        style={{ zIndex: 2147483647 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Sign in with Nostr</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Login Method Tabs */}
        <div className="mb-4 flex gap-2 border-b border-gray-200 flex-wrap">
          <button
            onClick={() => setLoginMethod('extension')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              loginMethod === 'extension'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Extension
          </button>
          <button
            onClick={() => setLoginMethod('amber')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              loginMethod === 'amber'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Amber
          </button>
          <button
            onClick={() => setLoginMethod('nip05')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              loginMethod === 'nip05'
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            NIP-05
          </button>
        </div>

        {/* Extension Login */}
        {loginMethod === 'extension' && hasExtension && (
          <div className="mb-4">
            <button
              onClick={handleExtensionLogin}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSubmitting ? 'Connecting...' : '🔌 Connect with Extension'}
            </button>
            <p className="mt-2 text-xs text-gray-500 text-center">
              Click to connect with your Nostr extension
            </p>
          </div>
        )}

        {/* Unified Amber Login */}
        {loginMethod === 'amber' && (
          <>
            {showNip46Connect ? (
              <Nip46Connect
                connectionToken={nip46ConnectionToken}
                signerUrl={nip46SignerUrl}
                onConnected={() => {
                  // Hide the connection UI immediately when connected
                  setShowNip46Connect(false);
                  // Then handle the connection and login
                  handleNip46Connected();
                }}
                onError={(error) => {
                  setError(error);
                  setIsSubmitting(false);
                  setShowNip46Connect(false);
                }}
                onCancel={() => {
                  setShowNip46Connect(false);
                  if (nip46Client) {
                    nip46Client.disconnect();
                  }
                  setIsSubmitting(false);
                }}
              />
            ) : (
              <div className="mb-4">
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-sm text-blue-800">
                    📱 <strong>Amber Signer:</strong> Connect your Amber app to sign Nostr events securely.
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    {isAndroid() && isNip55Available
                      ? 'Using direct app connection (NIP-55) for faster signing'
                      : 'Scan QR code with Amber on your phone (NIP-46)'}
                  </p>
                </div>

                {/* Toggle for pasting existing connection URI */}
                <details
                  className="group mb-3"
                  onToggle={(e) => {
                    // Reset paste mode when closing the details
                    if (!(e.target as HTMLDetailsElement).open) {
                      setShowPasteUri(false);
                      setPastedConnectionUri('');
                    }
                  }}
                >
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800 list-none flex items-center gap-2">
                    <span className="transition-transform group-open:rotate-90">▶</span>
                    <span>Or paste existing connection URI</span>
                  </summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-gray-500">
                      If you already have a bunker:// or nostrconnect:// URI from Amber, paste it here
                    </p>
                    <input
                      type="text"
                      value={pastedConnectionUri}
                      onChange={(e) => {
                        setPastedConnectionUri(e.target.value);
                        // Only enable paste mode if there's actual content
                        setShowPasteUri(e.target.value.trim().length > 0);
                      }}
                      onPaste={() => {
                        // User is pasting, enable paste mode
                        setShowPasteUri(true);
                      }}
                      placeholder="bunker://... or nostrconnect://..."
                      disabled={isSubmitting}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed font-mono text-xs"
                    />
                  </div>
                </details>

                <button
                  onClick={handleAmberLogin}
                  disabled={isSubmitting || (showPasteUri && !pastedConnectionUri.trim())}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isSubmitting ? 'Connecting...' : '🔐 Connect with Amber'}
                </button>
                <p className="mt-2 text-xs text-gray-500 text-center">
                  {showPasteUri && pastedConnectionUri.trim()
                    ? 'Click to connect with your pasted URI'
                    : isAndroid()
                    ? 'Make sure Amber is installed on your device'
                    : 'Scan QR code with Amber on your phone'}
                </p>
              </div>
            )}
          </>
        )}

        {/* NIP-05 Login */}
        {loginMethod === 'nip05' && (
          <div className="mb-4">
            <div className="mb-3">
              <label htmlFor="nip05-input" className="block text-sm font-medium text-gray-700 mb-2">
                NIP-05 Identifier
              </label>
              <input
                id="nip05-input"
                type="text"
                value={nip05Identifier}
                onChange={(e) => setNip05Identifier(e.target.value)}
                placeholder="user@domain.com"
                disabled={isSubmitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isSubmitting && nip05Identifier.trim()) {
                    handleNip05Login();
                  }
                }}
              />
            </div>
            <button
              onClick={handleNip05Login}
              disabled={isSubmitting || !nip05Identifier.trim()}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSubmitting ? 'Verifying...' : '🔐 Sign in with NIP-05'}
            </button>
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-xs text-blue-800">
                <strong>Read-only mode:</strong> NIP-05 login allows you to view your favorites. To add or remove favorites, you&apos;ll need to use the extension login method.
              </p>
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // Render in portal to ensure it's above everything
  if (!mounted || typeof window === 'undefined') {
    return null;
  }

  return createPortal(modalContent, document.body);
}

