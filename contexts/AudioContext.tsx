'use client';

import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { APP_NAME } from '@/lib/constants';
import { RSSAlbum } from '@/lib/rss-parser';
import { toast } from '@/components/Toast';
// Type-only import for TypeScript (hls.js is ~150KB, loaded dynamically when needed)
import type HlsType from 'hls.js';
import { monitoring } from '@/lib/monitoring';
import { isNativeAndroid } from '@/lib/native-app-identity';
import { storage } from '@/lib/indexed-db-storage';
import { useNostr } from './NostrContext';
import { useUserSettings } from '@/hooks/useUserSettings';
import { publishNowPlayingStatus, clearUserStatus } from '@/lib/nostr/nip38';
import { useBitcoinConnect } from '@/components/Lightning/BitcoinConnectProvider';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import { ValueRecipient } from '@/lib/lightning/value-parser';
import { reportBoost } from '@/lib/lightning/report-boost';
import { resolveAutoBoostSenderName, resolveBoostSenderName } from '@/lib/lightning/sender-name';
import { hasV4V as checkHasV4V, getV4VRecipients, getPrimaryRecipient, getPrimaryRecipientObject, formatValueSplitsForBoost } from '@/lib/v4v-utils';
import { prefetchUpcomingTracks, prefetchAudio } from '@/lib/audio-prefetch';
import { isCorsProblematicHost, isDirectFirstHost } from '@/lib/audio-url-utils';
import { NextTrackBlobCache } from '@/lib/audio-blob-prefetch';
import { downloadManager } from '@/lib/downloads/download-manager';
import { getObjectUrl as getDownloadObjectUrl } from '@/lib/downloads/downloads-cache';
import { primaryPlaybackKey } from '@/lib/downloads/playback-key';
import { PodcastChapter } from '@/lib/podcast-types';
import { shouldShowAndroidBatteryHint, ANDROID_BATTERY_HINT_DISMISSED_KEY } from '@/lib/android-battery-hint';
import { resolveAlbumRewindIndex } from '@/lib/album-rewind';
import {
  PLAYBACK_STATE_KEY,
  PLAYBACK_POSITION_KEY,
  AUDIO_STATE_VERSION,
  albumSessionKey,
  serializeAlbumForPersistence,
  rehydrateAlbum,
  resolveResumePosition,
  isSessionFresh,
} from '@/lib/playback-state';
import { isDataSaverOn, fallbackArtworkSrc } from '@/lib/data-saver';

// How often the "resume where you left off" position record may be rewritten.
// The exact second is best-effort; the point of the feature is coming back to
// the right track. Backgrounding the app flushes immediately regardless.
const POSITION_SAVE_THROTTLE_MS = 5000;

// How long an armed resume seek suppresses incidental position saves. Bounded
// so a ref that never gets consumed (armed, then the user never pressed play)
// cannot disable position saving for the rest of the session.
const PENDING_RESUME_BLOCKS_SAVE_MS = 30000;

// Track guids excluded from global shuffle (non-music recap/talk content).
const SHUFFLE_EXCLUDED_TRACK_GUIDS = new Set<string>([
  'f475f98b-8ed4-4b06-8038-53727b9100d6', // The Satellite Skirmish: Boost Recap
]);

/**
 * Detect OP3 boost chapter feeds. OP3 surfaces each boost as a "chapter" so
 * listeners can see who boosted and when. These are informational markers —
 * we render them on the progress bar but never skip between them on next/prev.
 */
function isBoostChaptersUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'op3.dev' || hostname.endsWith('.op3.dev');
  } catch {
    return /(^|\/\/)op3\.dev\//i.test(url);
  }
}

/**
 * Native-Android-only bridge to the PlaybackKeepAlive foreground service.
 * On iOS, desktop, and the browser PWA this is a complete no-op (returns
 * before any side effect). Never throws — a missing plugin or older native
 * shell degrades silently to today's no-foreground-service behavior.
 */
function playbackKeepAlive(action: 'start' | 'stop'): void {
  try {
    const cap = (typeof window !== 'undefined' ? (window as any).Capacitor : undefined);
    if (!cap?.isNativePlatform?.()) return;      // browser PWA / SSR / iOS Safari
    if (cap.getPlatform?.() !== 'android') return; // native, Android only
    cap.Plugins?.PlaybackKeepAlive?.[action]?.();
  } catch {
    // swallow — must never break the audio pipeline
  }
}

/** Push now-playing data to the native lock-screen MediaSession. No-op off native Android. */
function nativeMedia(method: 'updateMetadata' | 'setPlaybackState', data: Record<string, unknown>): void {
  try {
    if (!isNativeAndroid()) return;
    (window as any).Capacitor?.Plugins?.PlaybackKeepAlive?.[method]?.(data);
  } catch {
    // Best-effort — never break the audio pipeline.
  }
}

/** Whether the user's manual Offline-mode switch (Downloads page) is on. */
function isOfflineModeOn(): boolean {
  try {
    return typeof window !== 'undefined' && localStorage.getItem('sk_offline_mode') === '1';
  } catch {
    return false;
  }
}

/**
 * QoS gate: in manual Offline mode, refuse to *attempt* streaming a track that
 * isn't downloaded — so a poor/flaky connection can't hang the app trying to
 * buffer. Downloaded tracks play as normal. Returns true if playback was blocked.
 * Awaits `init()` so the downloaded set is populated before we decide.
 */
async function blockNonDownloadedInOfflineMode(
  track: { url?: string | null } | null | undefined
): Promise<boolean> {
  if (!isOfflineModeOn()) return false;
  try {
    await downloadManager.init();
    if (track?.url && downloadManager.isTrackDownloaded(track as any)) return false;
  } catch {
    // if we can't tell, fail safe to blocked (offline mode is intentional)
  }
  toast.info("Offline mode is on — this song isn't downloaded. Turn it off to stream.", {
    duration: 3500,
  });
  return true;
}

interface AudioContextType {
  // Audio state
  currentPlayingAlbum: RSSAlbum | null;
  isPlaying: boolean;
  isLoading: boolean; // True when playback is starting (between click and audio playing)
  currentTrackIndex: number;

  // Media type state
  isVideoMode: boolean;

  // Shuffle state
  isShuffleMode: boolean;

  // UI state
  isFullscreenMode: boolean;
  setFullscreenMode: (fullscreen: boolean) => void;

  // Repeat mode
  repeatMode: 'none' | 'one' | 'all';
  setRepeatMode: (mode: 'none' | 'one' | 'all') => void;

  // Chapter state
  chapters: PodcastChapter[];
  currentChapterIndex: number;

  // Audio controls
  playAlbum: (album: RSSAlbum, trackIndex?: number) => Promise<boolean>;
  playTrack: (audioUrl: string, startTime?: number, endTime?: number) => Promise<boolean>;
  playShuffledTrack: (index: number) => Promise<boolean>;
  shuffleAllTracks: () => Promise<boolean>;
  shuffleAlbums: (albums: RSSAlbum[]) => Promise<boolean>;
  toggleShuffle: () => void;
  pause: () => void;
  resume: () => void;
  seek: (time: number) => void;
  playNextTrack: () => void;
  playPreviousTrack: () => void;
  stop: () => void;

  // Media element refs for direct access
  audioRef: React.RefObject<HTMLAudioElement>;
  videoRef: React.RefObject<HTMLVideoElement>;

  // Pre-load albums (for server-side fetched data)
  setInitialAlbums: (albums: RSSAlbum[]) => void;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

/**
 * The playback clock, deliberately SEPARATE from AudioContext.
 *
 * WHY: `handleTimeUpdate` calls `setCurrentTime` on every `timeupdate` event —
 * roughly 4Hz, and up to 60Hz on some engines. While `currentTime` sat in the
 * main context value's dependency array, that invalidated the memo several
 * times a second and re-rendered ALL of its consumers, including the 2,143-line
 * `app/page.tsx`, which only ever wanted `playAlbum` and `shuffleAllTracks` and
 * never read the clock at all. `AlbumCard`'s custom comparator stopped the
 * cards themselves re-rendering, so the cost was a full JSX tree rebuild plus
 * roughly 800 comparator calls per second on a 200-card grid — on a phone,
 * while audio was decoding.
 *
 * Only the five components that actually display a position subscribe here.
 * Anything needing the exact value outside a render can read `currentTimeRef`.
 */
interface AudioTimeContextType {
  currentTime: number;
  duration: number;
}

const AudioTimeContext = createContext<AudioTimeContextType | undefined>(undefined);

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
};

/**
 * The playback position and track length.
 *
 * Split out of `useAudio` because it changes several times a second. Call it
 * ONLY from a component that renders the value — a progress bar, a time label,
 * a scrubber. Anything else should use `useAudio`, or it will re-render at the
 * clock's rate for nothing.
 */
export const useAudioTime = (): AudioTimeContextType => {
  const context = useContext(AudioTimeContext);
  if (!context) {
    throw new Error('useAudioTime must be used within an AudioProvider');
  }
  return context;
};

/**
 * A function identity that never changes, but always calls the LATEST closure.
 *
 * WHY THIS EXISTS: the provider's play/pause/seek functions are plain
 * `const fn = ...` declarations, so every render creates new ones — and
 * `playNextTrack`/`playPreviousTrack` are useCallbacks that depend on them, so
 * they churn too. Listing any of them in a memo's dependency array rebuilds
 * that memo on EVERY render. The value memo below did exactly that, and
 * `handleTimeUpdate` calls `setCurrentTime` on every `timeupdate` event, so the
 * memo was invalidated several times a second and every `useAudio()` consumer
 * re-rendered at the clock rate. Splitting the clock into `AudioTimeContext`
 * did not fix that on its own; this is the other half of the fix.
 *
 * The ref is assigned during render, not in an effect, so a call that arrives
 * before the commit still runs the current closure. Safe here because these are
 * only ever invoked from event handlers and effects, never during a render.
 */
function useStableFn<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

interface AudioProviderProps {
  children: ReactNode;
  radioMode?: boolean;
}

