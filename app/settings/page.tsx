'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import SettingsLayout from '@/components/Settings/SettingsLayout';
import NostrSettings from '@/components/Settings/NostrSettings';
import UserSettings from '@/components/Settings/UserSettings';

export default function SettingsPage() {
  const router = useRouter();

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
    </SettingsLayout>
  );
}
