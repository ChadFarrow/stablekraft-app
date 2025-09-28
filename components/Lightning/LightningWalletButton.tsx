'use client';

import React, { useState } from 'react';
import { useBitcoinConnect } from './BitcoinConnectProvider';
import { Zap, Wallet, LogOut, Settings, ChevronDown } from 'lucide-react';

interface LightningWalletButtonProps {
  className?: string;
  showLabel?: boolean;
  variant?: 'button' | 'dropdown' | 'minimal';
}

export function LightningWalletButton({ 
  className = '', 
  showLabel = true,
  variant = 'dropdown'
}: LightningWalletButtonProps) {
  try {
    const { isConnected, connect, disconnect, isLoading } = useBitcoinConnect();
    const [showDropdown, setShowDropdown] = useState(false);

    // Debug logging
    console.log('LightningWalletButton render:', { isConnected, isLoading, variant });

    const handleConnect = async () => {
      try {
        console.log('Attempting to connect wallet...');
        await connect();
        setShowDropdown(false);
      } catch (error) {
        console.error('Failed to connect wallet:', error);
      }
    };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      setShowDropdown(false);
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  };

  if (variant === 'minimal') {
    return (
      <button
        onClick={isConnected ? handleDisconnect : handleConnect}
        disabled={isLoading}
        className={`p-2 rounded-lg transition-colors ${
          isConnected 
            ? 'bg-green-600 hover:bg-green-700 text-white' 
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        } ${className}`}
        title={isConnected ? 'Disconnect Lightning wallet' : 'Connect Lightning wallet'}
      >
        <Zap className="w-4 h-4" />
      </button>
    );
  }

  if (variant === 'button') {
    return (
      <button
        onClick={isConnected ? handleDisconnect : handleConnect}
        disabled={isLoading}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
          isConnected 
            ? 'bg-green-600 hover:bg-green-700 text-white' 
            : 'bg-yellow-500 hover:bg-yellow-600 text-black'
        } ${className}`}
      >
        <Zap className="w-4 h-4" />
        {isLoading ? (
          'Connecting...'
        ) : isConnected ? (
          showLabel ? 'Disconnect' : ''
        ) : (
          showLabel ? 'Connect Wallet' : ''
        )}
      </button>
    );
  }

        // Dropdown variant (default)
        return (
          <div className={`relative ${className}`} style={{ zIndex: 1000 }}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={isLoading}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                isConnected 
                  ? 'bg-green-600 hover:bg-green-700 text-white' 
                  : 'bg-yellow-500 hover:bg-yellow-600 text-black'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Zap className="w-4 h-4" />
              {isLoading ? (
                'Connecting...'
              ) : isConnected ? (
                <>
                  {showLabel && <span>Lightning Wallet</span>}
                  <ChevronDown className="w-4 h-4" />
                </>
              ) : (
                <>
                  {showLabel && <span>Connect Wallet</span>}
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>

            {showDropdown && (
              <>
                {/* Backdrop */}
                <div 
                  className="fixed inset-0 z-[9998]" 
                  onClick={() => setShowDropdown(false)}
                />
                
                {/* Dropdown Menu */}
                <div className="absolute right-0 top-full mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-lg z-[9999] overflow-visible">
            <div className="p-4">
              {isConnected ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Lightning Wallet</h3>
                      <p className="text-sm text-gray-400">Connected</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <button
                      onClick={() => setShowDropdown(false)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Wallet Settings
                    </button>
                    
                    <button
                      onClick={handleDisconnect}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Disconnect Wallet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">Lightning Wallet</h3>
                      <p className="text-sm text-gray-400">Not connected</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <button
                      onClick={handleConnect}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                    >
                      <Zap className="w-4 h-4" />
                      Connect Lightning Wallet
                    </button>
                    
                    <div className="pt-2 border-t border-gray-700">
                      <p className="text-xs text-gray-500 mb-2">Connection Options:</p>
                      <div className="text-xs text-gray-400 space-y-1">
                        <div>• Browser Extension (Alby, Phoenix)</div>
                        <div>• Nostr Wallet Connect (NWC)</div>
                        <div>• Lightning Address</div>
                        <div>• LNURL</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
  } catch (error) {
    console.error('LightningWalletButton error:', error);
    // Fallback button if there's an error
    return (
      <button
        className={`p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 ${className}`}
        title="Lightning wallet (error)"
      >
        <Zap className="w-4 h-4" />
      </button>
    );
  }
}

export default LightningWalletButton;
