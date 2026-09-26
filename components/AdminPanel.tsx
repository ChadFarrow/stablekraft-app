'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from '@/components/Toast';
import { useNostr } from '@/contexts/NostrContext';
import { getUnifiedSigner } from '@/lib/nostr/signer';
import { adminFetch } from '@/lib/admin-fetch';

/**
 * refresh-by-url answers 202 when the feed was refreshed in the last few minutes:
 * one more refresh is scheduled for the end of that window (per-feed window,
 * lib/feeds/refresh-coalescer.ts). An admin with a stored secret skips the window.
 */
function queuedRefreshMessage(data: { runAt?: string }): string {
  const at = data.runAt ? new Date(data.runAt).toLocaleTimeString() : 'shortly';
  return `Refreshed recently. One more refresh is scheduled for ${at}.`;
}
import DiagnosticsPanel from '@/components/admin/DiagnosticsPanel';

export default function AdminPanel() {
  const [loading, setLoading] = useState(true);
  const [addingFeed, setAddingFeed] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [feedTypeOverride, setFeedTypeOverride] = useState<string>('auto');
  const [verifying, setVerifying] = useState(false);
  const [recentFeeds, setRecentFeeds] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [showImportResultModal, setShowImportResultModal] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [reparsingFeeds, setReparsingFeeds] = useState<Set<string>>(new Set());
  const [reparseFeedUrl, setReparseFeedUrl] = useState('');
  const [reparsingByUrl, setReparsingByUrl] = useState(false);

  // Delete by URL state
  const [deleteUrl, setDeleteUrl] = useState('');
  const [deletingByUrl, setDeletingByUrl] = useState(false);
  const [deletePreview, setDeletePreview] = useState<{
    found: boolean;
    feed?: { id: string; title: string; artist: string; image?: string; trackCount: number };
    slug?: string;
    message?: string;
  } | null>(null);

  // Mark-dead state (flag a taken-down feed as dead without deleting it)
  const [markDeadInput, setMarkDeadInput] = useState('');
  const [markDeadBusy, setMarkDeadBusy] = useState(false);
  const [markDeadPreview, setMarkDeadPreview] = useState<{
    found: boolean;
    feed?: { id: string; title: string; artist: string | null; originalUrl: string | null; markedDead: boolean };
    message?: string;
  } | null>(null);

  // Dead-feed sweep state (PI dead flag -> confirm 404 -> auto-hide)
  const [deadCheckBusy, setDeadCheckBusy] = useState(false);
  const [deadCheckReport, setDeadCheckReport] = useState<{
    dryRun: boolean;
    checked: number;
    candidates: number;
    totalActive?: number;
    resolvedInPI?: number;
    notInPI?: number;
    hiddenCount?: number;
    wouldHide?: Array<{ id: string; title: string; artist: string | null; url: string; piDead: number; httpStatus: number | null }>;
    hidden?: Array<{ id: string; title: string; artist: string | null; url: string; piDead: number; httpStatus: number | null }>;
    needsReview: Array<{ id: string; title: string; artist: string | null; url: string; piDead: number; httpStatus: number | null; reason?: string }>;
    unconfirmed: Array<{ id: string; title: string; artist: string | null; url: string; piDead: number; httpStatus: number | null; reason?: string }>;
    message?: string;
  } | null>(null);

  // Bulk import state
  const [bulkSearching, setBulkSearching] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<{
    query: string;
    type?: string;
    totalFound: number;
    newFeeds: number;
    existingFeeds: number;
    blacklistedFeeds: number;
    feeds: Array<{
      piId: number;
      title: string;
      author: string;
      image: string;
      feedUrl: string;
      medium: string;
      episodeCount: number;
      alreadyExists: boolean;
      isBlacklisted: boolean;
      existingFeedId?: string;
    }>;
  } | null>(null);
  const [bulkImportProgress, setBulkImportProgress] = useState<{
    current: number;
    total: number;
    imported: number;
    skipped: number;
    failed: number;
    currentFeed?: string;
    currentStatus?: string;
  } | null>(null);
  const [bulkImportResult, setBulkImportResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
    total: number;
    results: Array<{
      feedUrl: string;
      status: string;
      title?: string;
      artist?: string;
      trackCount?: number;
      feedId?: string;
      error?: string;
    }>;
  } | null>(null);
  const [bulkSelectedFeeds, setBulkSelectedFeeds] = useState<Set<string>>(new Set());

  // Orphan cleanup state
  const [parsingMissingTracks, setParsingMissingTracks] = useState(false);
  const [parseProgress, setParseProgress] = useState<{
    current: number;
    total: number;
    feedTitle?: string;
    parsed: number;
    failed: number;
    totalTracks: number;
  } | null>(null);
  const [parseResult, setParseResult] = useState<{
    total: number;
    parsed: number;
    failed: number;
    totalTracks: number;
  } | null>(null);
  const [failedFeeds, setFailedFeeds] = useState<Array<{
    feedId: string;
    feedUrl: string | null;
    reason: string;
    message: string | null;
    severity: 'error' | 'info';
  }>>([]);
  const [showFailedFeeds, setShowFailedFeeds] = useState(false);
  const [checkingOrphans, setCheckingOrphans] = useState(false);
  const [deletingOrphans, setDeletingOrphans] = useState(false);
  const [orphanPreview, setOrphanPreview] = useState<{
    feedsToKeep: number;
    orphanedFeeds: number;
    orphanedTracks: number;
    totalFeeds: number;
    totalTracks: number;
    withCanonicalCount?: number;
    withoutCanonicalCount?: number;
    sampleOrphanedFeeds: Array<{
      id: string;
      title: string;
      artist: string;
      image?: string;
      type: string;
      originalUrl?: string;
      trackCount: number;
      canonicalId?: string | null;
      canonicalTrackCount?: number;
    }>;
  } | null>(null);

  // Music-show-only publishers
  type MusicShowOnlyPublisher = {
    id: string;
    title: string;
    artist: string | null;
    originalUrl: string;
    image: string | null;
    musicShowOnly: boolean;
    childAlbums: number;
    childTracks: number;
  };
  type CleanupCandidate = {
    id: string;
    title: string;
    artist: string | null;
    trackCount: number;
  };
  type CleanupKept = CleanupCandidate & { playedTracks: number };
  const [msoPublishers, setMsoPublishers] = useState<MusicShowOnlyPublisher[] | null>(null);
  const [msoLoading, setMsoLoading] = useState(false);
  const [msoToggling, setMsoToggling] = useState<Set<string>>(new Set());
  const [msoCleaning, setMsoCleaning] = useState<Set<string>>(new Set());

  // Artist-name search for adding new music-show-only publishers
  type MsoSearchResult = {
    feedUrl: string;
    feedGuid?: string;
    title: string;
    author: string;
    image: string;
    medium: string;
    source: 'pi-publisher' | 'pi-wavlake-artist';
    existing: { id: string; type: string; musicShowOnly: boolean } | null;
  };
  const [msoSearchQuery, setMsoSearchQuery] = useState('');
  const [msoSearching, setMsoSearching] = useState(false);
  const [msoSearchResults, setMsoSearchResults] = useState<MsoSearchResult[] | null>(null);
  const [msoImporting, setMsoImporting] = useState<Set<string>>(new Set());
  const [msoSearchCleaning, setMsoSearchCleaning] = useState(false);

  // Nostr authentication
  const { user: nostrUser, isAuthenticated: isNostrAuthenticated, isLoading: nostrLoading } = useNostr();

  // Admin authentication state (separate from Nostr auth)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

  // Verify admin access - requires signing a challenge to prove key ownership
  const verifyAdminAccess = useCallback(async (npub: string, pubkey: string) => {
    setVerifying(true);
    try {
      // Step 1: Verify key ownership by signing a challenge
      const signer = getUnifiedSigner();
      await signer.ensureInitialized();

      if (!signer.isAvailable()) {
        toast.error('No Nostr signer available. Please connect your extension or signer app.');
        setVerifying(false);
        setLoading(false);
        return;
      }

      // Create and sign a challenge event
      const challenge = `stablekraft-admin-verify-${Date.now()}`;
      const eventTemplate = {
        kind: 27235, // NIP-98 HTTP Auth kind
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', window.location.href], ['method', 'GET']],
        content: challenge,
        pubkey: pubkey,
      };

      const signedEvent = await signer.signEvent(eventTemplate as any);

      if (!signedEvent?.sig || signedEvent.pubkey !== pubkey) {
        toast.error('Key verification failed. Signature does not match.');
        setVerifying(false);
        setLoading(false);
        return;
      }

      // Step 2: Check admin whitelist
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

  // When Nostr user logs in, automatically verify admin access
  useEffect(() => {
    if (nostrLoading) return;

    if (!isNostrAuthenticated || !nostrUser) {
      // Not authenticated, clear admin auth
      setIsAdminAuthenticated(false);
      localStorage.removeItem('admin-authenticated');
      localStorage.removeItem('admin-npub');
      setLoading(false);
    } else {
      // User is logged in, verify admin access (includes key ownership check)
      verifyAdminAccess(nostrUser.nostrNpub, nostrUser.nostrPubkey);
    }
  }, [nostrLoading, isNostrAuthenticated, nostrUser?.nostrNpub, nostrUser?.nostrPubkey, verifyAdminAccess]);

  const handleLogout = () => {
    setIsAdminAuthenticated(false);
    localStorage.removeItem('admin-authenticated');
    localStorage.removeItem('admin-npub');
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

  const fetchMsoPublishers = async () => {
    setMsoLoading(true);
    try {
      const response = await adminFetch('/api/admin/music-show-only-publishers');
      const data = await response.json();
      if (response.ok && Array.isArray(data.publishers)) {
        setMsoPublishers(data.publishers);
      } else {
        toast.error(data.error || 'Failed to load publishers');
      }
    } catch (error) {
      console.error('Error fetching publishers:', error);
      toast.error('Network error loading publishers');
    } finally {
      setMsoLoading(false);
    }
  };

  const toggleMusicShowOnly = async (id: string, next: boolean) => {
    setMsoToggling(prev => new Set(prev).add(id));
    try {
      const response = await adminFetch('/api/admin/music-show-only-publishers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, musicShowOnly: next }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Failed to update flag');
        return;
      }
      setMsoPublishers(prev => prev?.map(p => p.id === id ? { ...p, musicShowOnly: next } : p) ?? null);
      toast.success(next ? 'Marked music-show-only' : 'Removed music-show-only flag');
      // Reflect any same-artist siblings that were swept up by the flag.
      const flaggedAlso = (data.flaggedAlso ?? []) as Array<{ id: string; title: string }>;
      if (flaggedAlso.length > 0 && next) {
        const flaggedIds = new Set(flaggedAlso.map(f => f.id));
        setMsoPublishers(prev =>
          prev?.map(p => flaggedIds.has(p.id) ? { ...p, musicShowOnly: true } : p) ?? null
        );
        toast.info(
          `Also flagged ${flaggedAlso.length} same-artist publisher${flaggedAlso.length !== 1 ? 's' : ''}`
        );
      }
    } catch (error) {
      console.error('Error toggling flag:', error);
      toast.error('Network error updating flag');
    } finally {
      setMsoToggling(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const deleteUnplayedAlbums = async (id: string, publisherTitle: string) => {
    setMsoCleaning(prev => new Set(prev).add(id));
    try {
      const previewRes = await adminFetch('/api/admin/music-show-only-publishers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'preview' }),
      });
      const previewData = await previewRes.json();
      if (!previewRes.ok) {
        toast.error(previewData.error || 'Failed to preview cleanup');
        return;
      }

      const toDelete: CleanupCandidate[] = previewData.toDelete ?? [];
      const toKeep: CleanupKept[] = previewData.toKeep ?? [];
      if (toDelete.length === 0) {
        toast.info(`Nothing to delete — all ${toKeep.length} album${toKeep.length !== 1 ? 's' : ''} have played tracks`);
        return;
      }

      const trackTotal = toDelete.reduce((sum, a) => sum + a.trackCount, 0);
      const keepNote = toKeep.length > 0
        ? ` ${toKeep.length} played album${toKeep.length !== 1 ? 's' : ''} will be kept.`
        : '';
      const ok = confirm(
        `Delete ${toDelete.length} unplayed album${toDelete.length !== 1 ? 's' : ''} ` +
        `(${trackTotal} track${trackTotal !== 1 ? 's' : ''}) from ${publisherTitle}?${keepNote}`
      );
      if (!ok) return;

      const cleanupRes = await adminFetch('/api/admin/music-show-only-publishers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'cleanup' }),
      });
      const cleanupData = await cleanupRes.json();
      if (!cleanupRes.ok) {
        toast.error(cleanupData.error || 'Failed to run cleanup');
        return;
      }
      toast.success(`Deleted ${cleanupData.deletedAlbums} album${cleanupData.deletedAlbums !== 1 ? 's' : ''} (${cleanupData.deletedTracks} tracks)`);
      await fetchMsoPublishers();
    } catch (error) {
      console.error('Error deleting unplayed albums:', error);
      toast.error('Network error during cleanup');
    } finally {
      setMsoCleaning(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  };

  const searchMsoPublisher = async () => {
    const q = msoSearchQuery.trim();
    if (q.length < 2) {
      toast.error('Enter at least 2 characters');
      return;
    }
    setMsoSearching(true);
    try {
      const response = await adminFetch(`/api/admin/music-show-only-publishers/search?q=${encodeURIComponent(q)}`);
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Search failed');
        return;
      }
      setMsoSearchResults(data.results || []);
      if ((data.results || []).length === 0) {
        toast.info('No publisher feeds found. Try the URL form above.');
      }
    } catch (error) {
      console.error('Error searching publishers:', error);
      toast.error('Network error during search');
    } finally {
      setMsoSearching(false);
    }
  };

  const importMsoPublisher = async (result: MsoSearchResult) => {
    setMsoImporting(prev => new Set(prev).add(result.feedUrl));
    try {
      const response = await adminFetch('/api/admin/music-show-only-publishers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          feedUrl: result.feedUrl,
          feedGuid: result.feedGuid,
          title: result.title,
          artist: result.author,
          image: result.image,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Import failed');
        return;
      }
      toast.success(data.alreadyExisted ? `Flagged "${data.feed.title}" as music-show-only` : `Added "${data.feed.title}"`);
      // Reflect in search results so the button switches to "Already imported".
      setMsoSearchResults(prev => prev?.map(r =>
        r.feedUrl === result.feedUrl
          ? { ...r, existing: { id: data.feed.id, type: 'publisher', musicShowOnly: true } }
          : r
      ) ?? null);
      // Refresh main publisher list if it's been loaded.
      if (msoPublishers) {
        await fetchMsoPublishers();
      }
      // For promotions (publisher already existed), offer to clean up its
      // unplayed children. Skipped for brand-new entries — no children to clean.
      if (data.alreadyExisted) {
        await deleteUnplayedAlbums(data.feed.id, data.feed.title);
      }
      // Same-artist sweep: handleImport flags every other publisher row
      // sharing this artist (the duplicate-publisher gap that let the cron
      // resurrect deleted albums). Chain cleanup against each so we don't
      // leave their unplayed children dangling.
      const flaggedAlso = (data.flaggedAlso ?? []) as Array<{ id: string; title: string }>;
      if (flaggedAlso.length > 0) {
        toast.info(
          `Also flagged ${flaggedAlso.length} duplicate same-artist publisher${flaggedAlso.length !== 1 ? 's' : ''}`
        );
        for (const sibling of flaggedAlso) {
          await deleteUnplayedAlbums(sibling.id, sibling.title);
        }
      }
    } catch (error) {
      console.error('Error importing publisher:', error);
      toast.error('Network error during import');
    } finally {
      setMsoImporting(prev => {
        const n = new Set(prev);
        n.delete(result.feedUrl);
        return n;
      });
    }
  };

  const deleteUnplayedFromSearch = async () => {
    if (!msoSearchResults) return;
    const existingIds = msoSearchResults
      .map(r => r.existing?.id)
      .filter((id): id is string => Boolean(id));
    if (existingIds.length === 0) {
      toast.info('No imported feeds in these search results');
      return;
    }

    setMsoSearchCleaning(true);
    try {
      const previewRes = await adminFetch('/api/admin/music-show-only-publishers/cleanup-by-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: existingIds, dryRun: true }),
      });
      const previewData = await previewRes.json();
      if (!previewRes.ok) {
        toast.error(previewData.error || 'Failed to preview cleanup');
        return;
      }

      const toDelete: CleanupCandidate[] = previewData.toDelete ?? [];
      const toKeep: CleanupKept[] = previewData.toKeep ?? [];
      if (toDelete.length === 0) {
        toast.info(`Nothing to delete — all ${toKeep.length} imported feed${toKeep.length !== 1 ? 's' : ''} have played tracks`);
        return;
      }

      const trackTotal = toDelete.reduce((sum, a) => sum + a.trackCount, 0);
      const keepNote = toKeep.length > 0
        ? ` ${toKeep.length} played feed${toKeep.length !== 1 ? 's' : ''} will be kept.`
        : '';
      const ok = confirm(
        `Delete ${toDelete.length} unplayed feed${toDelete.length !== 1 ? 's' : ''} ` +
        `(${trackTotal} track${trackTotal !== 1 ? 's' : ''}) from these search results?${keepNote}`
      );
      if (!ok) return;

      const cleanupRes = await adminFetch('/api/admin/music-show-only-publishers/cleanup-by-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: existingIds }),
      });
      const cleanupData = await cleanupRes.json();
      if (!cleanupRes.ok) {
        toast.error(cleanupData.error || 'Failed to run cleanup');
        return;
      }
      toast.success(`Deleted ${cleanupData.deletedAlbums} feed${cleanupData.deletedAlbums !== 1 ? 's' : ''} (${cleanupData.deletedTracks} tracks)`);

      // Drop deleted entries from the search results so the row state matches DB.
      const deletedIds = new Set(toDelete.map(a => a.id));
      setMsoSearchResults(prev =>
        prev?.map(r =>
          r.existing && deletedIds.has(r.existing.id) ? { ...r, existing: null } : r
        ) ?? null
      );

      if (msoPublishers) {
        await fetchMsoPublishers();
      }
    } catch (error) {
      console.error('Error deleting unplayed from search:', error);
      toast.error('Network error during cleanup');
    } finally {
      setMsoSearchCleaning(false);
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
      const response = await adminFetch(`/api/admin/feeds/${feedId}/reparse`, {
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
      const response = await adminFetch('/api/feeds/refresh-by-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originalUrl: feedUrl,
        }),
      });

      const data = await response.json();

      if (response.status === 202) {
        toast.info(queuedRefreshMessage(data));
      } else if (response.ok) {
        // Check if this is the HGH playlist and clear its cache
        if (feedUrl.includes('HGH-music-playlist.xml') || feedUrl.includes('chadf-musicl-playlists')) {
          try {
            await adminFetch('/api/playlist-cache?clear=hgh-playlist', {
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

  // Check if a URL is a Podcast Index search URL
  const isPodcastIndexSearchUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'podcastindex.org' || parsed.hostname === 'www.podcastindex.org') &&
        parsed.pathname === '/search' &&
        !!parsed.searchParams.get('q')
      );
    } catch {
      return false;
    }
  };

  // Search PI and show preview
  const searchBulkFeeds = async (url: string) => {
    setBulkSearching(true);
    setBulkPreview(null);
    setBulkImportResult(null);
    setBulkImportProgress(null);

    try {
      const response = await adminFetch(`/api/admin/bulk-import?url=${encodeURIComponent(url)}`);
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || 'Failed to search Podcast Index');
        return;
      }

      if (data.feeds.length === 0) {
        toast.info('No feeds found for this search');
        return;
      }

      setBulkPreview(data);
      // Pre-select all new (non-existing, non-blacklisted) feeds
      const newFeedUrls = data.feeds
        .filter((f: any) => !f.alreadyExists && !f.isBlacklisted)
        .map((f: any) => f.feedUrl);
      setBulkSelectedFeeds(new Set(newFeedUrls));
    } catch (error) {
      console.error('Error searching bulk feeds:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setBulkSearching(false);
    }
  };

  // Import selected feeds with SSE progress
  const importBulkFeeds = async () => {
    if (bulkSelectedFeeds.size === 0) {
      toast.error('No feeds selected for import');
      return;
    }

    setBulkImporting(true);
    setBulkImportProgress(null);
    setBulkImportResult(null);

    try {
      const feedUrls = Array.from(bulkSelectedFeeds);
      const response = await adminFetch('/api/admin/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrls, type: 'album' }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        toast.error('Failed to start bulk import');
        setBulkImporting(false);
        return;
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'start') {
                setBulkImportProgress({
                  current: 0,
                  total: data.total,
                  imported: 0,
                  skipped: 0,
                  failed: 0,
                });
              } else if (data.type === 'progress') {
                setBulkImportProgress({
                  current: data.current,
                  total: data.total,
                  imported: data.imported,
                  skipped: data.skipped,
                  failed: data.failed,
                  currentFeed: data.title || data.feedUrl,
                  currentStatus: data.status,
                });
              } else if (data.type === 'complete') {
                setBulkImportResult({
                  imported: data.imported,
                  skipped: data.skipped,
                  failed: data.failed,
                  total: data.total,
                  results: data.results,
                });
                setBulkImportProgress(null);

                if (data.imported > 0) {
                  toast.success(`Imported ${data.imported} feeds! (${data.skipped} skipped, ${data.failed} failed)`);
                } else {
                  toast.info(`No new feeds imported. ${data.skipped} already existed.`);
                }

                fetchRecentFeeds();
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error during bulk import:', error);
      toast.error('Bulk import failed. Please try again.');
    } finally {
      setBulkImporting(false);
      setBulkImportProgress(null);
    }
  };

  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault();

    const feedUrl = newFeedUrl.trim();

    if (!feedUrl) {
      toast.error('Please enter a RSS feed URL');
      return;
    }

    // Detect Podcast Index search URLs → redirect to bulk import flow
    if (isPodcastIndexSearchUrl(feedUrl)) {
      searchBulkFeeds(feedUrl);
      return;
    }

    // Basic URL validation
    try {
      const parsed = new URL(feedUrl);
      // Reject stablekraft.app site URLs — these are pages, not RSS feeds
      if (parsed.hostname === 'stablekraft.app' || parsed.hostname === 'www.stablekraft.app') {
        toast.error('That\'s a site page URL, not an RSS feed URL. Use the actual XML feed URL instead.');
        return;
      }
    } catch {
      toast.error('Please enter a valid URL');
      return;
    }

    setAddingFeed(true);

    try {
      // Use manual override if set, otherwise auto-detect from URL patterns
      let detectedType = feedTypeOverride !== 'auto' ? feedTypeOverride : 'album';
      if (feedTypeOverride === 'auto') {
        if (feedUrl.includes('/artist/') || feedUrl.includes('/publisher') || feedUrl.includes('-pubfeed') || feedUrl.includes('publisher-feed')) {
          detectedType = 'publisher';
        } else if (feedUrl.includes('/playlist/')) {
          detectedType = 'playlist';
        }
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
          importedPublisherFeed: data.importedPublisherFeed,
          linkedAlbums: data.linkedAlbums
        });
        setShowImportResultModal(true);
        setNewFeedUrl('');
        // Refresh the recent feeds list
        fetchRecentFeeds();
      } else if (response.status === 409) {
        // Feed already exists - automatically reparse it
        toast.info('Feed exists, reparsing...');

        const reparseResponse = await adminFetch('/api/feeds/refresh-by-url', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            originalUrl: feedUrl,
          }),
        });

        const reparseData = await reparseResponse.json();

        if (reparseResponse.status === 202) {
          toast.info(queuedRefreshMessage(reparseData));
        } else if (reparseResponse.ok) {
          const messages = [];
          if (reparseData.newTracks > 0) messages.push(`Added ${reparseData.newTracks} new tracks`);
          if (reparseData.updatedTracks > 0) messages.push(`Updated ${reparseData.updatedTracks} existing tracks`);
          if (reparseData.v4vUpdated > 0) messages.push(`Refreshed ${reparseData.v4vUpdated} payment splits`);
          if (messages.length === 0) messages.push('No changes needed');
          toast.success(`Feed reparsed! ${messages.join('. ')}. Total: ${reparseData.totalTracks} tracks`);
          setNewFeedUrl('');
          fetchRecentFeeds();
        } else {
          toast.error(reparseData.error || 'Failed to reparse feed');
        }
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

  const previewDeleteByUrl = async () => {
    const url = deleteUrl.trim();
    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    setDeletingByUrl(true);
    setDeletePreview(null);

    try {
      const response = await adminFetch('/api/admin/feeds/delete-by-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, preview: true }),
      });

      const data = await response.json();
      setDeletePreview(data);

      if (!data.found) {
        toast.info(data.message || 'No feed found for this URL');
      }
    } catch (error) {
      console.error('Error previewing delete:', error);
      toast.error('Failed to look up feed');
    } finally {
      setDeletingByUrl(false);
    }
  };

  const confirmDeleteByUrl = async () => {
    if (!deletePreview?.found || !deletePreview.feed) {
      toast.error('No feed selected for deletion');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete "${deletePreview.feed.title}" by ${deletePreview.feed.artist}?\n\nThis will remove the feed and all ${deletePreview.feed.trackCount} tracks. This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingByUrl(true);

    try {
      const response = await adminFetch('/api/admin/feeds/delete-by-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: deleteUrl.trim(), preview: false }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Deleted "${data.deleted.title}" by ${data.deleted.artist} (${data.deleted.trackCount} tracks)`);
        setDeleteUrl('');
        setDeletePreview(null);
        fetchRecentFeeds();
      } else {
        toast.error(data.error || 'Failed to delete feed');
      }
    } catch (error) {
      console.error('Error deleting feed:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setDeletingByUrl(false);
    }
  };

  // Look up a feed (by URL or feed ID) and show its current dead state.
  const previewMarkDead = async () => {
    const value = markDeadInput.trim();
    if (!value) return;
    setMarkDeadBusy(true);
    setMarkDeadPreview(null);
    try {
      // Send the value as both id and url; the endpoint tries id first, then url.
      const response = await adminFetch('/api/admin/feeds/mark-dead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: value, url: value, preview: true }),
      });
      const data = await response.json();
      if (response.ok && data.found) {
        setMarkDeadPreview({ found: true, feed: data.feed });
      } else {
        setMarkDeadPreview({ found: false, message: data.message || 'No feed found' });
      }
    } catch (error) {
      console.error('Error looking up feed:', error);
      toast.error('Lookup failed. Please try again.');
    } finally {
      setMarkDeadBusy(false);
    }
  };

  // Flag the previewed feed as dead (dead=true) or restore it (dead=false).
  const applyMarkDead = async (dead: boolean) => {
    const feed = markDeadPreview?.feed;
    if (!feed) return;
    setMarkDeadBusy(true);
    try {
      const response = await adminFetch('/api/admin/feeds/mark-dead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: feed.id, dead }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        toast.success(dead ? `Hidden: ${data.feed.title}` : `Restored: ${data.feed.title}`);
        setMarkDeadPreview({ found: true, feed: data.feed });
      } else {
        toast.error(data.error || 'Failed to update feed');
      }
    } catch (error) {
      console.error('Error updating feed:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setMarkDeadBusy(false);
    }
  };

  // Run the dead-feed sweep. dryRun=true previews what would be hidden;
  // dryRun=false confirms 404 and auto-hides via markedDead. The endpoint
  // paginates (thousands of feeds), so loop until nextOffset is null and
  // accumulate results across pages.
  const runDeadFeedCheck = async (dryRun: boolean) => {
    setDeadCheckBusy(true);
    if (dryRun) setDeadCheckReport(null);
    try {
      let offset = 0;
      let checked = 0;
      let candidates = 0;
      let hiddenCount = 0;
      let totalActive = 0;
      let resolvedInPI = 0;
      let notInPI = 0;
      const toHide: any[] = [];
      const needsReview: any[] = [];
      const unconfirmed: any[] = [];

      // Hard cap on pages as a runaway guard (1000 limit × 60 ≈ 60k feeds).
      for (let page = 0; page < 60; page++) {
        const response = await adminFetch('/api/admin/check-dead-feeds', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun, limit: 300, offset }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          toast.error(data.error || 'Dead-feed check failed');
          setDeadCheckBusy(false);
          return;
        }

        totalActive = data.totalActive ?? totalActive;
        checked += data.checked ?? 0;
        candidates += data.candidates ?? 0;
        hiddenCount += data.hiddenCount ?? 0;
        resolvedInPI += data.resolvedInPI ?? 0;
        notInPI += data.notInPI ?? 0;
        if (Array.isArray(data.wouldHide)) toHide.push(...data.wouldHide);
        if (Array.isArray(data.hidden)) toHide.push(...data.hidden);
        if (Array.isArray(data.needsReview)) needsReview.push(...data.needsReview);
        if (Array.isArray(data.unconfirmed)) unconfirmed.push(...data.unconfirmed);

        // Show progress as pages come in.
        setDeadCheckReport({
          dryRun,
          checked,
          candidates,
          totalActive,
          resolvedInPI,
          notInPI,
          ...(dryRun ? { wouldHide: toHide } : { hidden: toHide, hiddenCount }),
          needsReview,
          unconfirmed,
          message: `Scanned ${checked} of ${totalActive} active feed(s)…`,
        });

        if (data.nextOffset === null || data.nextOffset === undefined) break;
        offset = data.nextOffset;
      }

      setDeadCheckReport({
        dryRun,
        checked,
        candidates,
        totalActive,
        resolvedInPI,
        notInPI,
        ...(dryRun ? { wouldHide: toHide } : { hidden: toHide, hiddenCount }),
        needsReview,
        unconfirmed,
        message: dryRun
          ? `Scanned ${checked} active feed(s): ${toHide.length} confirmed dead, ${needsReview.length} need review.`
          : `Scanned ${checked} active feed(s): hid ${hiddenCount}, ${needsReview.length} need review.`,
      });
      if (!dryRun) {
        toast.success(`Hid ${hiddenCount} dead feed(s)`);
      }
    } catch (error) {
      console.error('Error checking dead feeds:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setDeadCheckBusy(false);
    }
  };

  const parseMissingTracks = async () => {
    setParsingMissingTracks(true);
    setParseResult(null);
    setParseProgress(null);
    setFailedFeeds([]);
    setShowFailedFeeds(false);

    try {
      const response = await adminFetch('/api/playlist/parse-feeds-stream');
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        toast.error('Failed to start parsing');
        setParsingMissingTracks(false);
        return;
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'start') {
                setParseProgress({
                  current: 0,
                  total: data.total,
                  parsed: 0,
                  failed: 0,
                  totalTracks: 0
                });
              } else if (data.type === 'progress') {
                setParseProgress({
                  current: data.current,
                  total: data.total,
                  feedTitle: data.feedTitle,
                  parsed: data.parsed,
                  failed: data.failed,
                  totalTracks: data.totalTracks
                });
              } else if (data.type === 'complete') {
                setParseResult({
                  total: data.parsed + data.failed,
                  parsed: data.parsed,
                  failed: data.failed,
                  totalTracks: data.totalTracks
                });
                setParseProgress(null);
                if (data.parsed > 0) {
                  toast.success(`Parsed ${data.parsed} feeds, imported ${data.totalTracks} tracks`);
                } else if (data.parsed === 0 && data.failed === 0) {
                  toast.info('No feeds with missing tracks found');
                } else {
                  toast.warning(`Found feeds but failed to parse any`);
                }
                setOrphanPreview(null);
              } else if (data.type === 'feedError' || data.type === 'feedInfo') {
                const severity: 'error' | 'info' = data.type === 'feedInfo' ? 'info' : 'error';
                setFailedFeeds(prev => [...prev, {
                  feedId: data.feedId,
                  feedUrl: data.feedUrl ?? null,
                  reason: data.reason,
                  message: data.message ?? null,
                  severity,
                }]);
                if (severity === 'error') {
                  console.warn(`[parse-feeds] ${data.reason}: ${data.feedId}`, data);
                } else {
                  console.info(`[parse-feeds] ${data.reason}: ${data.feedId}`, data);
                }
              } else if (data.error) {
                toast.error(data.error);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      console.error('Error parsing feeds:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setParsingMissingTracks(false);
      setParseProgress(null);
    }
  };

  const checkForOrphans = async () => {
    setCheckingOrphans(true);
    setOrphanPreview(null);

    try {
      const response = await adminFetch('/api/admin/orphaned-items');
      const data = await response.json();

      if (response.ok) {
        setOrphanPreview(data);
        if (data.orphanedFeeds === 0) {
          toast.success('No orphaned items found - database is clean!');
        }
      } else {
        toast.error(data.error || 'Failed to check for orphaned items');
      }
    } catch (error) {
      console.error('Error checking orphans:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setCheckingOrphans(false);
    }
  };

  const deleteOrphanedItems = async () => {
    if (!orphanPreview || orphanPreview.orphanedFeeds === 0) {
      toast.error('No orphaned items to delete');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete ${orphanPreview.orphanedFeeds} orphaned feeds and ${orphanPreview.orphanedTracks} orphaned tracks?\n\nThis will remove all items NOT referenced by any system playlist.\n\nThis action cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingOrphans(true);

    try {
      const response = await adminFetch('/api/admin/orphaned-items', {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        toast.success(`Deleted ${data.deletedFeeds} feeds and ${data.deletedTracks} tracks. ${data.remainingFeeds} feeds remain.`);
        setOrphanPreview(null);
        fetchRecentFeeds();
      } else {
        toast.error(data.error || 'Failed to delete orphaned items');
      }
    } catch (error) {
      console.error('Error deleting orphans:', error);
      toast.error('Network error. Please try again.');
    } finally {
      setDeletingOrphans(false);
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

  // Show access denied if not authenticated
  if (!isNostrAuthenticated || !isAdminAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-8 w-full max-w-md text-center">
          <h1 className="text-3xl font-bold mb-2">Admin Access</h1>
          {!isNostrAuthenticated ? (
            <p className="text-gray-400">
              Please log in with Nostr to access this page.
            </p>
          ) : (
            <p className="text-gray-400">
              Your account is not authorized for admin access.
            </p>
          )}
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
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="px-4 py-2 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </Link>
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

        {/* Add/Update Feed Form - Smart single input */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4">Add or Update Feed</h2>
          <form onSubmit={addFeed} className="space-y-4">
            <div>
              <label htmlFor="feedUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Paste RSS Feed URL
              </label>
              <div className="space-y-2">
                <input
                  type="url"
                  id="feedUrl"
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      e.preventDefault();
                      setNewFeedUrl(pastedText.trim());
                    }
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={addingFeed}
                  required
                  autoFocus
                />
                <div className="flex gap-2">
                  <select
                    value={feedTypeOverride}
                    onChange={(e) => setFeedTypeOverride(e.target.value)}
                    disabled={addingFeed}
                    className="flex-1 px-3 py-3 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  >
                    <option value="auto" className="bg-gray-800">Auto-detect</option>
                    <option value="album" className="bg-gray-800">Album</option>
                    <option value="publisher" className="bg-gray-800">Publisher</option>
                    <option value="podcast" className="bg-gray-800">Podcast</option>
                  </select>
                  <button
                    type="submit"
                    disabled={addingFeed || bulkSearching || !newFeedUrl.trim()}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                  >
                    {addingFeed || bulkSearching ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        {bulkSearching ? 'Searching...' : 'Processing...'}
                      </>
                    ) : isPodcastIndexSearchUrl(newFeedUrl.trim()) ? (
                      'Search & Import'
                    ) : (
                      'Add / Update'
                    )}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Paste any RSS feed URL, Podcast Index link (e.g., podcastindex.org/podcast/12345), or PI search page URL (e.g., podcastindex.org/search?q=...) for bulk import. New feeds will be added and parsed. Existing feeds will be reparsed.
              </p>
            </div>
          </form>
        </div>

        {/* Bulk Import Preview */}
        {(bulkPreview || bulkImportProgress || bulkImportResult) && (
          <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-green-500/30 p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-semibold text-green-400">
                Bulk Import from Podcast Index
              </h2>
              <button
                onClick={() => {
                  setBulkPreview(null);
                  setBulkImportProgress(null);
                  setBulkImportResult(null);
                  setBulkSelectedFeeds(new Set());
                }}
                className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search Info */}
            {bulkPreview && (
              <div className="mb-4">
                <p className="text-sm text-gray-300">
                  Search: <span className="text-white font-medium">&quot;{bulkPreview.query}&quot;</span>
                  {bulkPreview.type && (
                    <span className="ml-2 px-2 py-0.5 bg-purple-600/20 text-purple-300 rounded text-xs">
                      {bulkPreview.type}
                    </span>
                  )}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-gray-400">
                    Found: <span className="text-white font-medium">{bulkPreview.totalFound}</span>
                  </span>
                  <span className="text-green-400">
                    New: {bulkPreview.newFeeds}
                  </span>
                  <span className="text-blue-400">
                    Existing: {bulkPreview.existingFeeds}
                  </span>
                  {bulkPreview.blacklistedFeeds > 0 && (
                    <span className="text-red-400">
                      Blacklisted: {bulkPreview.blacklistedFeeds}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Import Progress */}
            {bulkImportProgress && (
              <div className="mb-4 space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Importing {bulkImportProgress.current} of {bulkImportProgress.total}</span>
                  <span>{Math.round((bulkImportProgress.current / bulkImportProgress.total) * 100)}%</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(bulkImportProgress.current / bulkImportProgress.total) * 100}%` }}
                  />
                </div>
                {bulkImportProgress.currentFeed && (
                  <p className="text-xs text-gray-500 truncate">
                    {bulkImportProgress.currentStatus === 'imported' ? '✅' :
                     bulkImportProgress.currentStatus === 'skipped' ? '⏭️' : '❌'}{' '}
                    {bulkImportProgress.currentFeed}
                  </p>
                )}
                <div className="flex gap-4 text-xs">
                  <span className="text-green-400">{bulkImportProgress.imported} imported</span>
                  <span className="text-blue-400">{bulkImportProgress.skipped} skipped</span>
                  <span className="text-red-400">{bulkImportProgress.failed} failed</span>
                </div>
              </div>
            )}

            {/* Import Results Summary */}
            {bulkImportResult && (
              <div className="mb-4">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="bg-green-500/10 rounded p-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{bulkImportResult.imported}</p>
                    <p className="text-xs text-gray-400">Imported</p>
                  </div>
                  <div className="bg-blue-500/10 rounded p-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">{bulkImportResult.skipped}</p>
                    <p className="text-xs text-gray-400">Skipped</p>
                  </div>
                  <div className="bg-red-500/10 rounded p-3 text-center">
                    <p className="text-2xl font-bold text-red-400">{bulkImportResult.failed}</p>
                    <p className="text-xs text-gray-400">Failed</p>
                  </div>
                </div>

                {/* Detailed results list */}
                {bulkImportResult.results.length > 0 && (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {bulkImportResult.results.map((result, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-white/5">
                        <span>{result.status === 'imported' ? '✅' : result.status === 'skipped' ? '⏭️' : '❌'}</span>
                        <span className="flex-1 truncate text-gray-300">
                          {result.title || result.feedUrl}
                        </span>
                        {result.artist && (
                          <span className="text-gray-500 truncate max-w-[120px]">{result.artist}</span>
                        )}
                        {result.trackCount !== undefined && (
                          <span className="text-gray-500">{result.trackCount}t</span>
                        )}
                        {result.error && (
                          <span className="text-red-400 truncate max-w-[150px]">{result.error}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Feed List with Checkboxes */}
            {bulkPreview && !bulkImportProgress && !bulkImportResult && (
              <div className="space-y-3">
                {/* Select All / None */}
                <div className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => {
                      const allNew = bulkPreview.feeds
                        .filter(f => !f.alreadyExists && !f.isBlacklisted)
                        .map(f => f.feedUrl);
                      setBulkSelectedFeeds(new Set(allNew));
                    }}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Select all new
                  </button>
                  <span className="text-gray-600">|</span>
                  <button
                    onClick={() => setBulkSelectedFeeds(new Set())}
                    className="text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    Select none
                  </button>
                  <span className="text-gray-600">|</span>
                  <span className="text-gray-400">
                    {bulkSelectedFeeds.size} selected
                  </span>
                </div>

                {/* Feed List */}
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {bulkPreview.feeds.map((feed) => {
                    const isSelected = bulkSelectedFeeds.has(feed.feedUrl);
                    const isDisabled = feed.alreadyExists || feed.isBlacklisted;

                    return (
                      <label
                        key={feed.piId}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isDisabled
                            ? 'bg-white/2 border-white/5 opacity-50 cursor-default'
                            : isSelected
                              ? 'bg-green-500/10 border-green-500/30'
                              : 'bg-white/5 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isDisabled}
                          onChange={(e) => {
                            const next = new Set(bulkSelectedFeeds);
                            if (e.target.checked) {
                              next.add(feed.feedUrl);
                            } else {
                              next.delete(feed.feedUrl);
                            }
                            setBulkSelectedFeeds(next);
                          }}
                          className="rounded border-gray-500 bg-white/10 text-green-500 focus:ring-green-500"
                        />
                        {feed.image && (
                          <img
                            src={feed.image}
                            alt={feed.title}
                            className="w-10 h-10 rounded object-cover flex-shrink-0"
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">{feed.title}</p>
                          <p className="text-xs text-gray-400 truncate">{feed.author}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {feed.episodeCount > 0 && (
                            <span className="text-xs text-gray-500">{feed.episodeCount} tracks</span>
                          )}
                          {feed.alreadyExists && (
                            <span className="px-2 py-0.5 bg-blue-600/20 text-blue-400 rounded text-xs">
                              exists
                            </span>
                          )}
                          {feed.isBlacklisted && (
                            <span className="px-2 py-0.5 bg-red-600/20 text-red-400 rounded text-xs">
                              blocked
                            </span>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Import Button */}
                <button
                  onClick={importBulkFeeds}
                  disabled={bulkImporting || bulkSelectedFeeds.size === 0}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                >
                  {bulkImporting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Importing...
                    </>
                  ) : (
                    <>Import {bulkSelectedFeeds.size} Feed{bulkSelectedFeeds.size !== 1 ? 's' : ''}</>
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Music-Show-Only Publishers */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-purple-500/30 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold text-purple-300">Music-Show-Only Publishers</h2>
            <button
              onClick={fetchMsoPublishers}
              disabled={msoLoading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg text-sm transition-colors"
            >
              {msoLoading ? 'Loading…' : msoPublishers ? 'Refresh' : 'Load Publishers'}
            </button>
          </div>
          <p className="text-sm text-gray-400 mb-4">
            Flag a publisher as <strong>music-show-only</strong> to skip auto-importing its albums going forward.
            Only albums whose tracks are referenced by a curated music show (HGH, B4TS, MMM, etc.) will be kept.
            Flagging an existing publisher also offers to delete its current unplayed albums in the same step;
            <strong> Delete unplayed albums</strong> on the loaded list does the same on demand.
          </p>

          {/* Artist-name search */}
          <div className="bg-black/20 rounded-lg border border-white/10 p-4 mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Find a publisher by artist name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={msoSearchQuery}
                onChange={(e) => setMsoSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchMsoPublisher(); }}
                placeholder="Artist name…"
                className="flex-1 px-3 py-2 bg-black/40 text-white placeholder-gray-500 rounded border border-white/10 focus:border-purple-400 focus:outline-none text-sm"
              />
              <button
                onClick={searchMsoPublisher}
                disabled={msoSearching || msoSearchQuery.trim().length < 2}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-sm transition-colors"
              >
                {msoSearching ? 'Searching…' : 'Search'}
              </button>
              {msoSearchResults && (
                <button
                  onClick={() => { setMsoSearchResults(null); setMsoSearchQuery(''); }}
                  className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Searches Podcast Index for publisher feeds matching the artist (also picks up Wavlake artist pages).
              If nothing matches, paste the URL into the &ldquo;Add or Update Feed&rdquo; section above.
            </p>

            {msoSearchResults && msoSearchResults.length > 0 && (() => {
              const importedCount = msoSearchResults.filter(r => r.existing).length;
              return (
              <div className="mt-4 space-y-2">
                {importedCount > 0 && (
                  <div className="flex items-center justify-between bg-red-500/10 border border-red-500/30 rounded p-3">
                    <span className="text-sm text-gray-300">
                      <span className="text-red-300 font-medium">{importedCount}</span> already in DB — bulk-delete those with no plays on any music show
                    </span>
                    <button
                      onClick={deleteUnplayedFromSearch}
                      disabled={msoSearchCleaning}
                      className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:bg-gray-600 text-white rounded text-sm transition-colors flex-shrink-0 ml-3"
                    >
                      {msoSearchCleaning ? 'Deleting…' : 'Delete unplayed'}
                    </button>
                  </div>
                )}
                {msoSearchResults.map(r => {
                  const isImporting = msoImporting.has(r.feedUrl);
                  const existing = r.existing;
                  return (
                    <div key={r.feedUrl} className="bg-white/5 rounded border border-white/10 p-3 flex items-start gap-3">
                      {r.image && (
                        <img src={r.image} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white truncate">{r.title}</span>
                          {r.author && <span className="text-xs text-gray-400 truncate">— {r.author}</span>}
                          <span className="text-[10px] uppercase bg-gray-700/60 text-gray-300 px-1.5 py-0.5 rounded">
                            {r.source === 'pi-wavlake-artist' ? 'wavlake' : r.medium}
                          </span>
                          {existing?.musicShowOnly && (
                            <span className="text-[10px] bg-purple-500/30 text-purple-200 px-1.5 py-0.5 rounded">flagged</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 truncate">{r.feedUrl}</div>
                      </div>
                      <div className="flex-shrink-0">
                        {existing && existing.musicShowOnly ? (
                          <span className="text-xs text-gray-400">Already flagged</span>
                        ) : existing ? (
                          <button
                            onClick={() => importMsoPublisher(r)}
                            disabled={isImporting}
                            className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 disabled:bg-gray-600 text-white rounded text-xs transition-colors"
                          >
                            {isImporting ? 'Flagging…' : 'Flag existing'}
                          </button>
                        ) : (
                          <button
                            onClick={() => importMsoPublisher(r)}
                            disabled={isImporting}
                            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded text-xs transition-colors"
                          >
                            {isImporting ? 'Adding…' : 'Add as music-show-only'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              );
            })()}
            {msoSearchResults && msoSearchResults.length === 0 && (
              <p className="text-sm text-gray-500 mt-3">No publisher feeds found for &ldquo;{msoSearchQuery}&rdquo;.</p>
            )}
          </div>

          {msoPublishers && msoPublishers.length === 0 && (
            <p className="text-gray-400">No publisher feeds found.</p>
          )}

          {msoPublishers && msoPublishers.length > 0 && (
            <div className="space-y-3">
              {msoPublishers.map(pub => {
                const isToggling = msoToggling.has(pub.id);
                const isCleaning = msoCleaning.has(pub.id);
                return (
                  <div key={pub.id} className={`rounded-lg border p-4 ${pub.musicShowOnly ? 'bg-purple-500/10 border-purple-500/40' : 'bg-white/5 border-white/10'}`}>
                    <div className="flex items-start gap-4">
                      {pub.image && (
                        <img src={pub.image} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-white truncate">{pub.title}</span>
                          {pub.artist && <span className="text-sm text-gray-400 truncate">— {pub.artist}</span>}
                          {pub.musicShowOnly && (
                            <span className="text-xs bg-purple-500/30 text-purple-200 px-2 py-0.5 rounded">music-show-only</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1 truncate">{pub.originalUrl}</div>
                        <div className="text-xs text-gray-400 mt-1">
                          {pub.childAlbums} album{pub.childAlbums !== 1 ? 's' : ''} · {pub.childTracks} track{pub.childTracks !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pub.musicShowOnly}
                            disabled={isToggling}
                            onChange={(e) => toggleMusicShowOnly(pub.id, e.target.checked)}
                            className="w-4 h-4"
                          />
                          <span>{isToggling ? 'Saving…' : 'Music-show-only'}</span>
                        </label>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => deleteUnplayedAlbums(pub.id, pub.title)}
                        disabled={isCleaning}
                        className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:bg-gray-600 text-white rounded text-sm transition-colors"
                      >
                        {isCleaning ? 'Deleting…' : 'Delete unplayed albums'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delete by URL */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-red-500/30 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-red-400">Delete Feed by URL</h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="deleteUrl" className="block text-sm font-medium text-gray-300 mb-2">
                Paste Site URL (e.g., /album/some-album)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="deleteUrl"
                  value={deleteUrl}
                  onChange={(e) => {
                    setDeleteUrl(e.target.value);
                    setDeletePreview(null);
                  }}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      e.preventDefault();
                      setDeleteUrl(pastedText.trim());
                      setDeletePreview(null);
                    }
                  }}
                  placeholder="http://localhost:3000/album/aseda or /album/aseda"
                  className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  disabled={deletingByUrl}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={previewDeleteByUrl}
                  disabled={deletingByUrl || !deleteUrl.trim()}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                >
                  {deletingByUrl && !deletePreview ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Looking up...
                    </>
                  ) : (
                    <>
                      🔍 Preview
                    </>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Paste a site URL to look up the feed. Preview first to confirm, then delete.
              </p>
            </div>

            {/* Preview Result */}
            {deletePreview && (
              <div className={`rounded-lg p-4 border ${
                deletePreview.found
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-gray-500/10 border-gray-500/30'
              }`}>
                {deletePreview.found && deletePreview.feed ? (
                  <div className="space-y-3">
                    <div className="flex items-start gap-4">
                      {deletePreview.feed.image && (
                        <img
                          src={deletePreview.feed.image}
                          alt={deletePreview.feed.title}
                          className="w-16 h-16 rounded object-cover flex-shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-white">{deletePreview.feed.title}</h4>
                        <p className="text-sm text-gray-300">{deletePreview.feed.artist}</p>
                        <p className="text-sm text-gray-400 mt-1">
                          📀 {deletePreview.feed.trackCount} tracks
                        </p>
                        <p className="text-xs text-gray-500 mt-1 font-mono">
                          ID: {deletePreview.feed.id}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={confirmDeleteByUrl}
                      disabled={deletingByUrl}
                      className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      {deletingByUrl ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Deleting...
                        </>
                      ) : (
                        <>
                          🗑️ Delete This Feed
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <p className="text-gray-400">
                      {deletePreview.message || `No feed found for slug "${deletePreview.slug}"`}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Hide / Retire Feed */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-yellow-500/30 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-yellow-400">Hide Feed (Dead / Test / Unwanted)</h2>
          <p className="text-sm text-gray-400 mb-4">
            Hide any feed you never want shown — a feed taken down upstream (e.g. removed from Wavlake), a leftover test feed, or a stray podcast. The feed stays in the database but is hidden everywhere — grid, New, search, and publisher pages — and the nightly cron won&apos;t re-import it. Use this instead of deleting, which lets the cron re-mint it. You can restore a feed here too.
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="markDeadInput" className="block text-sm font-medium text-gray-300 mb-2">
                Paste the feed URL or feed ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="markDeadInput"
                  value={markDeadInput}
                  onChange={(e) => {
                    setMarkDeadInput(e.target.value);
                    setMarkDeadPreview(null);
                  }}
                  onPaste={(e) => {
                    const pastedText = e.clipboardData.getData('text');
                    if (pastedText.trim()) {
                      e.preventDefault();
                      setMarkDeadInput(pastedText.trim());
                      setMarkDeadPreview(null);
                    }
                  }}
                  placeholder="https://wavlake.com/feed/music/... or a feed ID"
                  className="flex-1 px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  disabled={markDeadBusy}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={previewMarkDead}
                  disabled={markDeadBusy || !markDeadInput.trim()}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
                >
                  {markDeadBusy && !markDeadPreview ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Looking up...
                    </>
                  ) : (
                    <>🔍 Look up</>
                  )}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Accepts the feed&apos;s RSS URL or its feed ID. Look up first to confirm, then mark dead or restore.
              </p>
            </div>

            {markDeadPreview && (
              <div className={`rounded-lg p-4 border ${
                markDeadPreview.found ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-gray-500/10 border-gray-500/30'
              }`}>
                {markDeadPreview.found && markDeadPreview.feed ? (
                  <div className="space-y-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-white flex items-center gap-2">
                        {markDeadPreview.feed.title}
                        {markDeadPreview.feed.markedDead && (
                          <span className="px-2 py-0.5 text-xs rounded bg-yellow-600/40 text-yellow-200 border border-yellow-500/40">HIDDEN</span>
                        )}
                      </h4>
                      <p className="text-sm text-gray-300">{markDeadPreview.feed.artist}</p>
                      <p className="text-xs text-gray-500 mt-1 font-mono break-all">
                        {markDeadPreview.feed.originalUrl}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 font-mono">ID: {markDeadPreview.feed.id}</p>
                    </div>
                    {markDeadPreview.feed.markedDead ? (
                      <button
                        type="button"
                        onClick={() => applyMarkDead(false)}
                        disabled={markDeadBusy}
                        className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        {markDeadBusy ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Restoring...
                          </>
                        ) : (
                          <>♻️ Restore Feed</>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => applyMarkDead(true)}
                        disabled={markDeadBusy}
                        className="w-full px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                      >
                        {markDeadBusy ? (
                          <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Hiding...
                          </>
                        ) : (
                          <>🚫 Hide Feed</>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-2">
                    <p className="text-gray-400">{markDeadPreview.message || 'No feed found'}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Dead-feed sweep (PI dead flag -> confirm 404 -> auto-hide) */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-yellow-500/30 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-yellow-400">Check for Dead Feeds</h2>
          <p className="text-sm text-gray-400 mb-4">
            Finds feeds whose URL has gone dead upstream (an artist pulled their catalog, a Wavlake mirror 404s). Asks Podcast Index which of our active feeds it has crawled as dead, then confirms each with a direct 404/410 fetch before hiding it. Confirmed-dead feeds are hidden via the same reversible flag as &quot;Hide Feed&quot; above. Preview first — nothing is hidden until you confirm.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => runDeadFeedCheck(true)}
              disabled={deadCheckBusy}
              className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center gap-2"
            >
              {deadCheckBusy ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Checking...
                </>
              ) : (
                <>🔎 Check for dead feeds</>
              )}
            </button>
          </div>

          {deadCheckReport && (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-300">
                Checked {deadCheckReport.checked} active feed(s) · {deadCheckReport.resolvedInPI ?? 0} resolved in Podcast Index ({deadCheckReport.notInPI ?? 0} not indexed) · {deadCheckReport.candidates} flagged dead.
              </p>

              {(() => {
                const toHide = deadCheckReport.dryRun ? deadCheckReport.wouldHide : deadCheckReport.hidden;
                return (
                  <>
                    {toHide && toHide.length > 0 && (
                      <div className="rounded-lg p-4 border bg-yellow-500/10 border-yellow-500/30">
                        <h4 className="font-semibold text-yellow-300 mb-2">
                          {deadCheckReport.dryRun
                            ? `${toHide.length} confirmed-dead feed(s) would be hidden (404/410)`
                            : `${deadCheckReport.hiddenCount ?? toHide.length} confirmed-dead feed(s) hidden`}
                        </h4>
                        <ul className="space-y-1 text-sm">
                          {toHide.map((f) => (
                            <li key={f.id} className="text-gray-300">
                              <span className="font-medium text-white">{f.title}</span>
                              {f.artist ? <span className="text-gray-400"> — {f.artist}</span> : null}
                              <span className="text-gray-500"> (PI dead={f.piDead}, HTTP {f.httpStatus ?? '—'})</span>
                              <br />
                              <span className="text-xs text-gray-500 font-mono break-all">{f.url}</span>
                            </li>
                          ))}
                        </ul>
                        {deadCheckReport.dryRun && (
                          <button
                            type="button"
                            onClick={() => runDeadFeedCheck(false)}
                            disabled={deadCheckBusy}
                            className="mt-3 w-full px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                          >
                            {deadCheckBusy ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Hiding...
                              </>
                            ) : (
                              <>🚫 Hide {toHide.length} confirmed-dead feed(s)</>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {toHide && toHide.length === 0 && (
                      <p className="text-sm text-green-400">No confirmed-dead feeds. Nothing to hide. ✅</p>
                    )}
                  </>
                );
              })()}

              {deadCheckReport.needsReview.length > 0 && (
                <div className="rounded-lg p-4 border bg-orange-500/10 border-orange-500/30">
                  <h4 className="font-semibold text-orange-300 mb-2">
                    {deadCheckReport.needsReview.length} need review — Podcast Index says dead but the URL still responds
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {deadCheckReport.needsReview.map((f) => (
                      <li key={f.id} className="text-gray-300">
                        <span className="font-medium text-white">{f.title}</span>
                        {f.artist ? <span className="text-gray-400"> — {f.artist}</span> : null}
                        <span className="text-gray-500"> (PI dead={f.piDead}, HTTP {f.httpStatus ?? '—'})</span>
                        <br />
                        <span className="text-xs text-gray-500 font-mono break-all">{f.url}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-gray-400">
                    Not hidden automatically. Use &quot;Hide Feed&quot; above to hide any of these manually.
                  </p>
                </div>
              )}

              {deadCheckReport.unconfirmed.length > 0 && (
                <details className="rounded-lg p-4 border bg-gray-500/10 border-gray-500/30">
                  <summary className="cursor-pointer text-sm text-gray-300">
                    {deadCheckReport.unconfirmed.length} unconfirmed (transient errors, not hidden)
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {deadCheckReport.unconfirmed.map((f) => (
                      <li key={f.id} className="text-gray-400">
                        <span className="text-gray-300">{f.title}</span>
                        <span className="text-gray-500"> — {f.reason || `HTTP ${f.httpStatus ?? '—'}`}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Database Cleanup - Orphaned Items */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-orange-500/30 p-6 mb-8">
          <h2 className="text-2xl font-semibold mb-4 text-orange-400">Database Cleanup</h2>
          <p className="text-sm text-gray-400 mb-4">
            Remove album feeds that failed to import (type=album with zero tracks). Publishers, podcasts, and populated albums are preserved regardless of playlist membership — use the per-feed delete button above for one-off cleanup.
          </p>

          <div className="space-y-4">
            {/* Step 1: Parse missing tracks */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Step 1: Parse Missing Tracks</h3>
              <p className="text-xs text-gray-500 mb-3">
                Import tracks for feeds that have none. This ensures feeds are properly linked before cleanup.
              </p>
              <button
                type="button"
                onClick={parseMissingTracks}
                disabled={parsingMissingTracks || checkingOrphans || deletingOrphans}
                className="px-4 py-2 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
              >
                {parsingMissingTracks ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                    Parsing feeds...
                  </>
                ) : (
                  <>Parse Missing Tracks</>
                )}
              </button>
              {/* Progress Bar */}
              {parseProgress && (
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Processing {parseProgress.current} of {parseProgress.total}</span>
                    <span>{Math.round((parseProgress.current / parseProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(parseProgress.current / parseProgress.total) * 100}%` }}
                    />
                  </div>
                  {parseProgress.feedTitle && (
                    <p className="text-xs text-gray-500 truncate">
                      {parseProgress.feedTitle}
                    </p>
                  )}
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-400">{parseProgress.parsed} parsed</span>
                    <span className="text-yellow-400">{parseProgress.failed} failed</span>
                    <span className="text-blue-400">{parseProgress.totalTracks} tracks</span>
                  </div>
                </div>
              )}
              {parseResult && !parseProgress && (
                <div className="mt-3 text-xs text-gray-400">
                  Found {parseResult.total} feeds without tracks.
                  Parsed {parseResult.parsed}, imported {parseResult.totalTracks} tracks.
                  {parseResult.failed > 0 && <span className="text-yellow-400"> ({parseResult.failed} failed)</span>}
                </div>
              )}
              {failedFeeds.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowFailedFeeds(v => !v)}
                    className="text-xs text-gray-300 hover:text-white underline-offset-2 hover:underline"
                  >
                    {showFailedFeeds ? 'Hide' : 'Show'} per-feed log ({failedFeeds.length})
                  </button>
                  {showFailedFeeds && (
                    <div className="mt-2 max-h-64 overflow-y-auto rounded bg-black/30 border border-white/10 p-2 space-y-1 font-mono text-[11px]">
                      {(() => {
                        const counts = failedFeeds.reduce<Record<string, number>>((acc, f) => {
                          acc[f.reason] = (acc[f.reason] || 0) + 1;
                          return acc;
                        }, {});
                        return (
                          <div className="pb-2 mb-2 border-b border-white/10 text-gray-400">
                            {Object.entries(counts)
                              .sort(([, a], [, b]) => b - a)
                              .map(([reason, n]) => `${reason}: ${n}`)
                              .join(' · ')}
                          </div>
                        );
                      })()}
                      {failedFeeds.map((f, i) => (
                        <div
                          key={`${f.feedId}-${i}`}
                          className={f.severity === 'info' ? 'text-blue-300' : 'text-yellow-300'}
                        >
                          <span className="text-gray-500">[{f.reason}]</span>{' '}
                          <span>{f.feedId}</span>
                          {f.feedUrl && <span className="text-gray-500"> — {f.feedUrl}</span>}
                          {f.message && <span className="text-gray-400"> — {f.message}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Check for orphans */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <h3 className="text-sm font-medium text-gray-300 mb-2">Step 2: Check for Orphaned Items</h3>
              <p className="text-xs text-gray-500 mb-3">
                Find empty album feeds left behind by failed imports.
              </p>
              <button
                type="button"
                onClick={checkForOrphans}
                disabled={checkingOrphans || deletingOrphans || parsingMissingTracks}
                className="px-4 py-2 bg-orange-600/20 text-orange-400 rounded-lg hover:bg-orange-600/30 focus:outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2"
              >
                {checkingOrphans ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-orange-400"></div>
                    Checking...
                  </>
                ) : (
                  <>Check for Orphaned Items</>
                )}
              </button>
            </div>

            {/* Orphan Preview Results */}
            {orphanPreview && (
              <div className={`rounded-lg p-4 border ${
                orphanPreview.orphanedFeeds > 0
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-green-500/10 border-green-500/30'
              }`}>
                {orphanPreview.orphanedFeeds > 0 ? (
                  <div className="space-y-4">
                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-white/5 rounded p-3">
                        <p className="text-xs text-gray-400">Feeds to Keep</p>
                        <p className="text-xl font-bold text-green-400">{orphanPreview.feedsToKeep}</p>
                      </div>
                      <div className="bg-white/5 rounded p-3">
                        <p className="text-xs text-gray-400">Orphaned Feeds</p>
                        <p className="text-xl font-bold text-red-400">{orphanPreview.orphanedFeeds}</p>
                      </div>
                      <div className="bg-white/5 rounded p-3">
                        <p className="text-xs text-gray-400">Orphaned Tracks</p>
                        <p className="text-xl font-bold text-red-400">{orphanPreview.orphanedTracks}</p>
                      </div>
                      <div className="bg-white/5 rounded p-3">
                        <p className="text-xs text-gray-400">Total in DB</p>
                        <p className="text-xl font-bold text-gray-300">{orphanPreview.totalFeeds} feeds</p>
                      </div>
                    </div>

                    {/* Sample Orphaned Feeds */}
                    {orphanPreview.sampleOrphanedFeeds.length > 0 && (
                      <div>
                        <p className="text-sm text-gray-400 mb-1">
                          Sample of feeds to be deleted ({Math.min(50, orphanPreview.orphanedFeeds)} of {orphanPreview.orphanedFeeds}):
                        </p>
                        {typeof orphanPreview.withCanonicalCount === 'number' && (
                          <p className="text-xs mb-2">
                            <span className="text-green-400">{orphanPreview.withCanonicalCount} safe duplicates</span>
                            {typeof orphanPreview.withoutCanonicalCount === 'number' && orphanPreview.withoutCanonicalCount > 0 && (
                              <>
                                {' · '}
                                <span className="text-red-400">{orphanPreview.withoutCanonicalCount} need review</span>
                              </>
                            )}
                          </p>
                        )}
                        <div className="max-h-48 overflow-y-auto space-y-2">
                          {orphanPreview.sampleOrphanedFeeds.map((feed) => (
                            <div key={feed.id} className="flex items-center gap-3 bg-white/5 rounded p-2 text-sm">
                              {feed.image && (
                                <img
                                  src={feed.image}
                                  alt={feed.title}
                                  className="w-8 h-8 rounded object-cover flex-shrink-0"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-white truncate">{feed.title}</p>
                                <p className="text-xs text-gray-400">{feed.artist} — {feed.trackCount} tracks</p>
                                {feed.originalUrl && (
                                  <p className="text-[10px] text-gray-500 font-mono truncate">{feed.originalUrl}</p>
                                )}
                                {feed.canonicalId ? (
                                  <p className="text-[10px] text-green-400 truncate">
                                    → duplicate of <span className="font-mono">{feed.canonicalId}</span> ({feed.canonicalTrackCount} tracks)
                                  </p>
                                ) : (
                                  <p className="text-[10px] text-red-400">
                                    ⚠ no canonical match — review before deleting
                                  </p>
                                )}
                              </div>
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                feed.type === 'album' ? 'bg-blue-600/20 text-blue-400' :
                                feed.type === 'publisher' ? 'bg-purple-600/20 text-purple-400' :
                                'bg-gray-600/20 text-gray-400'
                              }`}>
                                {feed.type}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={deleteOrphanedItems}
                      disabled={deletingOrphans || checkingOrphans}
                      className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      {deletingOrphans ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          Deleting...
                        </>
                      ) : (
                        <>Delete {orphanPreview.orphanedFeeds} Orphaned Feeds</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-green-400 font-medium">Database is clean!</p>
                    <p className="text-sm text-gray-400 mt-1">
                      No empty album feeds found ({orphanPreview.totalFeeds} feeds total).
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DiagnosticsPanel />

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
                      <div className="mt-2 space-y-1">
                        <a
                          href={feed.type === 'publisher' ? `/publisher/${feed.id}` : `/album/${feed.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-400 hover:text-emerald-300 block transition-colors"
                        >
                          stablekraft.app/{feed.type === 'publisher' ? 'publisher' : 'album'}/{feed.id}
                        </a>
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

        {/* Test Feeds Section */}
        <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-6">
          <h2 className="text-2xl font-semibold mb-4">Test Feeds</h2>
          <p className="text-gray-400 text-sm mb-4">
            These feeds are hidden from main site browsing and only accessible via direct links.
          </p>
          <div className="space-y-3">
            {/* LNURL Test Feed */}
            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
              <Link
                href="/album/lnurl-test-feed"
                className="flex-1 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                LNURL Test Feed
              </Link>
              <button
                onClick={async () => {
                  setReparsingFeeds(prev => new Set(prev).add('lnurl-test-feed'));
                  try {
                    const response = await adminFetch('/api/feeds/refresh-by-url', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        url: 'https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml',
                        feedId: 'lnurl-test-feed',
                        type: 'test'
                      })
                    });
                    const data = await response.json();
                    if (response.status === 202) {
                      toast.info(queuedRefreshMessage(data));
                    } else if (response.ok) {
                      toast.success(`LNURL Test Feed parsed! ${data.totalTracks || 0} tracks`);
                    } else {
                      toast.error(data.error || 'Failed to parse feed');
                    }
                  } catch (error) {
                    toast.error('Network error parsing feed');
                  } finally {
                    setReparsingFeeds(prev => {
                      const next = new Set(prev);
                      next.delete('lnurl-test-feed');
                      return next;
                    });
                  }
                }}
                disabled={reparsingFeeds.has('lnurl-test-feed')}
                className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reparsingFeeds.has('lnurl-test-feed') ? 'Parsing...' : 'Parse'}
              </button>
            </div>

            {/* Podtards Test Feed */}
            <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/10">
              <Link
                href="/publisher/podtards-test"
                className="flex-1 inline-flex items-center gap-2 text-orange-400 hover:text-orange-300 transition-colors text-sm font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Podtards Test Feed
              </Link>
              <button
                onClick={async () => {
                  setReparsingFeeds(prev => new Set(prev).add('podtards-test'));
                  try {
                    const response = await adminFetch('/api/feeds/refresh-by-url', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        url: 'https://msp.podtards.com/api/hosted/3eeb8274-6e82-4f88-ad84-3416ea5c50c4.xml',
                        feedId: 'podtards-test'
                      })
                    });
                    const data = await response.json();
                    if (response.status === 202) {
                      toast.info(queuedRefreshMessage(data));
                    } else if (response.ok) {
                      toast.success(`Podtards Test Feed parsed! ${data.totalTracks || 0} tracks`);
                    } else {
                      toast.error(data.error || 'Failed to parse feed');
                    }
                  } catch (error) {
                    toast.error('Network error parsing feed');
                  } finally {
                    setReparsingFeeds(prev => {
                      const next = new Set(prev);
                      next.delete('podtards-test');
                      return next;
                    });
                  }
                }}
                disabled={reparsingFeeds.has('podtards-test')}
                className="px-3 py-1.5 bg-blue-600/20 text-blue-400 rounded-lg hover:bg-blue-600/30 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {reparsingFeeds.has('podtards-test') ? 'Parsing...' : 'Parse'}
              </button>
            </div>
          </div>
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
                      {importResult.linkedAlbums ? (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">📀 Albums:</span>
                          <span className="text-white font-medium">{importResult.linkedAlbums.totalLinked} linked ({importResult.linkedAlbums.imported} imported, {importResult.linkedAlbums.remoteItemsFound} referenced)</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">📀 Tracks:</span>
                          <span className="text-white font-medium">{importResult.feed?._count?.Track || 0}</span>
                        </div>
                      )}
                      {importResult.feed?.v4vRecipient && (
                        <div className="flex items-center gap-2 text-sm min-w-0">
                          <span className="text-gray-400 flex-shrink-0">⚡ Lightning:</span>
                          <span className="text-green-400 font-mono text-xs truncate" title={importResult.feed.v4vRecipient}>{importResult.feed.v4vRecipient}</span>
                        </div>
                      )}
                      {importResult.feed?.v4vValue?.recipients && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400 mb-1">Payment splits:</p>
                          <div className="space-y-1">
                            {importResult.feed.v4vValue.recipients.map((recipient: any, idx: number) => (
                              <div key={idx} className="text-xs text-gray-300 font-mono break-all">
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
                        Found and automatically imported the artist&apos;s publisher feed:
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
                        Found artist&apos;s publisher feed: <span className="text-green-300 font-medium">{importResult.publisherFeed.title}</span>
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