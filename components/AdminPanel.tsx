'use client';

import { useState, useEffect } from 'react';
import { toast } from '@/components/Toast';

// ManagedFeed type definition (previously from feed-manager)
interface ManagedFeed {
  id: string;
  originalUrl: string;
  cdnUrl?: string;
  type: 'album' | 'publisher';
  status: 'active' | 'processing' | 'error' | 'pending';
  source?: 'hardcoded' | 'managed';
  title?: string;
  artist?: string;
  addedAt: string;
  lastFetched?: string;
  lastError?: string;
  albumCount?: number;
}

export default function AdminPanel() {
  const [isClient, setIsClient] = useState(false);
  const [feeds, setFeeds] = useState<ManagedFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingFeed, setAddingFeed] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedType, setNewFeedType] = useState<'album' | 'publisher'>('album');
  const [cdnStatus, setCdnStatus] = useState<any>(null);

  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [authError, setAuthError] = useState('');
  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    // Check if already authenticated from localStorage
    const savedAuth = localStorage.getItem('admin-authenticated');
    if (savedAuth === 'true') {
      setIsAuthenticated(true);
      loadFeeds();
      loadCDNStatus();
    } else {
      setLoading(false);
    }
  }, [isClient]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isClient) return;

    if (passphrase.trim().toLowerCase() === 'doerfel') {
      setIsAuthenticated(true);
      setAuthError('');
      localStorage.setItem('admin-authenticated', 'true');
      loadFeeds();
      loadCDNStatus();
    } else {
      setAuthError('Incorrect passphrase. Please try again.');
      setPassphrase('');
    }
  };

  const handleLogout = () => {
    if (!isClient) return;

    setIsAuthenticated(false);
    localStorage.removeItem('admin-authenticated');
    setPassphrase('');
    setAuthError('');
  };

  const loadFeeds = async () => {
    try {
      const response = await fetch('/api/admin/all-feeds');
      const data = await response.json();
      
      if (data.success) {
        setFeeds(data.feeds);
      } else {
        toast.error('Failed to load feeds');
      }
    } catch (error) {
      console.error('Error loading feeds:', error);
      toast.error('Error loading feeds');
    } finally {
      setLoading(false);
    }
  };

  const loadCDNStatus = async () => {
    try {
      const response = await fetch('/api/admin/cdn-status');
      const data = await response.json();
      
      if (data.success) {
        setCdnStatus(data.cdnStatus);
      }
    } catch (error) {
      console.error('Error loading CDN status:', error);
    }
  };

  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newFeedUrl.trim()) {
      toast.error('Please enter a RSS feed URL');
      return;
    }

    setAddingFeed(true);
    
    try {
      const response = await fetch('/api/admin/feeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: newFeedUrl.trim(),
          type: newFeedType
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Also add to hardcoded list
        try {
          const hardcodedResponse = await fetch('/api/admin/add-to-hardcoded', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              originalUrl: newFeedUrl.trim(),
              cdnUrl: data.feed.cdnUrl || newFeedUrl.trim(),
              type: newFeedType
            }),
          });
          
          if (hardcodedResponse.ok) {
            toast.success('Feed added to both managed system and hardcoded list');
          } else {
            toast.success('Feed added to managed system (hardcode update failed)');
          }
        } catch (error) {
          console.warn('Failed to add to hardcoded list:', error);
          toast.success('Feed added to managed system');
        }
        
        setNewFeedUrl('');
        setNewFeedType('album');
        await loadFeeds();
      } else {
        toast.error(data.error || 'Failed to add feed');
      }
    } catch (error) {
      console.error('Error adding feed:', error);
      toast.error('Error adding feed');
    } finally {
      setAddingFeed(false);
    }
  };

  const removeFeed = async (id: string, source: string) => {
    if (source === 'hardcoded') {
      toast.error('Cannot remove hardcoded feeds through admin interface');
      return;
    }

    if (!confirm('Are you sure you want to remove this feed?')) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/feeds/${id}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Feed removed successfully');
        await loadFeeds();
      } else {
        toast.error(data.error || 'Failed to remove feed');
      }
    } catch (error) {
      console.error('Error removing feed:', error);
      toast.error('Error removing feed');
    }
  };

  const refreshFeed = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/feeds/${id}/refresh`, {
        method: 'POST',
      });

      const data = await response.json();
      
      if (data.success) {
        toast.success('Feed refreshed successfully');
        await loadFeeds();
      } else {
        toast.error(data.error || 'Failed to refresh feed');
      }
    } catch (error) {
      console.error('Error refreshing feed:', error);
      toast.error('Error refreshing feed');
    }
  };

  const getStatusColor = (status: ManagedFeed['status']) => {
    switch (status) {
      case 'active': return 'text-green-400';
      case 'processing': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'pending': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: ManagedFeed['status']) => {
    switch (status) {
      case 'active': return '✅';
      case 'processing': return '⏳';
      case 'error': return '❌';
      case 'pending': return '⏸️';
      default: return '❓';
    }
  };

  // Don't render on server-side
  if (!isClient) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  // Authentication screen
  if (!isAuthenticated && !loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold mb-2">Admin Access</h1>
            <p className="text-gray-400">Enter passphrase to access RSS feed management</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="passphrase" className="block text-sm font-medium text-gray-300 mb-2">
                Passphrase
              </label>
              <input
                type="password"
                id="passphrase"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (authError) setAuthError('');
                }}
                placeholder="Enter admin passphrase"
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                autoFocus
                required
              />
              {authError && (
                <p className="mt-2 text-sm text-red-400">{authError}</p>
              )}
            </div>
            
            <button
              type="submit"
              disabled={!passphrase.trim()}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Access Admin Panel
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="container mx-auto px-6 py-12">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            <span className="ml-4 text-lg">Loading feeds...</span>
          </div>
        </div>
      </div>
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
            Manage RSS feeds for the music catalog. Feeds are automatically processed and cached to CDN.
          </p>
          
          {/* CDN Status */}
          {cdnStatus && (
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              cdnStatus.configured 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
            }`}>
              <span className="w-2 h-2 rounded-full bg-current"></span>
              <span>
                CDN: {cdnStatus.configured ? 'Connected' : 'Not Configured'} 
                {cdnStatus.configured && ` (${cdnStatus.storageZone})`}
              </span>
            </div>
          )}
        </div>

        {/* Add Feed Form */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Add New RSS Feed</h2>
          <form onSubmit={addFeed} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="feedUrl" className="block text-sm font-medium text-gray-300 mb-2">
                  RSS Feed URL
                </label>
                <input
                  type="url"
                  id="feedUrl"
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  placeholder="https://example.com/feed.xml"
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={addingFeed}
                  required
                />
              </div>
              <div>
                <label htmlFor="feedType" className="block text-sm font-medium text-gray-300 mb-2">
                  Feed Type
                </label>
                <select
                  id="feedType"
                  value={newFeedType}
                  onChange={(e) => setNewFeedType(e.target.value as 'album' | 'publisher')}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={addingFeed}
                >
                  <option value="album">Album Feed</option>
                  <option value="publisher">Publisher Feed</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={addingFeed || !newFeedUrl.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {addingFeed ? 'Adding Feed...' : 'Add Feed'}
            </button>
          </form>
        </div>

        {/* Feed Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
            <h3 className="text-lg font-semibold mb-2">Total Feeds</h3>
            <p className="text-3xl font-bold text-blue-400">{feeds.length}</p>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
            <h3 className="text-lg font-semibold mb-2">Built-in</h3>
            <p className="text-3xl font-bold text-blue-400">
              {feeds.filter(f => f.source === 'hardcoded').length}
            </p>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
            <h3 className="text-lg font-semibold mb-2">Added</h3>
            <p className="text-3xl font-bold text-green-400">
              {feeds.filter(f => f.source === 'managed').length}
            </p>
          </div>
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4">
            <h3 className="text-lg font-semibold mb-2">Active</h3>
            <p className="text-3xl font-bold text-purple-400">
              {feeds.filter(f => f.status === 'active').length}
            </p>
          </div>
        </div>

        {/* Feeds List */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden">
          <div className="p-6 border-b border-white/10">
            <h2 className="text-2xl font-semibold">Managed Feeds ({feeds.length})</h2>
          </div>
          
          {feeds.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-400 text-lg">No feeds managed yet</p>
              <p className="text-gray-500 text-sm mt-2">Add your first RSS feed above to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {feeds.map((feed) => (
                <div key={feed.id} className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-lg">{getStatusIcon(feed.status)}</span>
                        <span className={`text-sm font-medium ${getStatusColor(feed.status)}`}>
                          {feed.status.toUpperCase()}
                        </span>
                        <span className="text-xs bg-white/10 px-2 py-1 rounded">
                          {feed.type}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          feed.source === 'hardcoded' 
                            ? 'bg-blue-600/80 text-blue-100' 
                            : 'bg-green-600/80 text-green-100'
                        }`}>
                          {feed.source === 'hardcoded' ? 'Built-in' : 'Added'}
                        </span>
                      </div>
                      
                      {feed.title && (
                        <h3 className="text-lg font-semibold mb-1">
                          {feed.title} {feed.artist && `by ${feed.artist}`}
                        </h3>
                      )}
                      
                      <p className="text-gray-400 text-sm break-all mb-2">
                        {feed.originalUrl}
                      </p>
                      
                      {feed.cdnUrl && (
                        <p className="text-blue-400 text-sm break-all mb-2">
                          CDN: {feed.cdnUrl}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span>Added: {new Date(feed.addedAt).toLocaleString()}</span>
                        {feed.lastFetched && (
                          <span>Last fetched: {new Date(feed.lastFetched).toLocaleString()}</span>
                        )}
                        {feed.albumCount && (
                          <span>Albums: {feed.albumCount}</span>
                        )}
                      </div>
                      
                      {feed.lastError && (
                        <p className="text-red-400 text-sm mt-2 bg-red-500/10 p-2 rounded">
                          Error: {feed.lastError}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => refreshFeed(feed.id)}
                        disabled={feed.source === 'hardcoded'}
                        className={`px-3 py-1 rounded transition-colors text-sm ${
                          feed.source === 'hardcoded'
                            ? 'bg-gray-600/20 text-gray-500 cursor-not-allowed'
                            : 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                        }`}
                        title={feed.source === 'hardcoded' ? 'Cannot refresh hardcoded feeds' : 'Refresh feed'}
                      >
                        🔄
                      </button>
                      <button
                        onClick={() => removeFeed(feed.id, feed.source || 'managed')}
                        disabled={feed.source === 'hardcoded'}
                        className={`px-3 py-1 rounded transition-colors text-sm ${
                          feed.source === 'hardcoded'
                            ? 'bg-gray-600/20 text-gray-500 cursor-not-allowed'
                            : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                        }`}
                        title={feed.source === 'hardcoded' ? 'Cannot remove hardcoded feeds' : 'Remove feed'}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 