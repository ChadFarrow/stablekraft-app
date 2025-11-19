'use client';

import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Trash2, Edit, AlertCircle, CheckCircle, Music, Podcast, List, Search, X } from 'lucide-react';

interface Feed {
  id: string;
  title: string;
  description?: string;
  originalUrl: string;
  cdnUrl?: string;
  type: string;
  artist?: string;
  image?: string;
  status: string;
  priority: string;
  lastFetched?: string;
  lastError?: string;
  _count?: {
    Track: number;
  };
}

export default function FeedManager() {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [addingFeed, setAddingFeed] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFeed, setNewFeed] = useState({
    originalUrl: '',
    type: 'album',
    priority: 'normal',
    cdnUrl: ''
  });
  const [filter, setFilter] = useState({
    type: '',
    status: '',
    priority: ''
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Fetch feeds
  const fetchFeeds = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.type) params.append('type', filter.type);
      if (filter.status) params.append('status', filter.status);
      if (filter.priority) params.append('priority', filter.priority);
      
      const response = await fetch(`/api/feeds?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setFeeds(data.feeds || []);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load feeds' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load feeds' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeeds();
  }, [filter]);

  // Auto-dismiss messages after 5 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Add new feed - simplified, auto-detects type
  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const feedUrl = newFeed.originalUrl.trim();
    
    if (!feedUrl) {
      setMessage({ type: 'error', text: 'Feed URL is required' });
      return;
    }

    // Basic URL validation
    try {
      new URL(feedUrl);
    } catch {
      setMessage({ type: 'error', text: 'Please enter a valid URL' });
      return;
    }
    
    setAddingFeed(true);
    setMessage({ type: 'info', text: 'Adding feed...' });
    
    try {
      // Auto-detect type from URL patterns, default to 'album'
      let detectedType = 'album';
      if (feedUrl.includes('/artist/') || feedUrl.includes('/publisher/')) {
        detectedType = 'publisher';
      } else if (feedUrl.includes('/playlist/')) {
        detectedType = 'playlist';
      }
      
      const response = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalUrl: feedUrl,
          type: detectedType,
          priority: 'normal',
          cdnUrl: ''
        })
      });
      
      const data = await response.json();
      
      if (response.ok || response.status === 206) {
        const trackCount = data.feed?._count?.Track || 0;
        setMessage({ 
          type: response.ok ? 'success' : 'info', 
          text: response.ok 
            ? `✅ Feed added successfully! ${trackCount} tracks imported.`
            : `⚠️ ${data.warning || 'Feed added but parsing had issues. Check feed details.'}`
        });
        setShowAddForm(false);
        setNewFeed({ originalUrl: '', type: 'album', priority: 'normal', cdnUrl: '' });
        await fetchFeeds();
      } else if (response.status === 409) {
        setMessage({ type: 'info', text: 'ℹ️ This feed already exists in the database' });
      } else {
        setMessage({ type: 'error', text: `❌ ${data.error || 'Failed to add feed. Please check the URL and try again.'}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '❌ Network error. Please check your connection and try again.' });
    } finally {
      setAddingFeed(false);
    }
  };

  // Refresh feed
  const handleRefreshFeed = async (feedId: string) => {
    setRefreshing(feedId);
    try {
      const response = await fetch(`/api/feeds/${feedId}/refresh`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setMessage({ 
          type: 'success', 
          text: `Feed refreshed. ${data.newTracks || 0} new tracks added.` 
        });
        fetchFeeds();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to refresh feed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to refresh feed' });
    } finally {
      setRefreshing(null);
    }
  };

  // Delete feed
  const handleDeleteFeed = async (feedId: string) => {
    if (!confirm('Are you sure you want to delete this feed? All associated tracks will be deleted.')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/feeds?id=${feedId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Feed deleted successfully' });
        fetchFeeds();
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || 'Failed to delete feed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete feed' });
    }
  };

  // Get icon for feed type
  const getFeedIcon = (type: string) => {
    switch (type) {
      case 'album':
        return <Music className="w-4 h-4" />;
      case 'podcast':
        return <Podcast className="w-4 h-4" />;
      case 'playlist':
        return <List className="w-4 h-4" />;
      default:
        return <Music className="w-4 h-4" />;
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">Active</span>;
      case 'error':
        return <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">Error</span>;
      default:
        return <span className="px-2 py-1 text-xs bg-gray-500/20 text-gray-400 rounded">{status}</span>;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Feed Manager</h1>
        <p className="text-gray-400">Manage your RSS feeds and music sources</p>
      </div>

      {/* Messages */}
      {message && (
        <div className={`mb-4 p-4 rounded-lg flex items-center justify-between gap-2 ${
          message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
          message.type === 'error' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
          'bg-blue-500/20 text-blue-400 border border-blue-500/30'
        }`}>
          <div className="flex items-center gap-2">
            {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> :
             message.type === 'error' ? <AlertCircle className="w-5 h-5" /> :
             <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400"></div>}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {/* Search, Filters and Add Button */}
      <div className="mb-6 space-y-4">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Search */}
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search feeds by title, artist, or URL..."
              className="w-full pl-10 pr-10 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400 placeholder-gray-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Filters */}
          <select
            value={filter.type}
            onChange={(e) => setFilter({ ...filter, type: e.target.value })}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
          >
            <option value="">All Types</option>
            <option value="album">Albums</option>
            <option value="playlist">Playlists</option>
            <option value="podcast">Podcasts</option>
          </select>

          <select
            value={filter.status}
            onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="error">Error</option>
            <option value="inactive">Inactive</option>
          </select>

          <select
            value={filter.priority}
            onChange={(e) => setFilter({ ...filter, priority: e.target.value })}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
          >
            <option value="">All Priorities</option>
            <option value="core">Core</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2 disabled:opacity-50"
            disabled={addingFeed}
          >
            <Plus className="w-5 h-5" />
            Add Feed
          </button>
        </div>

        {/* Stats */}
        {!loading && feeds.length > 0 && (
          <div className="text-sm text-gray-400">
            Showing {feeds.length} feed{feeds.length !== 1 ? 's' : ''}
            {searchQuery && ` matching "${searchQuery}"`}
          </div>
        )}
      </div>

      {/* Add Feed Form - Simple paste interface */}
      {showAddForm && (
        <div className="mb-6 p-6 bg-white/5 border border-white/10 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Add RSS Feed</h3>
          <form onSubmit={handleAddFeed} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">
                Paste RSS Feed URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={newFeed.originalUrl}
                  onChange={(e) => setNewFeed({ ...newFeed, originalUrl: e.target.value })}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      setNewFeed({ ...newFeed, originalUrl: pastedText.trim() });
                    }
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400 focus:ring-2 focus:ring-green-400/20 text-white placeholder-gray-500"
                  required
                  autoFocus
                  disabled={addingFeed}
                />
                <button
                  type="submit"
                  disabled={addingFeed || !newFeed.originalUrl.trim()}
                  className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
                >
                  {addingFeed ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      Add
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewFeed({ originalUrl: '', type: 'album', priority: 'normal', cdnUrl: '' });
                    setMessage(null);
                  }}
                  disabled={addingFeed}
                  className="px-4 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Just paste the RSS feed URL and click Add. The system will automatically detect the feed type.
              </p>
            </div>
          </form>
        </div>
      )}

      {/* Feeds List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-400"></div>
          <p className="mt-4 text-gray-400">Loading feeds...</p>
        </div>
      ) : feeds.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400">No feeds found. Add your first feed to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {feeds
            .filter(feed => {
              if (!searchQuery) return true;
              const query = searchQuery.toLowerCase();
              return (
                feed.title?.toLowerCase().includes(query) ||
                feed.artist?.toLowerCase().includes(query) ||
                feed.originalUrl?.toLowerCase().includes(query) ||
                feed.description?.toLowerCase().includes(query)
              );
            })
            .map(feed => (
            <div key={feed.id} className="p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
              <div className="flex items-start gap-4">
                {feed.image && (
                  <img 
                    src={
                      feed.image.startsWith('http') && !feed.image.includes('re.podtards.com') && !feed.image.startsWith('data:')
                        ? `/api/proxy-image?url=${encodeURIComponent(feed.image)}`
                        : feed.image
                    }
                    alt={feed.title}
                    className="w-16 h-16 rounded-lg object-cover"
                    onError={(e) => {
                      // Fallback to original URL if proxy fails
                      if (e.currentTarget.src.includes('/api/proxy-image') && feed.image) {
                        e.currentTarget.src = feed.image;
                      }
                    }}
                  />
                )}
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {getFeedIcon(feed.type)}
                    <h3 className="text-lg font-semibold">{feed.title}</h3>
                    {getStatusBadge(feed.status)}
                    <span className="text-xs text-gray-400 px-2 py-1 bg-white/5 rounded">
                      {feed.priority}
                    </span>
                  </div>
                  
                  {feed.artist && (
                    <p className="text-sm text-gray-400 mb-1">by {feed.artist}</p>
                  )}
                  
                  {feed.description && (
                    <p className="text-sm text-gray-400 mb-2 line-clamp-2">{feed.description}</p>
                  )}
                  
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{feed._count?.Track || 0} tracks</span>
                    {feed.lastFetched && (
                      <span>Last updated: {new Date(feed.lastFetched).toLocaleDateString()}</span>
                    )}
                    <a 
                      href={feed.originalUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      View Feed
                    </a>
                  </div>
                  
                  {feed.lastError && (
                    <div className="mt-2 p-2 bg-red-500/10 text-red-400 text-xs rounded">
                      Error: {feed.lastError}
                    </div>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRefreshFeed(feed.id)}
                    disabled={refreshing === feed.id}
                    className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                    title="Refresh feed"
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshing === feed.id ? 'animate-spin' : ''}`} />
                  </button>
                  
                  <button
                    onClick={() => handleDeleteFeed(feed.id)}
                    className="p-2 bg-white/5 border border-white/10 rounded-lg hover:bg-red-500/20 hover:border-red-500/50 transition-colors"
                    title="Delete feed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}