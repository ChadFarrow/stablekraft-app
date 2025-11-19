'use client';

import React, { useState } from 'react';
import { useNostr } from '@/contexts/NostrContext';

interface ShareButtonProps {
  trackId?: string;
  feedId?: string;
  trackTitle?: string;
  albumTitle?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export default function ShareButton({
  trackId,
  feedId,
  trackTitle,
  albumTitle,
  className = '',
  variant = 'default',
  size = 'md',
}: ShareButtonProps) {
  const { user, isAuthenticated } = useNostr();
  const [isSharing, setIsSharing] = useState(false);
  const [message, setMessage] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleShare = async () => {
    if (!isAuthenticated || !user) {
      setShowModal(true);
      return;
    }

    // Check if user is NIP-05 (read-only) - they can't post
    const loginType = typeof window !== 'undefined'
      ? localStorage.getItem('nostr_login_type') as 'extension' | 'nip05' | 'nip46' | 'nip55' | null
      : null;
    
    if (loginType === 'nip05') {
      setError('NIP-05 login is read-only. To share to Nostr, please log in with a Nostr extension or Amber signer.');
      return;
    }

    setIsSharing(true);
    setError(null);

    try {
      // Check if signer is available
      const { getUnifiedSigner } = await import('@/lib/nostr/signer');
      const signer = getUnifiedSigner();
      
      if (!signer.isAvailable()) {
        // Check if user logged in with NIP-55 (Amber) - if so, try to reconnect
        if (loginType === 'nip55') {
          console.log('🔄 NIP-55 signer not available, attempting to reconnect...');
          try {
            const { NIP55Client } = await import('@/lib/nostr/nip55-client');
            const nip55Client = new NIP55Client();
            await nip55Client.connect();
            await signer.setNIP55Signer(nip55Client);
            console.log('✅ NIP-55 reconnected successfully!');
            // Continue to sign the event
          } catch (reconnectError) {
            console.warn('⚠️ Failed to reconnect NIP-55:', reconnectError);
            setError('Unable to connect to signer. Please ensure Amber is available and try again.');
            setIsSharing(false);
            return;
          }
        } else {
          setError('No signer available. Please connect a Nostr extension, NIP-46 signer, or NIP-55 signer.');
          setIsSharing(false);
          return;
        }
      }

      const content = message.trim() || `Check out this ${trackId ? 'track' : 'album'}!`;
      
      // Create note template using helper
      const tags: string[][] = [];
      if (trackId) {
        tags.push(['t', 'track']);
        tags.push(['trackId', trackId]);
      }
      if (feedId) {
        tags.push(['t', 'album']);
        tags.push(['feedId', feedId]);
      }
      
      const { createNoteTemplate } = await import('@/lib/nostr/events');
      const noteTemplate = createNoteTemplate(content, tags);
      
      // Sign with unified signer
      const signedEvent = await signer.signEvent(noteTemplate as any);
      
      // Send signed event to API
      const response = await fetch('/api/nostr/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-nostr-user-id': user.id,
        },
        body: JSON.stringify({
          trackId,
          feedId,
          message: message.trim() || undefined,
          signedEvent,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to share');
      }

      const data = await response.json();
      if (data.success) {
        setShowModal(false);
        setMessage('');
        // Show success message
        alert('Shared to Nostr successfully!');
      } else {
        throw new Error(data.error || 'Failed to share');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share');
    } finally {
      setIsSharing(false);
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          variant === 'outline'
            ? 'border border-gray-300 hover:bg-gray-50'
            : variant === 'ghost'
            ? 'hover:bg-gray-100'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        } ${size === 'sm' ? 'px-3 py-1 text-xs' : size === 'lg' ? 'px-6 py-3' : ''} ${className}`}
      >
        Share to Nostr
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">
                Share {trackId ? trackTitle || 'Track' : albumTitle || 'Album'} to Nostr
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setMessage('');
                  setError(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}

            <div className="mb-4">
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                Message (optional)
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Add a message..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                maxLength={500}
              />
              <p className="mt-1 text-xs text-gray-500">{message.length}/500</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setMessage('');
                  setError(null);
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleShare}
                disabled={isSharing}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSharing ? 'Sharing...' : 'Share'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

