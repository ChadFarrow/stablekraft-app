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
  const [errorLog, setErrorLog] = useState<Array<{ timestamp: string; message: string; details?: any }>>([]);
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{
    relayUrl?: string;
    appPubkey?: string;
    eventsReceived?: number;
    lastEventTime?: string;
    connectionCheckCount?: number;
  }>({});

  // Set up error logging from console
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;
    
    // Intercept console errors and warnings related to NIP-46/Amber
    console.error = (...args: any[]) => {
      originalError(...args);
      const message = args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ');
      
      if (message.includes('NIP-46') || message.includes('Amber') || message.includes('relay')) {
        setErrorLog(prev => [...prev.slice(-19), {
          timestamp: new Date().toLocaleTimeString(),
          message: message.substring(0, 200),
          details: args.length > 1 ? args.slice(1) : undefined,
        }]);
      }
    };
    
    console.warn = (...args: any[]) => {
      originalWarn(...args);
      const message = args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ');
      
      if (message.includes('NIP-46') || message.includes('Amber') || message.includes('relay')) {
        setErrorLog(prev => [...prev.slice(-19), {
          timestamp: new Date().toLocaleTimeString(),
          message: `⚠️ ${message.substring(0, 200)}`,
          details: args.length > 1 ? args.slice(1) : undefined,
        }]);
      }
    };
    
    return () => {
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

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
      
      {/* Debug: Show URI info */}
      {connectionToken && (
        <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
          <p className="font-semibold text-yellow-900 mb-1">URI Debug Info:</p>
          <p className="text-yellow-800">Starts with nostrconnect://: {connectionToken.startsWith('nostrconnect://') ? '✅' : '❌'}</p>
          <p className="text-yellow-800">Length: {connectionToken.length} characters</p>
          <p className="text-yellow-800">Has relay param: {connectionToken.includes('relay=') ? '✅' : '❌'}</p>
          <p className="text-yellow-800">Has metadata param: {connectionToken.includes('metadata=') ? '✅' : '❌'}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-yellow-700 font-semibold">Show URI (first 200 chars)</summary>
            <p className="font-mono text-xs break-all mt-1">{connectionToken.substring(0, 200)}...</p>
          </details>
        </div>
      )}

      {/* Connection URI (for manual entry) */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Connection URI (Standard Format)
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
        
        {/* Alternative URI Formats for Testing */}
        {typeof window !== 'undefined' && (window as any).__NIP46_URI_FORMATS__ && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs">
            <p className="font-semibold text-blue-900 mb-2">Alternative URI Formats (for testing):</p>
            <div className="space-y-2">
              <div>
                <label className="block text-blue-800 font-medium mb-1">Format 2 (with secret):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={(window as any).__NIP46_URI_FORMATS__.withSecret}
                    readOnly
                    className="flex-1 px-2 py-1 border border-blue-300 rounded bg-white text-xs font-mono"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText((window as any).__NIP46_URI_FORMATS__.withSecret)}
                    className="px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded text-xs"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-blue-800 font-medium mb-1">Format 3 (with token):</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={(window as any).__NIP46_URI_FORMATS__.withToken}
                    readOnly
                    className="flex-1 px-2 py-1 border border-blue-300 rounded bg-white text-xs font-mono"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText((window as any).__NIP46_URI_FORMATS__.withToken)}
                    className="px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded text-xs"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <p className="text-blue-700 text-xs mt-2">
                💡 If the standard format doesn't work, try these alternative formats in Amber
              </p>
            </div>
          </div>
        )}
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
          {debugInfo.connectionCheckCount && debugInfo.connectionCheckCount > 30 && (
            <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              ⚠️ Still waiting... ({debugInfo.connectionCheckCount} checks). 
              <br />
              Make sure you've:
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                <li>Scanned the QR code with Amber</li>
                <li>Approved the connection request in Amber</li>
                <li>Amber is connected to the same relay: <span className="font-mono text-xs">{debugInfo.relayUrl}</span></li>
              </ul>
            </div>
          )}
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
          <p className="text-sm text-red-800 text-center mb-2">
            ❌ Connection failed. Please try again.
          </p>
          {errorLog.length > 0 && (
            <button
              onClick={() => setShowErrorLog(!showErrorLog)}
              className="text-xs text-red-600 hover:text-red-800 underline"
            >
              {showErrorLog ? 'Hide' : 'Show'} error log ({errorLog.length})
            </button>
          )}
        </div>
      )}

      {/* Error Log Display */}
      {showErrorLog && errorLog.length > 0 && (
        <div className="p-4 bg-gray-900 text-gray-100 rounded-md border border-gray-700 max-h-64 overflow-y-auto">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-semibold">Error Log</h4>
            <button
              onClick={() => setErrorLog([])}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1 text-xs font-mono">
            {errorLog.map((error, index) => (
              <div key={index} className="border-b border-gray-700 pb-1">
                <div className="text-gray-400 text-xs mb-1">{error.timestamp}</div>
                <div className="text-red-300 break-words">{error.message}</div>
                {error.details && error.details.length > 0 && (
                  <details className="mt-1">
                    <summary className="text-gray-400 cursor-pointer text-xs">Details</summary>
                    <pre className="text-xs text-gray-500 mt-1 overflow-x-auto">
                      {JSON.stringify(error.details, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debug Info Panel (always visible on web) */}
      {!isAndroid() && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-semibold text-blue-900">Debug Info</h4>
            <button
              onClick={() => setShowErrorLog(!showErrorLog)}
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              {showErrorLog ? 'Hide' : 'Show'} error log {errorLog.length > 0 && `(${errorLog.length})`}
            </button>
          </div>
          <div className="text-xs text-blue-800 space-y-1">
            {debugInfo.relayUrl && (
              <div>Relay: <span className="font-mono">{debugInfo.relayUrl}</span></div>
            )}
            {debugInfo.appPubkey && (
              <div>App Pubkey: <span className="font-mono">{debugInfo.appPubkey}</span></div>
            )}
            {debugInfo.connectionCheckCount !== undefined && (
              <div>Connection Checks: {debugInfo.connectionCheckCount}</div>
            )}
            {errorLog.length > 0 && (
              <div className="text-red-600 font-semibold">
                ⚠️ {errorLog.length} error(s) logged
              </div>
            )}
          </div>
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

