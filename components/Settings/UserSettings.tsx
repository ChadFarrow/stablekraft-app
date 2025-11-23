'use client';

import React, { useState } from 'react';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import { useUserSettings } from '@/hooks/useUserSettings';

export default function UserSettings() {
  const { settings, updateSettings } = useUserSettings();
  const [boostAmount, setBoostAmount] = useState(settings.defaultBoostAmount?.toString() || '21');
  const [boostName, setBoostName] = useState(settings.defaultBoostName || '');

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
            className="w-24 px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600"
          />
          <span className="text-gray-400 text-sm">sats</span>
        </div>
      </SettingsRow>

      <SettingsRow
        label="Default Boost Name"
        description="Your name that will appear with boosts (leave empty to boost anonymously)"
      >
        <input
          type="text"
          value={boostName}
          onChange={(e) => handleBoostNameChange(e.target.value)}
          placeholder="Anonymous"
          maxLength={50}
          className="w-full max-w-xs px-3 py-2 bg-gray-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 placeholder-gray-500"
        />
      </SettingsRow>
    </SettingsSection>
  );
}
