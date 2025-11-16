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
  const [debugInfo, setDebugInfo] = useState<{
    relayUrl?: string;
    appPubkey?: string;
    eventsReceived?: number;
    lastEventTime?: string;
    connectionCheckCount?: number;
  }>({});

  // Poll for connection status and update debug info
  useEffect(() => {
    // Get debug info from sessionStorage
    const pendingConnection = sessionStorage.getItem('nip46_pending_connection');
    if (pendingConnection) {
      try {
        const connectionInfo = JSON.parse(pendingConnection);
        setDebugInfo(prev => ({
          ...prev,
          relayUrl: connectionInfo.relayUrl,
          appPubkey: connectionInfo.publicKey ? connectionInfo.publicKey.slice(0, 16) + '...' : undefined,
        }));
      } catch (err) {
        // Ignore parse errors
      }
    }

    if (connectionStatus === 'waiting' || connectionStatus === 'connecting') {
      let checkCount = 0;
      const interval = setInterval(() => {
        checkCount++;
        setDebugInfo(prev => ({
          ...prev,
          connectionCheckCount: checkCount,
        }));

        // Check if connection was established (stored in localStorage)
        // The key should match what saveNIP46Connection uses: 'nostr_nip46_connection'
        const storedConnection = localStorage.getItem('nostr_nip46_connection');
        if (storedConnection) {
          try {
            const connection = JSON.parse(storedConnection);
            // Check if connection has a pubkey (means it's connected)
            if (connection.pubkey) {
              setConnectionStatus('connected');
              setIsConnecting(false);
              setDebugInfo(prev => ({
                ...prev,
                lastEventTime: new Date().toLocaleTimeString(),
              }));
              // Call onConnected after a short delay to allow UI to update
              setTimeout(() => {
                onConnected();
              }, 500);
            }
          } catch (err) {
            // Ignore parse errors
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
          {isAndroid() 
            ? 'Scan the QR code or use the deep link to connect your Amber app'
            : 'Scan the QR code with Amber on your phone, or copy the connection URI and paste it into Amber'}
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
          {isAndroid() 
            ? 'You can manually enter this URI in Amber if QR code doesn\'t work'
            : 'Copy this URI and paste it into Amber on your mobile device to connect'}
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
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md space-y-2">
          <p className="text-sm text-blue-800 text-center font-medium">
            ⏳ Waiting for connection from Amber...
          </p>
          <p className="text-xs text-blue-600 text-center">
            Make sure you've scanned the QR code or opened the app, and approved the connection in Amber.
          </p>
          <div className="mt-3 flex justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          </div>
          
          {/* Debug Info */}
          <div className="mt-3 pt-3 border-t border-blue-200">
            <p className="text-xs text-blue-700 font-semibold mb-1">Connection Status:</p>
            <div className="text-xs text-blue-600 space-y-1">
              <div>Relay: {debugInfo.relayUrl || 'Not set'}</div>
              <div>App Key: {debugInfo.appPubkey || 'Not set'}</div>
              <div>Checks: {debugInfo.connectionCheckCount || 0}</div>
              {debugInfo.lastEventTime && (
                <div className="text-green-600">Last event: {debugInfo.lastEventTime}</div>
              )}
            </div>
          </div>
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
          <li>Open the Amber app on your mobile device</li>
          <li>Go to Settings → Remote Signing (NIP-46) or use the "Connect" option</li>
          {isAndroid() ? (
            <>
              <li>Scan the QR code above or tap "Open in Amber App" button</li>
            </>
          ) : (
            <>
              <li>Scan the QR code above with your phone's camera, or</li>
              <li>Copy the connection URI above and paste it into Amber's connection field</li>
            </>
          )}
          <li>Approve the connection request in Amber</li>
          <li>Wait for the connection to be established</li>
        </ol>
      </div>

      {/* Manual Check/Continue Buttons - Show when connecting or waiting */}
      {(connectionStatus === 'connecting' || connectionStatus === 'waiting') && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              // Force check connection status
              const storedConnection = localStorage.getItem('nostr_nip46_connection');
              if (storedConnection) {
                try {
                  const connection = JSON.parse(storedConnection);
                  if (connection.pubkey) {
                    setConnectionStatus('connected');
                    setIsConnecting(false);
                    setTimeout(() => onConnected(), 500);
                  } else {
                    alert('Connection not yet established. Please approve the connection in Amber.');
                  }
                } catch (err) {
                  alert('Error checking connection status.');
                }
              } else {
                alert('No connection found. Make sure you\'ve approved the connection in Amber.');
              }
            }}
            className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            Check Status
          </button>
          <button
            onClick={() => {
              // Manually trigger connection - this will try to request public key
              // even if no connection event was received
              console.log('🔄 Nip46Connect: Manual continue triggered');
              setConnectionStatus('connected');
              setIsConnecting(false);
              setTimeout(() => onConnected(), 500);
            }}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"
          >
            Continue
          </button>
        </div>
      )}

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

