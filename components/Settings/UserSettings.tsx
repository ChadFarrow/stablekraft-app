'use client';

import React, { useState } from 'react';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import { useUserSettings } from '@/hooks/useUserSettings';
import { useBitcoinConnect } from '@/components/Lightning/BitcoinConnectProvider';

export default function UserSettings() {
  const { settings, updateSettings } = useUserSettings();
  const { isConnected: isWalletConnected } = useBitcoinConnect();
  const [boostAmount, setBoostAmount] = useState(settings.defaultBoostAmount?.toString() || '21');
  const [boostName, setBoostName] = useState(settings.defaultBoostName || '');
  const [autoBoostAmount, setAutoBoostAmount] = useState(settings.autoBoostAmount?.toString() || '50');

  const handleBoostAmountChange = (value: string) => {
    setBoostAmount(value);

    // Parse and validate
    const amount = parseInt(value);
    if (!isNaN(amount) && amount >= 1) {
      updateSettings({ defaultBoostAmount: amount });
    }
  };

  const handleBoostNameChange = (value: string) => {
    setBoostName(value);
    updateSettings({ defaultBoostName: value });
  };

  const handleAutoBoostToggle = () => {
    updateSettings({ autoBoostEnabled: !settings.autoBoostEnabled });
  };

  const handleAutoBoostAmountChange = (value: string) => {
    setAutoBoostAmount(value);

    // Parse and validate
    const amount = parseInt(value);
    if (!isNaN(amount) && amount >= 1) {
      updateSettings({ autoBoostAmount: amount });
    }
  };

  return (
    <SettingsSection
      title="Lightning & Payments"
      description="Configure your boost and payment preferences"
    >
      <SettingsRow
        label="Default Boost Amount"
        description="The amount in sats that will be pre-filled when sending a boost"
      >
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={boostAmount}
            onChange={(e) => handleBoostAmountChange(e.target.value)}
            min="1"
            className="w-24 px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-purple-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-gray-400 text-sm">sats</span>
        </div>
      </SettingsRow>

      <SettingsRow
        label="Default Boost Name"
        description="Your name that will appear with boosts (leave empty to use 'StableKraft.app user')"
      >
        <input
          type="text"
          value={boostName}
          onChange={(e) => handleBoostNameChange(e.target.value)}
          placeholder="StableKraft.app user"
          maxLength={50}
          className="w-full max-w-xs px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-purple-600 placeholder-gray-500"
        />
      </SettingsRow>

      {/* Auto-Boost Section */}
      <div className="mt-6 pt-6 border-t border-gray-700">
        <h3 className="text-lg font-medium text-white mb-1">Auto-Boost</h3>
        <p className="text-sm text-gray-400 mb-4">Automatically send a boost when each track ends</p>

        <SettingsRow
          label="Enable Auto-Boost"
          description="Automatically boost tracks when they finish playing"
        >
          <div className="flex items-center gap-3">
            <button
              onClick={handleAutoBoostToggle}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.autoBoostEnabled ? 'bg-purple-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.autoBoostEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm text-gray-400">
              {settings.autoBoostEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </SettingsRow>

        {!isWalletConnected && settings.autoBoostEnabled && (
          <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
            <p className="text-sm text-yellow-400">
              ⚠️ Connect a wallet to enable auto-boost payments
            </p>
          </div>
        )}

        <SettingsRow
          label="Auto-Boost Amount"
          description="Amount in sats to send when each track ends"
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={autoBoostAmount}
              onChange={(e) => handleAutoBoostAmountChange(e.target.value)}
              min="1"
              disabled={!settings.autoBoostEnabled}
              className={`w-24 px-3 py-2 bg-gray-800 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-purple-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                !settings.autoBoostEnabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            />
            <span className="text-gray-400 text-sm">sats</span>
          </div>
        </SettingsRow>

        {settings.autoBoostEnabled && (
          <p className="text-xs text-gray-500 mt-2">
            Auto-boosts include Helipad TLV metadata for podcast apps but are not posted to Nostr.
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
