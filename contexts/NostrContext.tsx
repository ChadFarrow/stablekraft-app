'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
// Note: nostr-tools functions are imported via @/lib/nostr/keys when needed (lazy-loaded)
import { fetchAndStoreUserRelays, clearStoredUserRelays } from '@/lib/nostr/nip65';
import { normalizePubkey } from '@/lib/nostr/normalize';

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
  loginType?: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker'; // Track login method
}

interface NostrContextType {
  user: NostrUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => void;
  updateUser: (updates: Partial<NostrUser>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const NostrContext = createContext<NostrContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  logout: () => {},
  updateUser: async () => {},
  refreshUser: async () => {},
});

const NOSTR_USER_KEY = 'nostr_user';

export function NostrProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NostrUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from localStorage on mount
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem(NOSTR_USER_KEY);

      if (process.env.NODE_ENV === 'development') {
        console.log('🔐 NostrContext: Loading from localStorage', {
          hasUser: !!storedUser,
        });
      }

      // Load user (extension or NIP-05 login)
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          if (userData.nostrPubkey) {
            const hex = normalizePubkey(userData.nostrPubkey);
            if (hex) userData.nostrPubkey = hex;
          }
          // Get login type from localStorage
          const loginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
          if (loginType) {
            userData.loginType = loginType;
          }
          setUser(userData);
          
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ NostrContext: User loaded from localStorage', {
              userId: userData.id,
              npub: userData.nostrNpub?.slice(0, 16) + '...',
              loginType: userData.loginType || 'extension',
            });
          }

          // Fetch user's NIP-65 relay list in the background
          if (userData.nostrPubkey) {
            fetchAndStoreUserRelays(userData.nostrPubkey).then((relays) => {
              if (relays) {
                console.log(`✅ NostrContext: Fetched ${relays.write.length} write relays for user`);
              }
            }).catch((err) => {
              console.warn('⚠️ NostrContext: Failed to fetch user relays:', err);
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
          if (data.user.nostrPubkey) {
            const { normalizePubkey } = await import('@/lib/nostr/normalize');
            const hex = normalizePubkey(data.user.nostrPubkey);
            if (hex) data.user.nostrPubkey = hex;
          }
          if (data.user.nostrPubkey) {
            const { normalizePubkey } = await import('@/lib/nostr/normalize');
            const hex = normalizePubkey(data.user.nostrPubkey);
            if (hex) data.user.nostrPubkey = hex;
          }
          // Preserve loginType from localStorage if not in response
          const storedLoginType = localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
          if (storedLoginType && !data.user.loginType) {
            data.user.loginType = storedLoginType;
          }
          setUser(data.user);
          localStorage.setItem(NOSTR_USER_KEY, JSON.stringify(data.user));
        }
      }
    } catch (error) {
      console.error('Error refreshing Nostr user:', error);
    }
  }, [user]);


  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(NOSTR_USER_KEY);
    localStorage.removeItem('nostr_login_type'); // Remove login type
    clearStoredUserRelays(); // Clear NIP-65 relay list
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
          // Preserve loginType when updating
          const currentLoginType = user?.loginType || localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker' | null;
          if (currentLoginType && !data.user.loginType) {
            data.user.loginType = currentLoginType;
          }
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
        isAuthenticated: !!user,
        isLoading,
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

