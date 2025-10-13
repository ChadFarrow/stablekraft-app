'use client';

import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Trash2, Edit, AlertCircle, CheckCircle, Music, Podcast, List } from 'lucide-react';

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

  // Add new feed
  const handleAddFeed = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newFeed.originalUrl) {
      setMessage({ type: 'error', text: 'Feed URL is required' });
      return;
    }
    
    try {
      const response = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newFeed)
      });
      
      const data = await response.json();
      
      if (response.ok || response.status === 206) {
        setMessage({ 
          type: response.ok ? 'success' : 'info', 
          text: data.message || data.warning || 'Feed added successfully' 
        });
        setShowAddForm(false);
        setNewFeed({ originalUrl: '', type: 'album', priority: 'normal', cdnUrl: '' });
        fetchFeeds();
      } else if (response.status === 409) {
        setMessage({ type: 'info', text: 'Feed already exists' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add feed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to add feed' });
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
        <div className={`mb-4 p-4 rounded-lg flex items-center gap-2 ${
          message.type === 'success' ? 'bg-green-500/20 text-green-400' :
          message.type === 'error' ? 'bg-red-500/20 text-red-400' :
          'bg-blue-500/20 text-blue-400'
        }`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> :
           message.type === 'error' ? <AlertCircle className="w-5 h-5" /> :
           <AlertCircle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      {/* Filters and Add Button */}
      <div className="mb-6 flex flex-wrap gap-4">
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
          className="ml-auto px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Feed
        </button>
      </div>

      {/* Add Feed Form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Add New Feed</h3>
          <form onSubmit={handleAddFeed} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Feed URL *</label>
              <input
                type="url"
                value={newFeed.originalUrl}
                onChange={(e) => setNewFeed({ ...newFeed, originalUrl: e.target.value })}
                placeholder="https://example.com/feed.xml"
                className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
                required
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Type</label>
                <select
                  value={newFeed.type}
                  onChange={(e) => setNewFeed({ ...newFeed, type: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
                >
                  <option value="album">Album</option>
                  <option value="playlist">Playlist</option>
                  <option value="podcast">Podcast</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Priority</label>
                <select
                  value={newFeed.priority}
                  onChange={(e) => setNewFeed({ ...newFeed, priority: e.target.value })}
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
                >
                  <option value="core">Core</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">CDN URL (Optional)</label>
                <input
                  type="url"
                  value={newFeed.cdnUrl}
                  onChange={(e) => setNewFeed({ ...newFeed, cdnUrl: e.target.value })}
                  placeholder="CDN mirror URL"
                  className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg focus:outline-none focus:border-green-400"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                Add Feed
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setNewFeed({ originalUrl: '', type: 'album', priority: 'normal', cdnUrl: '' });
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
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
          {feeds.map(feed => (
            <div key={feed.id} className="p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors">
              <div className="flex items-start gap-4">
                {feed.image && (
                  <img 
                    src={feed.image} 
                    alt={feed.title}
                    className="w-16 h-16 rounded-lg object-cover"
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