'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNostr } from '@/contexts/NostrContext';

interface LoginModalProps {
  onClose: () => void;
}

export default function LoginModal({ onClose }: LoginModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasExtension, setHasExtension] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ensure we're mounted before rendering portal
  useEffect(() => {
    setMounted(true);
    // Close any open dropdowns when modal opens
    const closeDropdowns = () => {
      document.body.click();
    };
    closeDropdowns();
    return () => setMounted(false);
  }, []);

  // Check for NIP-07 extension (Alby, nos2x, etc.)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check for standard NIP-07 interface
      if ((window as any).nostr) {
        setHasExtension(true);
        return;
      }
      
      // Also check for Alby specifically
      if ((window as any).webln || (window as any).alby) {
        // Alby might expose nostr through webln
        if ((window as any).webln?.nostr) {
          setHasExtension(true);
          return;
        }
      }
      
      // Check periodically in case extension loads after page load
      const checkInterval = setInterval(() => {
        if ((window as any).nostr) {
          setHasExtension(true);
          clearInterval(checkInterval);
        }
      }, 500);
      
      // Stop checking after 5 seconds
      setTimeout(() => clearInterval(checkInterval), 5000);
      
      return () => clearInterval(checkInterval);
    }
  }, []);

  const handleExtensionLogin = async () => {
    try {
      setIsSubmitting(true);
      setError(null);

      console.log('🔌 LoginModal: Starting extension login...');
      const nostr = (window as any).nostr;
      if (!nostr) {
        console.error('❌ LoginModal: Nostr extension not found');
        throw new Error('Nostr extension not found');
      }
      console.log('✅ LoginModal: Nostr extension found');

      // Get public key from extension
      console.log('🔑 LoginModal: Getting public key from extension...');
      const publicKey = await nostr.getPublicKey();
      console.log('✅ LoginModal: Got public key', publicKey.slice(0, 16) + '...');

      // Request signature for challenge
      let challengeResponse;
      try {
        challengeResponse = await fetch('/api/nostr/auth/challenge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (fetchError) {
        console.error('❌ LoginModal: Network error fetching challenge:', fetchError);
        throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to connect to server'}`);
      }

      if (!challengeResponse.ok) {
        const errorText = await challengeResponse.text().catch(() => 'Unknown error');
        console.error('❌ LoginModal: Challenge request failed:', {
          status: challengeResponse.status,
          statusText: challengeResponse.statusText,
          body: errorText,
        });
        throw new Error(`Failed to get challenge: ${challengeResponse.status} ${challengeResponse.statusText}`);
      }

      let challengeData;
      try {
        challengeData = await challengeResponse.json();
      } catch (parseError) {
        console.error('❌ LoginModal: Failed to parse challenge response:', parseError);
        throw new Error('Invalid response from server');
      }

      if (!challengeData.challenge) {
        console.error('❌ LoginModal: Challenge response missing challenge field:', challengeData);
        throw new Error('Invalid challenge response from server');
      }

      const challenge = challengeData.challenge;

      // Sign challenge with extension
      const event = {
        kind: 22242,
        tags: [['challenge', challenge]],
        content: '',
        created_at: Math.floor(Date.now() / 1000),
      };

      console.log('✍️ LoginModal: Requesting signature from extension...');
      const signedEvent = await nostr.signEvent(event);
      console.log('✅ LoginModal: Got signed event', {
        id: signedEvent.id.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey.slice(0, 16) + '...',
      });

      // Calculate npub from public key
      const { publicKeyToNpub } = await import('@/lib/nostr/keys');
      const npub = publicKeyToNpub(signedEvent.pubkey);
      console.log('✅ LoginModal: Calculated npub', npub.slice(0, 16) + '...');

      // Login with signed event
      const loginResponse = await fetch('/api/nostr/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          publicKey: signedEvent.pubkey,
          npub: npub,
          challenge,
          signature: signedEvent.sig,
          eventId: signedEvent.id,
          createdAt: signedEvent.created_at,
        }),
      });

      if (!loginResponse.ok) {
        const errorData = await loginResponse.json().catch(() => ({}));
        throw new Error(errorData.error || `Login failed: ${loginResponse.status} ${loginResponse.statusText}`);
      }

      const loginData = await loginResponse.json();
      console.log('📥 LoginModal: Login response', { success: loginData.success, error: loginData.error });
      if (loginData.success && loginData.user) {
        console.log('✅ LoginModal: Login successful!', { userId: loginData.user?.id });
        
        // Save user data to localStorage before reload
        // Note: For extension login, we don't have the private key, so we'll need to handle this differently
        // For now, we'll save the user data and let the context handle the rest
        try {
          localStorage.setItem('nostr_user', JSON.stringify(loginData.user));
          console.log('💾 LoginModal: Saved user to localStorage');
          
          // For extension login, we can't store the private key, but we can store a flag
          // The context will need to handle extension-based sessions differently
          // For now, we'll just save the user and reload
        } catch (storageError) {
          console.error('❌ LoginModal: Failed to save to localStorage:', storageError);
        }
        
        onClose();
        window.location.reload(); // Refresh to update context
      } else {
        throw new Error(loginData.error || 'Login failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };


  const modalContent = (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" 
      style={{ zIndex: 2147483647 }}
      onClick={(e) => {
        // Close modal when clicking backdrop
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl relative" 
        style={{ zIndex: 2147483647 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Sign in with Nostr</h2>
          <button
            onClick={onClose}
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

        {hasExtension ? (
          <div className="mb-4">
            <button
              onClick={handleExtensionLogin}
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isSubmitting ? 'Connecting...' : '🔌 Connect with Alby Extension'}
            </button>
            <p className="mt-2 text-xs text-gray-500 text-center">
              Click to connect with your Alby extension
            </p>
          </div>
        ) : (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800">
              💡 <strong>Extension Required:</strong> Please install the <a href="https://getalby.com" target="_blank" rel="noopener noreferrer" className="underline">Alby extension</a> to sign in with Nostr.
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  // Render in portal to ensure it's above everything
  if (!mounted || typeof window === 'undefined') {
    return null;
  }

  return createPortal(modalContent, document.body);
}

