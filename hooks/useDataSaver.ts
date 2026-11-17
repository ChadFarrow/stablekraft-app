'use client';

import { useSyncExternalStore } from 'react';
import { DATA_SAVER_EVENT, isDataSaverOn } from '@/lib/data-saver';

/**
 * Subscribe to the Data Saver flag.
 *
 * Two events, and both are needed. `DATA_SAVER_EVENT` is dispatched by
 * `setDataSaver` and is the only thing that fires in the tab that made the
 * change — `storage` deliberately does not. `storage` covers the other tabs.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener(DATA_SAVER_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(DATA_SAVER_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Always off on the server. See the note in the hook below. */
const serverSnapshot = () => false;

/**
 * Is Data Saver on?
 *
 * WHY `useSyncExternalStore` AND NOT `hooks/useLocalStorage`: that hook reads
 * storage inside the `useState` initializer, which runs during render. The
 * server has no localStorage, so the server renders "off" and the client
 * renders the stored value — a hydration mismatch on every page for anyone who
 * has the setting on. `useSyncExternalStore` is built for exactly this: it uses
 * `getServerSnapshot` through hydration, then re-reads the real value once.
 *
 * This is the same "off first, read after mount" shape Offline mode uses in
 * `contexts/DownloadsContext.tsx`, for the same reason.
 */
export function useDataSaver(): boolean {
  return useSyncExternalStore(subscribe, isDataSaverOn, serverSnapshot);
}
