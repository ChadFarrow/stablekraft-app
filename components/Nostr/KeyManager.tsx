'use client';

import React, { useState } from 'react';
import { useNostr } from '@/contexts/NostrContext';
import { privateKeyToNsec, publicKeyToNpub } from '@/lib/nostr/keys';
import { getPublicKeyFromPrivate } from '@/lib/nostr/keys';

interface KeyManagerProps {
  className?: string;
}

export default function KeyManager({ className = '' }: KeyManagerProps) {
  const { privateKey, user } = useNostr();
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!privateKey || !user) {
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

  const nsec = privateKeyToNsec(privateKey);
  const publicKey = getPublicKeyFromPrivate(privateKey);
  const npub = publicKeyToNpub(publicKey);

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

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Private Key (nsec) - Keep Secret!
        </label>
        <div className="flex items-center gap-2">
          <input
            type={showPrivateKey ? 'text' : 'password'}
            value={nsec}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono"
          />
          <button
            onClick={() => setShowPrivateKey(!showPrivateKey)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            {showPrivateKey ? 'Hide' : 'Show'}
          </button>
          <button
            onClick={() => handleCopy(nsec)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p className="mt-1 text-xs text-red-600">
          ⚠️ Never share your private key! Keep it secure.
        </p>
      </div>

      <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
        <p className="text-sm text-yellow-800">
          <strong>Backup your keys:</strong> Save your private key (nsec) in a secure location.
          If you lose it, you won't be able to access your account.
        </p>
      </div>
    </div>
  );
}

