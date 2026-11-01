'use client';

import { usePathname } from 'next/navigation';
import { coversLayoutBackground } from '@/lib/layout-background';

/**
 * The layout's rocket wallpaper. On a route that paints its own opaque
 * background over it (lib/layout-background.ts) the element stays — app/page.tsx
 * looks it up by id — but carries no image, so the browser never downloads one.
 * usePathname runs during server rendering too, so the first HTML is already
 * right: no request starts and nothing flashes.
 */
export default function LayoutRocketBackground() {
  const covered = coversLayoutBackground(usePathname());
  return (
    <div
      className="fixed inset-0 z-0 opacity-0 transition-opacity duration-1000"
      id="background-image"
      style={
        covered
          ? { opacity: 0.6 }
          : {
              background: 'url(/stablekraft-rocket.webp) center/contain fixed',
              backgroundAttachment: 'fixed',
              opacity: 0.6,
            }
      }
    />
  );
}
