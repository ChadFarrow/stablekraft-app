'use client';

import React, { createContext, useContext } from 'react';

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
  loginType?: 'extension' | 'nip05' | 'nip46' | 'nip55' | 'nsecbunker';
}

interface NostrContextType {
  user: NostrUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  logout: () => void;
  updateUser: (updates: Partial<NostrUser>) => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Dummy context for radio mode - provides no-op implementations
const RadioNostrContext = createContext<NostrContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  logout: () => {},
  updateUser: async () => {},
  refreshUser: async () => {},
});

export function RadioNostrProvider({ children }: { children: React.ReactNode }) {
  const value: NostrContextType = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    logout: () => {
      console.log('Nostr logout disabled in radio mode');
    },
    updateUser: async () => {
      console.log('Nostr updateUser disabled in radio mode');
    },
    refreshUser: async () => {
      console.log('Nostr refreshUser disabled in radio mode');
    },
  };

  return (
    <RadioNostrContext.Provider value={value}>
      {children}
    </RadioNostrContext.Provider>
  );
}

export function useNostr() {
  const context = useContext(RadioNostrContext);
  
  if (context === undefined) {
    throw new Error('useNostr must be used within a RadioNostrProvider');
  }

  return context;
}

export default RadioNostrProvider;