'use client';

import { LightningProvider } from '@/contexts/LightningContext';

interface LightningWrapperProps {
  children: React.ReactNode;
}

export default function LightningWrapper({ children }: LightningWrapperProps) {
  return (
    <LightningProvider>
      {children}
    </LightningProvider>
  );
}
