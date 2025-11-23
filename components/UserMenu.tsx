'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useNostr } from '@/contexts/NostrContext';
import { useBitcoinConnect } from '@/components/Lightning/BitcoinConnectProvider';
import Link from 'next/link';
import { Menu, Zap, Settings, LogOut, User, Wallet, Info } from 'lucide-react';

// Lazy load LoginModal
const LoginModal = dynamic(() => import('./Nostr/LoginModal'), {
  loading: () => (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6">
        <div className="text-gray-700">Loading...</div>
      </div>
    </div>
  ),
  ssr: false
});

interface UserMenuProps {
  className?: string;
}

export default function UserMenu({ className = '' }: UserMenuProps) {
  const { user, isAuthenticated, logout } = useNostr();
  const { isConnected, connect, disconnect, isLoading } = useBitcoinConnect();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Determine icon color based on connection status
  const getIconColor = () => {
    if (isConnected) return 'text-green-400'; // Wallet connected (green for good)
    return 'text-yellow-400'; // Wallet not connected (yellow to draw attention)
  };

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      console.log('Disconnecting wallet...');

      // Close dropdown first to force a clean state
      setShowDropdown(false);

      // Then disconnect
      await disconnect();
      console.log('Wallet disconnected successfully');

      // Force a small delay to ensure state propagates
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
      alert('Failed to disconnect wallet. Please try again.');
    }
  };

  const handleSwitchWallet = async () => {
    try {
      // Close dropdown first
      setShowDropdown(false);

      // Disconnect current wallet
      await disconnect();
      console.log('Disconnected, now showing wallet selection...');

      // Small delay to ensure disconnect completes
      await new Promise(resolve => setTimeout(resolve, 300));

      // Now show wallet selection modal
      await connect();
    } catch (error) {
      console.error('Failed to switch wallet:', error);
      alert('Failed to switch wallet. Please try again.');
    }
  };

  const handleLogout = () => {
    logout();
    setShowDropdown(false);
  };

  const handleSignIn = () => {
    setShowDropdown(false);
    setShowLoginModal(true);
  };

  return (
    <>
      <div className={`relative ${className}`}>
        <div className="flex items-center gap-2">
          {/* Nostr Profile Display - Show when authenticated */}
          {isAuthenticated && user && (
            <div className="flex items-center gap-2">
              {user.avatar && (
                <img
                  src={user.avatar}
                  alt={user.displayName || 'User'}
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <span className="text-sm text-white">
                {user.displayName || 'User'}
              </span>
            </div>
          )}

          {/* Menu Trigger Button */}
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className={`p-2 rounded-lg transition-colors ${getIconColor()} hover:bg-gray-700/50`}
            title="User Menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </div>

        {/* Dropdown Menu Portal */}
        {showDropdown && typeof window !== 'undefined' && createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0"
              style={{ zIndex: 2147483646 }}
              onClick={() => setShowDropdown(false)}
            />

            {/* Dropdown Menu */}
            <div
              className="w-72 bg-gray-900 border-2 border-gray-700 rounded-lg shadow-lg"
              style={{
                zIndex: 2147483647,
                position: 'fixed',
                top: '80px',
                right: '20px',
                isolation: 'isolate'
              }}
            >
              <div className="p-4">
                {/* Profile Section - Show if authenticated */}
                {isAuthenticated && user && (
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-700">
                    {user.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.displayName || 'User'}
                        className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center">
                        <User className="w-6 h-6 text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">
                        {user.displayName || 'User'}
                      </h3>
                      <p className="text-sm text-gray-400">Nostr Connected</p>
                    </div>
                  </div>
                )}

                {/* Wallet Section */}
                <div className="mb-4 pb-4 border-b border-gray-700">
                  {isConnected ? (
                    <div className="space-y-2">
                      <button
                        onClick={handleSwitchWallet}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                      >
                        <Wallet className="w-4 h-4" />
                        Switch Wallet
                      </button>
                      <button
                        onClick={handleDisconnect}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        Disconnect Wallet
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={async () => {
                        setShowDropdown(false);
                        await handleConnect();
                      }}
                      disabled={isLoading}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Zap className="w-4 h-4" />
                      Connect Lightning Wallet
                    </button>
                  )}
                </div>

                {/* Settings & Authentication */}
                <div className="space-y-2">
                  <Link
                    href="/settings"
                    onClick={() => setShowDropdown(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>

                  <Link
                    href="/about"
                    onClick={() => setShowDropdown(false)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <Info className="w-4 h-4" />
                    About & Support
                  </Link>

                  {isAuthenticated ? (
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  ) : (
                    <button
                      onClick={handleSignIn}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    >
                      <User className="w-4 h-4" />
                      Sign in with Nostr
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>,
          document.body
        )}
      </div>

      {/* Login Modal */}
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </>
  );
}
