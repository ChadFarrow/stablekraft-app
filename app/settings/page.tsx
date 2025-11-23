'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import SettingsLayout from '@/components/Settings/SettingsLayout';
import NostrSettings from '@/components/Settings/NostrSettings';
import UserSettings from '@/components/Settings/UserSettings';

export default function SettingsPage() {
  const router = useRouter();

  const handleSave = () => {
    // Settings are auto-saved, so just navigate to home
    router.push('/');
  };

  return (
    <SettingsLayout>
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back
      </button>

      {/* Settings Sections */}
      <NostrSettings />
      <UserSettings />

      {/* Save Button */}
      <div className="mt-8 flex justify-center">
        <button
          onClick={handleSave}
          className="px-8 py-3 bg-stablekraft-teal hover:bg-stablekraft-teal/90 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-xl active:scale-95"
        >
          Save & Return to Home
        </button>
      </div>
    </SettingsLayout>
  );
}
