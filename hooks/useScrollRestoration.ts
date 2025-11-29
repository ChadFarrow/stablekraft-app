'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY_PREFIX = 'scroll_';
const DEBOUNCE_MS = 300;

export function useScrollRestoration() {
  const pathname = usePathname();
  const isPopState = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastPathname = useRef<string | null>(null);

  const getStorageKey = useCallback((path: string) => {
    return `${STORAGE_KEY_PREFIX}${path}`;
  }, []);

  const saveScrollPosition = useCallback((path: string) => {
    try {
      const scrollY = window.scrollY;
      sessionStorage.setItem(getStorageKey(path), String(scrollY));
    } catch {
      // sessionStorage might be unavailable (private browsing, etc.)
    }
  }, [getStorageKey]);

  const getScrollPosition = useCallback((path: string): number | null => {
    try {
      const saved = sessionStorage.getItem(getStorageKey(path));
      return saved ? parseInt(saved, 10) : null;
    } catch {
      return null;
    }
  }, [getStorageKey]);

  const restoreScrollPosition = useCallback((path: string) => {
    const savedPosition = getScrollPosition(path);
    if (savedPosition !== null && savedPosition > 0) {
      // Use requestAnimationFrame to ensure DOM has settled
      requestAnimationFrame(() => {
        // Small delay to handle async content loading
        setTimeout(() => {
          window.scrollTo(0, savedPosition);
        }, 50);
      });
    }
  }, [getScrollPosition]);

  // Handle popstate (back/forward buttons)
  useEffect(() => {
    const handlePopState = () => {
      isPopState.current = true;
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Handle route changes
  useEffect(() => {
    // Skip if pathname is null
    if (!pathname) return;

    // Skip initial mount
    if (lastPathname.current === null) {
      lastPathname.current = pathname;
      // Disable browser's built-in scroll restoration
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
      return;
    }

    // Save scroll position for the page we're leaving
    if (lastPathname.current && lastPathname.current !== pathname) {
      saveScrollPosition(lastPathname.current);
    }

    // Handle navigation
    if (isPopState.current) {
      // Back/forward button - restore scroll position
      restoreScrollPosition(pathname);
      isPopState.current = false;
    } else {
      // Forward navigation (link click) - scroll to top
      window.scrollTo(0, 0);
    }

    lastPathname.current = pathname;
  }, [pathname, saveScrollPosition, restoreScrollPosition]);

  // Save scroll position on scroll (debounced)
  useEffect(() => {
    if (!pathname) return;

    const currentPath = pathname;
    const handleScroll = () => {
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
      scrollTimeout.current = setTimeout(() => {
        saveScrollPosition(currentPath);
      }, DEBOUNCE_MS);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout.current) {
        clearTimeout(scrollTimeout.current);
      }
    };
  }, [pathname, saveScrollPosition]);

  // Save scroll position before page unload
  useEffect(() => {
    if (!pathname) return;

    const currentPath = pathname;
    const handleBeforeUnload = () => {
      saveScrollPosition(currentPath);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pathname, saveScrollPosition]);
}
