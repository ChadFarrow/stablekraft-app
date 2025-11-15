'use client';

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { isAndroid } from '@/lib/utils/device';

interface Nip46ConnectProps {
  connectionToken: string;
  signerUrl: string;
  onConnected: () => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export default function Nip46Connect({
  connectionToken,
  signerUrl,
  onConnected,
  onError,
  onCancel,
}: Nip46ConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'waiting' | 'connecting' | 'connected' | 'error'>('waiting');
  const [deepLinkUrl, setDeepLinkUrl] = useState<string>('');

  // Poll for connection status
  useEffect(() => {
    if (connectionStatus === 'waiting' || connectionStatus === 'connecting') {
      const interval = setInterval(() => {
        // Check if connection was established (stored in sessionStorage or localStorage)
        const pendingConnection = sessionStorage.getItem('nip46_pending_connection');
        if (pendingConnection) {
          const connectionInfo = JSON.parse(pendingConnection);
          // Check if we have a connection established
          const storedConnection = localStorage.getItem('nip46_connection');
          if (storedConnection) {
            setConnectionStatus('connected');
            setIsConnecting(false);
            // Call onConnected after a short delay to allow UI to update
            setTimeout(() => {
              onConnected();
            }, 500);
          }
        }
      }, 2000); // Check every 2 seconds

      return () => clearInterval(interval);
    }
  }, [connectionStatus, onConnected]);

  // Generate deep link URL for Amber
  useEffect(() => {
    if (isAndroid()) {
      // Amber supports nostrconnect:// URIs directly
      // Also support amber:// deep link as fallback
      setDeepLinkUrl(connectionToken); // connectionToken is already the nostrconnect:// URI
    }
  }, [connectionToken, signerUrl]);

  const handleDeepLink = () => {
    if (deepLinkUrl) {
      window.location.href = deepLinkUrl;
      setIsConnecting(true);
      setConnectionStatus('connecting');
    }
  };

  const handleCopyToken = async () => {
    try {
      await navigator.clipboard.writeText(connectionToken);
      alert('Connection token copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy token:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold mb-2">Connect with Amber</h3>
        <p className="text-sm text-gray-600 mb-4">
          Scan the QR code or use the deep link to connect your Amber app
        </p>
      </div>

      {/* QR Code */}
      <div className="flex justify-center p-4 bg-white rounded-lg border border-gray-200">
        <QRCodeSVG
          value={connectionToken} // This is the nostrconnect:// URI
          size={256}
          level="M"
          includeMargin={true}
        />
      </div>

      {/* Connection URI (for manual entry) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Connection URI
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={connectionToken}
            readOnly
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono text-xs"
          />
          <button
            onClick={handleCopyToken}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            Copy
          </button>
        </div>
        <p className="text-xs text-gray-500">
          You can manually enter this URI in Amber if QR code doesn't work
        </p>
      </div>

      {/* Deep Link Button (Android only) */}
      {isAndroid() && deepLinkUrl && (
        <div className="space-y-2">
          <button
            onClick={handleDeepLink}
            disabled={isConnecting}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isConnecting ? 'Opening Amber...' : 'Open in Amber App'}
          </button>
          <p className="text-xs text-gray-500 text-center">
            Tap to open Amber and connect automatically
          </p>
        </div>
      )}

      {/* Connection Status */}
      {connectionStatus === 'connecting' && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-sm text-blue-800 text-center">
            ⏳ Waiting for connection from Amber...
          </p>
        </div>
      )}

      {connectionStatus === 'connected' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-800 text-center">
            ✅ Connected successfully!
          </p>
        </div>
      )}

      {connectionStatus === 'error' && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800 text-center">
            ❌ Connection failed. Please try again.
          </p>
        </div>
      )}

      {/* Instructions */}
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
        <h4 className="text-sm font-semibold mb-2">How to connect:</h4>
        <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
          <li>Open the Amber app on your Android device</li>
          <li>Go to Settings → Remote Signing (NIP-46) or use the "Connect" option</li>
          <li>Scan the QR code above or tap "Open in Amber App" button</li>
          <li>Approve the connection request in Amber</li>
          <li>Wait for the connection to be established</li>
        </ol>
      </div>

      {/* Cancel Button */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

