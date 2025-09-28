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
          <span className="text-gray-500">Network:</span> 
          <span className={`ml-2 px-2 py-1 rounded text-xs ${
            LIGHTNING_CONFIG.network === 'testnet' 
              ? 'bg-yellow-500/20 text-yellow-400' 
              : LIGHTNING_CONFIG.network === 'mainnet'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-gray-500/20 text-gray-400'
          }`}>
            {LIGHTNING_CONFIG.network || 'not set'}
          </span>
        </div>
        
        <div>
          <span className="text-gray-500">Platform Address:</span>
          <div className="ml-2 text-gray-400 break-all">
            {LIGHTNING_CONFIG.platform.address || 'not set'}
          </div>
        </div>
        
        <div>
          <span className="text-gray-500">Node Pubkey:</span>
          <div className="ml-2 text-gray-400 break-all">
            {LIGHTNING_CONFIG.platform.nodePublicKey || 'not set'}
          </div>
        </div>
        
        <div>
          <span className="text-gray-500">NWC Relay:</span>
          <div className="ml-2 text-gray-400 break-all">
            {LIGHTNING_CONFIG.nwc.relayUrl || 'not set'}
          </div>
        </div>
        
        <div>
          <span className="text-gray-500">Nostr Enabled:</span>
          <span className={`ml-2 px-2 py-1 rounded text-xs ${
            LIGHTNING_CONFIG.nostr.enabled 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-gray-500/20 text-gray-400'
          }`}>
            {LIGHTNING_CONFIG.nostr.enabled ? 'true' : 'false'}
          </span>
        </div>
        
        <div>
          <span className="text-gray-500">Helipad Enabled:</span>
          <span className={`ml-2 px-2 py-1 rounded text-xs ${
            LIGHTNING_CONFIG.helipad.enabled 
              ? 'bg-green-500/20 text-green-400' 
              : 'bg-gray-500/20 text-gray-400'
          }`}>
            {LIGHTNING_CONFIG.helipad.enabled ? 'true' : 'false'}
          </span>
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
