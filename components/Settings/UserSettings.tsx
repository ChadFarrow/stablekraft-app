'use client';

import React from 'react';
import { SettingsSection, SettingsRow } from './SettingsLayout';

export default function UserSettings() {
  return (
    <SettingsSection
      title="App Preferences"
      description="Customize your listening experience"
    >
      <div className="text-center py-8 text-gray-400">
        <p>More settings coming soon...</p>
        <p className="text-sm mt-2">
          Future options: theme preferences, playback settings, notifications, and more.
        </p>
      </div>
    </SettingsSection>
  );
}