export const AudioProvider: React.FC<AudioProviderProps> = ({ children, radioMode = false }) => {
  const [currentPlayingAlbum, setCurrentPlayingAlbum] = useState<RSSAlbum | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false); // True when playback is starting
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [albums, setAlbums] = useState<RSSAlbum[]>([]);
  /**
   * `albums` as a ref, because `shuffleAllTracks` needs to read it AFTER an
   * await. That function is recreated each render and captures `albums` at call
   * time, so a load finishing while it waits is invisible to it — the old wait
   * loop re-read a `const` and could only ever escape via `albumsLoadedRef`.
   */
  const albumsRef = useRef<RSSAlbum[]>([]);
  /** Set by the mount effect so shuffle can START a load, not merely wait for one. */
  const loadAlbumsRef = useRef<((retryCount?: number) => Promise<void>) | null>(null);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Video mode state
  const [isVideoMode, setIsVideoMode] = useState(false);

  // Shuffle state
  const [isShuffleMode, setIsShuffleMode] = useState(false);
  const [shuffledPlaylist, setShuffledPlaylist] = useState<Array<{
    album: RSSAlbum;
    trackIndex: number;
    track: any;
  }>>([]);
  const [currentShuffleIndex, setCurrentShuffleIndex] = useState(0);

  // UI state
  const [isFullscreenMode, setIsFullscreenMode] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'one' | 'all'>('none');

  // Chapter state for podcast navigation
  const [chapters, setChapters] = useState<PodcastChapter[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1);
  // OP3 boost chapters are informational markers (each boost is a "chapter").
  // We still render them on the progress bar, but skip/next should advance to
  // the next track rather than cycling through individual boost markers.
  const [chaptersAreBoostMarkers, setChaptersAreBoostMarkers] = useState(false);
  const chaptersTrackKeyRef = useRef<string>(''); // Track which episode chapters belong to
  const currentTimeRef = useRef(0); // Ref for currentTime to avoid re-creating callbacks
  // Last playback position we observed while > 0. iOS can evict a backgrounded
  // audio element's buffer and reset currentTime to 0; this ref survives that so
  // resume() can seek back instead of restarting the track from the beginning.
  const lastNonZeroPositionRef = useRef(0);

  // "Resume where you left off": a one-shot instruction to seek the *next*
  // track that finishes loading to a restored position. Consumed (and always
  // cleared) by handleLoadedMetadata, which is both the one place that already
  // seeks on load and the one place that would otherwise reset us to 0.
  const pendingResumeSeekRef = useRef<{
    albumKey: string;
    trackIndex: number;
    position: number;
    setAt: number;
  } | null>(null);
  // Throttle stamp for the position record — see the save effects below.
  const lastPositionWriteRef = useRef(0);
  // Mirrors currentPlayingAlbum so the async session restore can tell whether
  // the user has already started something in the meantime.
  const currentPlayingAlbumRef = useRef<RSSAlbum | null>(null);

  // iOS detection state (for JSX conditional rendering)
  const [isIOS, setIsIOS] = useState(false);
  // Android detection state (drives the ping-pong background-transition path)
  const [isAndroid, setIsAndroid] = useState(false);
  // Stable ref so event handlers/timers can read Android-ness without re-subscribing
  const isAndroidRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const audioRefB = useRef<HTMLAudioElement>(null); // Second audio element for Android gapless ping-pong
  // Points at whichever of audioRef/audioRefB is currently the playback element.
  // Only ever repointed inside the Android ping-pong branch — on iOS/desktop it
  // stays === audioRef.current so behavior is unchanged.
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  // Offline downloads: when the track about to play has a downloaded copy, this
  // holds a same-origin blob: object URL for it, which getAudioUrlsToTry then
  // prepends to the candidate list so playback needs zero network. At most one
  // is live at a time (revoked on replace/stop).
  const activeLocalSrcRef = useRef<{ key: string; objectUrl: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const albumsLoadedRef = useRef(false);
  const isRetryingRef = useRef(false);
  const skipAutoSkipRef = useRef(false); // Prevent auto-skip when failure is handled programmatically
  const playbackSessionRef = useRef(0); // Session ID to cancel stale playback attempts
  const autoSkipTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track pending auto-skip to cancel on manual skip
  const isAutoTransitioningRef = useRef(false); // Track when transitioning from ended track (for iOS)
  const isInitializingHlsRef = useRef(false); // Prevent HLS cleanup during initialization
  const playNextTrackRef = useRef<() => Promise<void>>();
  const playPreviousTrackRef = useRef<() => Promise<void>>();
  const pauseRef = useRef<() => void>();
  const resumeRef = useRef<() => void>();
  // stop() is declared after resume(); this lets the cold-start failure toast
  // offer "Dismiss player" without reordering the file.
  const stopRef = useRef<() => void>();
  // Silent stall detection refs - detect when audio stops advancing while supposedly playing
  const lastKnownTimeRef = useRef<number>(0);
  const staleTimeCounterRef = useRef<number>(0);
  const stallCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recoveryAttemptRef = useRef<number>(0);
  const userInitiatedPauseRef = useRef<boolean>(false); // Track if pause was user-initiated

  // iOS background track advancement refs
  const pendingNextTrackUrlRef = useRef<string | null>(null); // Pre-computed URL for next track
  const iosAdvanceTimerRef = useRef<NodeJS.Timeout | null>(null); // Proactive advance timer
  const trackEndProcessedRef = useRef<boolean>(false); // Prevent double-advance from timer + ended event
  // True from "album finished with repeat off" until playback restarts. The
  // foreground-return net below re-triggers playNextTrack for any element still
  // reporting `ended`; after a completed album currentTrackIndex has been rewound,
  // so that would silently start TRACK 2 every time the user switches back to the
  // app. Deliberately NOT trackEndProcessedRef — that is a per-track double-advance
  // guard with three writers, and giving it a per-album meaning won't survive review.
  const albumCompleteRef = useRef<boolean>(false);
  const earlyAdvanceTriggeredRef = useRef<boolean>(false); // Android: guard so the pre-end gapless advance fires once per track
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null); // Hidden Audio element for preloading next track

  // Android locked-screen fix: holds the NEXT track's bytes as an in-memory
  // blob: URL so a backgrounded transition needs zero network. Lazily created
  // (client-only) so SSR never touches URL.createObjectURL. See
  // lib/audio-blob-prefetch.ts.
  const nextBlobCacheRef = useRef<NextTrackBlobCache | null>(null);
  const getBlobCache = (): NextTrackBlobCache => {
    if (!nextBlobCacheRef.current) {
      nextBlobCacheRef.current = new NextTrackBlobCache();
    }
    return nextBlobCacheRef.current;
  };

  // NIP-38 status publishing
  const { user, isAuthenticated } = useNostr();
  const { settings } = useUserSettings();
  const nip38TimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPublishedNip38TrackRef = useRef<string | null>(null);

  // Auto-boost support
  const { isConnected: isWalletConnected, sendPayment, sendKeysend, supportsKeysend } = useBitcoinConnect();
  const autoBoostProcessingRef = useRef(false);
  const autoBoostKeysendWarningShownRef = useRef(false);

  // Keep auto-boost settings in a ref so handleEnded always reads the latest values
  // (handleEnded is registered in a useEffect whose deps don't include settings)
  const autoBoostSettingsRef = useRef({ enabled: settings.autoBoostEnabled, amount: settings.autoBoostAmount });
  useEffect(() => {
    autoBoostSettingsRef.current = { enabled: settings.autoBoostEnabled, amount: settings.autoBoostAmount };
  }, [settings.autoBoostEnabled, settings.autoBoostAmount]);

  // Reset keysend warning when wallet keysend support changes (e.g. reconnect)
  useEffect(() => {
    autoBoostKeysendWarningShownRef.current = false;
  }, [supportsKeysend]);

  // Native Android: hold a foreground service while audio is playing so the OS
  // does not suspend the backgrounded WebView (locked-screen playback). No-op on
  // every non-native platform. Keyed on isPlaying, which stays true across track
  // transitions and only flips false on pause / stop / end-of-queue.
  useEffect(() => {
    // Start the FGS on play. Do NOT stop on pause: the native MediaSession
    // notification must persist while paused so the user can resume from the
    // lock screen (the wake lock is released on pause in the state-sync effect
    // below). No-op on every non-native platform.
    if (isPlaying) playbackKeepAlive('start');
  }, [isPlaying]);

  // Track previous VTS segment for chapter transition auto-boost
  const prevVtsSegmentRef = useRef<{ index: number; feedGuid?: string; itemGuid?: string; remotePercentage: number } | null>(null);
  // Track which track the VTS detection is monitoring so we can reset on track change
  const prevVtsTrackKeyRef = useRef<string>('');
  // Track when playback is in a gap between VTS segments (for boosting talk chapters)
  const inVtsGapRef = useRef<{ enteredAt: number } | null>(null);
  // Suppress autoboost on manual seeks/chapter skips (only natural playback triggers boosts)
  const isManualSeekRef = useRef(false);

  // Helper function to publish NIP-38 status (debounced)
  const publishNip38StatusDebounced = useCallback((action: 'play') => {
    // Clear any pending timeout
    if (nip38TimeoutRef.current) {
      clearTimeout(nip38TimeoutRef.current);
    }

    // Check if auto-status is enabled, user is authenticated, and not in radio mode
    if (!settings.nip38AutoStatus || !isAuthenticated || radioMode) {
      return;
    }

    // Debounce status updates to avoid spam (especially for rapid track changes)
    nip38TimeoutRef.current = setTimeout(async () => {
      try {
        if (action === 'play' && currentPlayingAlbum && currentPlayingAlbum.tracks[currentTrackIndex]) {
          const track = currentPlayingAlbum.tracks[currentTrackIndex];

          // Generate unique identifier for this track
          const trackIdentifier = track.id || track.guid || track.url || '';

          // Check if this is the same track we already published
          if (lastPublishedNip38TrackRef.current === trackIdentifier) {
            console.log('⏭️ NIP-38: Skipping duplicate status for same track');
            return;
          }

          const currentElement = isVideoMode ? videoRef.current : getActiveAudioEl();

          // Construct track page URL on this site
          const baseUrl = typeof window !== 'undefined'
            ? window.location.origin
            : (process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app');

          const trackPageUrl = trackIdentifier ? `${baseUrl}/music-tracks/${encodeURIComponent(trackIdentifier)}` : track.url;

          // Publish "now playing" status - persists as "last played" until next track
          await publishNowPlayingStatus(
            track.title || 'Unknown Track',
            track.artist || currentPlayingAlbum.artist || 'Unknown Artist',
            {
              trackTitle: track.title,
              artistName: track.artist || currentPlayingAlbum.artist,
              albumTitle: currentPlayingAlbum.title,
              trackUrl: trackPageUrl, // Link to track page on this site
              trackGuid: track.guid,
              feedGuid: currentPlayingAlbum.feedGuid,
              durationSeconds: currentElement?.duration || duration,
              currentTimeSeconds: currentElement?.currentTime || currentTime,
              imageUrl: track.image || currentPlayingAlbum.coverArt || undefined,
            },
            user?.relays
          );

          // Store this track as the last published
          lastPublishedNip38TrackRef.current = trackIdentifier;
        }
        // Status persists - never cleared automatically
      } catch (error) {
        // Silently fail - don't disrupt playback
        console.warn('Failed to publish NIP-38 status:', error);
      }
    }, 500); // 500ms debounce
  }, [settings.nip38AutoStatus, isAuthenticated, currentPlayingAlbum, currentTrackIndex, isVideoMode, duration, currentTime, user?.relays]);

  // Auto-boost trigger function - fire and forget, doesn't block playback
  const triggerAutoBoost = useCallback(async (track: any, album: RSSAlbum, amount: number) => {
    // Prevent concurrent auto-boosts
    if (autoBoostProcessingRef.current) {
      console.log('⚡ Auto-boost already in progress, skipping');
      return;
    }

    // Check if wallet is connected
    if (!isWalletConnected) {
      console.log('⚡ Auto-boost skipped: wallet not connected');
      return;
    }

    // Check if track or album has V4V data (fall back to album-level V4V,
    // matching BoostButton behavior — Wavlake feeds often set <podcast:value> at feed level only)
    const trackHasV4V = checkHasV4V(track);
    const albumHasV4V = checkHasV4V(album);
    if (!trackHasV4V && !albumHasV4V) {
      console.log('⚡ Auto-boost skipped: no V4V data for track or album');
      return;
    }

    // Use track V4V data if available, otherwise fall back to album
    const v4vSource = trackHasV4V ? track : album;

    autoBoostProcessingRef.current = true;

    try {
      console.log(`⚡ Auto-boost starting: ${amount} sats for "${track.title}"${!trackHasV4V ? ' (using album-level V4V)' : ''}`);

      // Build Helipad metadata
      const helipadMetadata: any = {
        podcast: track.artist || album.artist || 'Unknown Artist',
        episode: track.title || 'Unknown Track',
        action: 'auto', // Helipad action type 4 = automated boost
        app_name: APP_NAME,
        value_msat: amount * 1000,
        value_msat_total: amount * 1000,
        sender_name: resolveAutoBoostSenderName(settings.defaultBoostName),
        ts: Math.floor(Date.now() / 1000),
        uuid: `auto-${Date.now()}-${Math.floor(Math.random() * 999)}`
      };

      // Add optional fields
      if (album.feedUrl) {
        helipadMetadata.url = album.feedUrl;
        helipadMetadata.feed = album.feedUrl;
      }
      if (album.id) {
        helipadMetadata.feedId = album.id;
      }
      if (album.feedGuid) {
        helipadMetadata.remote_feed_guid = album.feedGuid;
      }
      // `track.id` is a StableKraft row id (`<feedId>-<guid>`), not an RSS
      // `<item>` guid. Same defect as the manual boost path in #242, in the
      // same two TLV fields — omit them rather than name the track with an
      // id only this app can resolve.
      if (track.guid) {
        helipadMetadata.remote_item_guid = track.guid;
        helipadMetadata.episode_guid = track.guid;
      }
      if (album.title) {
        helipadMetadata.album = album.title;
      }

      console.log('📋 Auto-boost Helipad metadata:', helipadMetadata);

      let result: { preimage?: string; error?: string } | null = null;

      // Check if we have value splits (multiple recipients)
      // Try track-level recipients first, fall back to album-level
      const v4vRecipients = getV4VRecipients(track).length > 0 ? getV4VRecipients(track) : getV4VRecipients(album);
      if (v4vRecipients.length > 0) {
        // Multi-recipient payment via value splits
        const recipients: ValueRecipient[] = v4vRecipients.map((r) => ({
          name: r.name || 'Unknown',
          type: r.type === 'lnaddress' ? 'lnaddress' : 'node',
          address: r.address,
          split: r.split || 100,
          customKey: r.customKey,
          customValue: r.customValue,
        }));

        console.log(`⚡ Auto-boost: sending to ${recipients.length} recipients`);

        const multiResult = await ValueSplitsService.sendMultiRecipientPayment(
          recipients,
          amount,
          sendPayment,
          sendKeysend,
          undefined, // No message for auto-boost
          helipadMetadata,
          undefined, // No progress callback for auto-boost
          undefined, // walletType
          supportsKeysend
        );

        if (multiResult.success || multiResult.isPartialSuccess) {
          result = { preimage: multiResult.primaryPreimage };
        } else {
          result = { error: multiResult.errors.join(', ') };
        }
      } else {
        // Single recipient (fallback: track -> album). Routed through the same dispatch as the
        // multi-recipient case rather than calling sendKeysend directly — that is what applies
        // the Fountain LNURL rule and the routing-TLV handling to auto-boost too.
        const primaryObject = getPrimaryRecipientObject(track) || getPrimaryRecipientObject(album);
        const primaryAddress = getPrimaryRecipient(track) || getPrimaryRecipient(album);

        if (primaryObject || primaryAddress) {
          const recipient: ValueRecipient = primaryObject
            ? {
                name: primaryObject.name || 'Unknown',
                type: primaryObject.type === 'lnaddress' ? 'lnaddress' : 'node',
                address: primaryObject.address,
                split: 100,
                customKey: primaryObject.customKey,
                customValue: primaryObject.customValue,
              }
            : {
                name: 'Unknown',
                // v4vRecipient is a bare string, so infer from its shape the way
                // /api/lightning/value-splits does.
                type: primaryAddress!.includes('@') ? 'lnaddress' : 'node',
                address: primaryAddress!,
                split: 100,
              };

          console.log(`⚡ Auto-boost: sending to single recipient ${recipient.address}`);

          const singleResult = await ValueSplitsService.sendMultiRecipientPayment(
            [recipient],
            amount,
            sendPayment,
            sendKeysend,
            undefined, // No message for auto-boost
            helipadMetadata,
            undefined, // No progress callback for auto-boost
            undefined, // walletType
            supportsKeysend
          );

          if (singleResult.success || singleResult.isPartialSuccess) {
            result = { preimage: singleResult.primaryPreimage };
          } else {
            result = { error: singleResult.errors.join(', ') };
          }
        }
      }

      // Reported on BOTH branches. Auto-boost runs while the screen is off, so the
      // toasts below are for whoever happens to be looking — the report is the
      // record. Logging only the successes is how a failing auto-boost stayed
      // invisible for an entire backgrounded album.
      const autoBoostReport = {
        trackId: track.id,
        feedId: album.id,
        trackTitle: track.title,
        artistName: track.artist || album.artist,
        amount,
        senderName: resolveBoostSenderName({ settingsName: settings.defaultBoostName }),
        recipient: getPrimaryRecipient(track) || getPrimaryRecipient(album) || 'value-splits',
      };

      if (result?.preimage) {
        console.log(`✅ Auto-boost successful: ${amount} sats`);

        await reportBoost({ ...autoBoostReport, preimage: result.preimage, status: 'succeeded' });

        // Show subtle toast notification
        toast.success(`Auto-boost: ${amount} sats ⚡`);
      } else {
        const reason = result?.error || 'Unknown error';
        console.warn(`⚠️ Auto-boost failed: ${reason}`);
        await reportBoost({ ...autoBoostReport, status: 'failed', error: reason });
        toast.error('Auto-boost failed');
      }
    } catch (error) {
      console.error('❌ Auto-boost error:', error);
      await reportBoost({
        trackId: track.id,
        feedId: album.id,
        trackTitle: track.title,
        artistName: track.artist || album.artist,
        amount,
        recipient: getPrimaryRecipient(track) || getPrimaryRecipient(album) || 'value-splits',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error('Auto-boost failed');
    } finally {
      autoBoostProcessingRef.current = false;
    }
  }, [isWalletConnected, sendPayment, sendKeysend, supportsKeysend, settings.defaultBoostName]);

  // Store auto-boost function in ref for use in event handlers
  const triggerAutoBoostRef = useRef(triggerAutoBoost);
  useEffect(() => {
    triggerAutoBoostRef.current = triggerAutoBoost;
  }, [triggerAutoBoost]);

  // Auto-boost on VTS chapter/segment transition — fires when the active VTS segment
  // changes, boosting the *outgoing* segment's artist via its remoteItem V4V data.
  // This lets listeners support each song's artist as they play through a VTS podcast.
  const triggerChapterAutoBoost = useCallback(async (
    outgoingFeedGuid: string,
    outgoingItemGuid: string,
    album: RSSAlbum,
    amount: number,
    remotePercentage: number,
    chapterTitle?: string
  ) => {
    // Prevent concurrent auto-boosts (shared with track-end auto-boost)
    if (autoBoostProcessingRef.current) {
      console.log('⚡ Chapter auto-boost skipped: another boost in progress');
      return;
    }

    if (!isWalletConnected) {
      console.log('⚡ Chapter auto-boost skipped: wallet not connected');
      return;
    }

    autoBoostProcessingRef.current = true;

    // Hoisted so the catch below can still name who we were paying. Everything else
    // it needs comes from the arguments; these two are resolved mid-try, and an
    // exception thrown after resolution used to report them as 'unknown'.
    let primaryRecipient: string | undefined;
    let resolvedArtistName: string | undefined;

    try {
      const hasRemoteItem = outgoingFeedGuid && outgoingItemGuid;
      const trackTitle = chapterTitle || 'Unknown Track';
      let artistName = album.artist || 'Unknown Artist';

      let blended: Array<{ name: string; address: string; split: number; type: 'node' | 'lnaddress' }> = [];

      if (hasRemoteItem) {
        // Song chapter: fetch V4V data for the remote artist
        const params = new URLSearchParams({ feedGuid: outgoingFeedGuid, itemGuid: outgoingItemGuid });
        if (chapterTitle) params.set('chapterTitle', chapterTitle);

        const res = await fetch(`/api/lightning/value-splits?${params}`);
        const data = await res.json();

        if (data.success && data.data?.recipients?.length > 0) {
          const remoteRecipients = data.data.recipients.filter((r: any) => !r.fee);
          artistName = data.artistName || artistName;

          // Scale remote artist splits by remotePercentage
          const totalRemoteSplits = remoteRecipients.reduce((sum: number, r: any) => sum + (r.split || 100), 0);
          const scaledRemote = remoteRecipients.map((r: any) => ({
            name: r.name || 'Unknown',
            address: r.address,
            split: Math.round(((r.split || 100) / totalRemoteSplits) * remotePercentage),
            type: (r.type || 'node') as 'node' | 'lnaddress',
          }));

          blended = scaledRemote;

          // If remotePercentage < 100, blend in the podcast host's (feed-level) recipients
          if (remotePercentage < 100) {
            const hostPercentage = 100 - remotePercentage;
            let hostSplits = formatValueSplitsForBoost(album, album.artist) || [];

            // If album object doesn't have V4V data, fetch from API
            if (hostSplits.length === 0 && album.feedGuid) {
              try {
                const feedParams = new URLSearchParams({ feedGuid: album.feedGuid });
                const feedRes = await fetch(`/api/lightning/value-splits?${feedParams}`);
                const feedData = await feedRes.json();
                if (feedData.success && feedData.data?.recipients?.length > 0) {
                  hostSplits = feedData.data.recipients
                    .filter((r: any) => !r.fee)
                    .map((r: any) => ({
                      name: r.name || album.artist || 'Unknown',
                      address: r.address,
                      split: parseInt(r.split) || 100,
                      type: (r.type || 'node') as 'node' | 'lnaddress',
                    }));
                }
              } catch (fetchError) {
                console.warn('⚠️ Failed to fetch host V4V for chapter blending:', fetchError);
              }
            }

            const totalHostSplits = hostSplits.reduce((sum, r) => sum + r.split, 0);
            if (totalHostSplits > 0) {
              const scaledHost = hostSplits.map(r => ({
                name: r.name || 'Unknown',
                address: r.address,
                split: Math.round((r.split / totalHostSplits) * hostPercentage),
                type: r.type as 'node' | 'lnaddress',
              }));
              blended = [...scaledRemote, ...scaledHost];
            }
          }
        }
      }

      // Non-song chapter or remote fetch returned nothing: use show-level recipients
      if (blended.length === 0) {
        let hostSplits = formatValueSplitsForBoost(album, album.artist) || [];

        // If album object doesn't have V4V data loaded, fetch from API using the feed's own GUID
        if (hostSplits.length === 0 && album.feedGuid) {
          try {
            const feedParams = new URLSearchParams({ feedGuid: album.feedGuid });
            const feedRes = await fetch(`/api/lightning/value-splits?${feedParams}`);
            const feedData = await feedRes.json();
            if (feedData.success && feedData.data?.recipients?.length > 0) {
              const feedRecipients = feedData.data.recipients.filter((r: any) => !r.fee);
              hostSplits = feedRecipients.map((r: any) => ({
                name: r.name || album.artist || 'Unknown',
                address: r.address,
                split: parseInt(r.split) || 100,
                type: (r.type || 'node') as 'node' | 'lnaddress',
              }));
            }
          } catch (fetchError) {
            console.warn('⚠️ Failed to fetch show-level V4V for chapter auto-boost:', fetchError);
          }
        }

        if (hostSplits.length === 0) {
          console.log('⚡ Chapter auto-boost skipped: no V4V recipients for segment or show');
          return;
        }
        blended = hostSplits.map(r => ({
          name: r.name || 'Unknown',
          address: r.address,
          split: r.split,
          type: r.type as 'node' | 'lnaddress',
        }));
      }

      console.log(`⚡ Chapter auto-boost starting: ${amount} sats for "${trackTitle}"${hasRemoteItem ? ` by ${artistName} (remote ${remotePercentage}%)` : ' (show-level)'}`);

      // Deduplicate recipients (e.g., Podcastindex listed with both lnaddress and node)
      const deduped: typeof blended = [];
      const seen = new Map<string, number>();
      for (const r of blended) {
        const key = (r.name || '').toLowerCase();
        const existing = seen.get(key);
        if (existing !== undefined) {
          deduped[existing].split += r.split;
          if (r.type === 'lnaddress' && deduped[existing].type !== 'lnaddress') {
            deduped[existing].address = r.address;
            deduped[existing].type = r.type;
          }
        } else {
          seen.set(key, deduped.length);
          deduped.push({ ...r });
        }
      }

      // Build Helipad metadata
      const helipadMetadata: any = {
        podcast: album.artist || 'Unknown Artist',
        episode: trackTitle,
        action: 'auto',
        app_name: APP_NAME,
        value_msat: amount * 1000,
        value_msat_total: amount * 1000,
        sender_name: resolveAutoBoostSenderName(settings.defaultBoostName),
        ts: Math.floor(Date.now() / 1000),
        uuid: `auto-ch-${Date.now()}-${Math.floor(Math.random() * 999)}`,
        remote_feed_guid: outgoingFeedGuid,
        remote_item_guid: outgoingItemGuid,
      };

      if (album.feedUrl) {
        helipadMetadata.url = album.feedUrl;
        helipadMetadata.feed = album.feedUrl;
      }
      if (album.id) {
        helipadMetadata.feedId = album.id;
      }
      if (album.title) {
        helipadMetadata.album = album.title;
      }
      helipadMetadata.episode_guid = outgoingItemGuid;

      // Use blended + deduped recipients for the full split
      const recipients: ValueRecipient[] = deduped.map(r => ({
        name: r.name,
        type: r.type,
        address: r.address,
        split: r.split,
      }));

      primaryRecipient = recipients[0]?.address;
      resolvedArtistName = artistName;

      console.log(`⚡ Chapter auto-boost: sending to ${recipients.length} recipients (${recipients.map(r => `${r.name}: ${r.split}%`).join(', ')})`);

      const multiResult = await ValueSplitsService.sendMultiRecipientPayment(
        recipients,
        amount,
        sendPayment,
        sendKeysend,
        undefined,
        helipadMetadata,
        undefined,
        undefined,
        supportsKeysend
      );

      const chapterBoostReport = {
        trackId: `${album.id}-ch-${chapterTitle || 'unknown'}`,
        feedId: album.id,
        trackTitle: chapterTitle || trackTitle,
        artistName,
        amount,
        recipient: recipients[0]?.address || 'value-splits',
      };

      if (multiResult.success || multiResult.isPartialSuccess) {
        console.log(`✅ Chapter auto-boost successful: ${amount} sats for "${trackTitle}"`);

        await reportBoost({
          ...chapterBoostReport,
          preimage: multiResult.primaryPreimage,
          status: 'succeeded',
          // isPartialSuccess means some recipients got nothing, and multiResult.errors
          // is replaced by a "Partial success: 2/3" summary at that point — carry it
          // so a partly-paid VTS segment is distinguishable from a fully-paid one.
          failedRecipients: multiResult.failedPayments?.map(payment => ({
            name: payment.recipient.name || payment.recipient.address,
            amount: payment.amount,
            error: payment.result?.error || 'unknown error',
          })),
        });

        toast.success(`Auto-boost: ${amount} sats for ${artistName} ⚡`);
      } else {
        const errors = multiResult.errors.join(', ');
        console.warn(`⚠️ Chapter auto-boost failed: ${errors}`);

        await reportBoost({ ...chapterBoostReport, status: 'failed', error: errors });

        const isKeysendUnsupported = errors.includes('Keysend not supported') ||
          errors.includes("doesn't support keysend") ||
          errors.includes('not implemented');

        if (isKeysendUnsupported) {
          if (!autoBoostKeysendWarningShownRef.current) {
            toast.error("Auto-boost unavailable: wallet doesn't support keysend");
            autoBoostKeysendWarningShownRef.current = true;
          }
        } else {
          toast.error('Auto-boost failed');
        }
      }
    } catch (error) {
      console.error('❌ Chapter auto-boost error:', error);
      await reportBoost({
        trackId: `${album.id}-ch-${chapterTitle || 'unknown'}`,
        feedId: album.id,
        // trackTitle/artistName are declared inside the try, so they are out of scope
        // here; artist and recipient are carried out in the hoisted vars above when
        // the throw happened late enough for them to have been resolved.
        trackTitle: chapterTitle || 'Unknown Track',
        artistName: resolvedArtistName || album.artist || 'Unknown Artist',
        amount,
        recipient: primaryRecipient || 'value-splits',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error('Auto-boost failed');
    } finally {
      autoBoostProcessingRef.current = false;
    }
  }, [isWalletConnected, sendPayment, sendKeysend, supportsKeysend, settings.defaultBoostName]);

  // Store chapter auto-boost function in ref for use in event handlers (handleEnded)
  const triggerChapterAutoBoostRef = useRef(triggerChapterAutoBoost);
  useEffect(() => {
    triggerChapterAutoBoostRef.current = triggerChapterAutoBoost;
  }, [triggerChapterAutoBoost]);

  // Detect VTS segment transitions and trigger chapter auto-boost for the outgoing segment
  useEffect(() => {
    if (!currentPlayingAlbum || currentTrackIndex < 0) {
      prevVtsSegmentRef.current = null;
      prevVtsTrackKeyRef.current = '';
      inVtsGapRef.current = null;
      return;
    }

    const track = currentPlayingAlbum.tracks[currentTrackIndex];
    const splits = track?.valueTimeSplits;
    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      prevVtsSegmentRef.current = null;
      prevVtsTrackKeyRef.current = '';
      inVtsGapRef.current = null;
      return;
    }

    // Reset VTS tracking when the track changes to prevent spurious boosts
    // from stale segment data left over from the previous track/episode
    const trackKey = `${currentPlayingAlbum.id || ''}-${currentTrackIndex}`;
    if (trackKey !== prevVtsTrackKeyRef.current) {
      prevVtsSegmentRef.current = null;
      prevVtsTrackKeyRef.current = trackKey;
      // If playback starts before the first VTS segment, mark as initial gap
      // so the pre-music chapter (e.g., Intro) gets boosted when the first segment begins
      if (splits.length > 0 && currentTime < splits[0].startTime) {
        inVtsGapRef.current = { enteredAt: currentTime };
      } else {
        inVtsGapRef.current = null;
      }
    }

    // Find active VTS segment based on current playback position (track ALL segments, not just those with remoteItem)
    let activeSegment: { index: number; feedGuid?: string; itemGuid?: string; remotePercentage: number } | null = null;
    for (let i = splits.length - 1; i >= 0; i--) {
      const s = splits[i];
      if (currentTime >= s.startTime && currentTime < s.startTime + s.duration) {
        activeSegment = {
          index: i,
          feedGuid: s.remoteItem?.feedGuid,
          itemGuid: s.remoteItem?.itemGuid,
          remotePercentage: s.remotePercentage ?? 100
        };
        break;
      }
    }

    const prev = prevVtsSegmentRef.current;

    // Suppress autoboost on manual seeks (chapter skip, progress bar, etc.)
    // but still update tracking refs so the next natural transition works correctly
    const isManualSeek = isManualSeekRef.current;
    if (isManualSeek) {
      isManualSeekRef.current = false;
    }

    // Detect segment change by index (covers both song and non-song chapters)
    if (prev && activeSegment && prev.index !== activeSegment.index) {
      if (!isManualSeek) {
        const { enabled, amount } = autoBoostSettingsRef.current;
        if (enabled) {
          const prevSplit = splits[prev.index];
          const outgoingChapterTitle = chapters.find(ch => {
            const chEnd = ch.endTime ?? Infinity;
            return prevSplit && prevSplit.startTime >= ch.startTime && prevSplit.startTime < chEnd;
          })?.title;

          // Fire and forget — don't block playback
          triggerChapterAutoBoost(
            prev.feedGuid || '', prev.itemGuid || '',
            currentPlayingAlbum, amount || 50, prev.remotePercentage, outgoingChapterTitle
          );
        }
      }
    }

    // Detect when playback exits a VTS segment into a gap (between segments or past the last one).
    // Boost the outgoing music segment and mark that we're in a gap.
    if (!activeSegment && prev) {
      const prevSplit = splits[prev.index];
      const prevSplitEnd = prevSplit.startTime + prevSplit.duration;
      if (currentTime >= prevSplitEnd) {
        if (!isManualSeek) {
          const { enabled, amount } = autoBoostSettingsRef.current;
          if (enabled) {
            const outgoingChapterTitle = chapters.find(ch => {
              const chEnd = ch.endTime ?? Infinity;
              return prevSplit && prevSplit.startTime >= ch.startTime && prevSplit.startTime < chEnd;
            })?.title;

            triggerChapterAutoBoost(
              prev.feedGuid || '', prev.itemGuid || '',
              currentPlayingAlbum, amount || 50, prev.remotePercentage, outgoingChapterTitle
            );
          }
        }
        // Always update tracking refs regardless of manual seek
        prevVtsSegmentRef.current = null;
        inVtsGapRef.current = { enteredAt: currentTime };
      }
    }

    // Detect when playback re-enters a VTS segment from a gap — boost the outgoing talk chapter
    if (activeSegment && !prev && inVtsGapRef.current) {
      if (!isManualSeek) {
        const { enabled, amount } = autoBoostSettingsRef.current;
        if (enabled) {
          const gapTime = inVtsGapRef.current.enteredAt;
          const outgoingChapterTitle = chapters.find(ch => {
            const chEnd = ch.endTime ?? Infinity;
            return gapTime >= ch.startTime && gapTime < chEnd;
          })?.title;

          // Talk chapters have no remoteItem — send 100% to show host
          triggerChapterAutoBoost(
            '', '', currentPlayingAlbum, amount || 50, 0, outgoingChapterTitle
          );
        }
      }
      inVtsGapRef.current = null;
    }

    // Clear gap tracking when entering a segment (not from a gap)
    if (activeSegment && prev) {
      inVtsGapRef.current = null;
    }

    // Only update prev ref when we have a valid segment — don't clear it during
    // gaps between segments
    if (activeSegment) {
      prevVtsSegmentRef.current = activeSegment;
    }
  }, [currentTime, currentPlayingAlbum, currentTrackIndex, chapters, triggerChapterAutoBoost]);

  // Foreground resume: detect missed VTS chapter transitions while backgrounded.
  // iOS throttles JS when backgrounded, so currentTime updates stop and chapter
  // transitions are missed. On return to foreground, find all skipped segments
  // between the last known position and current playback position, and boost each.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityForChapterBoost = () => {
      if (document.visibilityState !== 'visible') return;

      const { enabled, amount } = autoBoostSettingsRef.current;
      if (!enabled) return;
      if (!currentPlayingAlbum || currentTrackIndex < 0) return;

      const track = currentPlayingAlbum.tracks[currentTrackIndex];
      const splits = track?.valueTimeSplits;
      if (!splits || !Array.isArray(splits) || splits.length === 0) return;

      const prev = prevVtsSegmentRef.current;
      if (!prev) return;

      // Get actual current playback time from the audio/video element
      const audio = getActiveAudioEl();
      const video = videoRef.current;
      const currentElement = (video && !video.paused && !video.ended) ? video : audio;
      if (!currentElement) return;
      const now = currentElement.currentTime;

      // Use index-based tracking to find missed segments
      const prevIdx = prev.index;
      // Find current active segment
      let currentIdx = -1;
      for (let i = splits.length - 1; i >= 0; i--) {
        const s = splits[i];
        if (now >= s.startTime && now < s.startTime + s.duration) {
          currentIdx = i;
          break;
        }
      }

      // If currentIdx < 0, playback may have moved past all VTS segments while backgrounded
      // In that case, boost all segments from prev to the end (inclusive)
      const lastSplit = splits[splits.length - 1];
      const lastSplitEnd = lastSplit.startTime + lastSplit.duration;
      const pastAllSegments = currentIdx < 0 && now >= lastSplitEnd;

      if (!pastAllSegments && (currentIdx < 0 || currentIdx <= prevIdx)) return;

      // Collect all segments between prev (inclusive) and current (exclusive),
      // or all remaining segments if we're past the end
      const endIdx = pastAllSegments ? splits.length : currentIdx;
      const missedSegments = splits.slice(prevIdx, endIdx);

      if (missedSegments.length === 0) return;

      console.log(`📱 Foreground resume: ${missedSegments.length} missed chapter auto-boost(s)${pastAllSegments ? ' (past all segments)' : ''}`);

      // Boost each missed segment sequentially (fire and forget)
      const boostMissed = async () => {
        for (const segment of missedSegments) {
          const chapterTitle = chapters.find(ch => {
            const chEnd = ch.endTime ?? Infinity;
            return segment.startTime >= ch.startTime && segment.startTime < chEnd;
          })?.title;

          await triggerChapterAutoBoost(
            segment.remoteItem?.feedGuid || '',
            segment.remoteItem?.itemGuid || '',
            currentPlayingAlbum,
            amount || 50,
            segment.remotePercentage ?? 100,
            chapterTitle
          );
        }
      };
      boostMissed();

      if (pastAllSegments) {
        // Clear prev so the normal VTS effect doesn't re-trigger
        prevVtsSegmentRef.current = null;
      } else {
        // Update the prev ref to the current segment so the normal effect doesn't double-boost
        const currentSplit = splits[currentIdx];
        prevVtsSegmentRef.current = {
          index: currentIdx,
          feedGuid: currentSplit?.remoteItem?.feedGuid,
          itemGuid: currentSplit?.remoteItem?.itemGuid,
          remotePercentage: currentSplit?.remotePercentage ?? 100
        };
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityForChapterBoost);
    window.addEventListener('pageshow', handleVisibilityForChapterBoost);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityForChapterBoost);
      window.removeEventListener('pageshow', handleVisibilityForChapterBoost);
    };
  }, [currentPlayingAlbum, currentTrackIndex, chapters, triggerChapterAutoBoost]);

  // Detect iOS devices - Web Audio interferes with background playback on iOS
  const isIOSDevice = useCallback(() => {
    if (typeof navigator === 'undefined') return false;
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad on iOS 13+
  }, []);

  // Set iOS state on mount for JSX conditional rendering
  useEffect(() => {
    setIsIOS(isIOSDevice());
  }, [isIOSDevice]);

  // Detect Android (excluding anything that also matches iOS). Android's
  // background-media autoplay policy drops play() after a load()+play() on the
  // same element while the screen is locked — the ping-pong path below starts
  // the next track on a second, already-loaded element to avoid that.
  const isAndroidDevice = useCallback(() => {
    if (typeof navigator === 'undefined') return false;
    return /Android/i.test(navigator.userAgent) &&
           !/iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  // Set Android state (JSX) + ref (handlers/timers) on mount
  useEffect(() => {
    const android = isAndroidDevice();
    setIsAndroid(android);
    isAndroidRef.current = android;
  }, [isAndroidDevice]);

  // One-time Android battery-optimization hint: on the first time playback
  // starts, if this is an Android browser (not the native app) that hasn't
  // dismissed the hint, dispatch the event that opens AndroidBatteryHintModal.
  // Fires at most once per session; localStorage makes it once-ever. Never
  // throws into the audio pipeline.
  const androidHintDispatchedRef = useRef(false);
  useEffect(() => {
    if (!isPlaying || androidHintDispatchedRef.current) return;
    androidHintDispatchedRef.current = true;
    try {
      const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
      const dismissed = localStorage.getItem(ANDROID_BATTERY_HINT_DISMISSED_KEY) === '1';
      if (shouldShowAndroidBatteryHint({ isAndroid: isAndroidDevice(), isNative, dismissed })) {
        window.dispatchEvent(new CustomEvent('android-battery-hint'));
      }
    } catch {
      // swallow — must never break playback
    }
  }, [isPlaying, isAndroidDevice]);

  // Active/idle audio element indirection for the Android ping-pong path.
  // getActiveAudioEl() is the current playback element (defaults to audioRef);
  // getIdleAudioEl() is the other of the two audio elements. On iOS/desktop
  // activeAudioRef is never repointed, so getActiveAudioEl() === audioRef.current.
  const getActiveAudioEl = useCallback((): HTMLAudioElement | null => {
    return activeAudioRef.current ?? audioRef.current;
  }, []);
  const getIdleAudioEl = useCallback((): HTMLAudioElement | null => {
    const active = activeAudioRef.current ?? audioRef.current;
    return active === audioRefB.current ? audioRef.current : audioRefB.current;
  }, []);


  // "Resume where you left off" — restore the last session on mount.
  //
  // We restore the album/playlist and track index so the now-playing bar comes
  // back, plus the saved position so it reads e.g. "3:12 / 5:40". Playback does
  // NOT start: `isPlaying` is deliberately never restored, because browsers
  // block audio without a user gesture on a fresh page load, so an auto-play
  // attempt would fail and leave the UI claiming to play silence. The first tap
  // of play goes through resume()'s cold-start branch, which loads the track and
  // seeks to the restored position.
  //
  // Shuffle is deliberately NOT persisted or restored. The old record stored the
  // shuffled playlist as bare titles, which can never be rehydrated into
  // playable tracks — restoring `isShuffleMode: true` alongside an empty
  // playlist made playNextTrack quietly fall through to album order while the
  // shuffle icon showed "on". playAlbum force-clears shuffle anyway, so the
  // first tap always ended a restored shuffle session regardless. A restored
  // session resumes in album order.
  useEffect(() => {
    // The /radio route mounts its own AudioProvider; a radio session should
    // neither overwrite nor inherit the main app's resume point.
    if (typeof window === 'undefined' || radioMode) return;

    let cancelled = false;

    const dropSession = () => {
      storage.removeItem(PLAYBACK_STATE_KEY);
      storage.removeItem(PLAYBACK_POSITION_KEY);
    };

    (async () => {
      try {
        const savedState = await storage.getItem(PLAYBACK_STATE_KEY);
        if (!savedState || cancelled) return;

        const state = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;

        // Version gate — invalidates every older-shaped record for free.
        if (state.version !== AUDIO_STATE_VERSION) {
          console.log(`🔄 Playback session version mismatch (${state.version} !== ${AUDIO_STATE_VERSION}), clearing`);
          dropSession();
          return;
        }

        if (!isSessionFresh({ timestamp: state.timestamp, now: Date.now() })) {
          console.log('🔄 Playback session too old to restore, clearing');
          dropSession();
          return;
        }

        const album = rehydrateAlbum(state.album);
        if (!album) {
          console.log('🔄 Saved playback session has no playable track, clearing');
          dropSession();
          return;
        }

        const trackIndex = Math.max(
          0,
          Math.min(state.currentTrackIndex || 0, album.tracks.length - 1)
        );

        // Read the position BEFORE touching state. Setting the album first would
        // publish a render in which the album is restored but currentTimeRef is
        // still 0 — and the position-save effect, which fires on exactly that
        // change, would write that 0 straight over the saved position. The
        // symptom is nasty: the session resumes correctly once, then loses its
        // position on the next reload.
        let position: number | null = null;
        let savedDuration = 0;
        const savedPosition = await storage.getItem(PLAYBACK_POSITION_KEY);
        if (savedPosition) {
          const pos = typeof savedPosition === 'string' ? JSON.parse(savedPosition) : savedPosition;
          // Only apply a position that belongs to this exact album and track.
          if (pos.albumKey === albumSessionKey(album) && pos.trackIndex === trackIndex) {
            position = typeof pos.position === 'number' ? pos.position : 0;
            savedDuration = typeof pos.duration === 'number' ? pos.duration : 0;
          }
        }

        if (cancelled) return;
        // If the user already started something while we were reading storage,
        // their choice wins — never yank playback back to the old session.
        if (currentPlayingAlbumRef.current) return;

        if (position !== null) {
          // Refs first, so no render can observe the album without the position:
          // currentTimeRef is what the position-save path reads, and
          // lastNonZeroPositionRef is resume()'s iOS buffer-eviction anchor.
          currentTimeRef.current = position;
          lastNonZeroPositionRef.current = position;
          setCurrentTime(position);
          setDuration(savedDuration);
        }

        setCurrentPlayingAlbum(album);
        setCurrentTrackIndex(trackIndex);

        if (process.env.NODE_ENV === 'development') {
          console.log('🔄 Restored playback session:', {
            album: album.title,
            track: album.tracks[trackIndex]?.title,
            trackIndex,
          });
        }
      } catch (error) {
        console.warn('Failed to restore playback session:', error);
      }
    })();

    return () => { cancelled = true; };
  }, [radioMode]);

  // Add user interaction handler to enable audio playback
  useEffect(() => {
    // Check if we're on mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      console.log('📱 Mobile device detected - audio will play on first track click');
    }

    // No need for generic interaction handlers - playAlbum will handle it
    return () => {};
  }, []); // Run only once on mount

  // Initialize Media Session API early for iOS 26 lockscreen controls
  useEffect(() => {
    if ('mediaSession' in navigator && navigator.mediaSession && !isNativeAndroid()) {
      try {
        // Register action handlers immediately on mount (before any playback)
        // This is required for iOS 26 PWA mode to recognize media capabilities
        // Using refs with DOM fallback for iOS background reliability
        navigator.mediaSession.setActionHandler('play', () => {
          console.log('📱 Media session: Play action received');
          if (resumeRef.current) {
            resumeRef.current();
          }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          console.log('📱 Media session: Pause action received');
          if (pauseRef.current) {
            pauseRef.current();
          }
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          console.log('📱 Media session: Previous track from early init');
          if (playPreviousTrackRef.current) {
            playPreviousTrackRef.current();
          }
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          console.log('📱 Media session: Next track from early init');
          if (playNextTrackRef.current) {
            playNextTrackRef.current();
          }
        });

        // Explicitly disable seek handlers - we only support track navigation
        // This prevents iOS from showing skip forward/back buttons
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime != null) {
            // Use the active audio element (may be the ping-pong B element on Android)
            const el = getActiveAudioEl();
            if (el) {
              el.currentTime = details.seekTime;
            }
          }
        });

        // Set initial playback state to 'none' - will be updated when playback starts
        navigator.mediaSession.playbackState = 'none';

        console.log('📱 Media Session initialized on mount for iOS 26');
      } catch (error) {
        console.warn('Failed to initialize Media Session early:', error);
      }
    }
  }, []); // Run only once on mount

  // Native Android lock-screen controls: route MediaSession button presses back
  // into the app's existing playback functions. iOS/PWA use navigator.mediaSession.
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const plugin = (window as any).Capacitor?.Plugins?.PlaybackKeepAlive;
    if (!plugin?.addListener) return;
    let handle: any;
    Promise.resolve(
      plugin.addListener('mediaSessionAction', (ev: { action: string; seekTo?: number }) => {
        switch (ev.action) {
          case 'play': resumeRef.current?.(); break;
          case 'pause': pauseRef.current?.(); break;
          case 'next': playNextTrackRef.current?.(); break;
          case 'previous': playPreviousTrackRef.current?.(); break;
          case 'seekto': {
            const el = getActiveAudioEl();
            if (el && ev.seekTo != null) el.currentTime = ev.seekTo / 1000; // ms → s
            break;
          }
        }
      })
    ).then((h) => { handle = h; }).catch(() => {});
    return () => { try { handle?.remove?.(); } catch {} };
  }, []);

  // Sync playbackState with isPlaying — single source of truth for lock screen controls
  useEffect(() => {
    if ('mediaSession' in navigator && !isNativeAndroid()) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
    // Only drive the native Android lock-screen session once playback has
    // actually started (an album/track is loaded). Without this guard the
    // mount-time isPlaying=false push would cold-start the foreground service
    // and post an empty notification before the user plays anything. Once a
    // track is loaded this still fires on pause, so the paused notification
    // (Play button) persists as intended.
    if (currentPlayingAlbum) {
      const el = getActiveAudioEl();
      const position = el && !isNaN(el.currentTime) ? Math.round(el.currentTime * 1000) : 0;
      nativeMedia('setPlaybackState', { isPlaying, position });
    }
  }, [isPlaying]);

  // iOS background track advancement safety net:
  // When returning to foreground, check if the track ended while backgrounded
  // and the ended/timer handlers didn't successfully advance to the next track
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityForTrackAdvance = () => {
      if (document.visibilityState !== 'visible') return;

      // Check both audio and video elements
      const audio = getActiveAudioEl();
      const video = videoRef.current;
      const currentElement = (video && !video.paused && !video.ended) ? video : audio;
      if (!currentElement) return;

      // albumCompleteRef: a finished album is not a failed background advance. The
      // index has already been rewound to track 1, so advancing from here would start
      // TRACK 2 unprompted on every foreground return. A successful cue also clears
      // `ended` on its own; this ref covers the paths where the cue leaves the
      // element empty (offline, video, a load that throws).
      if (currentElement.ended && !albumCompleteRef.current) {
        // Background advance failed — the track ended but nothing new started.
        // Trigger advancement now.
        console.log('📱 Track ended while backgrounded — advancing on foreground return');
        trackEndProcessedRef.current = false;
        if (playNextTrackRef.current) {
          playNextTrackRef.current();
        }
      } else if (currentElement.paused && currentElement.src && !userInitiatedPauseRef.current) {
        // Audio is paused but the user didn't press pause — iOS interrupted playback
        // (another app stole the audio session) or a background track transition loaded
        // the next track but play() was blocked. Resume now that we're in the foreground.
        //
        // The `currentElement.src` check is LOAD-BEARING, not a nicety: after a
        // restored session the album is in state but nothing is loaded, and
        // userInitiatedPauseRef defaults to false — so src is the only thing
        // stopping this handler from auto-resuming a restored session the first
        // time the tab regains focus. Removing it reintroduces autoplay.
        console.log('📱 Audio paused by iOS interruption — resuming on foreground return');
        if (resumeRef.current) {
          resumeRef.current();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityForTrackAdvance);
    // Also listen for pageshow (iOS Safari fires this on PWA reactivation)
    window.addEventListener('pageshow', handleVisibilityForTrackAdvance);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityForTrackAdvance);
      window.removeEventListener('pageshow', handleVisibilityForTrackAdvance);
    };
  }, []);

  // --- "Resume where you left off" — the two save paths --------------------
  //
  // Identity and position are stored in SEPARATE records on purpose. They used
  // to share one, whose effect had `currentTime` in its deps — so the entire
  // album (every track, with V4V payloads) was re-serialized and rewritten to
  // IndexedDB on every timeupdate, roughly four times a second. The 100ms
  // debounce did nothing against a 250ms tick. Splitting them means the big
  // payload is written only when the track actually changes.

  // 1. Identity — which album/playlist, which track. Rarely changes.
  useEffect(() => {
    if (typeof window === 'undefined' || radioMode || !currentPlayingAlbum) return;

    const timeoutId = setTimeout(async () => {
      try {
        await storage.setItem(PLAYBACK_STATE_KEY, {
          version: AUDIO_STATE_VERSION,
          album: serializeAlbumForPersistence(currentPlayingAlbum, currentTrackIndex),
          currentTrackIndex,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.warn('Failed to save playback session:', error);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [currentPlayingAlbum, currentTrackIndex, radioMode]);

  // 2. Position — small, written on a throttle. A throttle rather than a
  // debounce: during continuous playback timeupdate never goes quiet, so a
  // debounce would only ever fire after playback stopped.
  const savePosition = useCallback(async (options?: { force?: boolean }) => {
    if (typeof window === 'undefined' || radioMode || !currentPlayingAlbum) return;
    // A resume seek is in flight: the element is loading and its clock still
    // reads ~0, so an incidental timeupdate-driven save would overwrite the very
    // position we're about to seek to. handleLoadedMetadata clears the ref once
    // it lands.
    //
    // Two escape hatches, both load-bearing:
    //  - `force` is for an explicit, user-intended write (scrubbing a restored
    //    bar). Without it, the second and later scrubs were silently dropped,
    //    because the first scrub leaves the ref armed.
    //  - the staleness bound releases a ref that never got consumed — e.g. the
    //    user scrubbed and walked away without pressing play — which otherwise
    //    disabled position saving for the rest of the session.
    const pending = pendingResumeSeekRef.current;
    const pendingIsFresh = !!pending && Date.now() - pending.setAt < PENDING_RESUME_BLOCKS_SAVE_MS;
    if (!options?.force && pendingIsFresh) return;
    try {
      lastPositionWriteRef.current = Date.now();
      await storage.setItem(PLAYBACK_POSITION_KEY, {
        albumKey: albumSessionKey(currentPlayingAlbum),
        trackIndex: currentTrackIndex,
        position: currentTimeRef.current,
        duration,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.warn('Failed to save playback position:', error);
    }
  }, [currentPlayingAlbum, currentTrackIndex, duration, radioMode]);

  const savePositionRef = useRef(savePosition);
  useEffect(() => { savePositionRef.current = savePosition; });
  useEffect(() => { currentPlayingAlbumRef.current = currentPlayingAlbum; });
  useEffect(() => { albumsRef.current = albums; }, [albums]);

  useEffect(() => {
    if (typeof window === 'undefined' || radioMode || !currentPlayingAlbum) return;
    if (Date.now() - lastPositionWriteRef.current < POSITION_SAVE_THROTTLE_MS) return;
    savePosition();
  }, [currentTime, duration, currentPlayingAlbum, radioMode, savePosition]);

  // Flush immediately when the app is backgrounded or closed — that's the exact
  // moment the user "leaves", and it's what keeps the throttle's worst-case loss
  // from ever being what they actually see on return. `visibilitychange` is the
  // reliable mobile signal; `pagehide` racing an async IndexedDB write is not.
  useEffect(() => {
    if (typeof window === 'undefined' || radioMode) return;

    const flushOnHide = () => {
      if (document.visibilityState === 'hidden') {
        savePositionRef.current?.();
      }
    };

    document.addEventListener('visibilitychange', flushOnHide);
    return () => document.removeEventListener('visibilitychange', flushOnHide);
  }, [radioMode]);

  // Load albums data for playback - with retry logic for cold starts
  useEffect(() => {
    const loadAlbums = async (retryCount = 0): Promise<void> => {
      // Prevent multiple loads if already loaded successfully
      if (albumsLoadedRef.current) {
        return;
      }

      // Small delay on first attempt to allow setInitialAlbums from server-side fetch to run first
      if (retryCount === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        // Check again after delay in case setInitialAlbums ran
        if (albumsLoadedRef.current) {
          return;
        }
      }

      const maxRetries = 5;
      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const retryDelay = Math.min(2000 * Math.pow(2, retryCount), 32000);

      try {
        // Create AbortController for timeout handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch('/api/albums?limit=0', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        if (response.ok) {
          // Check if response is valid JSON
          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            console.warn('⚠️ Albums API returned non-JSON response:', contentType);
            return;
          }
          
          const data = await response.json();
          if (data && Array.isArray(data.albums)) {
            setAlbums(data.albums);
            albumsRef.current = data.albums; // readable before React re-renders
            albumsLoadedRef.current = true; // Only mark as loaded after success
            // Only log in development mode
            if (process.env.NODE_ENV === 'development') {
              console.log(`✅ Loaded ${data.albums.length} albums for audio context`);

              // Debug: Check if Delta OG album has V4V data
              const deltaOGAlbum = data.albums.find((album: any) => album.title?.includes('Aged Friends'));
              if (deltaOGAlbum) {
                const deltaOGTrack = deltaOGAlbum.tracks?.[0];
                console.log('🔍 AudioContext Delta OG track debug:', {
                  albumTitle: deltaOGAlbum.title,
                  trackTitle: deltaOGTrack?.title,
                  trackKeys: deltaOGTrack ? Object.keys(deltaOGTrack) : [],
                  hasV4vRecipient: !!deltaOGTrack?.v4vRecipient,
                  hasV4vValue: !!deltaOGTrack?.v4vValue,
                  v4vRecipient: deltaOGTrack?.v4vRecipient,
                  v4vValue: deltaOGTrack?.v4vValue
                });
              }
            }
          } else {
            console.warn('⚠️ Albums API returned invalid data structure:', data);
          }
        } else {
          console.warn(`⚠️ Albums API returned ${response.status}: ${response.statusText}`);
          // Retry on non-ok response
          if (retryCount < maxRetries - 1) {
            console.log(`⏳ Retrying album load in ${retryDelay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return loadAlbums(retryCount + 1);
          }
        }
      } catch (error) {
        console.warn(`Failed to load albums (attempt ${retryCount + 1}/${maxRetries}):`, error);

        // Retry on failure if under max retries
        if (retryCount < maxRetries - 1) {
          console.log(`⏳ Retrying album load in ${retryDelay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return loadAlbums(retryCount + 1);
        }
        // Don't throw - allow the app to continue without albums
      }
    };

    loadAlbumsRef.current = loadAlbums;

    /**
     * Data Saver does not pull the whole catalogue on mount.
     *
     * This request is `/api/albums?limit=0` — every column of every track of up
     * to 500 feeds, with no per-feed cap, no server cache and no gzip — and
     * AudioProvider wraps the root layout, so it runs on EVERY page. The only
     * thing that consumes it is the shuffle pool, which most sessions never
     * touch. `shuffleAllTracks` now starts it on demand instead.
     */
    if (isDataSaverOn()) {
      return;
    }

    loadAlbums(0);
  }, []); // Run only once on mount

  // Helper function to detect if URL is a video
  const isVideoUrl = (url: string, mediaType?: string): boolean => {
    if (!url || typeof url !== 'string') return false;
    // If mediaType explicitly says video, trust it
    if (mediaType === 'video') return true;
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.m3u8', '.m4v', '.mov', '.avi', '.mkv', '.moov'];
    const urlLower = url.toLowerCase();
    return videoExtensions.some(ext => urlLower.includes(ext));
  };

  // Helper function to get the best playback URL from a track
  // Prefers video URL from alternateEnclosures when mediaType is 'video'
  const getTrackPlaybackUrl = (track: any): string => {
    console.log('🔍 getTrackPlaybackUrl called with track:', {
      title: track?.title,
      mediaType: track?.mediaType,
      hasAlternateEnclosures: !!track?.alternateEnclosures,
      alternateEnclosuresLength: track?.alternateEnclosures?.length,
      url: track?.url
    });

    // If track has video alternateEnclosures, prefer the video URL
    if (track?.mediaType === 'video' && track?.alternateEnclosures?.length > 0) {
      const videoEnclosure = track.alternateEnclosures.find((enc: any) =>
        enc.url && (enc.type?.includes('video') || enc.type === 'mp4' || enc.type === 'webm')
      );
      if (videoEnclosure?.url) {
        console.log('🎬 Using video URL from alternateEnclosures:', videoEnclosure.url);
        return videoEnclosure.url;
      }
    }
    // Fallback to regular audio URL
    console.log('🔊 Using audio URL:', track?.url);
    return track?.url || '';
  };

  // Helper function to detect if URL is an HLS stream
  const isHlsUrl = (url: string): boolean => {
    return Boolean(url && typeof url === 'string' && url.toLowerCase().includes('.m3u8'));
  };

  // Helper function to get URLs to try for audio/video playback
  const getAudioUrlsToTry = (originalUrl: string): string[] => {
    const urlsToTry = [];

    console.log('🔍 [URL Strategy] Processing URL:', originalUrl);

    if (!originalUrl || typeof originalUrl !== 'string') {
      console.warn('⚠️ Invalid audio URL provided:', originalUrl);
      return [];
    }

    // OFFLINE DOWNLOADS: if this track was downloaded and its blob is prepared,
    // try the local copy first. The network candidates still follow, so a bad/
    // evicted blob falls back automatically (every attempt path iterates this).
    const local = activeLocalSrcRef.current;
    if (local && local.key === primaryPlaybackKey(originalUrl)) {
      console.log('📥 [URL Strategy] Using downloaded local copy first');
      urlsToTry.push(local.objectUrl);
    }

    // Sanitize URL: encode spaces that aren't already encoded
    // Many RSS feeds have unencoded spaces in URLs which break playback
    let sanitizedUrl = originalUrl;
    if (originalUrl.includes(' ') && !originalUrl.includes('%20')) {
      sanitizedUrl = originalUrl.replace(/ /g, '%20');
      console.log('🔧 [URL Strategy] Encoded spaces in URL');
    }

    try {
      // Extract direct URL from op3.dev analytics wrapper FIRST (before HLS check)
      // This ensures HLS streams wrapped in op3.dev are handled correctly
      let effectiveUrl = sanitizedUrl;
      if (sanitizedUrl.includes('op3.dev/e/') && sanitizedUrl.includes('/https://')) {
        const directUrl = sanitizedUrl.split('/https://')[1];
        if (directUrl) {
          effectiveUrl = `https://${directUrl}`;
          console.log('🔗 [URL Strategy] Extracted direct URL from op3.dev:', effectiveUrl);
        }
      }

      const url = new URL(effectiveUrl);
      const isExternal = url.hostname !== window.location.hostname;
      const isHls = isHlsUrl(effectiveUrl);

      console.log(`🔍 [URL Strategy] Parsed - hostname: ${url.hostname}, isExternal: ${isExternal}, isHls: ${isHls}`);

      // Special handling for HLS streams
      if (isHls) {
        // Cloudflare Stream has CORS enabled and uses relative URLs in manifests,
        // so we MUST use direct URL (proxy breaks relative segment resolution)
        const isCloudflareStream = url.hostname.includes('cloudflarestream.com');
        if (isCloudflareStream) {
          console.log('📺 [URL Strategy] Cloudflare Stream HLS - using direct URL (has CORS)');
          urlsToTry.push(effectiveUrl);
        } else {
          // For other HLS streams, try proxy first, then direct
          console.log('📺 [URL Strategy] HLS stream detected - using proxy + direct fallback');
          urlsToTry.push(`/api/proxy-video?url=${encodeURIComponent(effectiveUrl)}`);
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(effectiveUrl)}`);
          urlsToTry.push(effectiveUrl);
        }
        console.log('📋 [URL Strategy] Final URLs to try:', urlsToTry.length, 'URLs');
        return urlsToTry;
      }

      // Special handling for op3.dev analytics URLs - extract direct URL (for non-HLS)
      if (sanitizedUrl.includes('op3.dev/e/') && sanitizedUrl.includes('/https://')) {
        console.log('🔗 [URL Strategy] op3.dev analytics URL detected');
        const directUrl = sanitizedUrl.split('/https://')[1];
        if (directUrl) {
          const fullDirectUrl = `https://${directUrl}`;
          console.log('🔗 Extracted direct URL from op3.dev:', fullDirectUrl);
          // Try direct URL first for better reliability
          urlsToTry.push(fullDirectUrl);
          // Then try proxy with direct URL
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(fullDirectUrl)}`);
          // Fallback to original op3 URL with proxy
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(sanitizedUrl)}`);
          // Last resort: original op3 URL direct
          urlsToTry.push(sanitizedUrl);
        } else {
          // If extraction fails, use normal logic
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(sanitizedUrl)}`);
          urlsToTry.push(sanitizedUrl);
        }
      } else if (isExternal) {
        // Normalize hostname for case-insensitive matching
        const hostname = url.hostname.toLowerCase();

        // The domain lists live in lib/audio-url-utils.ts so the download path
        // makes the SAME proxy decision. They used to be duplicated here with a
        // "keep in sync" comment; they drifted by two entries, and because
        // downloads had no fallback the drift surfaced as albums that streamed
        // fine and refused to download. Don't re-inline them.
        const isDirectFirst = isDirectFirstHost(hostname);

        // isCorsProblematicHost folds in the explicit CloudFront subdomain check.
        const isDomainProblematic = isCorsProblematicHost(hostname);
        const isCloudFront = hostname.endsWith('.cloudfront.net') || hostname === 'cloudfront.net';

        console.log(`🔍 [URL Strategy] Domain check - hostname: ${hostname}, problematic: ${isDomainProblematic}, isCloudFront: ${isCloudFront}, directFirst: ${isDirectFirst}`);

        if (isDomainProblematic || isCloudFront) {
          // For known CORS-problematic domains, use proxy first and skip direct URL
          console.log(`🚫 [URL Strategy] CORS-problematic domain detected (${hostname}) - PROXY ONLY`);
          monitoring.info('audio-playback', `CORS-problematic domain detected: ${hostname}`, { sanitizedUrl });
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(sanitizedUrl)}`);
        } else if (isDirectFirst) {
          // For domains known to work directly, try direct first for faster playback
          console.log(`⚡ [URL Strategy] Direct-first domain (${hostname}) - direct then proxy fallback`);
          urlsToTry.push(sanitizedUrl);
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(sanitizedUrl)}`);
        } else {
          console.log(`✅ [URL Strategy] External domain OK (${hostname}) - proxy first, then direct fallback`);
          // For other external URLs, try proxy first then direct as fallback
          urlsToTry.push(`/api/proxy-audio?url=${encodeURIComponent(sanitizedUrl)}`);
          urlsToTry.push(sanitizedUrl);
        }
      } else {
        console.log('🏠 [URL Strategy] Local URL - direct only');
        // For local URLs, try direct first
        urlsToTry.push(sanitizedUrl);
      }
    } catch (urlError) {
      console.warn('⚠️ Could not parse audio URL, using as-is:', sanitizedUrl, urlError);
      urlsToTry.push(sanitizedUrl);
    }

    console.log(`📋 [URL Strategy] Final strategy: ${urlsToTry.length} URL(s) to try:`, urlsToTry.map((u, i) =>
      `\n  ${i + 1}. ${u.includes('proxy-audio') ? '🔄 PROXY' : '📡 DIRECT'}: ${u.substring(0, 100)}${u.length > 100 ? '...' : ''}`
    ).join(''));

    return urlsToTry;
  };

  // Revoke the current downloaded-track object URL, if any.
  const revokeActiveLocalSrc = () => {
    if (activeLocalSrcRef.current) {
      try {
        URL.revokeObjectURL(activeLocalSrcRef.current.objectUrl);
      } catch {
        /* ignore */
      }
      activeLocalSrcRef.current = null;
    }
  };

  // OFFLINE DOWNLOADS: prepare a local blob source for `track` if it was
  // downloaded, so the next getAudioUrlsToTry call plays it from storage. Clears
  // the ref for non-downloaded tracks. Self-heals if the bytes were evicted.
  const prepareLocalSource = async (track: { url?: string } | null | undefined): Promise<void> => {
    const key = primaryPlaybackKey(track?.url);
    // Already prepared for this exact track — reuse.
    if (activeLocalSrcRef.current?.key === key) return;

    if (!key || !downloadManager.isDownloaded(key)) {
      revokeActiveLocalSrc();
      return;
    }

    try {
      const objectUrl = await getDownloadObjectUrl(key);
      if (!objectUrl) {
        // Bytes gone (e.g. iOS eviction) — forget the record and stream instead.
        await downloadManager.forgetEvicted(key);
        revokeActiveLocalSrc();
        return;
      }
      revokeActiveLocalSrc();
      activeLocalSrcRef.current = { key, objectUrl };
      console.log('📥 Prepared downloaded copy for playback:', key.slice(-60));
    } catch (err) {
      console.warn('Could not prepare downloaded copy, will stream:', err);
      revokeActiveLocalSrc();
    }
  };

  // Helper function to attempt HLS playback
  const attemptHlsPlayback = async (hlsUrl: string, context = 'HLS playback'): Promise<boolean> => {
    const videoElement = videoRef.current;

    if (!videoElement) {
      console.error('❌ Video element reference is null for HLS playback');
      return false;
    }

    // Set flag to prevent useEffect cleanup from destroying HLS during initialization
    isInitializingHlsRef.current = true;

    // Get URLs to try including proxied versions
    const urlsToTry = getAudioUrlsToTry(hlsUrl);
    console.log(`🔄 ${context}: Trying ${urlsToTry.length} HLS URLs`);

    for (let i = 0; i < urlsToTry.length; i++) {
      const currentUrl = urlsToTry[i];
      console.log(`🔄 ${context} attempt ${i + 1}/${urlsToTry.length}: ${typeof currentUrl === 'string' && currentUrl.includes('proxy-audio') ? 'Proxied HLS URL' : 'Direct HLS URL'}`);

      try {
        // Clean up any existing HLS instance
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }

        // Dynamically import hls.js only when needed (saves ~150KB from initial bundle)
        const { default: Hls } = await import('hls.js');

        if (Hls.isSupported()) {
          // Use hls.js for browsers that support it
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            // No xhrSetup needed - Cloudflare Stream has proper CORS headers
          });

          hlsRef.current = hls;

          // Clear any existing src to avoid conflicts
          videoElement.src = '';
          videoElement.load();

          // Set up event listeners
          const manifestParsed = new Promise<boolean>((resolve) => {
            let hasResolved = false;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              console.log('✅ HLS manifest parsed successfully');
              // Don't try to play immediately, wait for video to be ready
            });

            hls.on(Hls.Events.LEVEL_LOADED, () => {
              console.log('✅ HLS level loaded, attempting playback');
              if (!hasResolved) {
                videoElement.play().then(() => {
                  console.log(`✅ ${context} started successfully`);
                  hasResolved = true;
                  resolve(true);
                }).catch(error => {
                  console.error('❌ HLS playback failed:', error);
                  if (!hasResolved) {
                    hasResolved = true;
                    resolve(false);
                  }
                });
              }
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
              console.error('❌ HLS error:', data);
              if (data.fatal) {
                console.error('❌ Fatal HLS error, trying next URL');
                hls.destroy();
                hlsRef.current = null;
                if (!hasResolved) {
                  hasResolved = true;
                  resolve(false);
                }
              }
            });

            // Timeout after 10 seconds (reduced from 20s for faster fallback)
            setTimeout(() => {
              if (!hasResolved) {
                console.warn(`⏰ ${context} timed out for URL ${i + 1}`);
                hasResolved = true;
                resolve(false);
              }
            }, 10000);
          });

          // Load the HLS stream
          hls.loadSource(currentUrl);
          hls.attachMedia(videoElement);
          
          // Wait for manifest to be parsed and playback to start
          const success = await manifestParsed;
          if (success) {
            isInitializingHlsRef.current = false;
            return true;
          }
          
        } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS support
          console.log('🍎 Using Safari native HLS support');
          // Upgrade HTTP to HTTPS for security
          let secureUrl = currentUrl;
          if (currentUrl.startsWith('http://')) {
            secureUrl = currentUrl.replace(/^http:/, 'https:');
          }
          videoElement.src = secureUrl;
          videoElement.load();
          
          const playPromise = videoElement.play();
          if (playPromise !== undefined) {
            await playPromise;
            console.log(`✅ ${context} started successfully with Safari native HLS`);
            isInitializingHlsRef.current = false;
            return true;
          }
        } else {
          console.error('❌ HLS not supported in this browser');
          toast.error('Video streaming not supported in this browser', { duration: 5000 });
          isInitializingHlsRef.current = false;
          return false;
        }
        
      } catch (error) {
        console.error(`❌ ${context} attempt ${i + 1} failed:`, error);
        
        // Clean up on error
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        
        // Add a small delay before trying the next URL (reduced for faster skipping)
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.error(`❌ All ${urlsToTry.length} HLS URLs failed for ${context}`);
    isInitializingHlsRef.current = false;
    return false;
  };

  // Helper function to cancel pending auto-skip timeout
  const cancelPendingAutoSkip = () => {
    if (autoSkipTimeoutRef.current) {
      console.log('⏭️ Cancelling pending auto-skip timeout');
      clearTimeout(autoSkipTimeoutRef.current);
      autoSkipTimeoutRef.current = null;
    }
  };

  // Helper function to attempt media playback with fallback URLs
  const attemptAudioPlayback = async (originalUrl: string, context = 'playback', sessionId?: number, mediaType?: string): Promise<boolean> => {
    console.log('🎵 Attempting audio playback:', { originalUrl, context, mediaType });
    const isVideo = isVideoUrl(originalUrl, mediaType);
    const isHls = isHlsUrl(originalUrl);
    const mediaElement = isVideo ? videoRef.current : getActiveAudioEl();

    if (!mediaElement) {
      console.error(`❌ ${isVideo ? 'Video' : 'Audio'} element reference is null`);
      return false;
    }

    // Update video mode state
    setIsVideoMode(isVideo);

    if (isVideo) {
      console.log('🎬 Video URL detected, switching to video mode:', originalUrl);
      // For video HLS content, open fullscreen mode BEFORE attempting playback
      // This ensures the video element is moved to a visible container,
      // which is required for HLS playback on some browsers that throttle hidden videos
      if (isHls) {
        console.log('🖥️ Opening fullscreen mode for video HLS playback');
        setIsFullscreenMode(true);

        // CRITICAL: Don't rely on React's render cycle - directly make video element
        // visible to prevent browser throttling of hidden video elements.
        // NowPlayingScreen will take control of positioning once it renders.
        const videoElement = videoRef.current;
        if (videoElement) {
          // Temporarily make video element visible (not off-screen)
          // Use a small size so it doesn't flash visibly before fullscreen opens
          videoElement.style.position = 'fixed';
          videoElement.style.left = '0';
          videoElement.style.top = '0';
          videoElement.style.width = '1px';
          videoElement.style.height = '1px';
          videoElement.style.opacity = '0.01'; // Nearly invisible but not display:none
        }

        // Small delay for the style changes to take effect
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    if (isHls) {
      console.log('📺 HLS stream detected, using hls.js:', originalUrl);
      return attemptHlsPlayback(originalUrl, context);
    }
    
    const urlsToTry = getAudioUrlsToTry(originalUrl);
    
    // Set retry flag to prevent error handler interference
    isRetryingRef.current = true;
    
    for (let i = 0; i < urlsToTry.length; i++) {
      // Check if this session is still current before each attempt
      if (sessionId !== undefined && playbackSessionRef.current !== sessionId) {
        console.log(`⏭️ Session ${sessionId} cancelled, newer session ${playbackSessionRef.current} active`);
        isRetryingRef.current = false;
        return false;
      }

      const audioUrl = urlsToTry[i];
      const isProxied = typeof audioUrl === 'string' && audioUrl.includes('proxy-audio');
      console.log(`🔄 [Playback Attempt ${i + 1}/${urlsToTry.length}] ${isProxied ? '🔄 PROXY' : '📡 DIRECT'}: ${audioUrl.substring(0, 150)}${audioUrl.length > 150 ? '...' : ''}`);

      try {
        // Clean up any existing HLS instance when switching to regular media
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      // Check if media element is still valid
      const currentMediaElement = isVideo ? videoRef.current : getActiveAudioEl();
      if (!currentMediaElement) {
        console.error(`❌ ${isVideo ? 'Video' : 'Audio'} element became null during playback attempt`);
        return false;
      }
      
      // Clear any previous error state before setting new source
      currentMediaElement.pause();
      currentMediaElement.removeAttribute('src');
      currentMediaElement.load();

      // Upgrade HTTP to HTTPS for security and CORS compliance
      let secureAudioUrl = audioUrl;
      if (audioUrl.startsWith('http://')) {
        console.log(`⚠️ Upgrading HTTP audio URL to HTTPS: ${audioUrl}`);
        secureAudioUrl = audioUrl.replace(/^http:/, 'https:');
      }

      // Set new source and load
      currentMediaElement.src = secureAudioUrl;
      currentMediaElement.load();
        
        // Set volume for audio, videos typically control their own volume
        if (!isVideo) {
          (currentMediaElement as HTMLAudioElement).volume = 0.8;
        }
        
        // Wait briefly for media to load before playing
        // Reduced from 100ms to 10ms to prevent iOS from releasing audio session
        // in background playback. HLS streams may need slightly longer but seamless
        // playback handles track transitions anyway.
        await new Promise(resolve => setTimeout(resolve, 10));
        
        // Ensure media is not muted for playback
        currentMediaElement.muted = false;
        if (!isVideo) {
          (currentMediaElement as HTMLAudioElement).volume = 0.8;
        }
        
        const playPromise = currentMediaElement.play();
        if (playPromise !== undefined) {
          await playPromise;
          const isProxied = typeof audioUrl === 'string' && audioUrl.includes('proxy-audio');
          console.log(`✅ ${context} started successfully with ${isProxied ? 'proxied' : 'direct'} URL (${isVideo ? 'VIDEO' : 'AUDIO'} mode)`);
          
          // Monitor successful playback
          monitoring.info('audio-playback', `Playback success on attempt ${i + 1}`, {
            context,
            method: isProxied ? 'proxy' : 'direct',
            mode: isVideo ? 'video' : 'audio',
            url: originalUrl
          });

          // Clear retry flag on success
          isRetryingRef.current = false;
          return true;
        }
      } catch (attemptError) {
        const errorMessage = attemptError instanceof Error ? attemptError.message : String(attemptError);
        const errorName = attemptError instanceof DOMException ? attemptError.name : 'Unknown';

        console.warn(`⚠️ [Playback Attempt ${i + 1} FAILED] Error: ${errorName} - ${errorMessage}`);
        console.warn(`⚠️ [Playback Attempt ${i + 1} FAILED] Failed URL:`, audioUrl);

        // Monitor failed attempts
        monitoring.warn('audio-playback', `Playback failed on attempt ${i + 1}`, {
          context,
          method: isProxied ? 'proxy' : 'direct',
          error: errorMessage,
          errorName: errorName,
          url: originalUrl,
          attemptedUrl: audioUrl
        });

        // Handle specific error types
        if (attemptError instanceof DOMException) {
          if (attemptError.name === 'NotAllowedError') {
            console.log('🚫 [Error Handler] Autoplay blocked - this should not happen on user click');
            // If we get NotAllowedError on a user click, something is wrong
            // Don't show a generic message, return false to let playAlbum handle it
            return false;
          } else if (attemptError.name === 'NotSupportedError') {
            console.log('🚫 [Error Handler] Audio format not supported - trying next URL');
            continue; // Try next URL
          } else if (attemptError.name === 'AbortError') {
            console.log('🚫 [Error Handler] Audio request aborted - trying next URL');
            continue; // Try next URL
          } else if (typeof attemptError.message === 'string' && (attemptError.message.includes('CORS') || attemptError.message.includes('cross-origin'))) {
            console.log('🚫 [Error Handler] CORS error detected - trying next URL');
            continue; // Try next URL
          }
        }

        console.log(`⏳ [Error Handler] Waiting 50ms before trying next URL...`);
        // Add a small delay before trying the next URL (reduced from 150ms for faster skipping)
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Clear retry flag
    isRetryingRef.current = false;

    // Every candidate URL is exhausted — this is the track the user actually watched
    // fail to play, as opposed to the per-attempt warnings above, which are noisy and
    // often recovered from. Reported at error level so the two are separable.
    monitoring.error('audio-playback', 'All playback URLs failed', {
      context,
      attempts: urlsToTry.length,
      url: originalUrl,
    });

    // Set flag to prevent error handler from auto-skipping (we'll handle failure programmatically)
    skipAutoSkipRef.current = true;
    // Clear the flag after a short delay to allow error events to fire
    setTimeout(() => { skipAutoSkipRef.current = false; }, 500);

    return false; // All attempts failed
  };

  // Seamless playback for track transitions - keeps iOS audio session warm
  // by directly swapping source without pause/clear/delay
  const attemptSeamlessPlayback = async (audioUrl: string, context: string, sessionId?: number, mediaType?: string): Promise<boolean> => {
    const isVideo = isVideoUrl(audioUrl, mediaType);
    const currentElement = isVideo ? videoRef.current : getActiveAudioEl();

    if (!currentElement) {
      console.warn('⚠️ No media element for seamless playback');
      return false;
    }

    // Get URLs to try (includes proxied URLs for CORS-problematic domains)
    const urlsToTry = getAudioUrlsToTry(audioUrl);

    for (let i = 0; i < urlsToTry.length; i++) {
      // Check if this session is still current before each attempt
      if (sessionId !== undefined && playbackSessionRef.current !== sessionId) {
        console.log(`⏭️ Seamless session ${sessionId} cancelled, newer session ${playbackSessionRef.current} active`);
        return false;
      }

      let secureUrl = urlsToTry[i];

      // Upgrade HTTP to HTTPS
      if (secureUrl.startsWith('http://')) {
        secureUrl = secureUrl.replace(/^http:/, 'https:');
      }

      try {
        const isProxied = secureUrl.includes('proxy-audio');
        console.log(`🔄 Attempting seamless playback (${i + 1}/${urlsToTry.length}): ${context} - ${isProxied ? 'PROXY' : 'DIRECT'}`);

        // Direct source swap - no pause, no clearing, minimal delay
        // This keeps the audio session "warm" on iOS
        currentElement.src = secureUrl;
        currentElement.load(); // Required on iOS Safari to properly initialize new source

        // Reset currentTime to 0 for iOS - the src change may not automatically reset it
        currentElement.currentTime = 0;

        // Reassert "playing" right before play() so the media session stays warm
        // across the src swap (helps some backgrounded cases).
        if ('mediaSession' in navigator && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'playing';
        }

        // Attempt immediate play
        const playPromise = currentElement.play();
        if (playPromise !== undefined) {
          await playPromise;
          console.log(`✅ Seamless playback started: ${context}`);
          return true;
        }
        return true;
      } catch (error) {
        // Safe stopgap: a backgrounded play() can reject with NotAllowedError.
        // Retry ONCE without another load() (a second load() only makes it worse).
        // This is a cheap safety layer, not the primary Android fix (ping-pong).
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          try {
            await new Promise(resolve => setTimeout(resolve, 50));
            if ('mediaSession' in navigator && navigator.mediaSession) {
              navigator.mediaSession.playbackState = 'playing';
            }
            await currentElement.play();
            console.log(`✅ Seamless playback started on retry: ${context}`);
            return true;
          } catch (retryError) {
            console.warn(`⚠️ Seamless playback retry failed: ${retryError}`);
          }
        }
        console.warn(`⚠️ Seamless playback attempt ${i + 1} failed: ${error}`);
        // Continue to next URL if available
      }
    }

    console.warn(`⚠️ Seamless playback failed after ${urlsToTry.length} attempts, will fall back`);

    // Set flag to prevent error handler from auto-skipping (we'll handle failure programmatically)
    skipAutoSkipRef.current = true;
    setTimeout(() => { skipAutoSkipRef.current = false; }, 500);

    return false;
  };

  // Resolve the single "primary" playback URL for a track — the same first
  // candidate the transition path uses — so the prefetch key and the ping-pong
  // lookup always agree.
  const primaryPlaybackUrl = (track: any): string | null => {
    const raw = getTrackPlaybackUrl(track);
    if (!raw) return null;
    let url = getAudioUrlsToTry(raw)[0] || raw;
    if (url.startsWith('http://')) url = url.replace(/^http:/, 'https:');
    return url || null;
  };

  // Android: while the current track plays (tab alive), fetch the NEXT track
  // fully into an in-memory blob: URL. At the boundary the idle element plays it
  // with zero network — surviving Chromium's background media-load suspension.
  // Best-effort: any failure leaves the existing network path unchanged.
  const prefetchBlobForTrack = async (track: any): Promise<void> => {
    if (!isAndroidRef.current) return;              // Android-only, like ping-pong
    if (!track) return;
    const rawUrl = getTrackPlaybackUrl(track);
    if (isVideoUrl(rawUrl, track.mediaType)) return; // audio-only
    const key = primaryPlaybackUrl(track);
    if (!key) return;
    const cache = getBlobCache();
    if (cache.hasPreparedNext(key)) return;         // already prepared
    try {
      const res = await fetch(key);
      if (!res.ok) {
        console.warn(`⚠️ Blob prefetch HTTP ${res.status} for ...${key.slice(-40)}`);
        return;
      }
      const blob = await res.blob();
      cache.prepareNext(key, blob);
      console.log(`📥 Prefetched next-track blob (${blob.size} bytes): ${track.title}`);
    } catch (e) {
      console.warn(`⚠️ Blob prefetch failed: ${e}`);
    }
  };

  // Compute the track that will play after the current one, mirroring
  // playNextTrack's common cases (sequential + shuffle-sequential). repeat-one
  // replays the current element (no fresh source needed) and repeat-all wrap at
  // the end is left to the network fallback — both return null here.
  const getUpcomingTrack = (): any | null => {
    if (repeatMode === 'one') return null;
    if (isShuffleMode) {
      const next = shuffledPlaylist[currentShuffleIndex + 1];
      return next ? next.track : null;
    }
    if (!currentPlayingAlbum || !currentPlayingAlbum.tracks) return null;
    const tracks = currentPlayingAlbum.tracks;
    let i = currentTrackIndex + 1;
    while (i < tracks.length) {
      const t = tracks[i];
      if (!t.status || t.status === 'active') return t;
      i++;
    }
    return null; // end of album
  };

  // Prefetch the upcoming track's blob whenever the current track changes.
  // Runs on the client after each transition while the new track plays (tab
  // alive), so the following track is always ready before its boundary.
  useEffect(() => {
    if (!isAndroidRef.current) return;
    /**
     * Data Saver moves this to the 15s mark (see the timeupdate handler).
     *
     * Running it here means the ENTIRE next track is downloading for the whole
     * duration of the one you are listening to — on a weak link the two
     * compete, and the track playing is the one that stutters. It is delayed
     * rather than dropped because it is what keeps a locked-screen Android
     * handoff gapless; see the comment on prefetchBlobForTrack above.
     */
    if (isDataSaverOn()) return;
    const upcoming = getUpcomingTrack();
    if (upcoming) {
      prefetchBlobForTrack(upcoming);
    }
    // Intentionally depends only on playback-position state; the helper
    // closures are recreated each render and must not be deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlayingAlbum, currentTrackIndex, isShuffleMode, currentShuffleIndex, shuffledPlaylist, repeatMode]);

  // Starts the next track on the IDLE audio element WHILE the current element is
  // still playing, then promotes idle -> active and pauses the old element.
  // Because playback never fully stops, Android's locked-screen background
  // autoplay policy does not block the new play() — unlike a load()+play() on the
  // same element (what attemptSeamlessPlayback does), which Android drops on a
  // locked screen, stalling playback until the user foregrounds the app.
  // Audio-only; returns false (to fall through to seamless/full playback) for
  // video/HLS or on any failure.
  // Android gapless ping-pong transition.
  const attemptPingPongPlayback = async (
    track: RSSAlbum['tracks'][number],
    album: RSSAlbum,
    sessionId?: number
  ): Promise<boolean> => {
    const rawUrl = getTrackPlaybackUrl(track);
    if (isVideoUrl(rawUrl, track.mediaType)) return false; // video handled elsewhere

    const idle = getIdleAudioEl();
    const outgoing = getActiveAudioEl();
    if (!idle) return false;

    const urlsToTry = getAudioUrlsToTry(rawUrl);
    const startTime = track.startTime && typeof track.startTime === 'number' ? track.startTime : 0;

    // Prefer the prefetched in-memory blob (survives backgrounded media-load
    // suspension); fall back to the network URLs on any miss/failure.
    const blobKey = primaryPlaybackUrl(track);
    const blobUrl = blobKey ? getBlobCache().getPreparedNext(blobKey) : null;
    const sources: Array<{ url: string; isBlob: boolean }> = [];
    if (blobUrl) sources.push({ url: blobUrl, isBlob: true });
    for (const u of urlsToTry) {
      let s = u;
      if (s.startsWith('http://')) s = s.replace(/^http:/, 'https:');
      sources.push({ url: s, isBlob: false });
    }

    for (let i = 0; i < sources.length; i++) {
      if (sessionId !== undefined && playbackSessionRef.current !== sessionId) {
        console.log(`⏭️ Ping-pong session ${sessionId} cancelled, newer session ${playbackSessionRef.current} active`);
        return false;
      }

      const { url: secureUrl, isBlob } = sources[i];

      try {
        // Reuse the idle element if it already holds this exact source loaded.
        const alreadyLoaded = idle.src === secureUrl && idle.readyState >= 2;
        if (!alreadyLoaded) {
          idle.src = secureUrl;
          idle.load();
        }
        idle.currentTime = startTime;
        idle.muted = false;
        idle.volume = 0.8;

        if ('mediaSession' in navigator && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'playing';
        }

        // Start the new element while the old one is still playing.
        await idle.play();

        // Success — promote idle to active, then quiesce the old element.
        activeAudioRef.current = idle;
        if (outgoing && outgoing !== idle) {
          try { outgoing.pause(); } catch { /* ignore */ }
        }

        // Adopt the new element's clock. The `loadedmetadata` handler is gated
        // by shouldProcess(), which rejects events from an element while it is
        // still idle — and this element was idle when its metadata arrived (in
        // both the preloaded and the fresh-load() path). Without this, duration
        // stays pinned to the PREVIOUS track for the whole song, so the time
        // label is wrong and the unclamped progress knob slides off screen.
        // The durationchange listener below covers metadata arriving later.
        if (Number.isFinite(idle.duration) && idle.duration > 0) {
          setDuration(idle.duration);
        }
        setCurrentTime(idle.currentTime);
        currentTimeRef.current = idle.currentTime;
        // A consumed blob becomes the "playing" blob; the previously-playing
        // blob (now finished) is revoked inside promoteToPlaying.
        if (isBlob && blobKey) {
          getBlobCache().promoteToPlaying(blobKey);
        }

        // Reset advance/preload bookkeeping for the new current track.
        trackEndProcessedRef.current = false;
        pendingNextTrackUrlRef.current = null;
        if (iosAdvanceTimerRef.current) {
          clearTimeout(iosAdvanceTimerRef.current);
          iosAdvanceTimerRef.current = null;
        }

        setIsPlaying(true);
        if ('mediaSession' in navigator && navigator.mediaSession) {
          navigator.mediaSession.playbackState = 'playing';
        }
        updateMediaSession(album, track);
        setIsLoading(false);
        const isProxied = secureUrl.includes('proxy-audio');
        console.log(`✅ Ping-pong transition succeeded (${isBlob ? 'blob' : isProxied ? 'proxy' : 'direct'}): ${track.title}`);
        return true;
      } catch (err) {
        console.warn(`⚠️ Ping-pong attempt ${i + 1}/${sources.length} failed: ${err}`);
        // Try next source; on total failure, caller falls through to seamless/full.
      }
    }

    return false;
  };

  // Media event listeners
  useEffect(() => {
    const audio = audioRef.current;
    const audioB = audioRefB.current;
    const video = videoRef.current;
    if (!audio || !audioB || !video) return;

    // Only process events from the ONE element that is currently the playback
    // element. With the Android ping-pong path there are two audio elements, and
    // the idle one still fires loadstart/loadedmetadata/etc while it is preloaded
    // — those must not drive state (e.g. seek the active element to startTime).
    const shouldProcess = (e: Event): boolean => {
      const t = e.currentTarget;
      if (isVideoMode) return t === video;
      return t === getActiveAudioEl();
    };

    const handlePlay = (e: Event) => {
      if (!shouldProcess(e)) return;
      setIsPlaying(true);
      // Reset iOS background advance tracking for next track end
      trackEndProcessedRef.current = false;
      albumCompleteRef.current = false; // catch-all: audio is playing, so the album isn't over
      earlyAdvanceTriggeredRef.current = false; // re-arm Android pre-end gapless advance for this track
      pendingNextTrackUrlRef.current = null;
      if (iosAdvanceTimerRef.current) {
        clearTimeout(iosAdvanceTimerRef.current);
        iosAdvanceTimerRef.current = null;
      }
      // Clean up preload Audio element
      if (preloadAudioRef.current) {
        preloadAudioRef.current.removeAttribute('src');
        preloadAudioRef.current.load();
        preloadAudioRef.current = null;
      }
      // Update media session playback state immediately for iOS
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
      // Publish NIP-38 "now playing" status
      publishNip38StatusDebounced('play');
    };

    const handlePause = (e: Event) => {
      if (!shouldProcess(e)) return;
      // Ignore pause events from track ending — handleEnded handles transitions
      const currentElement = isVideoMode ? video : getActiveAudioEl();
      if (!currentElement || currentElement.ended) {
        return;
      }

      setIsPlaying(false);
    };

    const handleEnded = async (e: Event) => {
      if (!shouldProcess(e)) return;
      console.log('🎵 Track ended, attempting to play next track');

      // Clear proactive advance timer (no longer needed)
      if (iosAdvanceTimerRef.current) {
        clearTimeout(iosAdvanceTimerRef.current);
        iosAdvanceTimerRef.current = null;
      }

      // Auto-boost on track end. Read from ref to get latest settings (closure may be stale).
      const { enabled: autoBoostOn, amount: autoBoostAmt } = autoBoostSettingsRef.current;
      if (!radioMode && autoBoostOn && currentPlayingAlbum && currentTrackIndex >= 0) {
        const track = currentPlayingAlbum.tracks[currentTrackIndex];
        const hasVTS = track?.valueTimeSplits && Array.isArray(track.valueTimeSplits) && track.valueTimeSplits.length > 0;
        if (track && !hasVTS && triggerAutoBoostRef.current) {
          // Non-VTS track: boost the track directly
          triggerAutoBoostRef.current(track, currentPlayingAlbum, autoBoostAmt || 50);
        } else if (track && hasVTS && inVtsGapRef.current && triggerChapterAutoBoostRef.current) {
          // VTS track ending in a talk gap: boost the outgoing talk chapter (show-level V4V)
          const gapTime = inVtsGapRef.current.enteredAt;
          const outgoingChapterTitle = chapters.find(ch => {
            const chEnd = ch.endTime ?? Infinity;
            return gapTime >= ch.startTime && gapTime < chEnd;
          })?.title;
          triggerChapterAutoBoostRef.current(
            '', '', currentPlayingAlbum, autoBoostAmt || 50, 0, outgoingChapterTitle
          );
          inVtsGapRef.current = null;
        }
      }

      // Prevent double-advance: proactive timer may have already triggered playNextTrack
      if (trackEndProcessedRef.current) {
        console.log('📱 Track advance already handled by proactive timer, skipping playNextTrack');
        return;
      }
      trackEndProcessedRef.current = true;

      // CRITICAL for iOS PWA: Set auto-transitioning flag so playAlbum uses seamless playback
      // This flag ensures seamless playback is used even if isPlaying state has changed
      isAutoTransitioningRef.current = true;

      // CRITICAL for iOS PWA: Keep audio session warm by maintaining 'playing' state
      // before triggering next track. This prevents iOS from releasing the audio session.
      if ('mediaSession' in navigator && navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }

      try {
        // Immediately trigger next track without delay for better mobile performance
        // Use the ref to get the latest playNextTrack function
        if (playNextTrackRef.current) {
          // Call playNextTrack synchronously to avoid mobile browser throttling
          playNextTrackRef.current();
        } else {
          console.warn('⚠️ playNextTrackRef.current is null');
        }
      } catch (error) {
        console.error('❌ Error in auto-play:', error);
        // Don't let errors in auto-play crash the application
        isAutoTransitioningRef.current = false;
        setIsPlaying(false);
      }
    };

    const handleTimeUpdate = (e: Event) => {
      if (!shouldProcess(e)) return;
      const currentElement = isVideoMode ? video : getActiveAudioEl();
      if (!currentElement) return;
      currentTimeRef.current = currentElement.currentTime;
      // Record the last real position so resume() can recover from an iOS
      // background buffer-eviction that resets currentTime to 0. Ignore ~0
      // readings so a collapse can never overwrite the good value.
      if (currentElement.currentTime > 0.25) {
        lastNonZeroPositionRef.current = currentElement.currentTime;
      }
      setCurrentTime(currentElement.currentTime);

      // Update position state for iOS lockscreen controls
      if ('mediaSession' in navigator && navigator.mediaSession && isPlaying) {
        if (currentElement.duration && !isNaN(currentElement.duration)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: currentElement.duration,
              playbackRate: currentElement.playbackRate || 1.0,
              position: currentElement.currentTime
            });
          } catch (error) {
            // Ignore errors - some browsers don't support this
          }
        }
      }

      // Check if current track has end time and we've reached it
      if (currentPlayingAlbum && currentPlayingAlbum.tracks[currentTrackIndex]) {
        const track = currentPlayingAlbum.tracks[currentTrackIndex];
        if (track.endTime && typeof track.endTime === 'number') {
          if (currentElement.currentTime >= track.endTime) {
            console.log(`🎵 Reached end time: ${track.endTime}s for track: ${track.title}`);
            // Trigger the ended event to play next track
            currentElement.dispatchEvent(new Event('ended'));
          }
        }

        // Pre-compute and preload next track for smooth transitions
        // Critical for iOS background playback where network + JS are throttled
        const timeRemaining = (track.endTime || currentElement.duration) - currentElement.currentTime;
        if (timeRemaining > 0 && timeRemaining <= 15 && !currentElement.paused) {
          // Get next track info (shared by all preload strategies)
          let nextTrack = null;
          if (isShuffleMode && shuffledPlaylist.length > 0) {
            const nextShuffleIndex = currentShuffleIndex + 1;
            if (nextShuffleIndex < shuffledPlaylist.length) {
              nextTrack = shuffledPlaylist[nextShuffleIndex]?.track;
            } else if (repeatMode === 'all' && shuffledPlaylist.length > 0) {
              nextTrack = shuffledPlaylist[0]?.track;
            }
          } else if (currentTrackIndex + 1 < currentPlayingAlbum.tracks.length) {
            nextTrack = currentPlayingAlbum.tracks[currentTrackIndex + 1];
          } else if (repeatMode === 'all' && currentPlayingAlbum.tracks.length > 0) {
            nextTrack = currentPlayingAlbum.tracks[0];
          }

          if (nextTrack && (nextTrack.url || nextTrack.alternateEnclosures?.length > 0)) {
            const nextTrackUrl = getTrackPlaybackUrl(nextTrack);
            const urlsToTry = getAudioUrlsToTry(nextTrackUrl);
            let secureNextUrl = urlsToTry[0] || nextTrackUrl;
            if (secureNextUrl.startsWith('http://')) {
              secureNextUrl = secureNextUrl.replace(/^http:/, 'https:');
            }

            // Store pre-computed URL for fast access in handleEnded
            pendingNextTrackUrlRef.current = secureNextUrl;

            // ANDROID GAPLESS OVERLAP: ~0.5s before the current track ends, if the
            // next track's blob is already prefetched, start the transition NOW —
            // while this element is still playing. attemptPingPongPlayback starts
            // the idle (blob) element and only then pauses this one, so audio never
            // goes silent. That continuity is what a locked/backgrounded Android tab
            // needs: a next track (re)started during a silent gap keeps advancing but
            // plays inaudibly until foreground, whereas one started while audio is
            // still outputting stays audible. Blob-gated (instant, no network) and
            // Android-only; iOS/desktop keep the end-of-track transition untouched.
            if (
              isAndroidRef.current &&
              !isVideoMode &&
              timeRemaining <= 0.5 &&
              !trackEndProcessedRef.current &&
              !earlyAdvanceTriggeredRef.current
            ) {
              const blobKey = primaryPlaybackUrl(nextTrack);
              if (blobKey && getBlobCache().getPreparedNext(blobKey)) {
                earlyAdvanceTriggeredRef.current = true;
                trackEndProcessedRef.current = true; // suppress the natural 'ended' advance
                isAutoTransitioningRef.current = true;
                if ('mediaSession' in navigator && navigator.mediaSession) {
                  navigator.mediaSession.playbackState = 'playing';
                }
                console.log(`⏩ Android early gapless advance (${timeRemaining.toFixed(2)}s before end): ${nextTrack.title}`);
                if (playNextTrackRef.current) {
                  playNextTrackRef.current();
                }
              }
            }

            // At 15s: Preload next track audio via hidden Audio element
            // This populates the browser's HTTP cache so load() in handleEnded is instant
            //
            // Data Saver takes the other branch. It skips this warm-up entirely
            // — a hidden element with preload="auto" AND a fetch() of the same
            // bytes, so the file is pulled twice over — and on Android runs the
            // blob prefetch that normally starts at track start instead. The
            // locked-screen handoff still gets its bytes; it gets them once, and
            // 15 seconds before the boundary rather than three minutes.
            if (isDataSaverOn()) {
              if (isAndroidRef.current) {
                prefetchBlobForTrack(nextTrack);
              }
            } else if (!preloadAudioRef.current || preloadAudioRef.current.src !== secureNextUrl) {
              console.log('🔄 Preloading next track audio into browser cache:', nextTrack.title);
              if (preloadAudioRef.current) {
                preloadAudioRef.current.removeAttribute('src');
                preloadAudioRef.current.load(); // Reset previous preload
              }
              const preloader = new Audio();
              preloader.preload = 'auto';
              preloader.src = secureNextUrl;
              preloadAudioRef.current = preloader;
              // Also prefetch via fetch() as backup cache warming
              prefetchAudio(secureNextUrl).catch(() => {});
            }

            // At 5s: Cross-element preload.
            // - audio <-> video transitions use the alternate media element.
            // - On Android, audio->audio transitions preload into the IDLE audio
            //   element so the ping-pong handoff below can start it while the
            //   current element is still playing (locked-screen autoplay survival).
            //   On iOS/desktop this resolves to audioRef.current (== current
            //   element) and the `!== currentElement` guard makes it a no-op —
            //   behavior unchanged.
            if (timeRemaining <= 5) {
              const nextIsVideo = isVideoUrl(nextTrackUrl, nextTrack.mediaType);
              const nextElement = nextIsVideo
                ? videoRef.current
                : (isAndroidRef.current && !isVideoMode ? getIdleAudioEl() : audioRef.current);
              if (nextElement && nextElement !== currentElement) {
                if (!nextElement.src || nextElement.src !== secureNextUrl) {
                  console.log('🔄 Preloading next track into alternate element:', nextTrack.title);
                  nextElement.src = secureNextUrl;
                  nextElement.preload = 'auto';
                  nextElement.load();
                }
              }
            }

            // At 5s: Schedule proactive advance timer (iOS background)
            // Fires shortly after the track should end, while iOS may still allow JS execution
            // (iOS keeps JS semi-active while audio was recently playing)
            if (!iosAdvanceTimerRef.current && timeRemaining <= 5 && timeRemaining > 0.5) {
              // On iOS in the background, fire the advance slightly BEFORE the
              // current track ends — while its element is still actively playing —
              // so the audio session stays warm across the src swap. A swap that
              // happens after the element has already ended/paused in the
              // background gets its play() blocked (NotAllowedError), which is why
              // the next track otherwise only starts on foreground return.
              // Everywhere else, keep firing just after the expected end.
              const fireEarlyOnIOS = isIOSDevice() && document.visibilityState === 'hidden';
              const advanceInMs = fireEarlyOnIOS
                ? Math.max(0, (timeRemaining - 0.35) * 1000) // 350ms before expected end
                : (timeRemaining + 0.2) * 1000;              // 200ms after expected end
              console.log(`📱 Scheduling proactive track advance in ${Math.round(advanceInMs)}ms (fireEarlyOnIOS=${fireEarlyOnIOS})`);
              iosAdvanceTimerRef.current = setTimeout(() => {
                iosAdvanceTimerRef.current = null;
                const el = isVideoMode ? videoRef.current : getActiveAudioEl();
                // Advance when the track is at/near its end. When firing early on
                // backgrounded iOS the element is still playing (~0.35s left), so
                // accept "within 0.5s of the end" in addition to a real `ended`.
                if (el && (el.ended || (el.duration > 0 && el.currentTime >= el.duration - 0.5))) {
                  // Guard against double-advance (handleEnded may have already fired)
                  if (!trackEndProcessedRef.current) {
                    trackEndProcessedRef.current = true;

                    // Trigger auto-boost for the track that just ended
                    const { enabled: autoBoostOn, amount: autoBoostAmt } = autoBoostSettingsRef.current;
                    if (!radioMode && autoBoostOn && currentPlayingAlbum && currentTrackIndex >= 0) {
                      const endedTrack = currentPlayingAlbum.tracks[currentTrackIndex];
                      const endedTrackHasVTS = endedTrack?.valueTimeSplits && Array.isArray(endedTrack.valueTimeSplits) && endedTrack.valueTimeSplits.length > 0;
                      if (endedTrack && !endedTrackHasVTS && triggerAutoBoostRef.current) {
                        triggerAutoBoostRef.current(endedTrack, currentPlayingAlbum, autoBoostAmt || 50);
                      } else if (endedTrack && endedTrackHasVTS && inVtsGapRef.current && triggerChapterAutoBoostRef.current) {
                        const gapTime = inVtsGapRef.current.enteredAt;
                        const outgoingChapterTitle = chapters.find(ch => {
                          const chEnd = ch.endTime ?? Infinity;
                          return gapTime >= ch.startTime && gapTime < chEnd;
                        })?.title;
                        triggerChapterAutoBoostRef.current(
                          '', '', currentPlayingAlbum, autoBoostAmt || 50, 0, outgoingChapterTitle
                        );
                        inVtsGapRef.current = null;
                      }
                    }

                    // Mirror handleEnded: keep audio session warm so seamless playback succeeds
                    isAutoTransitioningRef.current = true;
                    if ('mediaSession' in navigator && navigator.mediaSession) {
                      navigator.mediaSession.playbackState = 'playing';
                    }
                    console.log('📱 Proactive advance timer fired, triggering next track');
                    if (playNextTrackRef.current) {
                      playNextTrackRef.current();
                    }
                  }
                }
              }, advanceInMs);
            }
          }
        }
      }
    };

    // Keeps `duration` honest for the element that is actually playing. Needed
    // because the Android ping-pong path promotes a preloaded element whose
    // `loadedmetadata` already fired (and was rejected by shouldProcess) while
    // it was still idle — leaving duration stuck on the previous track.
    const handleDurationChange = (e: Event) => {
      if (!shouldProcess(e)) return;
      const currentElement = isVideoMode ? video : getActiveAudioEl();
      if (!currentElement) return;
      if (Number.isFinite(currentElement.duration) && currentElement.duration > 0) {
        setDuration(currentElement.duration);
      }
    };

    const handleLoadedMetadata = (e: Event) => {
      if (!shouldProcess(e)) return;
      const currentElement = isVideoMode ? video : getActiveAudioEl();
      if (!currentElement) return;
      setDuration(currentElement.duration);

      // Re-update media session with duration info for iOS
      if (currentPlayingAlbum && currentPlayingAlbum.tracks[currentTrackIndex]) {
        const track = currentPlayingAlbum.tracks[currentTrackIndex];
        updateMediaSession(currentPlayingAlbum, track);

        // "Resume where you left off": apply a restored position, if one is
        // pending for exactly this album + track. This has to happen here
        // because the branches below would otherwise stomp it — either seeking
        // to the track's own startTime, or resetting currentTime to 0.
        const pendingResume = pendingResumeSeekRef.current;
        // Always one-shot: a stale instruction must never leak into the next track.
        pendingResumeSeekRef.current = null;
        if (
          pendingResume &&
          Date.now() - pendingResume.setAt < 60_000 &&
          pendingResume.trackIndex === currentTrackIndex &&
          pendingResume.albumKey === albumSessionKey(currentPlayingAlbum)
        ) {
          const resumeAt = resolveResumePosition({
            position: pendingResume.position,
            duration: currentElement.duration,
            startTime: track.startTime,
            endTime: track.endTime,
          });
          if (resumeAt !== null) {
            // Mark as a manual seek so the VTS transition detector doesn't read
            // the jump as a real segment change and fire an autoboost payment
            // for a segment the user never re-listened to.
            isManualSeekRef.current = true;
            console.log(`⏩ Resuming "${track.title}" at ${Math.round(resumeAt)}s`);
            currentElement.currentTime = resumeAt;
            return;
          }
        }

        // Check if current track has time segment information and seek to start time
        if (track.startTime && typeof track.startTime === 'number') {
          // Validate start time against duration
          if (track.startTime < currentElement.duration) {
            console.log(`🎵 Seeking to start time: ${track.startTime}s for track: ${track.title}`);
            currentElement.currentTime = track.startTime;
          } else {
            console.warn(`⚠️ Start time ${track.startTime}s is beyond track duration ${currentElement.duration}s for track: ${track.title}`);
          }
        } else {
          // No startTime - ensure we start from the beginning
          // This is important for iOS where currentTime may not reset automatically on source change
          if (currentElement.currentTime > 1) {
            console.log(`🎵 Resetting currentTime from ${currentElement.currentTime}s to 0 for track: ${track.title}`);
            currentElement.currentTime = 0;
          }
        }
      }
    };

    const handleError = (event: Event) => {
      if (!shouldProcess(event)) return;
      const mediaError = (event.target as HTMLMediaElement)?.error;
      console.error(`🚫 ${isVideoMode ? 'Video' : 'Audio'} error:`, mediaError);

      // The media element's own failure — the closest thing to a root cause for
      // "playback died". Reported by code so the pattern is visible across devices;
      // MEDIA_ERR_SRC_NOT_SUPPORTED (4) on one track is a dead URL, the same code
      // across many is a CORS or proxy regression.
      monitoring.error('audio-playback', `Media element error (code ${mediaError?.code ?? 'unknown'})`, {
        code: mediaError?.code,
        mode: isVideoMode ? 'video' : 'audio',
        retrying: isRetryingRef.current,
      });

      // Don't interfere if we're in the middle of retrying
      if (isRetryingRef.current) {
        console.log('🔄 Error during retry process - letting retry logic handle it');
        return;
      }

      setIsPlaying(false);

      // Don't clear the source immediately - let the retry logic in attemptAudioPlayback handle it
      // Only log the error for debugging
      if (mediaError?.code === 4) {
        console.log('🔄 Media not suitable error - retry logic will handle this');
      } else if (mediaError?.code === 3) {
        console.log('🔄 Decode error - retry logic will handle this');
      } else if (mediaError?.code === 2) {
        console.log('🔄 Network error - retry logic will handle this');
      } else if (mediaError?.code === 1) {
        console.log('🔄 Aborted error - retry logic will handle this');
      }

      // Auto-skip to next track on error (especially important for shuffle mode)
      // This prevents playback from stopping when a track fails
      // BUT: Skip if the failure is being handled programmatically (e.g., retry logic completed)
      if (skipAutoSkipRef.current) {
        console.log('⏭️ Skipping auto-skip: failure being handled programmatically');
        return;
      }

      // A failed end-of-album cue must not auto-skip. The cue loads track 1 with no
      // play() to fail on, so a dead/CORS-blocked URL surfaces here instead — and
      // auto-skipping from the rewound index would start TRACK 2 unprompted, which is
      // the exact bug the rewind exists to fix. (playbackSessionRef doesn't help: the
      // error arrives after the cue's own bump, so the session still matches.) Leave
      // the element empty so resume() cold-starts through playAlbum on the next tap.
      if (albumCompleteRef.current) {
        console.log('⏭️ Skipping auto-skip: album already finished (cue failed to load)');
        try {
          const el = getActiveAudioEl();
          el?.removeAttribute('src');
          el?.load();
        } catch {
          // Best effort.
        }
        return;
      }

      if (playNextTrackRef.current) {
        const currentSession = playbackSessionRef.current;
        console.log(`⏭️ Auto-skipping to next track after error (session ${currentSession})`);
        // Cancel any existing pending auto-skip before scheduling a new one
        cancelPendingAutoSkip();
        autoSkipTimeoutRef.current = setTimeout(() => {
          autoSkipTimeoutRef.current = null;
          // Only auto-skip if no new session started (i.e., user hasn't manually skipped)
          if (playbackSessionRef.current === currentSession && playNextTrackRef.current) {
            playNextTrackRef.current();
          } else {
            console.log(`⏭️ Skipping auto-skip: session changed from ${currentSession} to ${playbackSessionRef.current}`);
          }
        }, 300); // Reduced from 1000ms for faster skipping on CORS/unavailable tracks
      }
    };

    // iOS-specific: Handle stalled event - iOS fires this when buffering
    // Without this handler, iOS may pause playback and not resume
    const handleStalled = (event: Event) => {
      if (!shouldProcess(event)) return;
      const element = event.target as HTMLMediaElement;
      console.log('⏸️ Media stalled (buffering) - iOS may need help resuming');

      // If we're supposed to be playing, try to resume
      // Check readyState: 4 = HAVE_ENOUGH_DATA, 3 = HAVE_FUTURE_DATA
      if (!element.paused && element.readyState >= 3) {
        console.log('🔄 Stalled but have data - attempting to continue playback');
        element.play().catch(err => {
          console.warn('⚠️ Failed to resume after stall:', err);
        });
      }
    };

    // iOS-specific: Handle waiting event - playback stopped due to lack of data
    const handleWaiting = (event: Event) => {
      if (!shouldProcess(event)) return;
      const element = event.target as HTMLMediaElement;
      console.log('⏳ Media waiting for data (buffering)');

      // This is informational - playback should auto-resume when data is available
      // But on iOS, sometimes it doesn't, so we'll set a timeout to check
      setTimeout(() => {
        if (element.paused && element.readyState >= 3 && !element.ended) {
          console.log('🔄 Waiting timeout - attempting to resume playback');
          element.play().catch(err => {
            console.warn('⚠️ Failed to resume after waiting:', err);
          });
        }
      }, 1000);
    };

    // Add event listeners to both audio elements (ping-pong) and the video element
    const elements = [audio, audioB, video];
    elements.forEach(element => {
      element.addEventListener('play', handlePlay);
      element.addEventListener('pause', handlePause);
      element.addEventListener('ended', handleEnded);
      element.addEventListener('timeupdate', handleTimeUpdate);
      element.addEventListener('loadedmetadata', handleLoadedMetadata);
      element.addEventListener('durationchange', handleDurationChange);
      element.addEventListener('error', handleError);
      element.addEventListener('stalled', handleStalled);
      element.addEventListener('waiting', handleWaiting);
    });

    // Cleanup
    return () => {
      elements.forEach(element => {
        element.removeEventListener('play', handlePlay);
        element.removeEventListener('pause', handlePause);
        element.removeEventListener('ended', handleEnded);
        element.removeEventListener('timeupdate', handleTimeUpdate);
        element.removeEventListener('loadedmetadata', handleLoadedMetadata);
        element.removeEventListener('durationchange', handleDurationChange);
        element.removeEventListener('error', handleError);
        element.removeEventListener('stalled', handleStalled);
        element.removeEventListener('waiting', handleWaiting);
      });

      // Clean up iOS background advance timer
      if (iosAdvanceTimerRef.current) {
        clearTimeout(iosAdvanceTimerRef.current);
        iosAdvanceTimerRef.current = null;
      }

      // Clean up preload Audio element
      if (preloadAudioRef.current) {
        preloadAudioRef.current.removeAttribute('src');
        preloadAudioRef.current.load();
        preloadAudioRef.current = null;
      }

      // Clean up HLS instance - but NOT if:
      // 1. We're in the middle of initializing HLS
      // 2. Video is currently playing (don't destroy active HLS stream)
      const videoElement = videoRef.current;
      const isVideoPlaying = videoElement && !videoElement.paused && !videoElement.ended;

      if (hlsRef.current && !isInitializingHlsRef.current && !isVideoPlaying) {
        console.log('🧹 Cleaning up HLS instance in useEffect cleanup');
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      // Skip cleanup silently if HLS is initializing or video is playing
    };
  }, [isVideoMode, currentPlayingAlbum, currentTrackIndex, isShuffleMode, shuffledPlaylist, currentShuffleIndex, repeatMode, publishNip38StatusDebounced]); // Add necessary dependencies for preloading logic

  // Silent stall detection and recovery
  // Detects when audio element says "playing" but currentTime stops advancing
  useEffect(() => {
    // Only run when we think we're playing
    if (!isPlaying) {
      // Clear any existing interval when not playing
      if (stallCheckIntervalRef.current) {
        clearInterval(stallCheckIntervalRef.current);
        stallCheckIntervalRef.current = null;
      }
      // Reset counters
      staleTimeCounterRef.current = 0;
      recoveryAttemptRef.current = 0;
      return;
    }

    const checkForStall = () => {
      const currentElement = isVideoMode ? videoRef.current : getActiveAudioEl();
      if (!currentElement) return;

      // Only check if we think we're playing AND element is not paused AND not ended
      if (!isPlaying || currentElement.paused || currentElement.ended) {
        // Reset stale counter since we're legitimately not playing
        staleTimeCounterRef.current = 0;
        return;
      }

      const currentElementTime = currentElement.currentTime;
      const lastTime = lastKnownTimeRef.current;

      // Check if time has advanced (threshold of 0.1s to account for precision)
      if (Math.abs(currentElementTime - lastTime) < 0.1) {
        // Time hasn't advanced - increment stale counter
        staleTimeCounterRef.current++;
        console.log(`⚠️ Stall check: time stale for ${staleTimeCounterRef.current * 2}s (${currentElementTime.toFixed(1)}s)`);

        // Trigger recovery after 3 consecutive stale checks (6 seconds)
        if (staleTimeCounterRef.current >= 3) {
          attemptStallRecovery(currentElement, currentElementTime);
        }
      } else {
        // Time is advancing - reset counters
        if (staleTimeCounterRef.current > 0) {
          console.log('✅ Playback resumed naturally');
        }
        staleTimeCounterRef.current = 0;
        recoveryAttemptRef.current = 0;
      }

      // Update last known time
      lastKnownTimeRef.current = currentElementTime;
    };

    const attemptStallRecovery = async (element: HTMLMediaElement, stallTime: number) => {
      const attempt = ++recoveryAttemptRef.current;
      const currentSession = playbackSessionRef.current;

      console.log(`🔧 Stall recovery attempt ${attempt} at ${stallTime.toFixed(1)}s`);

      // Prevent infinite loops - max 4 recovery attempts
      if (attempt > 4) {
        console.log('⏭️ Max recovery attempts reached, auto-skipping to next track');
        recoveryAttemptRef.current = 0;
        staleTimeCounterRef.current = 0;
        if (playNextTrackRef.current && playbackSessionRef.current === currentSession) {
          playNextTrackRef.current();
        }
        return;
      }

      try {
        if (attempt === 1) {
          // Attempt 1: Simple resume
          console.log('🔧 Recovery: Attempting simple resume');
          await element.play();
        } else if (attempt === 2) {
          // Attempt 2: Seek nudge - move forward slightly to unstick decoder
          console.log('🔧 Recovery: Attempting seek nudge');
          element.currentTime = stallTime + 0.1;
          await element.play();
        } else if (attempt === 3) {
          // Attempt 3: Reload at position
          console.log('🔧 Recovery: Attempting source reload');
          const savedTime = element.currentTime;
          element.load();
          element.currentTime = savedTime;
          await element.play();
        } else if (attempt === 4) {
          // Attempt 4: Skip to next track
          console.log('⏭️ Recovery: Skipping to next track');
          recoveryAttemptRef.current = 0;
          staleTimeCounterRef.current = 0;
          if (playNextTrackRef.current && playbackSessionRef.current === currentSession) {
            playNextTrackRef.current();
          }
        }

        // Reset stale counter after recovery attempt (give it a chance)
        staleTimeCounterRef.current = 0;
      } catch (error) {
        console.warn(`⚠️ Recovery attempt ${attempt} failed:`, error);
        // Let next check cycle try next recovery method
      }
    };

    // Start the stall check interval (every 2 seconds)
    stallCheckIntervalRef.current = setInterval(checkForStall, 2000);

    // Initialize last known time
    const currentElement = isVideoMode ? videoRef.current : getActiveAudioEl();
    if (currentElement) {
      lastKnownTimeRef.current = currentElement.currentTime;
    }

    // Cleanup
    return () => {
      if (stallCheckIntervalRef.current) {
        clearInterval(stallCheckIntervalRef.current);
        stallCheckIntervalRef.current = null;
      }
    };
  }, [isPlaying, isVideoMode]);

  // Helper function to proxy external image URLs for media session
  const getProxiedMediaImageUrl = (imageUrl: string): string => {
    // 1.60 MB for a lock-screen thumbnail the OS scales to a few hundred
    // pixels. /album-placeholder-thumbnail.png is 12 KB and exists for this.
    if (!imageUrl) return fallbackArtworkSrc(isDataSaverOn(), '/stablekraft-rocket.png');

    // If it's already a local/proxied URL, return as-is
    if (imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')) {
      return imageUrl;
    }

    // Proxy external URLs to avoid CORS issues
    return `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;
  };

  // Helper function to update media session metadata
  const updateMediaSession = (album: RSSAlbum, track: any) => {
    if ('mediaSession' in navigator && navigator.mediaSession && !isNativeAndroid()) {
      try {
        // Ensure we have valid artwork URL - prefer track image, then album cover
        let originalArtworkUrl = track.image || album.coverArt || fallbackArtworkSrc(isDataSaverOn(), '/stablekraft-rocket.png');

        // Proxy external URLs to avoid CORS issues
        let artworkUrl = getProxiedMediaImageUrl(originalArtworkUrl);

        // If the URL is relative, make it absolute
        if (artworkUrl.startsWith('/')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://stablekraft.app';
          artworkUrl = `${baseUrl}${artworkUrl}`;
        }
        
        // Build artwork array — direct HTTPS URL first (fast), proxy fallback second
        const artworkSizes: Array<{src: string; sizes: string}> = [];

        // If original artwork is an external HTTPS URL, use it directly as primary (no proxy latency)
        if (originalArtworkUrl.startsWith('https://')) {
          ['512x512', '256x256', '96x96'].forEach(size => {
            artworkSizes.push({ src: originalArtworkUrl, sizes: size });
          });
        }

        // Add proxied/local URL as fallback (or primary if no external URL)
        ['512x512', '256x256', '96x96'].forEach(size => {
          artworkSizes.push({ src: artworkUrl, sizes: size });
        });

        // Deduplicate if original and proxied are the same (e.g. local images)
        const seen = new Set<string>();
        const artwork = artworkSizes.filter(entry => {
          const key = `${entry.src}|${entry.sizes}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || 'Unknown Track',
          artist: track.artist || album.artist || 'Unknown Artist',
          album: album.title || 'Unknown Album',
          artwork: artwork
        });

        // NOTE: Action handlers are registered ONCE in early init useEffect
        // We don't re-register them here to avoid issues on iOS where
        // re-registering can cause stale closures or handler conflicts

        // Set position state (required for iOS lockscreen controls)
        const currentElement = isVideoMode ? videoRef.current : getActiveAudioEl();
        if (currentElement && currentElement.duration && !isNaN(currentElement.duration)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: currentElement.duration,
              playbackRate: currentElement.playbackRate || 1.0,
              position: currentElement.currentTime || 0
            });
          } catch (error) {
            console.warn('Failed to set position state:', error);
          }
        }

        // Note: playbackState is now managed by handlePlay/handlePause event handlers
        // to avoid race conditions with state updates
        
        console.log('📱 Media session metadata updated:', {
          title: track.title,
          artist: track.artist || album.artist,
          album: album.title,
          originalArtwork: originalArtworkUrl,
          proxiedArtwork: artworkUrl,
          playbackState: navigator.mediaSession.playbackState
        });
      } catch (error) {
        console.warn('Failed to update media session:', error);
      }
    }

    // Native Android: push the same now-playing data to the lock-screen MediaSession.
    if (isNativeAndroid()) {
      try {
        const originalArtworkUrl = track.image || album.coverArt || fallbackArtworkSrc(isDataSaverOn(), '/stablekraft-rocket.png');
        let artworkUrl = getProxiedMediaImageUrl(originalArtworkUrl);
        if (artworkUrl.startsWith('/')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://stablekraft.app';
          artworkUrl = `${baseUrl}${artworkUrl}`;
        }
        const el = isVideoMode ? videoRef.current : getActiveAudioEl();
        const duration = el && el.duration && !isNaN(el.duration) ? Math.round(el.duration * 1000) : 0;
        nativeMedia('updateMetadata', {
          title: track.title || 'Unknown Track',
          artist: track.artist || album.artist || 'Unknown Artist',
          album: album.title || 'Unknown Album',
          artworkUrl: originalArtworkUrl.startsWith('https://') ? originalArtworkUrl : artworkUrl,
          duration,
        });
      } catch {
        // Best-effort.
      }
    }
  };

  /**
   * Load a track into the active element and leave it PAUSED at its start.
   *
   * Used when playback stops but the UI must keep showing a *different* track than
   * the one that was playing — end of album with repeat off, which rewinds to track 1.
   * The now-playing bar derives its title from `currentTrackIndex` alone, so moving
   * the index without moving the media is what made the player show track 1 while
   * track N kept playing.
   *
   * Deliberately NOT playAlbum: that autoplays, sets hasUserInteracted, clears
   * userInitiatedPauseRef, flips shuffle off, runs the seamless/ping-pong transition
   * and toasts through the offline gate — none of which is right for a silent cue.
   *
   * On ANY failure the element is left EMPTY, which is a designed fallback rather
   * than a giving-up: resume()'s cold-start check (`hasUsableSrc`) then reads false
   * and routes the next tap through playAlbum. The one thing this must never do is
   * leave the previous track's bytes loaded under a new title.
   */
  const cueTrackPaused = async (album: RSSAlbum, trackIndex: number): Promise<void> => {
    const track: any = album?.tracks?.[trackIndex];
    const active = getActiveAudioEl();
    const idle = getIdleAudioEl();

    // Both elements must go silent. After a ping-pong swap the idle one can still
    // hold a live or preloaded source — stop() pauses both for the same reason.
    try { idle?.pause(); } catch { /* element may be mid-teardown */ }
    try { active?.pause(); } catch { /* element may be mid-teardown */ }

    // Invalidate any in-flight playback attempt so a late resolve can't restart audio.
    ++playbackSessionRef.current;
    cancelPendingAutoSkip();

    const clearElement = (el: HTMLMediaElement | null) => {
      if (!el) return;
      try { el.removeAttribute('src'); el.load(); } catch { /* best effort */ }
    };

    // Video/HLS: don't try to cue. Tear the video element down so the next play
    // cold-starts through playAlbum, which knows how to set HLS up again.
    if (isVideoMode || (track && isVideoUrl(getTrackPlaybackUrl(track), track.mediaType))) {
      try { videoRef.current?.pause(); } catch { /* best effort */ }
      clearElement(videoRef.current);
      if (hlsRef.current) {
        try { hlsRef.current.destroy(); } catch { /* best effort */ }
        hlsRef.current = null;
      }
      setIsVideoMode(false);
      clearElement(active);
      return;
    }

    if (!active || !track?.url) { clearElement(active); return; }

    // Offline mode: never hit the network for a cue, and never toast about it —
    // the user didn't ask for anything. playAlbum's gate explains itself on the
    // next tap of play.
    if (isOfflineModeOn()) {
      let downloaded = false;
      try {
        await downloadManager.init();
        downloaded = downloadManager.isTrackDownloaded(track);
      } catch {
        // If we can't tell, treat as not downloaded — offline mode is intentional.
      }
      if (!downloaded) { clearElement(active); return; }
    }

    await prepareLocalSource(track);

    const raw = getTrackPlaybackUrl(track);
    // Same first candidate attemptAudioPlayback would pick, so the cued URL and the
    // eventual play URL agree (and the HTTP cache is warm for the next tap).
    let url = getAudioUrlsToTry(raw)[0] || raw;
    if (url.startsWith('http://')) url = url.replace(/^http:/, 'https:');
    if (!url) { clearElement(active); return; }

    try {
      active.src = url;
      // load() also clears `ended`, which is what stops the foreground-return net
      // from treating a finished album as a failed background advance.
      active.load();
    } catch {
      clearElement(active);
    }
  };

  // Play album function
  const playAlbum = async (album: RSSAlbum, trackIndex: number = 0): Promise<boolean> => {
    if (!album.tracks || album.tracks.length === 0) {
      console.error('❌ No tracks found in album');
      return false;
    }

    const track = album.tracks[trackIndex];
    if (!track || !track.url) {
      console.error('❌ No valid track found at index', trackIndex);
      return false;
    }

    // Offline mode (QoS): don't attempt to stream a non-downloaded track.
    if (await blockNonDownloadedInOfflineMode(track)) return false;

    // Prefer a downloaded copy if this track was saved for offline.
    await prepareLocalSource(track);

    // Set loading state immediately for UI feedback
    setIsLoading(true);

    // Increment session ID to cancel any stale playback attempts
    const sessionId = ++playbackSessionRef.current;
    // Cancel any pending auto-skip from previous track failures
    cancelPendingAutoSkip();
    // Reset stall detection counters for new track
    staleTimeCounterRef.current = 0;
    recoveryAttemptRef.current = 0;
    userInitiatedPauseRef.current = false; // New track = not user-paused
    albumCompleteRef.current = false; // Playback restarting — re-arm the foreground-return net
    console.log(`🎵 Starting playback session ${sessionId}`);

    // Since playAlbum is called from user clicks, we can safely set hasUserInteracted
    if (!hasUserInteracted) {
      console.log('🎵 First user interaction detected - enabling audio');
      setHasUserInteracted(true);
    }

    // IMPORTANT: Update state BEFORE attempting playback
    // This ensures NIP-38 status publishing has access to correct track info
    setCurrentPlayingAlbum(album);
    setCurrentTrackIndex(trackIndex);

    // Reset currentTime immediately when switching tracks to avoid stale time showing in UI
    // This is especially important on iOS where timeupdate events may be delayed
    const startTime = track.startTime && typeof track.startTime === 'number' ? track.startTime : 0;
    // If this play is a cold-start resume, seed the UI with the restored
    // position rather than the track's start — otherwise the now-playing bar
    // visibly snaps 3:12 → 0:00 and back once metadata lands.
    const pendingResume = pendingResumeSeekRef.current;
    const resumeSeed =
      pendingResume &&
      pendingResume.trackIndex === trackIndex &&
      pendingResume.albumKey === albumSessionKey(album)
        ? resolveResumePosition({
            position: pendingResume.position,
            startTime: track.startTime,
            endTime: track.endTime,
          })
        : null;
    const uiStartTime = resumeSeed ?? startTime;
    setCurrentTime(uiStartTime);
    // New track: reset the recovery position so a prior track's position can't
    // leak into this one's resume-after-background restore.
    lastNonZeroPositionRef.current = uiStartTime;

    // When manually playing an album/track, always exit shuffle mode
    // This ensures shuffle is turned off when you play something specific
    setIsShuffleMode(false);
    setShuffledPlaylist([]);
    setCurrentShuffleIndex(0);

    // Detect if this is a track transition (same album, different track while playing)
    // This is critical for iOS PWA background playback
    // Also check isAutoTransitioningRef for when track ended naturally (iOS fires pause before ended)
    const isTrackTransition = (currentPlayingAlbum?.id === album.id &&
                               currentTrackIndex !== trackIndex &&
                               isPlaying) || isAutoTransitioningRef.current;

    if (isTrackTransition) {
      console.log('🔄 Track transition detected, using seamless playback for iOS', {
        isPlaying,
        isAutoTransitioning: isAutoTransitioningRef.current
      });
      // Android: try the gapless ping-pong path first. Starting the next track on
      // a second element (while this one still plays) survives locked-screen
      // background transitions that a same-element load()+play() would stall.
      if (isAndroidRef.current && !isVideoMode) {
        const pingPongSuccess = await attemptPingPongPlayback(track, album, sessionId);
        if (pingPongSuccess) {
          isAutoTransitioningRef.current = false;
          if (playbackSessionRef.current !== sessionId) return false;
          console.log('✅ Android ping-pong track transition successful');
          return true;
        }
        // Fall through to seamless/full playback on failure.
      }
      // Try seamless playback first for iOS background compatibility
      const seamlessSuccess = await attemptSeamlessPlayback(getTrackPlaybackUrl(track), 'Track transition', sessionId, track.mediaType);
      // Clear auto-transitioning flag after attempt
      isAutoTransitioningRef.current = false;
      if (seamlessSuccess) {
        // Check if session is still current before updating state
        if (playbackSessionRef.current !== sessionId) {
          console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
          return false;
        }
        setIsLoading(false); // Clear loading on success
        updateMediaSession(album, track);
        console.log('✅ Seamless track transition successful');
        return true;
      }
      // If backgrounded, don't fall through to attemptAudioPlayback — same reasoning as
      // playShuffledTrack: .pause()/.removeAttribute('src')/.load() destroys the iOS session.
      // Track is loaded with the new src; foreground-return handler will call resume().
      if (document.visibilityState !== 'visible') {
        console.log('📱 Background seamless failed — leaving track loaded for foreground resume');
        isAutoTransitioningRef.current = false;
        return false;
      }
      // If seamless fails in foreground, fall through to normal playback
      console.log('⚠️ Seamless playback failed, trying full playback');
    }

    // Clear auto-transitioning flag before full playback attempt
    isAutoTransitioningRef.current = false;

    // Try to play the track (full playback for fresh starts or fallback)
    const success = await attemptAudioPlayback(getTrackPlaybackUrl(track), 'Album playback', sessionId, track.mediaType);

    // Check if session is still current before updating state
    if (playbackSessionRef.current !== sessionId) {
      console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
      return false;
    }

    // Clear loading state
    setIsLoading(false);

    if (success) {
      // Update media session for lockscreen display
      updateMediaSession(album, track);

      console.log('✅ Playback started successfully');
      return true;
    } else {
      // Only show retry message if it's a browser autoplay restriction
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        console.log('📱 Mobile playback failed - may need another tap');
        toast.info('Tap the play button once more to enable audio', { duration: 3000 });
      }
      return false;
    }
  };

  // Play shuffled track function
  const playShuffledTrack = async (index: number): Promise<boolean> => {
    if (!shuffledPlaylist[index]) {
      console.error('❌ Invalid shuffle track index:', index, 'playlist length:', shuffledPlaylist.length);
      return false;
    }

    const trackData = shuffledPlaylist[index];
    const track = trackData.track;
    const album = trackData.album;

    if (!track || !track.url) {
      console.error('❌ No valid track found in shuffled playlist');
      return false;
    }

    // Offline mode (QoS): don't attempt to stream a non-downloaded track.
    if (await blockNonDownloadedInOfflineMode(track)) return false;

    albumCompleteRef.current = false; // Playback restarting

    // Prefer a downloaded copy if this track was saved for offline.
    await prepareLocalSource(track);

    // Increment session ID to cancel any stale playback attempts
    const sessionId = ++playbackSessionRef.current;
    // Cancel any pending auto-skip from previous track failures
    cancelPendingAutoSkip();
    console.log(`🎵 Starting shuffle playback session ${sessionId}`);

    // IMPORTANT: Update state BEFORE attempting playback
    setCurrentPlayingAlbum(album);
    setCurrentTrackIndex(trackData.trackIndex);
    setCurrentShuffleIndex(index);
    setHasUserInteracted(true);

    // Reset currentTime immediately when switching tracks to avoid stale time showing in UI
    const startTime = track.startTime && typeof track.startTime === 'number' ? track.startTime : 0;
    setCurrentTime(startTime);
    // New track: reset the recovery position so a prior track's position can't
    // leak into this one's resume-after-background restore.
    lastNonZeroPositionRef.current = startTime;

    // In shuffle mode, if we're playing or auto-transitioning, use seamless playback for iOS background
    if (isPlaying || isAutoTransitioningRef.current) {
      console.log('🔄 Shuffle track transition, using seamless playback for iOS', {
        isPlaying,
        isAutoTransitioning: isAutoTransitioningRef.current
      });
      // Android: gapless ping-pong first (see playAlbum for rationale).
      if (isAndroidRef.current && !isVideoMode) {
        const pingPongSuccess = await attemptPingPongPlayback(track, album, sessionId);
        if (pingPongSuccess) {
          isAutoTransitioningRef.current = false;
          if (playbackSessionRef.current !== sessionId) return false;
          console.log('✅ Android ping-pong shuffle transition successful');
          return true;
        }
        // Fall through to seamless/full playback on failure.
      }
      const seamlessSuccess = await attemptSeamlessPlayback(getTrackPlaybackUrl(track), 'Shuffle track transition', sessionId, track.mediaType);
      // Clear auto-transitioning flag after attempt
      isAutoTransitioningRef.current = false;
      if (seamlessSuccess) {
        // Check if session is still current before updating state
        if (playbackSessionRef.current !== sessionId) {
          console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
          return false;
        }
        updateMediaSession(album, track);
        console.log('✅ Seamless shuffle transition successful');
        return true;
      }
      // If backgrounded, don't fall through to attemptAudioPlayback — it calls .pause() /
      // .removeAttribute('src') / .load() which destroys the iOS audio session and leaves
      // the element in a worse state. The track is already loaded with the new src from the
      // seamless attempt; the foreground-return visibility handler will call resume() to
      // start it once the user switches back.
      if (document.visibilityState !== 'visible') {
        console.log('📱 Background seamless failed — leaving track loaded for foreground resume');
        return false;
      }
      console.log('⚠️ Seamless playback failed, trying full playback');
    }

    const success = await attemptAudioPlayback(getTrackPlaybackUrl(track), 'Shuffled track playback', sessionId, track.mediaType);
    // Check if session is still current before updating state
    if (playbackSessionRef.current !== sessionId) {
      console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
      return false;
    }
    if (success) {
      // Update media session for lockscreen display
      updateMediaSession(album, track);
    }
    return success;
  };

  // Shuffle all tracks function
  const shuffleAllTracks = async (): Promise<boolean> => {
    /**
     * Resolve the shuffle pool from the REF, never from `albums`.
     *
     * This function is recreated on each render and captures `albums` by value,
     * so anything loaded while we await below is invisible to the closure. The
     * wait loop this replaces re-read that same captured const and could only
     * escape through `albumsLoadedRef`; the check after it then read the stale
     * value again and refused a shuffle whose data had in fact just arrived.
     * That is why RadioClient has to call this twice.
     */
    let pool = albumsRef.current;

    if (pool.length === 0) {
      /**
       * START the load, do not merely wait for one. Under Data Saver the mount
       * effect deliberately does not fetch the catalogue, so waiting alone is a
       * five-second pause followed by a refusal — nobody is loading anything.
       */
      if (!albumsLoadedRef.current && loadAlbumsRef.current) {
        console.log('⏳ Loading albums for shuffle...');
        await loadAlbumsRef.current(0);
        pool = albumsRef.current;
      }

      // Still empty: a load started elsewhere is in flight. Wait for it.
      if (pool.length === 0) {
        console.log('⏳ Waiting for albums to load before shuffle...');
        for (let i = 0; i < 50; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          pool = albumsRef.current;
          if (pool.length > 0) break;
        }
      }

      if (pool.length === 0) {
        console.warn('No albums available for shuffle after waiting');
        return false;
      }
    }

    // Clear any existing shuffle state to ensure a fresh random shuffle
    setShuffledPlaylist([]);
    setCurrentShuffleIndex(0);
    setIsShuffleMode(false);
    // NOTE: this deliberately does NOT delete the saved playback session.
    // It used to, to stop a stale shuffle order being restored — a concern that
    // no longer exists now that shuffle isn't persisted. Deleting it here meant
    // a single visit to /radio (RadioClient calls shuffleAllTracks on load)
    // wiped the user's resume point.

    // Create a flat array of all tracks with their album info
    const allTracks: Array<{
      album: RSSAlbum;
      trackIndex: number;
      track: any;
    }> = [];

    let skippedPlaylists = 0;
    let skippedTracks = 0;
    let includedAlbums = 0;

    pool.forEach(album => {
      // Skip playlist albums from global shuffle (playlists have feedId ending with '-playlist')
      if (album.feedId?.endsWith('-playlist')) {
        skippedPlaylists++;
        return;
      }
      includedAlbums++;
      if (album.tracks && album.tracks.length > 0) {
        album.tracks.forEach((track, trackIndex) => {
          // Skip tracks without valid audio URLs
          if (!track.url || track.url === '' || track.url.endsWith('.xml') || track.url.endsWith('/feed')) {
            skippedTracks++;
            return;
          }
          if (track.guid && SHUFFLE_EXCLUDED_TRACK_GUIDS.has(track.guid)) {
            skippedTracks++;
            return;
          }
          allTracks.push({
            album,
            trackIndex,
            track
          });
        });
      }
    });

    console.log(`🎲 Shuffle pool: ${includedAlbums} albums, ${allTracks.length} playable tracks (skipped ${skippedPlaylists} playlists, ${skippedTracks} tracks without audio URL)`);

    if (allTracks.length === 0) {
      console.warn('No tracks available for shuffle');
      return false;
    }

    // Simple Fisher-Yates shuffle - pure random
    const shuffledTracks = [...allTracks];
    for (let i = shuffledTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
    }

    console.log(`🎲 Random shuffle: ${shuffledTracks.length} tracks`);

    // Set up shuffle state
    setShuffledPlaylist(shuffledTracks);
    setCurrentShuffleIndex(0);
    setIsShuffleMode(true);

    // Play the first track in the shuffled playlist
    const firstTrack = shuffledTracks[0];
    console.log('🎲 Starting shuffle with:', firstTrack.track.title, 'from', firstTrack.album.title);

    // Play the first track directly using the local shuffledTracks array to avoid race condition
    const track = firstTrack.track;
    const album = firstTrack.album;

    if (!track || !track.url) {
      console.error('❌ No valid track found in shuffled playlist');
      return false;
    }

    // Increment session ID to cancel any stale playback attempts
    const sessionId = ++playbackSessionRef.current;
    // Cancel any pending auto-skip from previous track failures
    cancelPendingAutoSkip();
    console.log(`🎵 Starting shuffleAll playback session ${sessionId}`);

    // IMPORTANT: Update state BEFORE attempting playback
    setCurrentPlayingAlbum(album);
    setCurrentTrackIndex(firstTrack.trackIndex);
    setCurrentShuffleIndex(0);
    setHasUserInteracted(true);

    const success = await attemptAudioPlayback(getTrackPlaybackUrl(track), 'Shuffled track playback', sessionId, track.mediaType);

    // Check if session is still current before updating state
    if (playbackSessionRef.current !== sessionId) {
      console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
      return false;
    }

    // If initial track failed, auto-skip to find a playable track
    if (!success) {
      console.log('⏭️ Initial shuffle track failed, auto-skipping to next...');
      const currentSession = playbackSessionRef.current;
      setTimeout(() => {
        // Only auto-skip if no new session started
        if (playbackSessionRef.current === currentSession && playNextTrackRef.current) {
          playNextTrackRef.current();
        }
      }, 500);
      // Return true so caller doesn't show error - we're handling it
      return true;
    }

    // Prefetch upcoming tracks in the background for smooth radio playback
    if (shuffledTracks.length > 1) {
      const upcomingTracks = shuffledTracks.slice(1, 4).map(item => item.track);
      prefetchUpcomingTracks(upcomingTracks, 0).catch(() => {
        // Silent fail - prefetching is best-effort
      });
    }

    return success;
  };

  // Shuffle specific albums (for page-specific shuffle like publisher pages)
  const shuffleAlbums = async (albumsToShuffle: RSSAlbum[]): Promise<boolean> => {
    if (!albumsToShuffle || albumsToShuffle.length === 0) {
      console.warn('No albums provided for shuffle');
      return false;
    }

    // Clear any existing shuffle state to ensure a fresh random shuffle
    setShuffledPlaylist([]);
    setCurrentShuffleIndex(0);
    setIsShuffleMode(false);
    // Deliberately does not delete the saved playback session — see the note in
    // shuffleAllTracks above.

    // Create a flat array of all tracks with their album info
    const allTracks: Array<{
      album: RSSAlbum;
      trackIndex: number;
      track: any;
    }> = [];

    let skippedTracks = 0;
    albumsToShuffle.forEach(album => {
      if (album.tracks && album.tracks.length > 0) {
        album.tracks.forEach((track, trackIndex) => {
          // Skip tracks without valid audio URLs
          if (!track.url || track.url === '' || track.url.endsWith('.xml') || track.url.endsWith('/feed')) {
            skippedTracks++;
            return;
          }
          allTracks.push({
            album,
            trackIndex,
            track
          });
        });
      }
    });

    console.log(`🎲 Page shuffle pool: ${albumsToShuffle.length} albums, ${allTracks.length} playable tracks (skipped ${skippedTracks} without audio URL)`);

    if (allTracks.length === 0) {
      console.warn('No tracks available for shuffle');
      return false;
    }

    // Simple Fisher-Yates shuffle - pure random
    const shuffledTracks = [...allTracks];
    for (let i = shuffledTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledTracks[i], shuffledTracks[j]] = [shuffledTracks[j], shuffledTracks[i]];
    }

    console.log(`🎲 Random shuffle: ${shuffledTracks.length} tracks`);

    // Set up shuffle state
    setShuffledPlaylist(shuffledTracks);
    setCurrentShuffleIndex(0);
    setIsShuffleMode(true);

    // Play the first track in the shuffled playlist
    const firstTrack = shuffledTracks[0];
    console.log('🎲 Starting shuffle with:', firstTrack.track.title, 'from', firstTrack.album.title);

    const track = firstTrack.track;
    const album = firstTrack.album;

    if (!track || !track.url) {
      console.error('❌ No valid track found in shuffled playlist');
      return false;
    }

    // Increment session ID to cancel any stale playback attempts
    const sessionId = ++playbackSessionRef.current;
    // Cancel any pending auto-skip from previous track failures
    cancelPendingAutoSkip();
    console.log(`🎵 Starting shuffleAlbums playback session ${sessionId}`);

    // IMPORTANT: Update state BEFORE attempting playback
    setCurrentPlayingAlbum(album);
    setCurrentTrackIndex(firstTrack.trackIndex);
    setCurrentShuffleIndex(0);
    setHasUserInteracted(true);

    const success = await attemptAudioPlayback(getTrackPlaybackUrl(track), 'Shuffled track playback', sessionId, track.mediaType);

    // Check if session is still current before updating state
    if (playbackSessionRef.current !== sessionId) {
      console.log(`⏭️ Session ${sessionId} completed but newer session active, skipping state update`);
      return false;
    }

    // If initial track failed, auto-skip to find a playable track
    if (!success) {
      console.log('⏭️ Initial shuffle track failed, auto-skipping to next...');
      const currentSession = playbackSessionRef.current;
      setTimeout(() => {
        // Only auto-skip if no new session started
        if (playbackSessionRef.current === currentSession && playNextTrackRef.current) {
          playNextTrackRef.current();
        }
      }, 500);
      return true;
    }

    // Prefetch upcoming tracks in the background for smooth playback
    if (shuffledTracks.length > 1) {
      const upcomingTracks = shuffledTracks.slice(1, 4).map(item => item.track);
      prefetchUpcomingTracks(upcomingTracks, 0).catch(() => {
        // Silent fail - prefetching is best-effort
      });
    }

    return success;
  };

  // Pause function - uses DOM ID as fallback for reliability
  const pause = () => {
    userInitiatedPauseRef.current = true;

    let currentElement: HTMLAudioElement | HTMLVideoElement | null = isVideoMode
      ? videoRef.current
      : getActiveAudioEl();

    if (!currentElement) {
      currentElement = isVideoMode
        ? document.getElementById('stablekraft-video-player') as HTMLVideoElement
        : document.getElementById('stablekraft-audio-player') as HTMLAudioElement;
    }

    if (currentElement) {
      currentElement.pause();
      setIsPlaying(false);
      // Pausing is a natural "I'm stopping here" moment — flush the resume
      // position past the throttle so it's exact if the user leaves now.
      savePositionRef.current?.();
    }
  };

  // Resume function — tiered recovery for iOS PWA pause/resume.
  // Tier 1: plain play(). Tier 2: load() + wait for canplay + play() (fixes stale-buffer
  // state iOS PWA falls into after extended pause with Bluetooth earbuds). Tier 3: surface
  // a toast with Retry so the user is never silently stuck.
  const resume = async () => {
    userInitiatedPauseRef.current = false;
    albumCompleteRef.current = false;

    let currentElement: HTMLAudioElement | HTMLVideoElement | null = isVideoMode
      ? videoRef.current
      : getActiveAudioEl();

    if (!currentElement) {
      currentElement = isVideoMode
        ? document.getElementById('stablekraft-video-player') as HTMLVideoElement
        : document.getElementById('stablekraft-audio-player') as HTMLAudioElement;
    }

    if (!currentElement) {
      toast.error("Couldn't resume playback", {
        duration: 8000,
        action: { label: 'Retry', onClick: () => resumeRef.current?.() },
      });
      return;
    }

    // Cold start: the session was restored from storage on mount, so the album
    // is in state but no media element has ever been loaded. Tiers 1-3 below all
    // assume a loaded element — play() on a src-less one throws, load() fails,
    // and the user gets "Couldn't resume playback" on the very first tap. Route
    // through playAlbum instead, which is also our user-gesture entry point.
    //
    // The check is on the ELEMENT, never on state: `pageshow` fires on bfcache
    // restores where the element still holds its src, and treating those as cold
    // starts would restart the track every time the user navigated back.
    const hasUsableSrc =
      !!(currentElement.currentSrc || currentElement.src) &&
      currentElement.networkState !== HTMLMediaElement.NETWORK_EMPTY;

    if (!hasUsableSrc && currentPlayingAlbum?.tracks?.length) {
      pendingResumeSeekRef.current = {
        albumKey: albumSessionKey(currentPlayingAlbum),
        trackIndex: currentTrackIndex,
        // currentTimeRef is authoritative — the `currentTime` closure can still
        // be stale on the first render after a restore.
        position: currentTimeRef.current || currentTime,
        setAt: Date.now(),
      };

      const started = await playAlbum(currentPlayingAlbum, currentTrackIndex);
      if (!started) {
        pendingResumeSeekRef.current = null;
        setIsPlaying(false);
        // Offline mode already explained itself via blockNonDownloadedInOfflineMode;
        // a second toast would just contradict it.
        if (!isOfflineModeOn()) {
          toast.error("Couldn't reload that track — it may no longer be available.", {
            duration: 8000,
            action: { label: 'Dismiss player', onClick: () => stopRef.current?.() },
          });
        }
      }
      // Never fall through to the tiers — they can only fail from here.
      return;
    }

    const el = currentElement;
    const savedTime = el.currentTime;
    // Recovery position for iOS background buffer-eviction: if the element's
    // currentTime has collapsed to ~0 (iOS dropped the buffer while backgrounded),
    // fall back to the last non-zero position we recorded so we resume where the
    // user left off instead of restarting the track from the beginning.
    const recoverTime = savedTime > 1 ? savedTime : lastNonZeroPositionRef.current;
    const shouldRestore = (t: number) =>
      recoverTime > 1 &&
      t < 1 &&
      (!el.duration || isNaN(el.duration) || recoverTime < el.duration - 0.5);

    // Listener-based wait for the element to reach HAVE_CURRENT_DATA after a load().
    const waitForReady = (timeoutMs: number): Promise<void> => {
      return new Promise((resolve) => {
        if (el.readyState >= 2 /* HAVE_CURRENT_DATA */) { resolve(); return; }
        const cleanup = () => {
          el.removeEventListener('loadeddata', onReady);
          el.removeEventListener('canplay', onReady);
          clearTimeout(timer);
        };
        const onReady = () => { cleanup(); resolve(); };
        el.addEventListener('loadeddata', onReady, { once: true });
        el.addEventListener('canplay', onReady, { once: true });
        const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
      });
    };

    // Tier 1 — plain play().
    try {
      await el.play();
      // iOS may have reset currentTime to 0 while backgrounded — seek back so the
      // track resumes where the user left off rather than from the start.
      if (shouldRestore(el.currentTime)) {
        try { el.currentTime = recoverTime; } catch { /* seek can throw pre-buffer */ }
      }
      setIsPlaying(true);
      return;
    } catch (err) {
      console.warn('Resume Tier 1 failed, attempting load+play recovery', err);
    }

    // Tier 2 — load() + wait + play(). Restores stale buffer on iOS PWA.
    try {
      el.load();
      await waitForReady(2000);
      // load() resets currentTime to 0; restore the recovery position (which
      // accounts for an iOS buffer-eviction collapse, not just an in-app pause).
      if (recoverTime > 1 && Math.abs(el.currentTime - recoverTime) > 0.25) {
        el.currentTime = recoverTime;
      }
      await el.play();
      setIsPlaying(true);
      return;
    } catch (err) {
      console.warn('Resume Tier 2 (load+play) failed', err, {
        readyState: el.readyState,
        networkState: el.networkState,
        paused: el.paused,
        currentTime: el.currentTime,
        src: el.currentSrc || el.src,
        isVideoMode,
      });
    }

    // Tier 3 — give up with user-visible feedback.
    setIsPlaying(false);
    toast.error("Couldn't resume playback", {
      duration: 8000,
      action: { label: 'Retry', onClick: () => resumeRef.current?.() },
    });
  };

  // Update pause/resume refs for media session handlers (no deps — must stay current every render)
  useEffect(() => {
    pauseRef.current = pause;
  });

  useEffect(() => {
    resumeRef.current = resume;
  });

  useEffect(() => {
    stopRef.current = stop;
  });

  // Seek function
  const seek = (time: number) => {
    const currentElement = isVideoMode ? videoRef.current : getActiveAudioEl();
    if (currentElement && duration) {
      // Mark as manual seek so VTS detection doesn't trigger autoboost
      isManualSeekRef.current = true;
      // Validate time value
      const validTime = Math.max(0, Math.min(time, duration));

      // Cold start: the session was restored but nothing is loaded yet, so this
      // element has no src. Writing currentTime on it does nothing and reads
      // back 0 — which would then be persisted, meaning one stray tap on the
      // restored progress bar destroyed the saved position. Move the intent,
      // not the element: update the UI and the pending resume target instead.
      const hasUsableSrc =
        !!(currentElement.currentSrc || currentElement.src) &&
        currentElement.networkState !== HTMLMediaElement.NETWORK_EMPTY;
      if (!hasUsableSrc && currentPlayingAlbum?.tracks?.length) {
        setCurrentTime(validTime);
        // savePosition reads the ref, not the state — keep them in step.
        currentTimeRef.current = validTime;
        lastNonZeroPositionRef.current = validTime;
        pendingResumeSeekRef.current = {
          albumKey: albumSessionKey(currentPlayingAlbum),
          trackIndex: currentTrackIndex,
          position: validTime,
          setAt: Date.now(),
        };
        // force: this is an explicit user scrub, not an incidental timeupdate,
        // so it must persist even though we just armed the resume ref above.
        savePositionRef.current?.({ force: true });
        return;
      }
      
      // Check if the time is reasonable (not too large)
      if (time > duration * 2) {
        console.warn(`⚠️ Seek time ${time}s is much larger than duration ${duration}s, clamping to duration`);
      }
      
      currentElement.currentTime = validTime;
      setCurrentTime(currentElement.currentTime);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🎵 Seeking to time: ${validTime}s (requested: ${time}s, duration: ${duration}s)`);
      }
    } else {
      console.warn('⚠️ Cannot seek: no media element or duration not available');
    }
  };

  // Play next track - moved before useEffect hooks that depend on it
  const playNextTrack = useCallback(async () => {
    // Chapter navigation: if we have real chapters and aren't at the last one, skip to next chapter.
    // OP3 boost-marker chapters are skipped over — they're informational and not meant for navigation.
    // Skipped when shuffle is active — in shuffle, Next should always advance to the next
    // shuffled track rather than stepping through VTS segments of the current show.
    if (!isShuffleMode && !chaptersAreBoostMarkers && chapters.length > 0 && currentChapterIndex >= 0 && currentChapterIndex < chapters.length - 1) {
      const nextChapter = chapters[currentChapterIndex + 1];
      console.debug(`📖 Skipping to next chapter: "${nextChapter.title}" at ${nextChapter.startTime}s`);
      seek(nextChapter.startTime);
      setCurrentChapterIndex(currentChapterIndex + 1);
      return;
    }
    // If at last chapter (or no chapters, or boost markers), fall through to normal next-track behavior

    console.log('⏭️ playNextTrack called from lockscreen', {
      repeatMode,
      currentTrackIndex,
      totalTracks: currentPlayingAlbum?.tracks?.length || 0,
      isShuffleMode
    });

    // Add state validation and recovery logic
    if (!currentPlayingAlbum || !currentPlayingAlbum.tracks || currentPlayingAlbum.tracks.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️ Cannot play next track: missing album or tracks');
        console.log('🔍 Current state:', {
          hasAlbum: !!currentPlayingAlbum,
          hasTracks: !!(currentPlayingAlbum?.tracks),
          trackCount: currentPlayingAlbum?.tracks?.length || 0,
          currentIndex: currentTrackIndex
        });
      }
      
      // Try to recover from IndexedDB if available. This covers the window
      // before the mount restore resolves. It must go through rehydrateAlbum:
      // the persisted record is a projection, not an RSSAlbum, and handing it
      // to playAlbum raw used to dead-end at "No valid track found".
      if (typeof window !== 'undefined') {
        try {
          const savedState = await storage.getItem(PLAYBACK_STATE_KEY);
          if (savedState) {
            const parsedState = typeof savedState === 'string' ? JSON.parse(savedState) : savedState;
            const recovered = rehydrateAlbum(parsedState.album);
            if (recovered) {
              console.log('🔄 Attempting to recover from saved state');
              setCurrentPlayingAlbum(recovered);
              setCurrentTrackIndex(parsedState.currentTrackIndex || 0);
              // Retry after state recovery - using ref to avoid stale closure
              setTimeout(() => {
                if (playNextTrackRef.current) {
                  playNextTrackRef.current();
                }
              }, 100);
              return;
            }
          }
        } catch (error) {
          console.error('❌ Error recovering from IndexedDB:', error);
        }
      }
      
      return;
    }

    if (isShuffleMode && shuffledPlaylist.length > 0) {
      // Handle repeat one mode in shuffle - replay current track
      if (repeatMode === 'one') {
        console.log('🔂 Shuffle: Repeat one mode - replaying current track');
        await playShuffledTrack(currentShuffleIndex);
        return;
      }

      // In shuffle mode, play next track from shuffled playlist
      const nextShuffleIndex = currentShuffleIndex + 1;

      if (nextShuffleIndex < shuffledPlaylist.length) {
        // Play next track in shuffled playlist
        const nextTrack = shuffledPlaylist[nextShuffleIndex];
        console.log('🎲 Playing next shuffled track:', nextTrack.track.title, 'from', nextTrack.album.title);
        const success = await playShuffledTrack(nextShuffleIndex);

        // If playback failed (CORS, unavailable, etc.), auto-skip to next track
        if (!success) {
          console.log('⏭️ Track failed to play, auto-skipping to next...');
          // Cancel any existing pending auto-skip before scheduling a new one
          cancelPendingAutoSkip();
          autoSkipTimeoutRef.current = setTimeout(() => {
            autoSkipTimeoutRef.current = null;
            if (playNextTrackRef.current) {
              playNextTrackRef.current();
            }
          }, 500);
          return;
        }

        // Prefetch upcoming tracks in the background
        const upcomingTracks = shuffledPlaylist.slice(nextShuffleIndex + 1, nextShuffleIndex + 4).map(item => item.track);
        if (upcomingTracks.length > 0) {
          prefetchUpcomingTracks(upcomingTracks, 0).catch(() => {});
        }
      } else {
        // End of shuffled playlist
        if (repeatMode === 'all') {
          // Loop back to the first track
          console.log('🔁 Shuffle: Repeat all - looping back to first track');
          const success = await playShuffledTrack(0);

          // If playback failed, try next track
          if (!success) {
            console.log('⏭️ First track failed to play, trying next...');
            // Cancel any existing pending auto-skip before scheduling a new one
            cancelPendingAutoSkip();
            autoSkipTimeoutRef.current = setTimeout(() => {
              autoSkipTimeoutRef.current = null;
              if (playNextTrackRef.current) {
                playNextTrackRef.current();
              }
            }, 500);
            return;
          }

          // Prefetch upcoming tracks from the start
          const upcomingTracks = shuffledPlaylist.slice(1, 4).map(item => item.track);
          if (upcomingTracks.length > 0) {
            prefetchUpcomingTracks(upcomingTracks, 0).catch(() => {});
          }
        } else {
          // repeatMode === 'none' - stop playback but stay in shuffle mode.
          //
          // No rewind here: a shuffled queue's "first" item is an artifact of the last
          // shuffle, not something the user recognizes, so we stay on the track that
          // just played and its title stays correct. But the stop has to be real —
          // setIsPlaying(false) alone left a manually-skipped track audibly playing,
          // the same defect as the album case below.
          console.log('⏹️ Shuffle: End of playlist reached, stopping playback');
          albumCompleteRef.current = true;
          isAutoTransitioningRef.current = false;
          trackEndProcessedRef.current = false;
          userInitiatedPauseRef.current = true;
          try { getActiveAudioEl()?.pause(); } catch { /* best effort */ }
          try { getIdleAudioEl()?.pause(); } catch { /* best effort */ }
          setIsPlaying(false);
          // Stay in shuffle mode so user can hit play to restart
        }
      }
      return;
    }

    // Normal mode - play next track in current album

    // Handle repeat one mode
    if (repeatMode === 'one') {
      // Replay the same track
      console.log('🔂 Repeat one mode detected - replaying current track');
      await playAlbum(currentPlayingAlbum, currentTrackIndex);
      return;
    }

    // Find the next available (non-unavailable) track
    let nextIndex = currentTrackIndex + 1;
    const totalTracks = currentPlayingAlbum.tracks.length;
    let checkedCount = 0;

    // Skip unavailable tracks
    while (nextIndex < totalTracks && checkedCount < totalTracks) {
      const track = currentPlayingAlbum.tracks[nextIndex];
      if (!track.status || track.status === 'active') {
        break; // Found an available track
      }
      console.log(`⏭️ Skipping unavailable track: ${track.title}`);
      nextIndex++;
      checkedCount++;
    }

    if (nextIndex < totalTracks) {
      // Play next available track in the album
      console.log('🎵 Playing next track:', currentPlayingAlbum.tracks[nextIndex].title, `(${nextIndex + 1}/${totalTracks})`);
      await playAlbum(currentPlayingAlbum, nextIndex);
    } else {
      // End of album reached
      if (repeatMode === 'all') {
        // Loop back to the first available track
        let firstAvailableIndex = 0;
        while (firstAvailableIndex < totalTracks) {
          const track = currentPlayingAlbum.tracks[firstAvailableIndex];
          if (!track.status || track.status === 'active') {
            break;
          }
          firstAvailableIndex++;
        }
        if (firstAvailableIndex < totalTracks) {
          if (process.env.NODE_ENV === 'development') {
            console.log('🔁 Repeat all: looping back to first available track');
          }
          await playAlbum(currentPlayingAlbum, firstAvailableIndex);
        } else {
          // All tracks are unavailable
          console.log('⚠️ All tracks are unavailable, stopping playback');
          setIsPlaying(false);
        }
      } else {
        // repeatMode === 'none' — end of album: rewind to the first available track
        // and STOP there, with that track genuinely loaded and paused at 0:00.
        //
        // This used to be `setIsPlaying(false); setCurrentTrackIndex(0);` and nothing
        // else. Both halves were wrong: setIsPlaying is React state that never pauses
        // the element (so skipping on the last track kept it audibly playing), and
        // moving the index without moving the media made every player show track 1's
        // title while track N's bytes were loaded — the bar derives its title from
        // currentTrackIndex alone.
        if (process.env.NODE_ENV === 'development') {
          console.log('⏹️ End of album reached, rewinding to the first track');
        }

        const rewindIndex = resolveAlbumRewindIndex(currentPlayingAlbum.tracks);

        // Refs first — all of these must land before the await below.
        albumCompleteRef.current = true;
        // handleEnded set this true; only playAlbum ever clears it, so without this
        // the next user-initiated play is forced down the seamless/ping-pong path,
        // which assumes the current element is still playing.
        isAutoTransitioningRef.current = false;
        trackEndProcessedRef.current = false;
        // "Stopped on purpose", not interrupted. The foreground-return net resumes
        // any element that is paused && src && !userInitiatedPause — after the cue
        // all three hold, so without this an app-switch auto-plays track 1.
        userInitiatedPauseRef.current = true;
        pendingResumeSeekRef.current = null;

        setIsPlaying(false);
        setCurrentTrackIndex(rewindIndex ?? 0);

        // resume() falls back to lastNonZeroPositionRef when the element's own
        // currentTime is ~0, which a freshly cued element always is. Left alone, the
        // first tap on play would start track 1 and immediately seek it to wherever
        // the LAST track ended.
        currentTimeRef.current = 0;
        lastNonZeroPositionRef.current = 0;
        setCurrentTime(0);
        setDuration(0);

        // An album that ran to the end has no resume point. The position save effect
        // fires on the duration change below and would otherwise persist the last
        // track's end position next to the rewound index — restoring minutes into
        // the wrong track on the next launch.
        try {
          storage.removeItem(PLAYBACK_POSITION_KEY);
        } catch {
          // Best-effort; a stale position is rejected by MIN_RESUME_SECONDS anyway.
        }

        if (rewindIndex !== null) {
          await cueTrackPaused(currentPlayingAlbum, rewindIndex);
          // The notification would otherwise keep naming the last track. Duration is
          // 0 at cue time; handleLoadedMetadata re-issues this with the real one.
          updateMediaSession(currentPlayingAlbum, currentPlayingAlbum.tracks[rewindIndex]);
          nativeMedia('setPlaybackState', { isPlaying: false, position: 0 });
        } else {
          // Nothing playable to cue — just make sure both elements are silent.
          try { getActiveAudioEl()?.pause(); } catch { /* best effort */ }
          try { getIdleAudioEl()?.pause(); } catch { /* best effort */ }
        }
      }
    }
  }, [currentPlayingAlbum, currentTrackIndex, isShuffleMode, shuffledPlaylist, currentShuffleIndex, playShuffledTrack, playAlbum, repeatMode, chapters, currentChapterIndex, chaptersAreBoostMarkers, seek]);

  // Update the ref whenever playNextTrack changes
  useEffect(() => {
    playNextTrackRef.current = playNextTrack;
  }, [playNextTrack]);

  // Play previous track
  const playPreviousTrack = useCallback(async () => {
    // Chapter navigation: if we have real chapters, go to previous chapter or start of current.
    // OP3 boost-marker chapters are skipped over — prev goes to the previous track instead.
    // Skipped when shuffle is active — in shuffle, Previous should move between shuffled
    // tracks rather than stepping through VTS segments of the current show.
    if (!isShuffleMode && !chaptersAreBoostMarkers && chapters.length > 0 && currentChapterIndex >= 0) {
      const currentChapter = chapters[currentChapterIndex];
      const timeIntoChapter = currentTimeRef.current - currentChapter.startTime;

      if (timeIntoChapter > 3 || currentChapterIndex === 0) {
        // More than 3s into chapter (or first chapter): restart current chapter
        console.debug(`📖 Restarting chapter: "${currentChapter.title}" at ${currentChapter.startTime}s`);
        seek(currentChapter.startTime);
        return;
      } else {
        // Less than 3s in: go to previous chapter
        const prevChapter = chapters[currentChapterIndex - 1];
        console.debug(`📖 Skipping to previous chapter: "${prevChapter.title}" at ${prevChapter.startTime}s`);
        seek(prevChapter.startTime);
        setCurrentChapterIndex(currentChapterIndex - 1);
        return;
      }
    }

    console.log('⏮️ playPreviousTrack called from lockscreen');

    if (isShuffleMode && shuffledPlaylist.length > 0) {
      // In shuffle mode, play previous track from shuffled playlist
      const prevShuffleIndex = currentShuffleIndex - 1;

      if (prevShuffleIndex >= 0) {
        // Play previous track in shuffled playlist
        const prevTrack = shuffledPlaylist[prevShuffleIndex];
        console.log('🎲 Playing previous shuffled track:', prevTrack.track.title, 'from', prevTrack.album.title);
        await playShuffledTrack(prevShuffleIndex);
      } else {
        // Go to the last track in shuffled playlist
        const lastIndex = shuffledPlaylist.length - 1;
        const lastTrack = shuffledPlaylist[lastIndex];
        console.log('🎲 Playing last shuffled track:', lastTrack.track.title, 'from', lastTrack.album.title);
        await playShuffledTrack(lastIndex);
      }
      return;
    }

    // Normal mode - play previous track in current album
    if (!currentPlayingAlbum || !currentPlayingAlbum.tracks) {
      console.warn('⚠️ Cannot play previous track: missing album or tracks');
      return;
    }

    const prevIndex = currentTrackIndex - 1;
    if (prevIndex >= 0) {
      console.log('🎵 Playing previous track:', currentPlayingAlbum.tracks[prevIndex].title);
      await playAlbum(currentPlayingAlbum, prevIndex);
    } else {
      console.log('⚠️ Already at first track');
    }
  }, [isShuffleMode, shuffledPlaylist, currentShuffleIndex, playShuffledTrack, currentPlayingAlbum, currentTrackIndex, playAlbum, chapters, currentChapterIndex, chaptersAreBoostMarkers, seek]);

  // Update the ref whenever playPreviousTrack changes
  useEffect(() => {
    playPreviousTrackRef.current = playPreviousTrack;
  }, [playPreviousTrack]);

  // Load chapters when track changes — use pre-loaded data from DB, fallback to API fetch
  useEffect(() => {
    if (!currentPlayingAlbum) return;
    const track = currentPlayingAlbum.tracks[currentTrackIndex];
    if (!track) return;

    const trackKey = `${track.chaptersUrl || track.id || ''}-${track.title}`;

    // Only process if this is a different track
    if (trackKey === chaptersTrackKeyRef.current) return;
    chaptersTrackKeyRef.current = trackKey;

    const isBoostChapters = isBoostChaptersUrl(track.chaptersUrl);

    // Use pre-loaded chapters from DB if available
    if (track.chapters && Array.isArray(track.chapters) && track.chapters.length > 0) {
      setChapters(track.chapters);
      setCurrentChapterIndex(0);
      setChaptersAreBoostMarkers(isBoostChapters);
      console.debug(`📖 Using ${track.chapters.length} pre-loaded chapters for: ${track.title}${isBoostChapters ? ' (boost markers)' : ''}`);
      return;
    }

    // No pre-loaded chapters and no URL — clear
    if (!track.chaptersUrl) {
      setChapters([]);
      setCurrentChapterIndex(-1);
      setChaptersAreBoostMarkers(false);
      return;
    }

    // Fallback: fetch chapters from API proxy
    const controller = new AbortController();
    fetch(`/api/chapters?url=${encodeURIComponent(track.chaptersUrl)}`, {
      signal: controller.signal,
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.chapters?.length > 0) {
          setChapters(data.chapters);
          setCurrentChapterIndex(0);
          setChaptersAreBoostMarkers(isBoostChapters);
          console.debug(`📖 Fetched ${data.chapters.length} chapters for: ${track.title}${isBoostChapters ? ' (boost markers)' : ''}`);
        } else {
          setChapters([]);
          setCurrentChapterIndex(-1);
          setChaptersAreBoostMarkers(false);
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.warn('Failed to load chapters:', err);
          setChapters([]);
          setCurrentChapterIndex(-1);
          setChaptersAreBoostMarkers(false);
        }
      });

    return () => controller.abort();
  }, [currentPlayingAlbum, currentTrackIndex]);

  // Update current chapter index based on playback position
  useEffect(() => {
    if (chapters.length === 0) return;

    let chapterIdx = -1;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].startTime) {
        chapterIdx = i;
        break;
      }
    }
    if (chapterIdx >= 0 && chapterIdx !== currentChapterIndex) {
      setCurrentChapterIndex(chapterIdx);
    }
  }, [currentTime, chapters, currentChapterIndex]);

  // Play individual track function
  const playTrack = async (audioUrl: string, startTime: number = 0, endTime?: number): Promise<boolean> => {
    // Offline mode (QoS): don't attempt to stream a non-downloaded track.
    if (await blockNonDownloadedInOfflineMode({ url: audioUrl })) return false;
    console.log('🎵 Playing individual track:', { audioUrl, startTime, endTime });

    // Stop any current playback
    stop();
    albumCompleteRef.current = false; // after stop(), which sets it — playback is restarting
    
    // Set user interaction flag
    setHasUserInteracted(true);
    
    // Create a single-track "album" to enable repeat functionality
    const singleTrackAlbum: RSSAlbum = {
      title: 'Single Track',
      artist: 'Unknown Artist',
      description: '',
      coverArt: null,
      releaseDate: new Date().toISOString(),
      tracks: [{
        title: 'Track',
        url: audioUrl,
        startTime,
        endTime,
        duration: '0' // Will be updated when metadata loads
      }]
    };
    
    // Set the album context so repeat works
    setCurrentPlayingAlbum(singleTrackAlbum);
    setCurrentTrackIndex(0);

    // Prefer a downloaded copy if this track was saved for offline.
    await prepareLocalSource({ url: audioUrl });

    // Attempt to play the track
    const success = await attemptAudioPlayback(audioUrl, 'individual track');
    
    if (success && startTime > 0) {
      // Seek to start time after a short delay to ensure media is loaded
      setTimeout(() => {
        console.log('🎵 Seeking to start time:', startTime);
        seek(startTime);
      }, 500);
    }
    
    console.log('🎵 Track playback result:', success);
    return success;
  };

  // Stop function
  const stop = () => {
    albumCompleteRef.current = false; // player state is being wiped
    // Stop both audio elements (ping-pong A + B) and the video element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioRefB.current) {
      audioRefB.current.pause();
      audioRefB.current.currentTime = 0;
    }
    // Android blob prefetch: release any held object URLs (playing + prepared).
    nextBlobCacheRef.current?.clearAll();
    // Offline downloads: release the current downloaded-track object URL.
    revokeActiveLocalSrc();
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }

    // Clean up HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    // Clear last published NIP-38 track so next play will publish
    lastPublishedNip38TrackRef.current = null;

    setIsPlaying(false);
    setCurrentPlayingAlbum(null);
    setCurrentTrackIndex(0);
    setCurrentTime(0);
    setDuration(0);
    lastNonZeroPositionRef.current = 0;
    setIsVideoMode(false);

    // Clear shuffle state
    setIsShuffleMode(false);
    setShuffledPlaylist([]);
    setCurrentShuffleIndex(0);

    // Clear the saved playback session — stop() means "I'm done with this",
    // so there is nothing to resume. Both records must go.
    if (typeof window !== 'undefined') {
      storage.removeItem(PLAYBACK_STATE_KEY);
      storage.removeItem(PLAYBACK_POSITION_KEY);
    }
    pendingResumeSeekRef.current = null;

    // Don't clear NIP-38 status - it persists as "last played"
  };

  // Toggle shuffle mode
  const toggleShuffle = () => {
    const newShuffleMode = !isShuffleMode;
    setIsShuffleMode(newShuffleMode);

    if (process.env.NODE_ENV === 'development') {
      console.log('🎲 Shuffle mode toggled:', newShuffleMode);
    }

    // When enabling shuffle, create a shuffled playlist from the current album
    if (newShuffleMode && currentPlayingAlbum?.tracks && currentPlayingAlbum.tracks.length > 0) {
      const albumTracks = currentPlayingAlbum.tracks.map((track, trackIndex) => ({
        album: currentPlayingAlbum,
        trackIndex,
        track
      }));

      // Fisher-Yates shuffle
      const shuffled = [...albumTracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      // Find current track position in shuffled array and move it to front
      // so playback continues from current track
      const currentTrackIdx = shuffled.findIndex(t => t.trackIndex === currentTrackIndex);
      if (currentTrackIdx > 0) {
        const [currentTrack] = shuffled.splice(currentTrackIdx, 1);
        shuffled.unshift(currentTrack);
      }

      setShuffledPlaylist(shuffled);
      setCurrentShuffleIndex(0);

      console.log(`🎲 Created album shuffle: ${shuffled.length} tracks from "${currentPlayingAlbum.title}"`);
    } else if (!newShuffleMode) {
      // When disabling shuffle, clear the shuffled playlist
      setShuffledPlaylist([]);
      setCurrentShuffleIndex(0);
      console.log('🎲 Cleared shuffle playlist');
    }
  };

  // Memoize setInitialAlbums to prevent recreation on every render
  const setInitialAlbums = useCallback((initialAlbums: RSSAlbum[]) => {
    // Only set if we don't already have albums loaded
    if (!albumsLoadedRef.current && initialAlbums.length > 0) {
      setAlbums(initialAlbums);
      albumsLoadedRef.current = true;
      console.log(`✅ Pre-loaded ${initialAlbums.length} albums from server`);
    }
  }, []);

  // Each of these is redefined on every render of this provider, so each one
  // used to invalidate the memo below on every render. See useStableFn.
  const stablePlayAlbum = useStableFn(playAlbum);
  const stablePlayTrack = useStableFn(playTrack);
  const stablePlayShuffledTrack = useStableFn(playShuffledTrack);
  const stableShuffleAllTracks = useStableFn(shuffleAllTracks);
  const stableShuffleAlbums = useStableFn(shuffleAlbums);
  const stableToggleShuffle = useStableFn(toggleShuffle);
  const stablePause = useStableFn(pause);
  const stableResume = useStableFn(resume);
  const stableSeek = useStableFn(seek);
  const stablePlayNextTrack = useStableFn(playNextTrack);
  const stablePlayPreviousTrack = useStableFn(playPreviousTrack);
  const stableStop = useStableFn(stop);

  // Memoized so a state change that is not in the deps below does not re-render
  // every consumer.
  //
  // The comment that used to sit here said this memo stopped `currentTime`
  // updates from re-rendering all consumers. It did not, and could not:
  // `currentTime` was IN the dependency array, so the memo was invalidated by
  // every tick — several times a second — which is exactly what it claimed to
  // prevent.
  //
  // Moving the clock to AudioTimeContext was necessary but NOT sufficient: the
  // twelve functions listed here were plain declarations, so they changed
  // identity on every render and kept invalidating the memo just as often. Both
  // halves are needed, which is why the deps below are state and stable
  // wrappers only.
  const value: AudioContextType = useMemo(() => ({
    currentPlayingAlbum,
    isPlaying,
    isLoading,
    currentTrackIndex,
    isVideoMode,
    isShuffleMode,
    isFullscreenMode,
    setFullscreenMode: setIsFullscreenMode,
    repeatMode,
    setRepeatMode,
    chapters,
    currentChapterIndex,
    playAlbum: stablePlayAlbum,
    playTrack: stablePlayTrack,
    playShuffledTrack: stablePlayShuffledTrack,
    shuffleAllTracks: stableShuffleAllTracks,
    shuffleAlbums: stableShuffleAlbums,
    toggleShuffle: stableToggleShuffle,
    pause: stablePause,
    resume: stableResume,
    seek: stableSeek,
    playNextTrack: stablePlayNextTrack,
    playPreviousTrack: stablePlayPreviousTrack,
    stop: stableStop,
    audioRef,
    videoRef,
    setInitialAlbums,
  }), [
    // State only. Every entry below changes on a real state change, never on a
    // clock tick — which is what makes the AudioTimeContext split pay off.
    currentPlayingAlbum,
    isPlaying,
    isLoading,
    currentTrackIndex,
    isVideoMode,
    isShuffleMode,
    isFullscreenMode,
    repeatMode,
    chapters,
    currentChapterIndex,
    // Permanently stable; listed so the exhaustive-deps rule stays satisfied.
    stablePlayAlbum,
    stablePlayTrack,
    stablePlayShuffledTrack,
    stableShuffleAllTracks,
    stableShuffleAlbums,
    stableToggleShuffle,
    stablePause,
    stableResume,
    stableSeek,
    stablePlayNextTrack,
    stablePlayPreviousTrack,
    stableStop,
    setInitialAlbums,
  ]);

  // Its own memo, so a clock tick invalidates only this one.
  const timeValue = useMemo<AudioTimeContextType>(
    () => ({ currentTime, duration }),
    [currentTime, duration]
  );

  return (
    <AudioContext.Provider value={value}>
      <AudioTimeContext.Provider value={timeValue}>
      {children}
      {/* Hidden audio element - ID used for iOS background fallback
          Note: Using position absolute off-screen instead of opacity:0/1px
          as some iOS versions don't treat very small elements as real media */}
      <audio
        id="stablekraft-audio-player"
        ref={audioRef}
        preload={isIOS ? 'auto' : 'metadata'}
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        autoPlay={false}
        controls={true}
        muted={false}
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          pointerEvents: 'none'
        }}
      />
      {/* Second audio element — used only on Android for gapless ping-pong
          transitions (start next track here while the first is still playing so
          Android's locked-screen autoplay policy doesn't drop play()). Idle on
          iOS/desktop. */}
      <audio
        id="stablekraft-audio-player-b"
        ref={audioRefB}
        preload={isIOS ? 'auto' : 'metadata'}
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        autoPlay={false}
        controls={true}
        muted={false}
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          pointerEvents: 'none'
        }}
      />
      {/* Hidden video element - ID used for iOS background fallback */}
      <video
        id="stablekraft-video-player"
        ref={videoRef}
        preload={isIOS ? 'auto' : 'metadata'}
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        autoPlay={false}
        controls={true}
        muted={false}
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '1px',
          height: '1px',
          pointerEvents: 'none'
        }}
      />
      </AudioTimeContext.Provider>
    </AudioContext.Provider>
  );
}; 