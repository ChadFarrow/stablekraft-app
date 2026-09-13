'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { resolveBrowserName, ANDROID_BATTERY_HINT_DISMISSED_KEY } from '@/lib/android-battery-hint';

/**
 * One-time modal shown to Android browser users on first playback, explaining
 * how to set their browser to Unrestricted battery so locked-screen audio
 * survives GrapheneOS / aggressive battery managers. Opened by the
 * `android-battery-hint` CustomEvent dispatched from AudioContext (which owns
 * the gating decision). Dismissal persists in localStorage.
 */
export default function AndroidBatteryHintModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [browserName, setBrowserName] = useState('your browser');

  // Open on the gated event from AudioContext.
  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener('android-battery-hint', handleOpen as EventListener);
    return () => window.removeEventListener('android-battery-hint', handleOpen as EventListener);
  }, []);

  // Resolve the browser display name (Brave needs the async navigator.brave API).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let isBrave = false;
      try {
        const nav = navigator as any;
        if (nav.brave?.isBrave) isBrave = await nav.brave.isBrave();
      } catch {
        // ignore — fall through to UA-based detection
      }
      if (!cancelled) {
        setBrowserName(resolveBrowserName({ ua: navigator.userAgent, isBrave }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(ANDROID_BATTERY_HINT_DISMISSED_KEY, '1');
    } catch {
      // ignore — private mode etc.; worst case it shows again next session
    }
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    // The card is height-bounded in `dvh`, not `vh`, and carries its own
    // scroll: this backdrop centres it without scrolling itself, so an
    // unbounded card clips at *both* ends and no gesture reaches the "Got it"
    // button — reported from a Pixel 4a with Android's Display size turned up,
    // where the four steps alone outgrow the viewport. `vh` would not do,
    // since it is the viewport with the browser toolbar hidden. The safe-area
    // insets are in the padding and the bound so the card clears the status
    // and gesture bars in the native app.
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center px-4 pt-[calc(1rem+var(--sk-safe-top))] pb-[calc(1rem+var(--sk-safe-bottom))]"
      onClick={dismiss}
    >
      <div
        className="bg-gray-900 rounded-xl max-w-md w-full p-6 max-h-[calc(100dvh-2rem-var(--sk-safe-top)-var(--sk-safe-bottom))] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The close button sits in flow beside the heading rather than
            absolutely over it: the heading has no reserved gutter, so at a
            2x OS font scale its first line runs underneath an overlaid X. */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-2xl font-bold text-white">
            Keep audio playing when your screen locks
          </h2>
          <button
            onClick={dismiss}
            className="text-gray-400 hover:text-white transition-colors shrink-0 -mr-1 -mt-1 p-1"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <p className="text-gray-300 text-sm mb-4">
          On some Android phones (GrapheneOS, or phones with aggressive battery
          saving), locked-screen playback can cut out after a few seconds. To fix
          it, let your browser run unrestricted in the background:
        </p>

        <ol className="text-gray-200 text-sm space-y-2 mb-6 list-decimal list-inside">
          <li>Open Android <strong>Settings → Apps → {browserName}</strong></li>
          <li>Tap <strong>Battery</strong> (or &ldquo;App battery usage&rdquo;)</li>
          <li>Set it to <strong>Unrestricted</strong></li>
          <li>Fully close and reopen this app</li>
        </ol>

        <button
          onClick={dismiss}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 rounded-lg transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
