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

      // Load user (extension-based login only)
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          setUser(userData);
          
          if (process.env.NODE_ENV === 'development') {
            console.log('✅ NostrContext: User loaded from localStorage', {
              userId: userData.id,
              npub: userData.nostrNpub?.slice(0, 16) + '...',
              loginType: 'extension',
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


  // Logout
  const logout = useCallback(() => {
    localStorage.removeItem(NOSTR_USER_KEY);
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

