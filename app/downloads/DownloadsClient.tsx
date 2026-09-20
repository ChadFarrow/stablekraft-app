'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Trash2, Play, HardDrive, ChevronDown, Volume2 } from 'lucide-react';
import { useDownloads } from '@/contexts/DownloadsContext';
import { useAudio } from '@/contexts/AudioContext';
import { primaryPlaybackKey } from '@/lib/downloads/playback-key';
import BackButton from '@/components/BackButton';
import HomeButton from '@/components/HomeButton';
import type { DownloadRecord } from '@/lib/downloads/downloads-db';
import type { DownloadableAlbum } from '@/lib/downloads/download-manager';
import type { RSSAlbum } from '@/lib/rss-parser';
import { toast } from '@/components/Toast';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface DownloadGroup {
  id: string;
  kind: 'album' | 'loose';
  title: string;
  coverArt?: string;
  records: DownloadRecord[];
}

/** Build a minimal playable album from a group so in-group next/prev works. */
function groupToAlbum(group: DownloadGroup): RSSAlbum {
  return {
    title: group.title,
    artist: group.records[0]?.artist || 'Unknown Artist',
    description: '',
    coverArt: group.coverArt || null,
    releaseDate: new Date(0).toISOString(),
    tracks: group.records.map((r) => ({
      title: r.title,
      url: r.key,
      artist: r.artist,
      guid: r.trackGuid,
      duration: r.durationSecs != null ? String(r.durationSecs) : '0',
    })),
  } as unknown as RSSAlbum;
}

