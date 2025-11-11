'use client';

import React, { useState } from 'react';
import { useNostr } from '@/contexts/NostrContext';

interface KeyManagerProps {
  className?: string;
}

export default function KeyManager({ className = '' }: KeyManagerProps) {
  const { user } = useNostr();
  const [copied, setCopied] = useState(false);

  if (!user || !user.nostrNpub) {
    return null;
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const npub = user.nostrNpub;

  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Public Key (npub)
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={npub}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono"
          />
          <button
            onClick={() => handleCopy(npub)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Private keys are managed by your Nostr extension and are not stored in this application for security reasons.
        </p>
      </div>
    </div>
  );
}

