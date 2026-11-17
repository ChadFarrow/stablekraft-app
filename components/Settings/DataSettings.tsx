'use client';

import React from 'react';
import { Gauge, WifiOff } from 'lucide-react';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import { useDataSaver } from '@/hooks/useDataSaver';
import { setDataSaver } from '@/lib/data-saver';
import { useDownloads } from '@/contexts/DownloadsContext';

/**
 * The app's two manual "use less network" switches, in one place.
 *
 * Both are deliberately worded as trades rather than as free wins: the artwork
 * really does get softer, and Offline mode really will refuse to stream. A
 * setting that lists only benefits is one people turn on and then report as a
 * bug.
 *
 * Offline mode lived on /downloads until now. It is the same switch reading the
 * same `sk_offline_mode` key through the same DownloadsContext — only the place
 * it is drawn has changed, so anyone who had it on still has it on.
 */

const SWITCH_TRACK = 'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors';
const SWITCH_KNOB = 'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform';

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`${SWITCH_TRACK} ${on ? 'bg-amber-500' : 'bg-gray-600'}`}
    >
      <span className={`${SWITCH_KNOB} ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function DataSettings() {
  const dataSaver = useDataSaver();
  const { offlineMode, setOfflineMode } = useDownloads();

  return (
    <SettingsSection
      title="Data & Offline"
      description="For slow connections, metered data, and listening without a network"
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
        <Switch on={dataSaver} label="Toggle Data Saver" onToggle={() => setDataSaver(!dataSaver)} />
      </SettingsRow>

      {/* Offline mode — a manual switch; the app never flips this on its own. */}
      <SettingsRow
        label={
          <span className="flex items-center gap-2">
            <WifiOff className={`h-4 w-4 flex-shrink-0 ${offlineMode ? 'text-amber-400' : 'text-gray-500'}`} />
            Offline mode
          </span>
        }
        description={
          offlineMode
            ? 'On — only downloaded music plays; new downloads are paused.'
            : 'Off — browse and stream normally.'
        }
      >
        <Switch on={offlineMode} label="Toggle offline mode" onToggle={() => setOfflineMode(!offlineMode)} />
      </SettingsRow>
    </SettingsSection>
  );
}
