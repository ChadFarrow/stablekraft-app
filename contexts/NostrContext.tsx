'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPublicKey, nip19 } from 'nostr-tools';
import { getPublicKeyFromPrivate, publicKeyToNpub } from '@/lib/nostr/keys';

export interface NostrUser {
  id: string;
  nostrPubkey: string;
  nostrNpub: string;
  displayName?: string;
  avatar?: string;
  bio?: string;
  lightningAddress?: string;
  relays: string[];
  nip05Verified?: boolean;
}

interface NostrContextType {
  user: NostrUser | null;
  privateKey: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (privateKey: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<NostrUser>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const NostrContext = createContext<NostrContextType>({
  user: null,
  privateKey: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
  updateUser: async () => {},
  refreshUser: async () => {},
});

const NOSTR_PRIVATE_KEY_KEY = 'nostr_private_key';
const NOSTR_USER_KEY = 'nostr_user';

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NostrUser | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    try {
      const storedPrivateKey = localStorage.getItem(NOSTR_PRIVATE_KEY_KEY);
      const storedUser = localStorage.getItem(NOSTR_USER_KEY);

      if (process.env.NODE_ENV === 'development') {
        console.log('🔐 NostrContext: Loading from localStorage', {
          hasPrivateKey: !!storedPrivateKey,
          hasUser: !!storedUser,
        });
      }

      // Load user even if there's no private key (for extension-based logins)
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          setUser(userData);
          
          // Only set private key if it exists (manual login)
          if (storedPrivateKey) {
            setPrivateKey(storedPrivateKey);
          }
          
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ NostrContext: User loaded from localStorage', {
              userId: userData.id,
              npub: userData.nostrNpub?.slice(0, 16) + '...',
              hasPrivateKey: !!storedPrivateKey,
              loginType: storedPrivateKey ? 'manual' : 'extension',
            });
          }
        } catch (parseError) {
          console.error('❌ NostrContext: Failed to parse user data:', parseError);
        }
      } else {
        if (process.env.NODE_ENV === 'development') {
          console.log('ℹ️ NostrContext: No stored user found');
        }
      }
    } catch (error) {
      console.error('❌ NostrContext: Error loading user from localStorage:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Sync user with server - fetches from Nostr relays first (source of truth)
  const refreshUser = useCallback(async () => {
    if (!user) return;

    try {
      const response = await fetch('/api/nostr/auth/me', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-nostr-user-id': user.id, // Send user ID to fetch from Nostr relays
        },
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          setUser(data.user);
          localStorage.setItem(NOSTR_USER_KEY, JSON.stringify(data.user));
        }
      }
    } catch (error) {
      console.error('Error refreshing Nostr user:', error);
    }
  }, [user]);

  // Login with private key
  const login = useCallback(async (privateKey: string) => {
    try {
      // Generate public key from private key
      const publicKey = getPublicKeyFromPrivate(privateKey);
      const npub = publicKeyToNpub(publicKey);

      // Store private key (in production, consider more secure storage)
      localStorage.setItem(NOSTR_PRIVATE_KEY_KEY, privateKey);
      setPrivateKey(privateKey);

      // Create challenge and sign it
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

      // Sign challenge using nostr-tools
      const { finalizeEvent } = await import('nostr-tools');
      
      // Convert hex string to Uint8Array
      const secretKey = new Uint8Array(privateKey.length / 2);
      for (let i = 0; i < privateKey.length; i += 2) {
        secretKey[i / 2] = parseInt(privateKey.substr(i, 2), 16);
      }
      
      const eventTemplate = {
        kind: 22242, // Nostr auth challenge kind
        tags: [['challenge', challenge]],
        content: '',
        created_at: Math.floor(Date.now() / 1000),
      };
      const signedEvent = finalizeEvent(eventTemplate, secretKey);
      const signature = signedEvent.sig;
      const eventId = signedEvent.id;
      const createdAt = signedEvent.created_at;

      const loginResponse = await fetch('/api/nostr/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey,
          npub,
          challenge,
          signature,
          eventId,
          createdAt,
        }),
        credentials: 'include',
      });

      if (!loginResponse.ok) {
        throw new Error('Login failed');
      }

      const loginData = await loginResponse.json();
      if (loginData.success && loginData.user) {
        setUser(loginData.user);
        localStorage.setItem(NOSTR_USER_KEY, JSON.stringify(loginData.user));
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (error) {
      console.error('Nostr login error:', error);
      throw error;
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(NOSTR_PRIVATE_KEY_KEY);
    localStorage.removeItem(NOSTR_USER_KEY);
    setPrivateKey(null);
    setUser(null);

    // Call logout API
    fetch('/api/nostr/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(err => {
      console.error('Logout API error:', err);
    });
  }, []);

  // Update user
  const updateUser = useCallback(async (updates: Partial<NostrUser>) => {
    if (!user) return;

    try {
      const response = await fetch('/api/nostr/profile/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.user) {
          setUser(data.user);
          localStorage.setItem(NOSTR_USER_KEY, JSON.stringify(data.user));
        }
      }
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }, [user]);

  return (
    <NostrContext.Provider
      value={{
        user,
        privateKey,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
        updateUser,
        refreshUser,
      }}
    >
      {children}
    </NostrContext.Provider>
  );
}

export function useNostr() {
  const context = useContext(NostrContext);

  if (context === undefined) {
    throw new Error('useNostr must be used within a NostrProvider');
  }

  return context;
}

