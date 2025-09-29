'use client';

import React from 'react';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';

export default function LightningConfigDebug() {
  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 border border-gray-700 rounded-lg p-4 max-w-md z-50">
      <h3 className="text-white font-semibold mb-2">⚡ Lightning Config Debug</h3>
      <div className="text-xs text-gray-300 space-y-1">
        
        <div>
          <span className="text-gray-500">Platform Node Pubkey:</span>
          <div className="ml-2 text-gray-400 break-all">
            {LIGHTNING_CONFIG.platform.nodePublicKey || 'not set'}
          </div>
        </div>
        
        <div>
          <span className="text-gray-500">Node Pubkey:</span>
          <div className="ml-2 text-gray-400 break-all">
            {LIGHTNING_CONFIG.platform.nodePublicKey || 'not set'}
          </div>
        </div>
        
      </div>
      
      <div className="mt-3 pt-2 border-t border-gray-700">
        <p className="text-xs text-gray-500">
          This debug panel only shows in development mode.
        </p>
      </div>
    </div>
  );
}
