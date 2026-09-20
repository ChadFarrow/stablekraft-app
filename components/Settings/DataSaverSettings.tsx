'use client';

import React from 'react';
import { Gauge } from 'lucide-react';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import { useDataSaver } from '@/hooks/useDataSaver';
import { setDataSaver } from '@/lib/data-saver';

/**
 * The Data Saver switch.
 *
 * Deliberately worded as a trade, not as a free win: the artwork really does
 * get softer and a wallet really does reconnect later. A setting that only
 * lists benefits is one people turn on and then report as a bug.
 *
 * The switch markup matches the Offline mode row on /downloads so the two read
 * as siblings — they are the app's two manual "use less network" controls.
 */
export default function DataSaverSettings() {
  const dataSaver = useDataSaver();

  return (
    <SettingsSection
      title="Data & Bandwidth"
      description="For slow or metered connections"
    >
      <SettingsRow
        label={
          <span className="flex items-center gap-2">
            <Gauge className={`h-4 w-4 flex-shrink-0 ${dataSaver ? 'text-amber-400' : 'text-gray-500'}`} />
            Data Saver
          </span>
        }
        description={
          dataSaver
            ? 'On — smaller artwork, still covers instead of animated ones, and no tracks downloaded ahead of what you are playing. Artwork looks softer, and a connected wallet reconnects the first time you use it rather than on load.'
            : 'Off — full-resolution artwork, animated covers, and the next track fetched in advance.'
        }
      >
        <button
          type="button"
          role="switch"
          aria-checked={dataSaver}
          aria-label="Toggle Data Saver"
          onClick={() => setDataSaver(!dataSaver)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            dataSaver ? 'bg-amber-500' : 'bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              dataSaver ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </SettingsRow>
    </SettingsSection>
  );
}
