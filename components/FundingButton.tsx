'use client';

import { useEffect, useRef, useState } from 'react';
import { DollarSign } from 'lucide-react';

import { fundingFromJson, type FundingLink } from '@/lib/podcast-funding';

/**
 * The album page's `<podcast:funding>` button: a green "$" right of the yellow ⚡
 * Boost — the non-Lightning way to pay the artist (PayPal, Cash App, Venmo,
 * Patreon, a merch store: whatever URL the tag names) beside the Lightning one.
 *
 * One link → the button IS that link (new tab). Several → it opens a short menu.
 * No link → renders nothing, so the action row is unchanged for most albums.
 *
 * `fundingFromJson` re-checks every URL: the value becomes an href, and the album
 * object can come from cache or another caller, not only from our parser.
 *
 * Sizes are px, never rem (mobile-layout skill): Android's font-size setting
 * scales rem, and a rem circle in the action row swells into its neighbours.
 */
export function FundingButton({
  funding,
  variant = 'icon',
}: {
  funding?: Array<{ url: string; message?: string }> | null;
  /** `icon`: the 44px circle of the mobile action row. `button`: the desktop pill beside Boost. */
  variant?: 'icon' | 'button';
}) {
  const links = fundingFromJson(funding) ?? [];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (links.length === 0) return null;

  const look =
    variant === 'icon'
      ? 'flex items-center justify-center rounded-full bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg active:scale-95 transition-transform flex-shrink-0'
      : 'flex items-center gap-2 px-6 py-3 text-base rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-semibold transition-colors flex-shrink-0';
  const size = variant === 'icon' ? { width: 44, height: 44 } : undefined;
  const face = (
    <>
      <DollarSign size={20} className="pointer-events-none" aria-hidden />
      {variant === 'button' && <span>Support</span>}
    </>
  );

  if (links.length === 1) {
    const link = links[0];
    return (
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className={look}
        style={size}
        aria-label={`Support the artist: ${labelOf(link)}`}
        title={labelOf(link)}
        data-testid="funding-button"
      >
        {face}
      </a>
    );
  }

  return (
    <div ref={wrapRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={look}
        style={size}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Ways to support the artist"
        title="Ways to support the artist"
        data-testid="funding-button"
      >
        {face}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 rounded-xl bg-gray-900/95 ring-1 ring-white/15 shadow-xl backdrop-blur-md p-1"
          style={{ minWidth: 224, maxWidth: 'min(320px, calc(100vw - 32px))' }}
          data-testid="funding-menu"
        >
          {links.map((link) => (
            <a
              key={link.url}
              role="menuitem"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 text-sm text-white hover:bg-white/10"
              style={{ minHeight: 44 }}
            >
              <DollarSign size={16} className="flex-shrink-0 text-emerald-400" aria-hidden />
              <span className="truncate">{labelOf(link)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** The tag's own text, else the service's host name ("ko-fi.com"), never a bare URL. */
function labelOf(link: FundingLink): string {
  if (link.message) return link.message;
  try {
    return new URL(link.url).hostname.replace(/^www\./, '');
  } catch {
    return 'Support';
  }
}
