/**
 * Nostr Authentication Utilities
 * Shared login logic to reduce duplication in LoginModal
 */

import { getUnifiedSigner } from './signer';
import { saveNIP46Connection, savePreferredSigner } from './nip46-storage';
import { publicKeyToNpub } from './keys';
import { createLoginEventTemplate } from './events';

export type LoginType = 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | 'amber';

export interface LoginResult {
  success: boolean;
  user?: any;
  error?: string;
}

export interface SignedLoginEvent {
  id: string;
  pubkey: string;
  sig: string;
  created_at: number;
  kind: number;
  content: string;
  tags: string[][];
}

/**
 * Preserve wallet connection state before page reload
 */
export async function preserveWalletConnection(): Promise<void> {
  try {
    const hasBitcoinConnectData = Object.keys(localStorage).some(key => key.startsWith('bc:'));
    if (hasBitcoinConnectData) {
      console.log('💾 Preserving wallet connection before Nostr login reload...');
      localStorage.setItem('wallet_restore_after_login', 'true');
      localStorage.setItem('wallet_manually_disconnected', 'false');
    }
  } catch (err) {
    console.log('ℹ️ Error checking wallet connection:', err);
  }
}

/**
 * Get authentication challenge from server
 */
export async function getAuthChallenge(): Promise<string> {
  const response = await fetch('/api/nostr/auth/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to get challenge: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.challenge) {
    throw new Error('Invalid challenge response from server');
  }

  return data.challenge;
}

/**
 * Send login request to server with signed event
 */
export async function sendLoginRequest(
  signedEvent: SignedLoginEvent,
  challenge: string
): Promise<LoginResult> {
  const npub = publicKeyToNpub(signedEvent.pubkey);

  const response = await fetch('/api/nostr/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: signedEvent.pubkey,
      npub,
      challenge,
      signature: signedEvent.sig,
      eventId: signedEvent.id,
      createdAt: signedEvent.created_at,
      kind: signedEvent.kind,
      content: signedEvent.content,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      error: errorData.error || `Login failed: ${response.status}`,
    };
  }

  const data = await response.json();
  if (data.success && data.user) {
    return { success: true, user: data.user };
  }

  return { success: false, error: data.error || 'Login failed' };
}

/**
 * Save user data to localStorage after successful login
 */
export function saveUserData(user: any, loginType: LoginType): void {
  localStorage.setItem('nostr_user', JSON.stringify(user));
  localStorage.setItem('nostr_login_type', loginType);
  // Only save preferred signer for signer-based login types
  if (loginType === 'extension' || loginType === 'nip46' || loginType === 'nip55' || loginType === 'nsecbunker') {
    savePreferredSigner(user.nostrPubkey, loginType);
  }
  console.log(`💾 Saved user to localStorage (${loginType} login)`);
}

/**
 * Start favorites sync (fire and forget)
 */
export function startFavoritesSync(userId: string): void {
  console.log('🔄 Syncing favorites to Nostr...');
  import('./sync-favorites')
    .then(({ syncFavoritesToNostr }) => {
      syncFavoritesToNostr(userId)
        .then((results) => console.log('✅ Favorites synced to Nostr:', results))
        .catch((err) => console.error('❌ Error syncing favorites:', err));
    })
    .catch((err) => console.error('❌ Error importing sync module:', err));
}

/**
 * Complete login flow - save data, sync favorites, reload
 */
export async function completeLogin(
  user: any,
  loginType: LoginType,
  onClose: () => void,
  reloadDelay = 500
): Promise<void> {
  saveUserData(user, loginType);
  startFavoritesSync(user.id);
  onClose();
  await preserveWalletConnection();
  setTimeout(() => window.location.reload(), reloadDelay);
}

/**
 * Get challenge and create event template for signing
 */
export async function prepareLoginEvent(): Promise<{ challenge: string; eventTemplate: any }> {
  const challenge = await getAuthChallenge();
  const eventTemplate = createLoginEventTemplate(challenge);
  return { challenge, eventTemplate };
}

/**
 * Complete the full login flow after signing
 */
export async function processSignedLogin(
  signedEvent: SignedLoginEvent,
  challenge: string,
  loginType: LoginType,
  onClose: () => void,
  reloadDelay = 500
): Promise<LoginResult> {
  // Validate signed event
  const missingFields: string[] = [];
  if (!signedEvent.pubkey) missingFields.push('pubkey');
  if (!signedEvent.sig) missingFields.push('sig');
  if (!signedEvent.id) missingFields.push('id');
  if (!signedEvent.created_at) missingFields.push('created_at');

  if (missingFields.length > 0) {
    return {
      success: false,
      error: `Signed event missing fields: ${missingFields.join(', ')}`,
    };
  }

  // Send login request
  const result = await sendLoginRequest(signedEvent, challenge);

  if (result.success && result.user) {
    await completeLogin(result.user, loginType, onClose, reloadDelay);
  }

  return result;
}
