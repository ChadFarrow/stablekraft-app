'use client';

import React, { useState } from 'react';
import { useNostr } from '@/contexts/NostrContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import { useRouter } from 'next/navigation';

export default function NostrSettings() {
  const { user, isAuthenticated, logout } = useNostr();
  const { settings, updateSettings } = useUserSettings();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showRelays, setShowRelays] = useState(false);

  const handleNip38Toggle = () => {
    updateSettings({ nip38AutoStatus: !settings.nip38AutoStatus });
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      router.push('/');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (!isAuthenticated || !user) {
    return (
      <SettingsSection
        title="Nostr Account"
        description="Connect with Nostr to unlock social features"
      >
        <div className="text-center py-8">
          <p className="text-gray-400 mb-4">Not connected to Nostr</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            Connect Account
          </button>
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      {/* Account Info */}
      <SettingsSection
        title="Nostr Account"
        description="Your connected Nostr identity"
      >
        <div className="space-y-4">
          {/* Profile Info */}
          <div className="flex items-center gap-4">
            {user.avatar && (
              <img
                src={user.avatar}
                alt={user.displayName || 'Profile'}
                className="w-16 h-16 rounded-full object-cover"
              />
            )}
            <div className="flex-1">
              <div className="text-white font-medium">
                {user.displayName || 'Unnamed User'}
              </div>
              <div className="text-sm text-gray-400 font-mono break-all">
                {user.nostrNpub ? (
                  `${user.nostrNpub.slice(0, 12)}...${user.nostrNpub.slice(-8)}`
                ) : (
                  user.nostrPubkey ? `${user.nostrPubkey.slice(0, 12)}...${user.nostrPubkey.slice(-8)}` : 'No public key'
                )}
              </div>
            </div>
          </div>

          {/* Relays Info */}
          {user.relays && user.relays.length > 0 && (
            <div>
              <button
                onClick={() => setShowRelays(!showRelays)}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors mb-2"
              >
                <span>Connected Relays ({user.relays.length})</span>
                <svg
                  className={`w-4 h-4 transition-transform ${showRelays ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {showRelays && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {user.relays.map((relay, index) => (
                    <div
                      key={index}
                      className="text-xs text-gray-500 font-mono bg-gray-900/50 px-3 py-1 rounded"
                    >
                      {relay}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Disconnect Button */}
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-full px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoggingOut ? 'Disconnecting...' : 'Disconnect Account'}
          </button>
        </div>
      </SettingsSection>

      {/* NIP-38 Status Settings */}
      <SettingsSection
        title="Now Playing Status (NIP-38)"
        description="Automatically share what you're listening to on Nostr"
      >
        <SettingsRow
          label="Auto-publish status"
          description="Publish your currently playing track to Nostr relays. Your status will persist until the next track plays or until the track's duration expires."
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={settings.nip38AutoStatus}
              onChange={handleNip38Toggle}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-800 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </SettingsRow>

        {settings.nip38AutoStatus && (
          <div className="bg-purple-900/20 border border-purple-700/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <svg
                className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="text-sm text-purple-200">
                <p className="font-medium mb-1">Status publishing is enabled</p>
                <p className="text-purple-300/80">
                  Your currently playing track will be shared to your Nostr relays.
                  This status is visible to anyone following you on Nostr and will persist
                  as "last played" until you play a different track or the expiration time is reached.
                </p>
              </div>
            </div>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
