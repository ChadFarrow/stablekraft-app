'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSession } from '@/contexts/SessionContext';
import { useNostr } from '@/contexts/NostrContext';
import { getSessionId } from '@/lib/session-utils';
import { AlertTriangle, Trash2, Loader2, X } from 'lucide-react';

interface FavoriteCounts {
  nostr: { albums: number; tracks: number; total: number };
  local: { albums: number; tracks: number; total: number };
  all: { albums: number; tracks: number; total: number };
  hasNostrUser: boolean;
  hasSession: boolean;
}

export default function DangerSettings() {
  const { sessionId, isLoading: sessionLoading } = useSession();
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();
  const [counts, setCounts] = useState<FavoriteCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState<'nostr' | 'local' | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Function to fetch favorite counts
  const fetchCounts = async () => {
    setLoading(true);
    try {
      const headers: HeadersInit = {};
      if (isNostrAuthenticated && nostrUser) {
        headers['x-nostr-user-id'] = nostrUser.id;
      }
      const currentSessionId = sessionId || getSessionId();
      if (currentSessionId) {
        headers['x-session-id'] = currentSessionId;
      }

      const response = await fetch('/api/favorites/delete-all', {
        method: 'GET',
        headers
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCounts(data.counts);
        }
      }
    } catch (error) {
      console.error('Error fetching favorite counts:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch favorite counts when contexts are ready
  useEffect(() => {
    // Wait for both contexts to finish loading
    if (sessionLoading || nostrLoading) {
      return;
    }

    fetchCounts();
  }, [sessionId, sessionLoading, nostrUser, isNostrAuthenticated, nostrLoading]);

  const handleDelete = async (type: 'nostr' | 'local') => {
    setDeleting(true);
    setDeleteResult(null);

    try {
      const headers: HeadersInit = {};
      if (type === 'nostr' && isNostrAuthenticated && nostrUser) {
        headers['x-nostr-user-id'] = nostrUser.id;
      }
      if (type === 'local') {
        const currentSessionId = sessionId || getSessionId();
        if (currentSessionId) {
          headers['x-session-id'] = currentSessionId;
        }
      }

      const response = await fetch(`/api/favorites/delete-all?type=${type}`, {
        method: 'DELETE',
        headers
      });

      const data = await response.json();

      if (data.success) {
        setDeleteResult({
          success: true,
          message: data.message
        });
        // Refresh counts
        await fetchCounts();
      } else {
        setDeleteResult({
          success: false,
          message: data.error || 'Failed to delete favorites'
        });
      }
    } catch (error) {
      console.error('Error deleting favorites:', error);
      setDeleteResult({
        success: false,
        message: 'An error occurred while deleting favorites'
      });
    } finally {
      setDeleting(false);
      setShowConfirmModal(null);
    }
  };

  const getConfirmModalContent = () => {
    if (showConfirmModal === 'nostr') {
      return {
        title: 'Delete All Nostr Favorites?',
        description: `This will permanently delete ${counts?.nostr.albums || 0} albums and ${counts?.nostr.tracks || 0} tracks from your Nostr favorites. This action cannot be undone.`,
        buttonText: 'Delete Nostr Favorites'
      };
    } else if (showConfirmModal === 'local') {
      return {
        title: 'Delete All Local Favorites?',
        description: `This will permanently delete ${counts?.local.albums || 0} albums and ${counts?.local.tracks || 0} tracks from your local favorites. This action cannot be undone.`,
        buttonText: 'Delete Local Favorites'
      };
    }
    return null;
  };

  const hasNostrFavorites = counts && counts.nostr.total > 0;
  const hasLocalFavorites = counts && counts.local.total > 0;

  return (
    <div className="bg-red-950/30 backdrop-blur-sm rounded-lg p-6 border border-red-900/50">
      <div className="mb-4 flex items-center gap-3">
        <AlertTriangle className="w-6 h-6 text-red-500" />
        <div>
          <h2 className="text-xl font-semibold text-red-400">Danger Zone</h2>
          <p className="text-sm text-red-400/70">Irreversible actions - proceed with caution</p>
        </div>
      </div>

      {/* Delete Result Message */}
      {deleteResult && (
        <div
          className={`mb-4 p-3 rounded-lg border ${
            deleteResult.success
              ? 'bg-green-900/30 border-green-700 text-green-400'
              : 'bg-red-900/30 border-red-700 text-red-400'
          }`}
        >
          {deleteResult.message}
        </div>
      )}

      <div className="space-y-6">
        {/* Delete Nostr Favorites */}
        <div className="border-b border-red-900/30 pb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-400" />
                Delete Nostr Favorites
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Delete all favorites associated with your Nostr account.
                {loading || nostrLoading ? (
                  <span className="text-gray-500"> Loading counts...</span>
                ) : isNostrAuthenticated && nostrUser ? (
                  <span className="text-red-400/80">
                    {' '}({counts?.nostr.albums || 0} albums, {counts?.nostr.tracks || 0} tracks)
                  </span>
                ) : (
                  <span className="text-gray-500"> (Not logged in with Nostr)</span>
                )}
              </div>
            </div>
            <div className="flex-shrink-0">
              <button
                onClick={() => setShowConfirmModal('nostr')}
                disabled={!isNostrAuthenticated || !nostrUser || !hasNostrFavorites || loading || nostrLoading}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-400 hover:text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete Nostr Favorites
              </button>
            </div>
          </div>
        </div>

        {/* Delete Local Favorites */}
        <div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-400" />
                Delete Local Favorites
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Delete all favorites stored in your browser session (not linked to Nostr).
                {loading || sessionLoading ? (
                  <span className="text-gray-500"> Loading counts...</span>
                ) : sessionId || getSessionId() ? (
                  <span className="text-red-400/80">
                    {' '}({counts?.local.albums || 0} albums, {counts?.local.tracks || 0} tracks)
                  </span>
                ) : (
                  <span className="text-gray-500"> (No session found)</span>
                )}
              </div>
            </div>
            <div className="flex-shrink-0">
              <button
                onClick={() => setShowConfirmModal('local')}
                disabled={!(sessionId || getSessionId()) || !hasLocalFavorites || loading || sessionLoading}
                className="px-4 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-400 hover:text-red-300 text-sm font-medium rounded-lg transition-colors border border-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Delete Local Favorites
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && mounted && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-xl max-w-md w-full p-6 border border-red-900/50">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-900/30 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-white">
                  {getConfirmModalContent()?.title}
                </h2>
              </div>
              <button
                onClick={() => setShowConfirmModal(null)}
                className="text-gray-400 hover:text-white transition-colors"
                disabled={deleting}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-gray-300 mb-6">
              {getConfirmModalContent()?.description}
            </p>

            <div className="bg-red-950/30 border border-red-900/50 rounded-lg p-4 mb-6">
              <p className="text-red-400 text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                This action is permanent and cannot be undone.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(null)}
                disabled={deleting}
                className="flex-1 py-2.5 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showConfirmModal)}
                disabled={deleting}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  getConfirmModalContent()?.buttonText
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
