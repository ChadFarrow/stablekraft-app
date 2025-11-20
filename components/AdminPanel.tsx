'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/components/Toast';
import { useNostr } from '@/contexts/NostrContext';
import dynamic from 'next/dynamic';

// Dynamically import LoginModal to avoid SSR issues
const LoginModal = dynamic(() => import('@/components/Nostr/LoginModal'), {
  ssr: false,
});

export default function AdminPanel() {
  const [loading, setLoading] = useState(true);
  const [addingFeed, setAddingFeed] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [verifying, setVerifying] = useState(false);
  
  // Nostr authentication
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  
  // Admin authentication state (separate from Nostr auth)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  const verifyAdminAccess = useCallback(async (npub: string, pubkey: string) => {
    setVerifying(true);
    try {
      const response = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ npub, pubkey }),
      });

      const data = await response.json();
      
      if (data.success && data.authorized) {
        setIsAdminAuthenticated(true);
        localStorage.setItem('admin-authenticated', 'true');
        localStorage.setItem('admin-npub', npub);
      } else {
        setIsAdminAuthenticated(false);
        localStorage.removeItem('admin-authenticated');
        localStorage.removeItem('admin-npub');
        
        // Show specific error message if ADMIN_NPUBS is not configured
        if (response.status === 500 && data.error === 'No admin npubs configured') {
          toast.error('Admin access is not configured. Please set ADMIN_NPUBS environment variable.');
        } else if (response.status === 403) {
          toast.error('Your Nostr account is not whitelisted for admin access.');
        } else if (data.error) {
          toast.error(data.error);
        }
      }
    } catch (error) {
      console.error('Error verifying admin access:', error);
      setIsAdminAuthenticated(false);
      localStorage.removeItem('admin-authenticated');
      localStorage.removeItem('admin-npub');
      toast.error('Failed to verify admin access. Please try again.');
    } finally {
      setVerifying(false);
      setLoading(false);
    }
  }, []);

  // When Nostr user changes, check admin access
  useEffect(() => {
    if (nostrLoading) return;
    
    if (isNostrAuthenticated && nostrUser) {
      // Check if already authenticated as admin
      const savedAdminAuth = localStorage.getItem('admin-authenticated');
      const savedNpub = localStorage.getItem('admin-npub');
      
      // If we have a saved admin auth and the npub matches, verify it's still valid
      if (savedAdminAuth === 'true' && savedNpub === nostrUser.nostrNpub) {
        verifyAdminAccess(nostrUser.nostrNpub, nostrUser.nostrPubkey);
      } else if (savedAdminAuth !== 'true') {
        // No saved admin auth, verify the current user
        verifyAdminAccess(nostrUser.nostrNpub, nostrUser.nostrPubkey);
      } else {
        // Saved npub doesn't match current user, clear and verify
        localStorage.removeItem('admin-authenticated');
        localStorage.removeItem('admin-npub');
        verifyAdminAccess(nostrUser.nostrNpub, nostrUser.nostrPubkey);
      }
    } else {
      // Not authenticated, clear admin auth
      setIsAdminAuthenticated(false);
      localStorage.removeItem('admin-authenticated');
      localStorage.removeItem('admin-npub');
      setLoading(false);
    }
  }, [nostrLoading, isNostrAuthenticated, nostrUser?.nostrNpub, nostrUser?.nostrPubkey, verifyAdminAccess]);

  const handleLogout = () => {
    setIsAdminAuthenticated(false);
    localStorage.removeItem('admin-authenticated');
    localStorage.removeItem('admin-npub');
    setShowLoginModal(false);
  };



  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault();

    const feedUrl = newFeedUrl.trim();

    if (!feedUrl) {
      toast.error('Please enter a RSS feed URL');
      return;
    }

    // Basic URL validation
    try {
      new URL(feedUrl);
    } catch {
      toast.error('Please enter a valid URL');
      return;
    }

    setAddingFeed(true);

    try {
      // Auto-detect type from URL patterns, default to 'album'
      let detectedType = 'album';
      if (feedUrl.includes('/artist/') || feedUrl.includes('/publisher/')) {
        detectedType = 'publisher';
      } else if (feedUrl.includes('/playlist/')) {
        detectedType = 'playlist';
      }

      // Use the main feeds API which parses tracks automatically
      const response = await fetch('/api/feeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalUrl: feedUrl,
          type: detectedType,
          priority: 'normal',
          cdnUrl: ''
        }),
      });

      const data = await response.json();

      if (response.ok || response.status === 206) {
        const trackCount = data.feed?._count?.Track || 0;
        let message = response.ok
          ? `Feed added successfully! ${trackCount} tracks imported.`
          : data.warning || 'Feed added but parsing had issues. Check feed details.';

        // Check if a publisher feed was found
        if (data.publisherFeed?.found && !data.publisherFeed.alreadyImported) {
          message += ` Found publisher feed "${data.publisherFeed.title}" with ${data.publisherFeed.episodeCount} albums. Import it?`;
          toast.success(message, {
            action: {
              label: 'Import Publisher',
              onClick: async () => {
                try {
                  const pubResponse = await fetch('/api/feeds', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      originalUrl: data.publisherFeed.feedUrl,
                      type: 'publisher',
                      priority: 'normal',
                      cdnUrl: ''
                    }),
                  });
                  const pubData = await pubResponse.json();
                  if (pubResponse.ok) {
                    toast.success(`Publisher feed imported with ${pubData.feed?._count?.Track || 0} tracks!`);
                  } else {
                    toast.error('Failed to import publisher feed');
                  }
                } catch (err) {
                  toast.error('Error importing publisher feed');
                }
              }
            }
          });
        } else if (data.publisherFeed?.alreadyImported) {
          message += ' (Publisher feed already imported)';
          toast.success(message);
        } else {
          toast.success(message);
        }

        setNewFeedUrl('');
      } else if (response.status === 409) {
        toast.info('This feed already exists in the database');
      } else {
        toast.error(data.error || 'Failed to add feed. Please check the URL and try again.');
      }
    } catch (error) {
      console.error('Error adding feed:', error);
      toast.error('Network error. Please check your connection and try again.');
    } finally {
      setAddingFeed(false);
    }
  };


  // Show loading state
  if (loading || nostrLoading || verifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="container mx-auto px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-4 text-lg">
              {verifying ? 'Verifying admin access...' : 'Loading...'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (!isNostrAuthenticated || !isAdminAuthenticated) {
    return (
      <>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold mb-2">Admin Access</h1>
              <p className="text-gray-400 mb-4">
                Sign in with Nostr to access RSS feed management
              </p>
              {isNostrAuthenticated && !isAdminAuthenticated && (
                <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500/30 rounded-lg">
                  <p className="text-sm text-yellow-400">
                    ⚠️ Your Nostr account is not whitelisted for admin access.
                  </p>
                  <p className="text-xs text-yellow-500/80 mt-2">
                    Your npub: <span className="font-mono break-all">{nostrUser?.nostrNpub}</span>
                  </p>
                  <p className="text-xs text-yellow-500/80 mt-2">
                    Add this npub to the ADMIN_NPUBS environment variable to grant access.
                  </p>
                </div>
              )}
            </div>
            
            {!isNostrAuthenticated ? (
              <button
                onClick={() => setShowLoginModal(true)}
                className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors font-medium"
              >
                🔐 Sign in with Nostr
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-white/5 rounded-lg text-sm">
                  <p className="text-gray-300">Logged in as:</p>
                  <p className="text-blue-400 font-mono text-xs break-all mt-1">
                    {nostrUser?.nostrNpub || nostrUser?.nostrPubkey}
                  </p>
                </div>
                <button
                  onClick={() => verifyAdminAccess(nostrUser!.nostrNpub, nostrUser!.nostrPubkey)}
                  disabled={verifying}
                  className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {verifying ? 'Verifying...' : 'Verify Admin Access'}
                </button>
              </div>
            )}
          </div>
        </div>
        {showLoginModal && (
          <LoginModal onClose={() => setShowLoginModal(false)} />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      <div className="container mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-4xl font-bold">RSS Feed Management</h1>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors text-sm font-medium"
              title="Logout"
            >
              Logout
            </button>
          </div>
          <p className="text-gray-400 mb-4">
            Manage RSS feeds for the music catalog.
          </p>
        </div>

        {/* Add Feed Form - Simple paste interface */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Add RSS Feed</h2>
          <form onSubmit={addFeed} className="space-y-4">
            <div>
              <label htmlFor="feedUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Paste RSS Feed URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  id="feedUrl"
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      setNewFeedUrl(pastedText.trim());
                    }
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={addingFeed}
                  required
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={addingFeed || !newFeedUrl.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                >
                  {addingFeed ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Adding...
                    </>
                  ) : (
                    'Add Feed'
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Just paste the RSS feed URL and click Add. The system will automatically detect the feed type and parse all tracks.
              </p>
            </div>
          </form>
        </div>

      </div>
    </div>
  );
} 