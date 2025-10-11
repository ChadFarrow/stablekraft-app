'use client';

import { useEffect, useState } from 'react';
import { BoostButton } from '@/components/Lightning/BoostButton';
import { X } from 'lucide-react';

interface BoostEventDetail {
  feedId?: string;
  trackTitle?: string;
  artistName?: string;
  lightningAddress?: string;
  valueSplits?: Array<{
    name?: string;
    address: string;
    split: number;
    type: 'node' | 'lnaddress';
  }>;
}

export function GlobalBoostModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [boostData, setBoostData] = useState<BoostEventDetail | null>(null);

  useEffect(() => {
    const handleOpenBoost = (event: CustomEvent<BoostEventDetail>) => {
      setBoostData(event.detail);
      setIsOpen(true);
    };

    window.addEventListener('openBoost', handleOpenBoost as EventListener);

    return () => {
      window.removeEventListener('openBoost', handleOpenBoost as EventListener);
    };
  }, []);

  if (!isOpen || !boostData) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl max-w-md w-full p-6 relative">
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-6 h-6" />
        </button>

        <h2 className="text-2xl font-bold text-white mb-4">
          Send a Boost ⚡
        </h2>

        {boostData.trackTitle && (
          <div className="mb-4 p-3 bg-gray-800 rounded-lg">
            <p className="text-sm text-gray-400">Boosting</p>
            <p className="text-white font-semibold">{boostData.trackTitle}</p>
            {boostData.artistName && (
              <p className="text-sm text-gray-400">by {boostData.artistName}</p>
            )}
          </div>
        )}

        <div className="mt-4">
          {/* Render a hidden BoostButton that will open its own modal */}
          <div style={{ display: 'none' }}>
            <BoostButton
              feedId={boostData.feedId}
              trackTitle={boostData.trackTitle}
              artistName={boostData.artistName}
              lightningAddress={boostData.lightningAddress}
              valueSplits={boostData.valueSplits}
            />
          </div>

          {/* We'll manually trigger the boost button's modal */}
          <p className="text-gray-300 text-sm">
            This modal is still being set up. The boost button component will handle the payment flow.
          </p>
        </div>
      </div>
    </div>
  );
}
