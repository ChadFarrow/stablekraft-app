'use client';

import { ReactNode } from 'react';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';

interface ScrollRestorationProviderProps {
  children: ReactNode;
}

export default function ScrollRestorationProvider({ children }: ScrollRestorationProviderProps) {
  useScrollRestoration();
  return <>{children}</>;
}
