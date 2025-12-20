/**
 * Nostr signer reconnection utilities
 * Handles restoring NIP-46/NIP-55 connections when signer becomes unavailable
 */

import { getUnifiedSigner } from './signer';

export type LoginType = 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | 'amber' | null;

export interface ReconnectResult {
  success: boolean;
  error?: string;
  signerType?: string;
}

/**
 * Get current user's pubkey from localStorage
 */
export function getCurrentUserPubkey(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const storedUser = localStorage.getItem('nostr_user');
    if (storedUser) {
      const userData = JSON.parse(storedUser);
      return userData.nostrPubkey;
    }
  } catch (err) {
    console.warn('⚠️ Failed to get current user pubkey:', err);
  }
  return undefined;
}

/**
 * Get login type from localStorage
 */
export function getLoginType(): LoginType {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('nostr_login_type') as LoginType;
}

/**
 * Attempt to restore NIP-46/nsecBunker connection
 */
async function restoreNIP46Connection(
  signer: ReturnType<typeof getUnifiedSigner>,
  currentUserPubkey?: string
): Promise<ReconnectResult> {
  console.log('🔄 NIP-46/nsecBunker signer not available, attempting to restore connection...');

  try {
    const { loadNIP46Connection, saveNIP46Connection } = await import('./nip46-storage');
    const { NIP46Client } = await import('./nip46-client');

    // Debug: Check what's in localStorage
    if (typeof window !== 'undefined') {
      const defaultConn = localStorage.getItem('nostr_nip46_connection');
      const byPubkeyConn = localStorage.getItem('nostr_nip46_connections_by_pubkey');
      console.log('🔍 Checking localStorage for connections:', {
        hasDefaultConnection: !!defaultConn,
        hasByPubkeyConnections: !!byPubkeyConn,
        currentUserPubkey: currentUserPubkey?.slice(0, 16) + '...' || 'N/A',
      });
    }

    // Load saved connection - try with user pubkey first
    let savedConnection = currentUserPubkey ? loadNIP46Connection(currentUserPubkey) : null;
    if (!savedConnection) {
      console.log('⚠️ No connection found with user pubkey, trying without validation...');
      savedConnection = loadNIP46Connection();
    }

    if (!savedConnection) {
      console.warn('⚠️ No saved NIP-46/nsecBunker connection found');
      return {
        success: false,
        error: 'Nostr connection lost. Please log out and reconnect with Amber.'
      };
    }

    // Validate connection matches current user
    if (currentUserPubkey && savedConnection.pubkey && savedConnection.pubkey !== currentUserPubkey) {
      console.warn('⚠️ Stored connection is for different user. Cannot restore.');
      return {
        success: false,
        error: 'Connection mismatch: Please log out and reconnect with Amber.'
      };
    }

    // Set pubkey if missing
    if (!savedConnection.pubkey && currentUserPubkey) {
      savedConnection.pubkey = currentUserPubkey;
      console.log('✅ Set pubkey on connection from current user');
    }

    console.log('✅ Found saved NIP-46/nsecBunker connection, restoring...', {
      signerUrl: savedConnection.signerUrl,
      hasToken: !!savedConnection.token,
      hasPubkey: !!savedConnection.pubkey,
    });

    // Create client and restore connection
    const client = new NIP46Client();
    await client.connect(savedConnection.signerUrl, savedConnection.token, false, savedConnection.pubkey);

    // Authenticate
    console.log('🔐 Authenticating NIP-46/nsecBunker connection...');
    try {
      await client.authenticate();
    } catch (authError) {
      console.warn('⚠️ Authentication failed with saved pubkey, trying fresh connection...', authError);
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      await client.connect(savedConnection.signerUrl, savedConnection.token, false);
      await client.authenticate();
    }

    // Verify client is connected
    const isClientConnected = client.isConnected();
    console.log('🔍 NIP-46 client connection status:', {
      isConnected: isClientConnected,
      hasConnection: !!client.getConnection(),
      pubkey: client.getPubkey()?.slice(0, 16) + '...' || 'N/A',
    });

    if (!isClientConnected) {
      console.warn('⚠️ NIP-46 client not connected after restore attempt');
      try {
        await client.authenticate();
        console.log('✅ NIP-46 client authenticated after retry');
      } catch (authError) {
        const errorMsg = authError instanceof Error ? authError.message : String(authError);
        return {
          success: false,
          error: `Authentication failed: ${errorMsg}. Please try reconnecting with Amber.`
        };
      }
    }

    // Save the connection
    const connection = client.getConnection();
    if (connection) {
      connection.pubkey = currentUserPubkey || connection.pubkey;
      saveNIP46Connection(connection);
      console.log('💾 Saved restored connection to localStorage');
    }

    // Register with unified signer
    await signer.setNIP46Signer(client);
    console.log('✅ NIP-46/nsecBunker signer restored successfully!');

    // Give it a moment to fully establish
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify signer is now available
    if (!signer.isAvailable()) {
      console.log('🔄 Attempting final reinitialize...');
      await signer.reinitialize();
      await new Promise(resolve => setTimeout(resolve, 500));

      if (!signer.isAvailable()) {
        return {
          success: false,
          error: 'Signer not available after reconnection. Please try logging out and reconnecting with Amber.'
        };
      }
    }

    console.log('✅ Signer verified available');
    return { success: true, signerType: 'nip46' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Reconnection error:', errorMessage);
    return {
      success: false,
      error: `Reconnection failed: ${errorMessage}. Please try reconnecting with Amber.`
    };
  }
}

/**
 * Attempt to restore NIP-55 connection (Android only)
 */
async function restoreNIP55Connection(
  signer: ReturnType<typeof getUnifiedSigner>
): Promise<ReconnectResult> {
  console.log('🔄 NIP-55 signer not available, attempting to reconnect...');

  try {
    const { NIP55Client } = await import('./nip55-client');
    const { isIOS } = await import('@/lib/utils/device');

    // Check if user is on iOS - NIP-55 doesn't work on iOS
    if (isIOS()) {
      console.warn('⚠️ NIP-55 is not supported on iOS Safari.');
      return {
        success: false,
        error: 'NIP-55 is not supported on iOS. Please log out and reconnect using NIP-46 (Nostr Connect).'
      };
    }

    const nip55Client = new NIP55Client();
    await nip55Client.connect();
    await signer.setNIP55Signer(nip55Client);
    console.log('✅ NIP-55 reconnected successfully!');

    return { success: true, signerType: 'nip55' };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('⚠️ Failed to reconnect NIP-55:', errorMessage);

    if (errorMessage.includes('iOS') || errorMessage.includes('not supported')) {
      return {
        success: false,
        error: 'NIP-55 is not supported on iOS. Please log out and reconnect using NIP-46 (Nostr Connect).'
      };
    }

    return {
      success: false,
      error: `NIP-55 reconnection failed: ${errorMessage}`
    };
  }
}

/**
 * Verify NIP-46 connection is active
 */
export async function verifyNIP46Connection(
  signer: ReturnType<typeof getUnifiedSigner>
): Promise<ReconnectResult> {
  const nip46Client = signer.getNIP46Client();

  if (!nip46Client) {
    return {
      success: false,
      error: 'Nostr client not available. Please try reconnecting with Amber.'
    };
  }

  const isConnected = nip46Client.isConnected();
  const connection = nip46Client.getConnection();
  const pubkey = nip46Client.getPubkey();

  console.log('🔍 NIP-46/nsecBunker connection verification:', {
    isConnected,
    hasConnection: !!connection,
    hasPubkey: !!pubkey,
  });

  if (!isConnected || !connection) {
    return {
      success: false,
      error: 'Connection not established. Please try reconnecting with Amber.'
    };
  }

  if (!pubkey) {
    console.warn('⚠️ NIP-46/nsecBunker pubkey not available, attempting to get it...');
    try {
      await nip46Client.getPublicKey();
    } catch (error) {
      return {
        success: false,
        error: 'Failed to get public key. Please try reconnecting with Amber.'
      };
    }
  }

  return { success: true, signerType: 'nip46' };
}

/**
 * Ensure signer is available, attempting reconnection if needed
 * Returns true if signer is available, false otherwise
 */
export async function ensureSignerAvailable(): Promise<ReconnectResult> {
  const signer = getUnifiedSigner();

  // Try to reinitialize first
  if (!signer.isAvailable()) {
    try {
      await signer.reinitialize();
    } catch (error) {
      console.warn('⚠️ Failed to reinitialize signer:', error);
    }
  }

  // If available, we're done
  if (signer.isAvailable()) {
    const signerType = signer.getSignerType();

    // For NIP-46, verify the connection is active
    if (signerType === 'nip46' || signerType === 'nsecbunker') {
      const verifyResult = await verifyNIP46Connection(signer);
      if (!verifyResult.success) {
        return verifyResult;
      }
    }

    return { success: true, signerType: signerType || undefined };
  }

  // Not available - attempt reconnection based on login type
  const loginType = getLoginType();
  const currentUserPubkey = getCurrentUserPubkey();

  if (loginType === 'nip46' || loginType === 'nsecbunker' || loginType === 'amber') {
    return restoreNIP46Connection(signer, currentUserPubkey);
  }

  if (loginType === 'nip55') {
    return restoreNIP55Connection(signer);
  }

  // No reconnection possible
  console.log('ℹ️ No signer available (NIP-07 extension, NIP-46, or NIP-55 required)');
  return {
    success: false,
    error: 'No Nostr signer available. Please connect a Nostr wallet.'
  };
}