export default function DownloadsClient() {
  const {
    ready,
    listDownloads,
    removeByKey,
    removeAlbum,
    clearAllDownloads,
    getStorageEstimate,
    getCoverUrl,
  } = useDownloads();
  const { playAlbum, currentPlayingAlbum, currentTrackIndex, isPlaying } = useAudio();
  // Key of the track currently playing, to highlight it in the list below.
  const currentUrl = currentPlayingAlbum?.tracks?.[currentTrackIndex]?.url;
  const currentKey = currentUrl ? primaryPlaybackKey(currentUrl) : null;
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  // Albums start collapsed so a large library stays a short, scannable list.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const records = listDownloads();

  useEffect(() => {
    getStorageEstimate().then(setEstimate);
  }, [getStorageEstimate, records.length]);

  const groups = useMemo<DownloadGroup[]>(() => {
    const byAlbum = new Map<string, DownloadGroup>();
    const loose: DownloadRecord[] = [];

    for (const rec of records) {
      if (rec.albumId) {
        const g = byAlbum.get(rec.albumId) ?? {
          id: rec.albumId,
          kind: 'album' as const,
          title: rec.albumTitle || 'Album',
          coverArt: rec.coverArt,
          records: [],
        };
        g.records.push(rec);
        byAlbum.set(rec.albumId, g);
      } else {
        loose.push(rec);
      }
    }

    // Within each album, play/list in real album order (trackOrder captured at
    // download time). Records without it (older downloads) fall to the end.
    for (const g of byAlbum.values()) {
      g.records.sort(
        (a, b) =>
          (a.trackOrder ?? Number.MAX_SAFE_INTEGER) - (b.trackOrder ?? Number.MAX_SAFE_INTEGER) ||
          b.createdAt - a.createdAt
      );
    }

    const out: DownloadGroup[] = [...byAlbum.values()];
    if (loose.length) {
      out.push({ id: 'loose', kind: 'loose', title: 'Individual tracks', records: loose });
    }
    return out;
  }, [records]);

  const totalBytes = records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);

  // Resolve each album's downloaded cover to a cached object URL so art shows
  // offline; falls back to the network URL when a cover isn't cached. Keyed off
  // the set of cover URLs so it only re-runs when that set changes.
  const coverArtKeys = groups.map((g) => g.coverArt || '').join('|');
  const [coverSrc, setCoverSrc] = useState<Record<string, string>>({});
  const createdCoverUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const created: string[] = [];
      const map: Record<string, string> = {};
      const seen = new Set<string>();
      for (const g of groups) {
        const url = g.coverArt;
        if (url && !seen.has(url)) {
          seen.add(url);
          const blob = await getCoverUrl(url);
          if (blob) {
            map[url] = blob;
            created.push(blob);
          }
        }
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      createdCoverUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      createdCoverUrlsRef.current = created;
      setCoverSrc(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverArtKeys]);
  // Revoke any remaining object URLs on unmount.
  useEffect(
    () => () => {
      createdCoverUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  const groupKeys = groups.map((g) => `${g.kind}-${g.id}`);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((k) => expandedGroups.has(k));
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () => setExpandedGroups(allExpanded ? new Set() : new Set(groupKeys));

  const playGroupAt = (group: DownloadGroup, index: number) => {
    playAlbum(groupToAlbum(group), index).catch(() => {
      toast.error('Could not start playback.');
    });
  };

  const handleRemoveGroup = async (group: DownloadGroup) => {
    if (
      group.records.length > 1 &&
      !window.confirm(
        `Remove all ${group.records.length} downloaded tracks in “${group.title}”?`
      )
    ) {
      return;
    }
    if (group.kind === 'album') {
      // Owner-scoped: only drops this album's claim, keeps bytes a track shared
      // with another owner still needs.
      await removeAlbum({ feedId: group.id } as DownloadableAlbum);
    } else {
      for (const rec of group.records) await removeByKey(rec.key);
    }
  };

  const handleClearAll = async () => {
    if (!records.length) return;
    if (!window.confirm(`Remove all ${records.length} downloaded track(s)? This frees the storage they use.`)) {
      return;
    }
    await clearAllDownloads();
    toast.success('All downloads removed.');
  };

  if (!ready) {
    return (
      <div className="min-h-screen text-white flex items-center justify-center">
        <p className="text-gray-400">Loading downloads…</p>
      </div>
    );
  }

  const usedFraction =
    estimate?.quota && estimate.quota > 0 ? Math.min(1, estimate.usage / estimate.quota) : null;

  return (
    // Dark scrim so the app's atmospheric canvas background doesn't bleed
    // illegibly into the content, while keeping a subtle sense of depth.
    <div className="min-h-screen bg-neutral-950/85 backdrop-blur-sm">
      {/* pt carries the safe-area inset: in a standalone PWA the web view is full-bleed
          under the status bar, so a bare py-8 puts the Back button under the clock on a
          notched iPhone (59px inset). Safari's own chrome hides this, so it only appears
          once the app is installed. pb stays at the py-8 value. */}
      <div className="max-w-3xl mx-auto px-4 pt-[calc(var(--sk-safe-top)+32px)] pb-8 text-white">
        <div className="mb-4 -ml-2 flex items-center gap-1">
          <BackButton />
          <HomeButton />
        </div>

        {/* Header card */}
        <header className="rounded-2xl bg-neutral-900/80 backdrop-blur-md border border-white/10 shadow-xl p-5 mb-6">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
              <span className="grid place-items-center h-10 w-10 rounded-xl bg-amber-400/15 ring-1 ring-amber-400/30">
                <Download className="h-5 w-5 text-amber-400" />
              </span>
              Downloads
            </h1>
            {records.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-sm text-red-300/90 hover:text-red-200 hover:bg-red-500/10 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="h-4 w-4" /> Clear all
              </button>
            )}
          </div>

          {/* Storage usage */}
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-300">
            <HardDrive className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <span>
              <span className="font-semibold text-white">{formatBytes(totalBytes)}</span> downloaded
              {estimate?.quota
                ? ` · ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used on device`
                : ''}
            </span>
          </div>
          {usedFraction !== null && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-400/80"
                style={{ width: `${Math.max(2, usedFraction * 100)}%` }}
              />
            </div>
          )}

          {/* Offline mode moved to Settings -> Data & Offline, beside Data Saver.
              The two are the app's manual "use less network" switches and were in
              different places; this page keeps the storage meter and the list. */}
        </header>

        {records.length === 0 ? (
          <div className="rounded-2xl bg-neutral-900/80 backdrop-blur-md border border-white/10 text-center py-16 px-6 text-gray-300">
            <div className="grid place-items-center h-16 w-16 mx-auto mb-5 rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/20">
              <Download className="h-8 w-8 text-amber-400/70" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">No downloads yet</p>
            <p className="text-sm max-w-sm mx-auto text-gray-400">
              Tap the <Download className="inline h-3.5 w-3.5 -mt-0.5 text-amber-400" /> download button on
              any album or track to save it for offline listening.
            </p>
            <Link
              href="/"
              className="inline-block mt-6 rounded-full bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 px-5 py-2 text-sm font-medium transition-colors"
            >
              Browse music →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.length > 1 && (
              <div className="flex justify-end">
                <button
                  onClick={toggleAll}
                  className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded transition-colors"
                >
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
            )}
            {groups.map((group) => {
              const groupBytes = group.records.reduce((s, r) => s + (r.sizeBytes || 0), 0);
              const groupKey = `${group.kind}-${group.id}`;
              const isExpanded = expandedGroups.has(groupKey);
              return (
                <section
                  key={`${group.kind}-${group.id}`}
                  className="rounded-2xl bg-neutral-900/80 backdrop-blur-md border border-white/10 shadow-xl overflow-hidden"
                >
                  {/* Group header — click to expand/collapse */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(groupKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(groupKey);
                      }
                    }}
                    aria-expanded={isExpanded}
                    className={`flex items-center gap-3 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer transition-colors ${
                      isExpanded ? 'border-b border-white/10' : ''
                    }`}
                  >
                    <ChevronDown
                      className={`h-5 w-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                    {group.coverArt ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={coverSrc[group.coverArt] ?? group.coverArt}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover flex-shrink-0 ring-1 ring-white/10"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg flex-shrink-0 grid place-items-center bg-white/5 ring-1 ring-white/10">
                        <Download className="h-5 w-5 text-gray-500" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold truncate">{group.title}</h2>
                      <p className="text-xs text-gray-400">
                        {group.records.length} track{group.records.length === 1 ? '' : 's'} ·{' '}
                        {formatBytes(groupBytes)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveGroup(group);
                      }}
                      className="flex-shrink-0 p-2 rounded-full text-gray-400 hover:text-red-400 hover:bg-white/10 transition-colors"
                      aria-label={`Remove ${group.title} download`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playGroupAt(group, 0);
                      }}
                      className="flex-shrink-0 grid place-items-center h-9 w-9 rounded-full bg-amber-400 text-black hover:bg-amber-300 active:scale-95 transition-all shadow-lg shadow-amber-400/20"
                      aria-label={`Play ${group.title}`}
                    >
                      <Play className="h-4 w-4 ml-0.5" fill="currentColor" />
                    </button>
                  </div>

                  {isExpanded && (
                  <ul className="divide-y divide-white/5">
                    {group.records.map((rec, i) => {
                      const isCurrent = !!currentKey && rec.key === currentKey;
                      return (
                      <li
                        key={rec.key}
                        className={`group flex items-center gap-3 px-3 py-2.5 transition-colors ${
                          isCurrent ? 'bg-amber-500/10' : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <button
                          onClick={() => playGroupAt(group, i)}
                          className={`p-2 rounded-full flex-shrink-0 transition-colors ${
                            isCurrent
                              ? 'text-amber-400'
                              : 'text-gray-300 hover:text-amber-400 hover:bg-white/10'
                          }`}
                          aria-label={isCurrent ? `Now playing ${rec.title}` : `Play ${rec.title}`}
                        >
                          {isCurrent ? (
                            <Volume2 className={`h-4 w-4 ${isPlaying ? 'animate-pulse' : ''}`} />
                          ) : (
                            <Play className="h-4 w-4" fill="currentColor" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm ${
                              isCurrent ? 'text-amber-400 font-medium' : 'text-white'
                            }`}
                          >
                            {rec.title}
                          </p>
                          {rec.artist && (
                            <p className="truncate text-xs text-gray-400">{rec.artist}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums">
                          {formatBytes(rec.sizeBytes || 0)}
                        </span>
                        <button
                          onClick={() => removeByKey(rec.key)}
                          className="p-2 rounded-full text-gray-500 hover:text-red-400 hover:bg-white/10 flex-shrink-0 transition-colors sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Remove download of ${rec.title}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-8 px-1">
          Downloads are stored on this device by your browser. On iOS, the browser may remove them to free
          space; if a download disappears it will simply stream again when you&apos;re online.
        </p>
      </div>
    </div>
  );
}
