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
  const [recentFeeds, setRecentFeeds] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [showImportResultModal, setShowImportResultModal] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [reparsingFeeds, setReparsingFeeds] = useState<Set<string>>(new Set());
  const [reparseFeedUrl, setReparseFeedUrl] = useState('');
  const [reparsingByUrl, setReparsingByUrl] = useState(false);

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

  const fetchRecentFeeds = async () => {
    setLoadingRecent(true);
    try {
      const response = await fetch('/api/feeds?limit=5&sortBy=recent');
      const data = await response.json();
      if (data.feeds) {
        setRecentFeeds(data.feeds);
        if (process.env.NODE_ENV === 'development') {
          console.log('✅ Refreshed recent feeds:', data.feeds.length);
        }
      } else {
        toast.error('Failed to load recent feeds');
      }
    } catch (error) {
      console.error('Error fetching recent feeds:', error);
      toast.error('Network error loading recent feeds');
    } finally {
      setLoadingRecent(false);
    }
  };

  // Fetch recent feeds when authenticated
  useEffect(() => {
    if (isAdminAuthenticated) {
      fetchRecentFeeds();
    }
  }, [isAdminAuthenticated]);



  const reparseFeed = async (feedId: string) => {
    setReparsingFeeds(prev => new Set(prev).add(feedId));

    try {
      const response = await fetch(`/api/admin/feeds/${feedId}/reparse`, {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        const msgs = [];
        if (data.newTracks > 0) msgs.push(`Added ${data.newTracks} new tracks`);
        if (data.updatedTracks > 0) msgs.push(`Updated ${data.updatedTracks} existing tracks`);
        if (data.v4vUpdated > 0) msgs.push(`Refreshed ${data.v4vUpdated} payment splits`);
        if (msgs.length === 0) msgs.push('No changes needed');
        toast.success(`Feed reparsed! ${msgs.join('. ')}.`);
        // Refresh the recent feeds list
        fetchRecentFeeds();
      } else {
        toast.error(data.error || 'Failed to reparse feed. Please try again.');
      }
    } catch (error) {
      console.error('Error reparsing feed:', error);
      toast.error('Network error. Please check your connection and try again.');
    } finally {
      setReparsingFeeds(prev => {
        const next = new Set(prev);
        next.delete(feedId);
        return next;
      });
    }
  };

  const reparseByUrl = async (e: React.FormEvent) => {
    e.preventDefault();

    const feedUrl = reparseFeedUrl.trim();

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

    setReparsingByUrl(true);

    try {
      // Use the refresh-by-url endpoint which will find the feed by URL and reparse it
      const response = await fetch('/api/feeds/refresh-by-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalUrl: feedUrl,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Check if this is the HGH playlist and clear its cache
        if (feedUrl.includes('HGH-music-playlist.xml') || feedUrl.includes('chadf-musicl-playlists')) {
          try {
            await fetch('/api/playlist-cache?clear=hgh-playlist', {
              method: 'DELETE',
            });
            console.log('✅ Cleared HGH playlist cache');
          } catch (cacheError) {
            console.warn('⚠️ Failed to clear HGH playlist cache:', cacheError);
          }
        }

        const messages = [];
        if (data.newTracks > 0) messages.push(`Added ${data.newTracks} new tracks`);
        if (data.updatedTracks > 0) messages.push(`Updated ${data.updatedTracks} existing tracks`);
        if (data.v4vUpdated > 0) messages.push(`Refreshed ${data.v4vUpdated} payment splits`);
        if (messages.length === 0) messages.push('No changes needed');
        toast.success(`Feed reparsed! ${messages.join('. ')}. Total: ${data.totalTracks} tracks`);
        setReparseFeedUrl('');
        // Refresh the recent feeds list
        fetchRecentFeeds();
      } else {
        toast.error(data.error || 'Failed to reparse feed. Please check the URL and try again.');
      }
    } catch (error) {
      console.error('Error reparsing feed:', error);
      toast.error('Network error. Please check your connection and try again.');
    } finally {
      setReparsingByUrl(false);
    }
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
        // Show modal with import results
        setImportResult({
          success: response.ok,
          warning: response.status === 206,
          feed: data.feed,
          publisherFeed: data.publisherFeed,
          importedPublisherFeed: data.importedPublisherFeed
        });
        setShowImportResultModal(true);
        setNewFeedUrl('');
        // Refresh the recent feeds list
        fetchRecentFeeds();
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
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </a>
              <h1 className="text-4xl font-bold">RSS Feed Management</h1>
            </div>
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

        {/* Reparse Feed Form */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Reparse Existing Feed</h2>
          <form onSubmit={reparseByUrl} className="space-y-4">
            <div>
              <label htmlFor="reparseFeedUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Paste RSS Feed URL to Reparse
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  id="reparseFeedUrl"
                  value={reparseFeedUrl}
                  onChange={(e) => setReparseFeedUrl(e.target.value)}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      setReparseFeedUrl(pastedText.trim());
                    }
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  disabled={reparsingByUrl}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={reparsingByUrl || !reparseFeedUrl.trim()}
                  className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                >
                  {reparsingByUrl ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Reparsing...
                    </>
                  ) : (
                    <>
                      🔄 Reparse Feed
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Paste the URL of an existing feed to refresh it from the source. This will update metadata, add any new tracks, and sync all lightning payment splits with the feed.
              </p>
            </div>
          </form>
        </div>

        {/* Recently Added Feeds */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Recently Added</h2>
            <button
              onClick={fetchRecentFeeds}
              disabled={loadingRecent}
              className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {loadingRecent ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {loadingRecent && recentFeeds.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
              Loading recent feeds...
            </div>
          ) : recentFeeds.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No feeds imported yet. Add your first feed above!
            </div>
          ) : (
            <div className="space-y-3">
              {recentFeeds.map((feed) => (
                <div
                  key={feed.id}
                  className="bg-white/5 rounded-lg p-4 border border-white/10 hover:bg-white/10 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {feed.image && (
                      <img
                        src={feed.image}
                        alt={feed.title}
                        className="w-16 h-16 rounded object-cover flex-shrink-0"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <a
                            href={feed.type === 'publisher' ? `/publisher/${feed.id}` : `/album/${feed.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-white hover:text-blue-400 truncate block transition-colors"
                            title="View on site"
                          >
                            {feed.title} ↗
                          </a>
                          {feed.artist && (
                            <p className="text-sm text-gray-400">{feed.artist}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            feed.type === 'album' ? 'bg-blue-600/20 text-blue-400' :
                            feed.type === 'publisher' ? 'bg-purple-600/20 text-purple-400' :
                            'bg-green-600/20 text-green-400'
                          }`}>
                            {feed.type}
                          </span>
                          <button
                            onClick={() => reparseFeed(feed.id)}
                            disabled={reparsingFeeds.has(feed.id)}
                            className="px-3 py-1 bg-orange-600/20 text-orange-400 rounded hover:bg-orange-600/30 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            title="Reparse feed from RSS source"
                          >
                            {reparsingFeeds.has(feed.id) ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b border-orange-400"></div>
                                <span>Reparsing...</span>
                              </>
                            ) : (
                              <>
                                <span>🔄</span>
                                <span>Reparse</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                        <span>📀 {feed._count?.Track || 0} tracks</span>
                        {feed.v4vRecipient && (
                          <span className="text-green-400">⚡ {feed.v4vRecipient}</span>
                        )}
                        <span className="text-gray-500">
                          {new Date(feed.createdAt).toLocaleDateString()} {new Date(feed.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="mt-2">
                        <a
                          href={feed.originalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 truncate block"
                        >
                          {feed.originalUrl}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test Feed Link */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
          <h2 className="text-2xl font-semibold mb-4">Test Feed</h2>
          <a
            href="/album/lnurl-test-feed"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600/20 text-orange-400 rounded-lg hover:bg-orange-600/30 transition-colors text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            LNURL Test Feed
          </a>
        </div>

      </div>

      {/* Import Result Modal */}
      {showImportResultModal && importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl border border-white/20 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gray-900/95 backdrop-blur-sm border-b border-white/10 p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-1">
                    {importResult.success ? '✅ Import Successful!' : '⚠️ Import Completed with Warnings'}
                  </h3>
                  <p className="text-gray-400 text-sm">
                    {importResult.success
                      ? 'Feed and tracks have been imported successfully'
                      : 'Feed was added but some issues were encountered'}
                  </p>
                </div>
                <button
                  onClick={() => setShowImportResultModal(false)}
                  className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Main Album/Feed Info */}
              <div className="bg-white/5 rounded-lg p-5 border border-white/10">
                <div className="flex items-start gap-4">
                  {importResult.feed?.image && (
                    <img
                      src={importResult.feed.image}
                      alt={importResult.feed.title}
                      className="w-24 h-24 rounded-lg object-cover flex-shrink-0 shadow-lg"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 mb-2">
                      <h4 className="text-xl font-semibold text-white">{importResult.feed?.title}</h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ${
                        importResult.feed?.type === 'album' ? 'bg-blue-600/20 text-blue-400' :
                        importResult.feed?.type === 'publisher' ? 'bg-purple-600/20 text-purple-400' :
                        'bg-green-600/20 text-green-400'
                      }`}>
                        {importResult.feed?.type}
                      </span>
                    </div>
                    {importResult.feed?.artist && (
                      <p className="text-gray-300 mb-3">{importResult.feed.artist}</p>
                    )}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-gray-400">📀 Tracks:</span>
                        <span className="text-white font-medium">{importResult.feed?._count?.Track || 0}</span>
                      </div>
                      {importResult.feed?.v4vRecipient && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">⚡ Lightning:</span>
                          <span className="text-green-400 font-mono text-xs">{importResult.feed.v4vRecipient}</span>
                        </div>
                      )}
                      {importResult.feed?.v4vValue?.recipients && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400 mb-1">Payment splits:</p>
                          <div className="space-y-1">
                            {importResult.feed.v4vValue.recipients.map((recipient: any, idx: number) => (
                              <div key={idx} className="text-xs text-gray-300 font-mono">
                                {recipient.name} ({recipient.split}%) - {recipient.address}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="pt-2 border-t border-white/10">
                        <a
                          href={importResult.feed?.originalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 truncate block"
                        >
                          {importResult.feed?.originalUrl}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Publisher Feed Auto-Import Info */}
              {importResult.importedPublisherFeed && (
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-5">
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">🎤</div>
                    <div className="flex-1">
                      <h5 className="text-lg font-semibold text-purple-300 mb-2">
                        Publisher Feed Auto-Imported!
                      </h5>
                      <p className="text-sm text-gray-300 mb-3">
                        Found and automatically imported the artist's publisher feed:
                      </p>
                      <div className="bg-white/5 rounded p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-white font-medium">{importResult.importedPublisherFeed.title}</span>
                          <span className="px-2 py-0.5 bg-purple-600/30 text-purple-300 rounded text-xs font-medium">
                            publisher
                          </span>
                        </div>
                        <div className="text-sm text-gray-400">
                          📀 {importResult.importedPublisherFeed.trackCount} albums imported
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Publisher Feed Already Existed */}
              {importResult.publisherFeed?.found && importResult.publisherFeed?.alreadyImported && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl">ℹ️</div>
                    <div>
                      <p className="text-sm text-gray-300">
                        Publisher feed <span className="text-blue-300 font-medium">{importResult.publisherFeed.title}</span> was already in the database.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Publisher Feed Found but Not Auto-Imported */}
              {importResult.publisherFeed?.found &&
               !importResult.publisherFeed?.alreadyImported &&
               !importResult.publisherFeed?.autoImported &&
               !importResult.publisherFeed?.error && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl">🎤</div>
                    <div className="flex-1">
                      <p className="text-sm text-green-200 font-medium mb-2">
                        Publisher Feed Detected
                      </p>
                      <p className="text-sm text-gray-300 mb-2">
                        Found artist's publisher feed: <span className="text-green-300 font-medium">{importResult.publisherFeed.title}</span>
                      </p>
                      {importResult.publisherFeed.episodeCount && (
                        <p className="text-xs text-gray-400">
                          Contains {importResult.publisherFeed.episodeCount} albums
                        </p>
                      )}
                      <div className="mt-2 pt-2 border-t border-green-500/20">
                        <a
                          href={importResult.publisherFeed.feedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-green-400 hover:text-green-300"
                        >
                          {importResult.publisherFeed.feedUrl}
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Publisher Auto-Import Failed */}
              {importResult.publisherFeed?.found && importResult.publisherFeed?.error && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl">⚠️</div>
                    <div>
                      <p className="text-sm text-yellow-200 font-medium mb-1">
                        Failed to auto-import publisher feed
                      </p>
                      <p className="text-xs text-gray-400">
                        {importResult.publisherFeed.error}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning Message */}
              {importResult.warning && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl">⚠️</div>
                    <div>
                      <p className="text-sm text-orange-200">
                        Feed was added but parsing had some issues. Please check the feed details.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 bg-gray-900/95 backdrop-blur-sm border-t border-white/10 p-6">
              <button
                onClick={() => setShowImportResultModal(false)}
                className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 