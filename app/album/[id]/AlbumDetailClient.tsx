'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import ArtworkImage from '@/components/ArtworkImage';
import { useSearchParams } from 'next/navigation';
import { Play, Pause, SkipBack, SkipForward, Volume2, Video, MoreVertical, Shuffle, ChevronDown } from 'lucide-react';
import { RSSAlbum } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { buildPageBackgroundStyle } from '@/lib/page-background-style';
import { pickCanvasBackground } from '@/lib/podcast-images';
import { artworkImageUrl } from '@/lib/artwork-image-url';
import { generateAlbumHref, generateAlbumSlug, generatePublisherSlug, getPublisherInfo } from '@/lib/url-utils';
import { useAudio, useAudioTime } from '@/contexts/AudioContext';
import { useScrollDetectionContext } from '@/components/ScrollDetectionProvider';
import ControlsBar from '@/components/ControlsBar';
import BackButton from '@/components/BackButton';
import HomeButton from '@/components/HomeButton';
import { useLightning } from '@/contexts/LightningContext';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';
import { singleTrackFavoriteData } from '@/lib/favorite-target';
import DownloadButton from '@/components/downloads/DownloadButton';
import ShareButton from '@/components/Nostr/ShareButton';
import { hasV4V as checkHasV4V, formatValueSplitsForBoost, getPrimaryRecipient } from '@/lib/v4v-utils';
import { useDataSaver } from '@/hooks/useDataSaver';
// import CDNImage from '@/components/CDNImage'; // Replaced with Next.js Image for performance

interface AlbumDetailClientProps {
  albumTitle: string;
  albumId: string; // Add albumId prop
  initialAlbum: RSSAlbum | null;
  extraAlbumActions?: React.ReactNode; // Optional extra buttons next to album Boost
}

// Module-scoped background cache. Module scope survives client-side route remounts within a
// session, so navigating between albums can initialize the background from a previously-resolved
// value instead of null — which otherwise flashes the default dark gradient on every navigation
// (the page passes initialAlbum=null and always fetches client-side). `backgroundCacheById` gives
// an instantly-correct background on revisit; `lastShownBackground` holds the previous album's art
// for a first visit until the new art resolves, avoiding the default-gradient flicker.
// Both hold DISPLAY-READY URLs (what `buildPageBackgroundStyle` paints), so a held-over background
// reuses the exact response the browser already has.
const backgroundCacheById = new Map<string, string>();
let lastShownBackground: string | null = null;

// The hero cover's source and box. The page backdrop asks `artworkImageUrl` for the URL an
// <ArtworkImage> with these same values requests, so hero and backdrop are one response and one
// cache entry and cannot show two versions of one file — see lib/artwork-image-url.ts.
const HERO_ART_SIZE = 280;
const heroArtworkSrc = (coverArt: string) => getAlbumArtworkUrl(coverArt, 'medium', true);

// A <podcast:image> canvas is its own image — nothing else on the page shows it — so it keeps the
// full-size proxy route it always had.
function canvasBackgroundUrl(canvas: string): string {
  if (canvas.includes('stablekraft.app') || canvas.startsWith('/')) {
    return getAlbumArtworkUrl(canvas, 'xl', false);
  }
  return `/api/proxy-image?url=${encodeURIComponent(canvas)}&enhance=true&minWidth=1920&minHeight=1080`;
}

export default function AlbumDetailClient({ albumTitle, albumId, initialAlbum, extraAlbumActions }: AlbumDetailClientProps) {
  const [album, setAlbum] = useState<RSSAlbum | null>(initialAlbum);
  const [isLoading, setIsLoading] = useState(!initialAlbum);
  const [error, setError] = useState<string | null>(null);
  const [podrollAlbums, setPodrollAlbums] = useState<RSSAlbum[]>([]);
  const [loadingStarted, setLoadingStarted] = useState(false);
  const [doerfelsPublisherInfo, setDoerfelsPublisherInfo] = useState<any>(null);
  const [relatedDoerfelsAlbums, setRelatedDoerfelsAlbums] = useState<any[]>([]);
  const [isDoerfelsAlbum, setIsDoerfelsAlbum] = useState(false);
  
  // Global audio context
  const {
    playAlbum: globalPlayAlbum,
    currentPlayingAlbum,
    isPlaying: globalIsPlaying,
    currentTrackIndex: globalTrackIndex,
    pause: globalPause,
    resume: globalResume,
    seek: globalSeek,
    shuffleAllTracks,
    setFullscreenMode
  } = useAudio();
  // The clock lives in its own context so a 4Hz tick does not re-render
  // every useAudio() consumer. Only components that DISPLAY a position
  // subscribe here. See contexts/AudioContext.tsx.
  const { currentTime: globalCurrentTime, duration: globalDuration } = useAudioTime();

  // Track URL parameter for deep linking
  const searchParams = useSearchParams();
  const trackParam = searchParams?.get('track') ?? null;
  const filterParam = searchParams?.get('filter') ?? null;
  const hasAutoPlayedRef = useRef(false);

  // Filter tracks based on filterParam (e.g., 'videos' to show only video tracks)
  const filteredTracks = useMemo(() => {
    if (!album?.tracks) return [];
    if (filterParam === 'videos') {
      return album.tracks.filter((track: any) =>
        track.mediaType === 'video' ||
        (track.alternateEnclosures && track.alternateEnclosures.some((enc: any) =>
          enc.type?.includes('video')
        ))
      );
    }
    return album.tracks;
  }, [album?.tracks, filterParam]);
  const { shouldPreventClick } = useScrollDetectionContext();
  const lightning = useLightning(); // Initialize Lightning context

  // Background state — seed from the module cache (this album's last-resolved background, else the
  // most recently shown one) so a client-side navigation doesn't flash the default gradient.
  const [backgroundImage, setBackgroundImage] = useState<string | null>(
    () => backgroundCacheById.get(albumId) ?? lastShownBackground
  );
  const [isClient, setIsClient] = useState(false);
  const [backgroundLoaded, setBackgroundLoaded] = useState(false);
  const [albumArtLoaded, setAlbumArtLoaded] = useState(false);
  const [albumArtError, setAlbumArtError] = useState(false);
  // Mobile: track rows are one line; the per-row actions live behind a kebab.
  const [expandedTrackKey, setExpandedTrackKey] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Detect desktop for background loading optimization
  useEffect(() => {
    const checkDevice = () => {
      setIsDesktop(window.innerWidth > 768);
    };
    
    if (typeof window !== 'undefined') {
      checkDevice();
      window.addEventListener('resize', checkDevice);
      return () => window.removeEventListener('resize', checkDevice);
    }
  }, []);

  // Auto-play track from URL parameter and open fullscreen player
  useEffect(() => {
    if (!album || !trackParam || hasAutoPlayedRef.current) return;

    // Find track by multiple matching strategies
    let trackIndex = -1;

    // 1. Try exact ID match (database UUID)
    trackIndex = album.tracks.findIndex(t => t.id === trackParam);

    // 2. Try GUID match
    if (trackIndex === -1) {
      trackIndex = album.tracks.findIndex(t => t.guid === trackParam);
    }

    // 3. Try slug-based match (e.g., "album-title-track-1" format)
    if (trackIndex === -1) {
      // Check if trackParam ends with "-track-N" pattern
      const trackNumberMatch = trackParam.match(/-track-(\d+)$/);
      if (trackNumberMatch) {
        const trackNumber = parseInt(trackNumberMatch[1], 10);
        if (trackNumber >= 1 && trackNumber <= album.tracks.length) {
          trackIndex = trackNumber - 1; // Convert to 0-based index
        }
      }
    }

    // 4. Try title-based match (slugified title comparison)
    if (trackIndex === -1) {
      const slugify = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      trackIndex = album.tracks.findIndex(t => slugify(t.title) === slugify(trackParam));
    }

    if (trackIndex !== -1) {
      hasAutoPlayedRef.current = true;
      // Auto-play and open fullscreen
      globalPlayAlbum(album, trackIndex).then(success => {
        if (success) {
          setFullscreenMode(true);
        }
      });
    }
  }, [album, trackParam, globalPlayAlbum, setFullscreenMode]);

  // Update Media Session API for iOS lock screen controls
  const updateMediaSession = (track: any) => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: album?.artist || 'Unknown Artist',
        album: album?.title || 'Unknown Album',
        artwork: [
          { src: album?.coverArt || '', sizes: '512x512', type: 'image/jpeg' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
    }
  };

  const formatSecondsToDisplay = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (duration: string): string => {
    if (!duration || duration.trim() === '') return '0:00';

    const durationStr = duration.trim();

    // Handle edge cases first
    if (durationStr === 'NaN' || durationStr === 'undefined' || durationStr === 'null') {
      return '0:00';
    }

    // If already formatted with colon, validate and convert to display format
    if (durationStr.includes(':')) {
      const parts = durationStr.split(':');
      if (parts.length === 2) {
        const mins = parseInt(parts[0]);
        const secs = parseInt(parts[1]);
        if (!isNaN(mins) && !isNaN(secs) && mins >= 0 && mins < 1440 && secs >= 0 && secs < 60) {
          return formatSecondsToDisplay(mins * 60 + secs);
        }
      } else if (parts.length === 3) {
        const hours = parseInt(parts[0]);
        const mins = parseInt(parts[1]);
        const secs = parseInt(parts[2]);
        if (!isNaN(hours) && !isNaN(mins) && !isNaN(secs) &&
            hours >= 0 && hours < 24 && mins >= 0 && mins < 60 && secs >= 0 && secs < 60) {
          return formatSecondsToDisplay(hours * 3600 + mins * 60 + secs);
        }
      }
      // Invalid colon format, fall through to seconds parsing
    }

    // If it's just seconds, convert to display format
    const seconds = parseInt(durationStr);
    if (!isNaN(seconds) && seconds >= 0 && seconds < 86400) { // Max 24 hours
      return formatSecondsToDisplay(seconds);
    }

    // If all else fails, return default
    return '0:00';
  };

  const formatTime = (time: number): string => {
    if (isNaN(time) || time < 0) return '0:00';
    return formatSecondsToDisplay(time);
  };

  const calculateTotalDuration = (tracks: any[]): string => {
    if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
      return '0';
    }

    let totalSeconds = 0;
    
    for (const track of tracks) {
      if (!track.duration) continue;
      
      const duration = track.duration.toString().trim();
      
      // Skip invalid durations
      if (duration === 'NaN' || duration === 'undefined' || duration === 'null' || duration === '') {
        continue;
      }
      
      // Handle MM:SS or HH:MM:SS format
      if (duration.includes(':')) {
        const parts = duration.split(':');
        if (parts.length === 2) {
          const mins = parseInt(parts[0]);
          const secs = parseInt(parts[1]);
          if (!isNaN(mins) && !isNaN(secs)) {
            totalSeconds += (mins * 60) + secs;
          }
        } else if (parts.length === 3) {
          const hours = parseInt(parts[0]);
          const mins = parseInt(parts[1]);
          const secs = parseInt(parts[2]);
          if (!isNaN(hours) && !isNaN(mins) && !isNaN(secs)) {
            totalSeconds += (hours * 3600) + (mins * 60) + secs;
          }
        }
      } else {
        // Handle seconds format
        const seconds = parseInt(duration);
        if (!isNaN(seconds) && seconds > 0) {
          totalSeconds += seconds;
        }
      }
    }
    
    // Convert total seconds to minutes (rounded)
    const totalMinutes = Math.round(totalSeconds / 60);
    return totalMinutes.toString();
  };

  const getAlbumYear = (releaseDate: string): string => {
    if (!releaseDate) {
      return new Date().getFullYear().toString();
    }
    
    const date = new Date(releaseDate);
    const year = date.getFullYear();
    
    // Check if the year is valid (not NaN and within reasonable range)
    if (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 1) {
      return new Date().getFullYear().toString();
    }
    
    return year.toString();
  };

  // Audio player functions
  const togglePlay = async () => {
    if (globalIsPlaying && currentPlayingAlbum?.title === album?.title) {
      globalPause();
    } else {
      if (album && album.tracks.length > 0) {
        await playTrack(globalTrackIndex);
      }
    }
  };

  const playTrack = async (index: number) => {
    // Prevent accidental clicks while scrolling
    if (shouldPreventClick()) {
      console.log('🚫 Prevented accidental track click while scrolling');
      return;
    }

    if (!album || !album.tracks[index] || !album.tracks[index].url) {
      console.error('❌ Missing album, track, or URL');
      return;
    }
    
    console.log('🎵 Attempting to play track:', album.tracks[index].title, 'URL:', album.tracks[index].url);
    
    // Use global audio context for playback
    const success = await globalPlayAlbum(album, index);
    
    if (success) {
      console.log('✅ Track playback started successfully via global audio context');
      
      // Update Media Session for lock screen controls
      updateMediaSession(album.tracks[index]);
    } else {
      console.error('❌ Failed to play track via global audio context');
      setError('Unable to play audio - please try a different track');
      setTimeout(() => setError(null), 5000);
    }
  };

  const playAlbum = async () => {
    if (album && filteredTracks.length > 0) {
      // Find the original index of the first filtered track
      const firstFilteredTrack = filteredTracks[0];
      const originalIndex = album.tracks.findIndex(t => t === firstFilteredTrack);
      if (originalIndex !== -1) {
        await playTrack(originalIndex);
      }
    }
  };

  const nextTrack = async () => {
    if (album && globalTrackIndex < album.tracks.length - 1) {
      await playTrack(globalTrackIndex + 1);
    }
  };

  const prevTrack = async () => {
    if (album && globalTrackIndex > 0) {
      await playTrack(globalTrackIndex - 1);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    globalSeek(time);
  };

  // Initialize client state
  useEffect(() => {
    setIsClient(true);
  }, []);


  // Update background when album data changes. This is the ONLY writer of `backgroundImage` besides
  // the module-cache seed. A desktop-only preload used to race it with a cache-busted URL
  // (a `cb` query of the current time), which is how the backdrop came to show newer art than the
  // hero beside it.
  useEffect(() => {
    // Don't run background effect while loading or if album is null
    if (isLoading || !album) {
      return;
    }

    if (album.coverArt) {
      // Reset loading states when album changes
      setBackgroundLoaded(false);
      setAlbumArtLoaded(false);
    }

    // Prefer a Podcasting 2.0 <podcast:image> canvas background sized for the current
    // viewport (16:9 on desktop, 9:16 on mobile); fall back to the album cover art.
    const canvasBg = album.coverArt && pickCanvasBackground(
      (album as any).podcastImages,
      isDesktop ? 'landscape' : 'portrait'
    );

    if (canvasBg) {
      setBackgroundImage(canvasBackgroundUrl(canvasBg));
    } else if (album.coverArt) {
      setBackgroundImage(artworkImageUrl({
        src: heroArtworkSrc(album.coverArt),
        width: HERO_ART_SIZE,
        height: HERO_ART_SIZE,
      }));
    } else {
      // No art at all: clear any background held over from the previous album.
      setBackgroundImage(null);
    }
    setBackgroundLoaded(true);
  }, [album?.coverArt, (album as any)?.podcastImages, isDesktop, isLoading]); // re-pick canvas on viewport orientation change

  // Remember every resolved background so future navigations can seed their initial background from
  // the module cache instead of flashing the default gradient.
  useEffect(() => {
    if (!backgroundImage) return;
    // Always the most-recent visible background (held over on the NEXT navigation).
    lastShownBackground = backgroundImage;
    // Only key it to this album once the album's own data has loaded, so a carried-over previous
    // background is never cached under the wrong id.
    if (album && !isLoading) {
      backgroundCacheById.set(albumId, backgroundImage);
    }
  }, [backgroundImage, album, isLoading, albumId]);

  const dataSaver = useDataSaver();

  // Optimized background style calculation - memoized to prevent repeated logs
  const backgroundStyle = useMemo(() => {
    /**
     * `backgroundImage` is already display-ready (see the effect above): for a
     * cover it is the hero's own `/_next/image` URL, so the backdrop costs no
     * second download; for a <podcast:image> canvas it is the full-size proxy.
     *
     * Data Saver drops the backdrop entirely. Under Data Saver the hero asks for
     * a lower quality, so a cover backdrop would no longer share its response.
     *
     * Passing null is a fully supported state, not a degraded one: it is the
     * branch used during SSR and before `isClient`, it paints the opaque base
     * gradient, and lib/page-background-style.test.ts covers it. It cannot
     * reopen #201.
     */
    const highResBackgroundUrl = backgroundImage && isClient && !dataSaver ? backgroundImage : null;

    // Shared with the playlist pages, and opaque underneath the artwork so the
    // global rocket wallpaper cannot show through while it loads — see #201.
    return buildPageBackgroundStyle(highResBackgroundUrl);
  }, [backgroundImage, isClient, dataSaver]);

  // Load album data if not provided initially
  useEffect(() => {
    if (!initialAlbum && !loadingStarted) {
      setLoadingStarted(true);
      const loadAlbum = async () => {
        try {
          setIsLoading(true);
          setError(null);
          
          // Use the new specific album API endpoint for much faster lookup
          console.log(`🔍 Loading album: ${albumTitle} (ID: ${albumId})`);
          const cacheBuster = Date.now();
          const response = await fetch(`/api/albums/${encodeURIComponent(albumId)}?cb=${cacheBuster}`);
          
          const data = await response.json();

          // Handle redirect for publisher/test feeds
          if (data.redirect) {
            console.log(`🔀 Redirecting to publisher page: ${data.redirect}`);
            window.location.href = data.redirect;
            return;
          }

          if (!response.ok) {
            if (response.status === 404) {
              throw new Error('Album not found');
            }
            throw new Error(`Failed to fetch album: ${response.status} ${response.statusText}`);
          }

          const foundAlbum = data.album;
            
            if (foundAlbum) {
              console.log(`✅ Successfully loaded album: ${foundAlbum.title} by ${foundAlbum.artist}`);
              
              // Validate album data structure
              if (!Array.isArray(foundAlbum.tracks)) {
                console.warn('⚠️ Album tracks is not an array:', foundAlbum.tracks);
                // Ensure tracks is always an array
                foundAlbum.tracks = [];
              }
              
              setAlbum(foundAlbum);
              
              // Load Doerfels publisher data for all albums
              loadDoerfelsPublisherData();
              // Load PodRoll albums if they exist
              if (foundAlbum.podroll && foundAlbum.podroll.length > 0) {
                loadPodrollAlbums(foundAlbum.podroll);
              }
              // Load Publisher feed albums if publisher exists
              if (foundAlbum.publisher && foundAlbum.publisher.feedUrl && typeof foundAlbum.publisher.feedUrl === 'string') {
                loadPublisherAlbums(foundAlbum.publisher.feedUrl);
              }
            } else {
              setError('Album not found');
            }
        } catch (err) {
          console.error('Error loading album:', err);
          setError('Error loading album data');
        } finally {
          setIsLoading(false);
        }
      };

      loadAlbum();
    } else if (initialAlbum) {
      // Validate initial album data structure
      if (!Array.isArray(initialAlbum.tracks)) {
        console.warn('⚠️ Initial album tracks is not an array:', initialAlbum.tracks);
        // Create a copy with proper tracks array
        const validatedAlbum = {
          ...initialAlbum,
          tracks: []
        };
        setAlbum(validatedAlbum);
      } else {
        setAlbum(initialAlbum);
      }
      
      // Load Doerfels publisher data for all albums
      loadDoerfelsPublisherData();
      // Load PodRoll albums if they exist
      if (initialAlbum.podroll && initialAlbum.podroll.length > 0) {
        loadPodrollAlbums(initialAlbum.podroll);
      }
      // Load Publisher feed albums if publisher exists
      if (initialAlbum.publisher && initialAlbum.publisher.feedUrl && typeof initialAlbum.publisher.feedUrl === 'string') {
        loadPublisherAlbums(initialAlbum.publisher.feedUrl);
      }
    }
  }, [albumTitle, initialAlbum, loadingStarted]);

  const loadPodrollAlbums = async (podrollItems: { url: string; title?: string; description?: string }[]) => {
    try {
      // Load pre-parsed album data and filter for podroll items
      const response = await fetch('/api/albums');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const allAlbums = data.albums || [];
      
      // Filter albums that match the podroll URLs
      const podrollUrls = podrollItems.map(item => item.url).filter(url => typeof url === 'string');
      const podrollAlbumsData = allAlbums.filter((album: any) => {
        return album.feedUrl && 
               typeof album.feedUrl === 'string' &&
               podrollUrls.some(url => album.feedUrl === url);
      });
      
      setPodrollAlbums(podrollAlbumsData);
    } catch (err) {
      console.error('Error loading PodRoll albums:', err);
    }
  };

  const loadPublisherAlbums = async (publisherFeedUrl: string) => {
    try {
      // Validate input
      if (!publisherFeedUrl || typeof publisherFeedUrl !== 'string') {
        console.warn('⚠️ Invalid publisher feed URL:', publisherFeedUrl);
        return;
      }
      
      console.log(`🏢 Loading albums from publisher feed: ${publisherFeedUrl}`);
      
      // Load pre-parsed album data and filter for publisher albums
      const response = await fetch('/api/albums');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const allAlbums = data.albums || [];
      
      // Filter albums that belong to the publisher
      const publisherAlbumsData = allAlbums.filter((album: any) => {
        return album.publisher && 
               album.publisher.feedUrl && 
               typeof album.publisher.feedUrl === 'string' &&
               album.publisher.feedUrl === publisherFeedUrl;
      });
      
      // Only add publisher albums to recommendations if there are already podroll albums
      // (This prevents "You Might Also Like" from appearing for albums without podrolls)
      setPodrollAlbums(prevAlbums => {
        // Only show publisher albums if there are existing podroll recommendations
        if (prevAlbums.length === 0) {
          console.log(`🎶 No podroll albums found, not showing publisher recommendations for this album`);
          return prevAlbums;
        }
        
        // Combine and deduplicate based on title+artist
        const combined = [...prevAlbums];
        const existingKeys = new Set(prevAlbums.map(album => `${album.title.toLowerCase()}|${album.artist.toLowerCase()}`));
        
        publisherAlbumsData.forEach((album: any) => {
          const key = `${album.title.toLowerCase()}|${album.artist.toLowerCase()}`;
          if (!existingKeys.has(key)) {
            combined.push(album);
            existingKeys.add(key);
          }
        });
        
        console.log(`🎶 Added ${publisherAlbumsData.length} albums from publisher to existing podroll, total recommendations: ${combined.length}`);
        return combined;
      });
    } catch (err) {
      console.error('Error loading Publisher albums:', err);
    }
  };

  // Load Doerfels publisher feed data
  const loadDoerfelsPublisherData = async () => {
    try {
      console.log('🎵 Loading Doerfels publisher feed data...');
      const response = await fetch('/api/feeds/doerfels-pubfeed');
      if (response.ok) {
        const feedText = await response.text();
        
        // Parse the XML to extract publisher info and album list
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(feedText, 'text/xml');
        
        // Extract publisher information
        const channel = xmlDoc.querySelector('channel');
        if (channel) {
          const title = channel.querySelector('title')?.textContent || 'The Doerfels';
          const description = channel.querySelector('description')?.textContent || '';
          const link = channel.querySelector('link')?.textContent || 'https://www.doerfelverse.com/';
          const image = channel.querySelector('itunes\\:image')?.getAttribute('href') || '';
          
          setDoerfelsPublisherInfo({
            title,
            description,
            link,
            image
          });
        }
        
        // Extract remote items (albums)
        const remoteItems = xmlDoc.querySelectorAll('podcast\\:remoteItem');
        const albums = Array.from(remoteItems).map(item => ({
          feedGuid: item.getAttribute('feedGuid') || '',
          feedUrl: item.getAttribute('feedUrl') || '',
          title: item.getAttribute('title') || ''
        }));
        
        setRelatedDoerfelsAlbums(albums);
        
        // Check if current album is a Doerfels album
        if (album) {
          const isDoerfels = albums.some(doerfelsAlbum => 
            doerfelsAlbum.title.toLowerCase() === album.title.toLowerCase() ||
            doerfelsAlbum.feedUrl.includes(album.title.toLowerCase().replace(/\s+/g, '-'))
          );
          setIsDoerfelsAlbum(isDoerfels);
        }
        
        console.log('✅ Loaded Doerfels publisher data:', { albums: albums.length, isDoerfelsAlbum: isDoerfelsAlbum });
      }
    } catch (error) {
      console.warn('Failed to load Doerfels publisher feed:', error);
    }
  };

  if (isLoading) {
    return (
      <>
        {/* Background layer */}
        <div style={backgroundStyle} />
        <div className="min-h-screen text-white relative z-10">
          <div className="container mx-auto px-6 py-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <h1 className="text-2xl font-bold">Loading Album...</h1>
              {isDesktop && backgroundImage && (
                <p className="text-gray-400 mt-2">Background loaded, content loading...</p>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !album) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="container mx-auto px-6 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">
              {error === 'Album not found' ? 'Album Not Available' : (error || 'Album Not Found')}
            </h1>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              {error === 'Album not found' 
                ? 'This album may not be available in our current collection or may have been temporarily removed.'
                : 'We couldn\'t load this album. Please check the URL or try again later.'
              }
            </p>
            <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors">
              ← Back to Albums
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Album-level boost metadata, shared by the mobile action row and the desktop block.
  // These were duplicated verbatim across the two breakpoints — the same failure family as
  // the `/api/albums-fast` dual-select gotcha, where a later fix lands on one copy and the
  // other silently keeps sending wrong boost metadata on the breakpoint nobody retested.
  // `remoteFeedGuid` must stay a real GUID (`album.feedGuid`), never the feed slug.
  const albumBoostProps = {
    trackId: undefined,
    feedId: album.feedId,
    trackTitle: album.title,
    artistName: album.artist,
    lightningAddress: getPrimaryRecipient(album),
    valueSplits: formatValueSplitsForBoost(album, album.artist),
    feedUrl: album.feedUrl,
    remoteFeedGuid: album.feedGuid,
    albumName: album.title,
    publisherGuid: album.publisher?.feedGuid,
    persons: (album as any).persons || [],
  };

  return (
    <div className="lg:fixed lg:inset-0 lg:z-[15]">
      {/* Background layer - fixed positioned to override global layout background */}
      <div style={backgroundStyle} />

      {/* No fixed overlay belongs at the top of this page. A compact sticky header
          (thumbnail + title + shuffle + play) lived here briefly and was removed: it
          appeared at only 220px of scroll, while the cover, title and action row were
          all still on screen, and its full-bleed background ran underneath the global
          UserMenu so the account avatar looked buried in it. Its Play duplicated
          GlobalNowPlayingBar (fixed bottom, z-50) whenever audio was loaded, and
          tapping track 1 otherwise. See the z-40 note in CLAUDE.md before adding any
          fixed overlay here. */}

      {/* Content layer - relative positioned above background */}
      <div className="min-h-screen lg:h-full text-white relative z-10 lg:overflow-hidden">
        {/* Top padding must carry the safe-area inset. This was `pt-16` before the page
            was compacted, which happened to clear the iOS status bar by accident; `pt-6`
            alone put the Back/Home row under the clock and signal icons. Per the
            Safe-Area Insets rule, the inset comes from `var(--sk-safe-*)`, never bare
            `env()`. The 24px base preserves the compact spacing on devices that report
            no inset (Android browser, desktop), where the var resolves to 0. */}
        <div className="container mx-auto px-4 lg:px-6 pt-[calc(var(--sk-safe-top)+24px)] md:pt-[calc(var(--sk-safe-top)+48px)] pb-40 lg:pb-8 lg:h-full lg:flex lg:flex-col">
        {/* Back / Home buttons */}
        <div className="mb-3 lg:mb-6 lg:flex-shrink-0 flex items-center gap-1">
          <BackButton label="Back" />
          <HomeButton />
        </div>

        {/* Two-column layout on desktop, single column on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-8 mb-8 lg:mb-0 lg:flex-1 lg:min-h-0">
          {/* Left Column: Album Art and Info (2/5 width) */}
          <div className="flex flex-col gap-3 lg:gap-4 lg:col-span-2 lg:min-h-0">
            {/* Album Art with Play Button Overlay */}
            <div className="relative group mx-auto lg:mx-0 w-[260px] h-[260px] lg:w-full lg:h-auto lg:aspect-square lg:max-w-[320px] lg:flex-shrink-0">
            <ArtworkImage
              src={albumArtError || !album?.coverArt ? getPlaceholderImageUrl('medium') : heroArtworkSrc(album.coverArt)}
              alt={album.title}
              width={HERO_ART_SIZE}
              height={HERO_ART_SIZE}
              className={`rounded-lg object-cover shadow-2xl transition-opacity duration-500 w-full h-full ${
                albumArtLoaded ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ objectFit: 'cover' }}
              priority // Always prioritize album art loading
              onLoad={() => {
                setAlbumArtLoaded(true);
                setAlbumArtError(false);
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (!albumArtError) {
                  setAlbumArtError(true);
                  target.src = getPlaceholderImageUrl('medium');
                }
                setAlbumArtLoaded(true);
              }}
              placeholder="empty"
            />
            
            {/* Loading placeholder - show when album art is not loaded */}
            {!albumArtLoaded && (
              <div className="absolute inset-0 w-full h-full bg-gray-800 animate-pulse rounded-lg flex items-center justify-center">
                <div className="text-gray-400 text-sm">Loading...</div>
              </div>
            )}
            
            {/* Play Button Overlay - Always visible and prominent on mobile */}
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                onClick={globalIsPlaying && currentPlayingAlbum?.title === album?.title ? togglePlay : playAlbum}
                className="bg-white/95 hover:bg-white active:bg-white text-black rounded-full p-4 transform hover:scale-110 active:scale-95 transition-all duration-200 shadow-2xl border-2 border-white/30 z-10 touch-manipulation"
                style={{ minWidth: '64px', minHeight: '64px' }}
              >
                {globalIsPlaying && currentPlayingAlbum?.title === album?.title ? (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                  </svg>
                ) : (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Album Favorite Button - Heart icon in bottom-right corner */}
            {album.feedId && (
              <div
                className="absolute bottom-1 right-1 sm:bottom-2 sm:right-2 z-20 hidden lg:flex items-center gap-1.5"
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                }}
              >
                <div className="bg-black/60 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/80 transition-colors">
                  <DownloadButton
                    downloadTarget={{ type: 'album', album }}
                    size={18}
                    className="text-white"
                  />
                </div>
                <div className="bg-black/60 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/80 transition-colors">
                  <FavoriteButton
                    feedId={album.feedId}
                    size={18}
                    className="text-white"
                    singleTrackData={singleTrackFavoriteData(album as any)}
                  />
                </div>
              </div>
            )}
          </div>
          
            {/* Album Info */}
            <div className="lg:bg-black/50 lg:backdrop-blur-sm rounded-lg p-0 lg:p-6 lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="text-center lg:text-left space-y-3 lg:space-y-4">
            <h1 className="text-2xl md:text-4xl font-bold leading-tight">{album.title}</h1>
            {album.publisher ? (
              <Link
                href={`/publisher/${generatePublisherSlug({ artist: album.artist, feedGuid: album.publisher.feedGuid })}`}
                className="text-xl text-gray-300 hover:text-blue-400 transition-colors"
              >
                {album.artist}
              </Link>
            ) : (
              <p className="text-xl text-gray-300">{album.artist}</p>
            )}
            
            {album.subtitle && (
              <p className="text-lg text-gray-300 italic">{album.subtitle}</p>
            )}
            
            {/* Artwork, title, artist, these stats and the description read as one block —
                the album's identity — with the action row below it as the divider before
                the track list. */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-sm text-gray-400">
              <span>{getAlbumYear(album.releaseDate)}</span>
              <span>{Array.isArray(album.tracks) ? album.tracks.length : 0} {(album as any).isPodcast ? 'episodes' : 'tracks'}</span>
              <span>{calculateTotalDuration(album.tracks)} min</span>
              {album.explicit && <span className="bg-red-600 text-white px-2 py-1 rounded text-xs">EXPLICIT</span>}
            </div>

            {/* Share Button - desktop keeps the labelled pill; mobile folds it into
                the consolidated action row below. */}
            <div className="hidden lg:flex items-center justify-start">
              <ShareButton
                feedId={albumId}
                className="bg-stablekraft-teal/90 hover:bg-stablekraft-teal text-white"
                size="sm"
                showLabel
              />
            </div>

            {(album.summary || album.description) && (() => {
              const fullText = (album.summary || album.description || '').replace(/<[^>]*>/g, '');
              const charLimit = 200;
              const needsTruncation = fullText.length > charLimit;
              const displayText = needsTruncation && !descriptionExpanded
                ? fullText.slice(0, charLimit).trim() + '...'
                : fullText;

              const aboutLabel = (album as any)?.isPodcast ? 'About this podcast' : 'About this album';

              return (
                <>
                  {/* Mobile: fully collapsed behind a toggle. The description is reference
                      material — it shouldn't push the track list down the screen before
                      you've asked to read it. Desktop keeps the inline preview below,
                      where the left column has room for it. */}
                  <div className="lg:hidden max-w-lg mx-auto">
                    <button
                      type="button"
                      onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                      aria-expanded={descriptionExpanded}
                      className="flex items-center justify-center gap-1.5 mx-auto text-sm text-gray-300 hover:text-white transition-colors"
                    >
                      <span>{aboutLabel}</span>
                      <ChevronDown
                        size={16}
                        className={`flex-shrink-0 transition-transform duration-200 ${descriptionExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {descriptionExpanded && (
                      <p className="text-sm text-gray-300 leading-relaxed text-center mt-2">{fullText}</p>
                    )}
                  </div>

                  <div className="hidden lg:block text-left lg:max-w-none lg:mx-0">
                    <p className="text-base text-gray-300 leading-relaxed">{displayText}</p>
                    {needsTruncation && (
                      <button
                        onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                        className="text-blue-400 hover:text-blue-300 text-sm mt-1 transition-colors"
                      >
                        {descriptionExpanded ? 'Show less' : 'Show more'}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Publisher Information */}
            {album.publisher && (() => {
              const publisherSlug = generatePublisherSlug({ artist: album.artist, feedGuid: album.publisher.feedGuid });
              const publisherExists = getPublisherInfo(publisherSlug) !== null;

              return publisherExists ? (
                <div className="flex items-center justify-center lg:justify-start gap-2 text-sm text-gray-400">
                  <span>More from this artist:</span>
                  <Link
                    href={`/publisher/${publisherSlug}`}
                    className="text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View Discography
                  </Link>
                </div>
              ) : null;
            })()}

            {/* Mobile action row - one place for every album-level action. These used to
                be scattered across the artwork corners (download / favourite), a teal
                Share pill, and a separate Boost block further down the page. It sits
                below the identity block above, acting as the divider before the tracks. */}
            {/* Touch targets are px, never rem. Android's Font size setting scales the
                root font size and Tailwind's width, padding and gap utilities are all
                rem-based, so at 1.3x the rem-sized circles inflated until shuffle ran
                off the left edge and share off the right — justify-center spills both
                ways. Only text should grow. Same rule as the Now Playing transport row. */}
            <div className="lg:hidden flex items-center justify-center" style={{ gap: 12 }}>
              <button
                onClick={shuffleAllTracks}
                className="flex items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-md shadow-lg text-white active:scale-95 transition-transform flex-shrink-0"
                style={{ width: 44, height: 44 }}
                aria-label="Shuffle"
                title="Shuffle"
              >
                <Shuffle size={20} />
              </button>

              {checkHasV4V(album) && (
                <BoostButton
                  {...albumBoostProps}
                  iconOnly
                  className="!w-[44px] !h-[44px] !p-0 !rounded-full flex-shrink-0"
                />
              )}

              {album.feedId && (
                <div className="flex items-center flex-shrink-0" style={{ gap: 12 }}>
                  {/* `[&>button]:*` makes the child button fill the circle. These three
                      components render their own <button> with no padding, so the circle
                      is only a painted <div> — the real tap target was the 20px glyph
                      inside it, and the visual affordance lied about where to press.
                      Styling the child directly would mean fighting each component's own
                      classes at equal specificity, where stylesheet order decides. */}
                  <div className="flex items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-md shadow-lg flex-shrink-0 [&>button]:w-full [&>button]:h-full [&>button]:rounded-full" style={{ width: 44, height: 44 }}>
                    <FavoriteButton
                      feedId={album.feedId}
                      size={20}
                      iconClassName="text-white hover:text-red-400"
                      singleTrackData={singleTrackFavoriteData(album as any)}
                    />
                  </div>
                  <div className="flex items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-md shadow-lg flex-shrink-0 [&>button]:w-full [&>button]:h-full [&>button]:rounded-full" style={{ width: 44, height: 44 }}>
                    <DownloadButton
                      downloadTarget={{ type: 'album', album }}
                      size={20}
                      iconClassName="text-white"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25 backdrop-blur-md shadow-lg flex-shrink-0 [&>button]:w-full [&>button]:h-full [&>button]:rounded-full [&>button]:justify-center" style={{ width: 44, height: 44 }}>
                <ShareButton feedId={albumId} variant="ghost" size="sm" className="text-white !p-0" iconClassName="w-[20px] h-[20px]" />
              </div>
            </div>

            {/* Lightning Boost and Funding Information */}
            <div className="space-y-4">
              {/* Lightning Boost Button - only show if v4v data exists.
                  Desktop only: mobile carries Boost in the action row above. */}
              {checkHasV4V(album) ? (
                <div className="hidden lg:flex justify-start gap-2">
                  <BoostButton
                    {...albumBoostProps}
                    className="flex items-center gap-2 px-6 py-3 text-base"
                  />
                  {extraAlbumActions}
                </div>
              ) : (
                <div className="hidden lg:flex justify-start gap-2">
                  <div className="px-6 py-3 bg-gray-800/50 rounded-lg text-gray-400 text-sm">
                    No Lightning payment info available for this album
                  </div>
                  {extraAlbumActions}
                </div>
              )}

              {/* Traditional Funding Information */}
              {album.funding && album.funding.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 text-white text-center lg:text-left">More Ways to Support</h3>
                  <div className="flex flex-wrap justify-center lg:justify-start gap-3">
                    {album.funding.map((funding, index) => (
                      <a
                        key={index}
                        href={funding.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-4 py-2 rounded-full text-sm font-medium transition-all transform hover:scale-105 flex items-center gap-2"
                      >
                        💝 {funding.message || 'Support'}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Doerfels Publisher Information */}
          {isDoerfelsAlbum && doerfelsPublisherInfo && (
            <div className="bg-gradient-to-r from-blue-900/40 to-purple-900/40 backdrop-blur-sm rounded-lg p-6 mb-8 border border-blue-500/30">
              <div className="flex items-center gap-4 mb-4">
                {doerfelsPublisherInfo.image && (
                  <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                    <ArtworkImage
                      src={getAlbumArtworkUrl(doerfelsPublisherInfo.image, 'thumbnail')}
                      alt="The Doerfels"
                      width={64}
                      height={64}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = getPlaceholderImageUrl('thumbnail');
                      }}
                      placeholder="empty"
                    />
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-blue-300">The Doerfels</h3>
                  <p className="text-gray-300 text-sm">
                    Family band from Buffalo, NY creating original music across multiple genres
                  </p>
                  <a
                    href={doerfelsPublisherInfo.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                  >
                    Visit DoerfelVerse →
                  </a>
                </div>
              </div>

              {/* Related Doerfels Albums */}
              {relatedDoerfelsAlbums.length > 0 && (
                <div>
                  <h4 className="text-lg font-semibold mb-3 text-white">More from The Doerfels</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {relatedDoerfelsAlbums.slice(0, 6).map((doerfelsAlbum, index) => (
                      <div key={index} className="bg-white/5 hover:bg-white/10 rounded-lg p-3 transition-all duration-200">
                        <div className="aspect-square bg-gradient-to-br from-blue-600/20 to-purple-600/20 rounded-md mb-2 flex items-center justify-center">
                          <span className="text-blue-300 text-xs text-center font-medium">
                            {doerfelsAlbum.title}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs truncate">
                          {doerfelsAlbum.title}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

          {/* Right Column: Track List (Desktop) / Below (Mobile) (3/5 width) */}
          <div className="lg:col-span-3 lg:min-h-0">
            {/* Track List */}
            {/* `lg:` throughout the track list, matching the rows inside it. The page has
                one mobile boundary — the left column, action row and description
                toggle are all `lg:`-gated, so rows switching at `md:` produced
                a hybrid at 768-1023px: mobile chrome around desktop rows, with per-track
                Boost showing and no Tracks heading or ControlsBar at all. */}
            <div className="bg-black/40 backdrop-blur-sm rounded-lg p-2 lg:p-6 lg:h-full lg:flex lg:flex-col lg:min-h-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-0 lg:mb-4 lg:flex-shrink-0">
                <h2 className="hidden lg:block text-xl font-semibold text-left">{(album as any)?.isPodcast ? 'Episodes' : 'Tracks'}</h2>

                {/* Shuffle Controls */}
                <ControlsBar
                  activeFilter="all"
                  onFilterChange={() => {}}
                  showFilters={false}
                  sortType="name-asc"
                  onSortChange={() => {}}
                  showSort={false}
                  viewType="list"
                  onViewChange={() => {}}
                  showViewToggle={false}
                  onShuffle={shuffleAllTracks}
                  showShuffle={true}
                  resultCount={filteredTracks.length}
                  resultLabel={filterParam === 'videos' ? 'video tracks' : 'tracks'}
                  className="flex-shrink-0 hidden lg:flex"
                />
              </div>
              <div className="space-y-0 lg:space-y-2 divide-y divide-white/5 lg:divide-y-0 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pb-28">
                {filteredTracks.map((track, displayIndex) => {
                  // Find the original index in album.tracks for correct playback
                  const originalIndex = album.tracks.findIndex(t => t === track);
                  const isUnavailable = track.status && track.status !== 'active';
                  const trackKey = track.guid || track.url || `${track.title}-${displayIndex}`;
                  return (
                  <div
                    key={track.guid || track.url || `${track.title}-${displayIndex}`}
                    className={`flex flex-row items-center justify-between gap-2 py-2 px-2.5 lg:p-4 rounded-lg transition-colors group ${
                      isUnavailable
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-white/10 cursor-pointer'
                    } ${
                      globalTrackIndex === originalIndex && currentPlayingAlbum?.title === album?.title ? 'bg-white/20' : ''
                    }`}
                    onClick={() => !isUnavailable && playTrack(originalIndex)}
                    title={isUnavailable ? 'This track is currently unavailable' : undefined}
                  >
                    {/* Row 1: Artwork + Track Info */}
                    <div className="flex items-center gap-2.5 lg:gap-3 flex-1 min-w-0">
                      {/* Mobile: a track number in place of the thumbnail — every row
                          repeats the same cover anyway, and it buys the row's height back.
                          Podcasts get no number (episodes are listed newest-first). */}
                      {!(album as any)?.isPodcast && (
                        <span className="lg:hidden w-5 flex-shrink-0 text-right text-sm text-gray-300 tabular-nums">
                          {displayIndex + 1}
                        </span>
                      )}
                      <div className="relative hidden lg:block w-12 h-12 lg:w-14 lg:h-14 flex-shrink-0 overflow-hidden rounded">
                        {/* Use track-specific artwork if available, fallback to album artwork */}
                        <ArtworkImage
                          src={getAlbumArtworkUrl(track.image || album?.coverArt || '', 'thumbnail', true)}
                          alt={track.title}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                          priority={displayIndex < 5} // Priority for first 5 tracks
                          loading={displayIndex < 5 ? 'eager' : 'lazy'}
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            console.warn('🖼️ Image failed for track:', track.title, 'URL:', target.src);
                            
                            // Try album art as fallback if not already using it
                            const albumArtUrl = getAlbumArtworkUrl(album?.coverArt || '', 'thumbnail', true);
                            const placeholderUrl = getPlaceholderImageUrl('thumbnail');
                            
                            // If current src is not album art and album art exists, try it
                            if (target.src !== albumArtUrl && album?.coverArt) {
                              console.log('🔄 Trying album art fallback for:', track.title);
                              target.src = albumArtUrl;
                            } else {
                              // Use placeholder as final fallback
                              console.log('🖼️ Using placeholder for:', track.title);
                              target.src = placeholderUrl;
                            }
                          }}
                          placeholder="empty"
                        />
                        {/* Play Button Overlay - On album artwork */}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity duration-200">
                          <button
                            className="bg-white text-black rounded-full p-1 transform hover:scale-110 transition-all duration-200 shadow-lg"
                            onClick={(e) => {
                              e.stopPropagation();
                              playTrack(originalIndex);
                            }}
                          >
                            {globalTrackIndex === originalIndex && globalIsPlaying && currentPlayingAlbum?.title === album?.title ? (
                              <Pause className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </div>
                      {/* min-w in px, not rem: everything else in this row (number,
                          duration, the expanded actions) grows with the OS font setting,
                          and `min-w-0 truncate` means the title yields all of it — at 2.0x
                          with the kebab open it reached 0px and the row became
                          unidentifiable. A px floor keeps the title legible; the actions
                          truncate instead. */}
                      <div className="min-w-[64px] flex-1">
                        {/* Mobile: stacked layout, Desktop: single line */}
                        {/* Mobile: one line. The artist is already in the header, so it
                            only earns a line on podcasts, where it carries the date. */}
                        <div className="lg:hidden flex items-center gap-2 min-w-0">
                          <p className="font-medium text-sm truncate min-w-0">
                            {track.title}
                          </p>
                          {((track as any).mediaType === 'video' || (track as any).alternateEnclosures?.some((enc: any) => enc.type?.includes('video'))) && (
                            <span className="flex-shrink-0 inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              <Video className="w-2.5 h-2.5" />
                            </span>
                          )}
                          {(album as any)?.isPodcast && (track as any).publishedAt && (
                            <span className="flex-shrink-0 text-[11px] text-gray-400">
                              {new Date((track as any).publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                        <div className="hidden lg:block">
                          <p className="font-medium text-base line-clamp-2 whitespace-normal break-words">
                            {track.title}
                            {((track as any).mediaType === 'video' || (track as any).alternateEnclosures?.some((enc: any) => enc.type?.includes('video'))) && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                <Video className="w-2.5 h-2.5 mr-0.5" />
                                Video
                              </span>
                            )}
                            {(album as any)?.isPodcast && (track as any).publishedAt
                              ? <span className="text-gray-400 font-normal"> • {new Date((track as any).publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                              : <span className="text-gray-400 font-normal"> • {album?.artist}</span>}
                            {track.subtitle && (
                              <span className="text-gray-400 font-normal italic"> — {track.subtitle}</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                    {/* Row 2: Duration + Action Buttons */}
                    <div className="flex items-center justify-end gap-2 lg:gap-4 flex-shrink-0">
                      {track.explicit && (
                        <span className="bg-red-600 text-white px-1 py-0.5 rounded text-[10px] lg:text-xs font-bold">
                          E
                        </span>
                      )}
                      <span className="text-xs lg:text-sm text-gray-300 lg:text-gray-400 tabular-nums">
                        {formatDuration(track.duration)}
                      </span>

                      {/* The revealed actions sit BEFORE the kebab so they expand leftwards
                          and the kebab itself never moves — the same spot toggles it shut. */}
                      {/* px gaps, same rule as the action row. These are rem by default,
                          and because the title is `min-w-0 truncate` the overflow shows up
                          as the title silently shrinking to nothing rather than as a
                          clipped control — at 2.0x font scale an opened row lost its title
                          entirely (measured 0px), so a collapsed-state sweep can't catch it. */}
                      <div className={`${expandedTrackKey === trackKey ? 'flex' : 'hidden'} lg:flex items-center gap-[12px] lg:gap-[16px]`}>
                      {/* Share Button */}
                      {track.id && (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ShareButton
                            trackId={track.id}
                            feedId={album.feedId}
                            trackTitle={track.title}
                            albumTitle={album.title}
                            variant="ghost"
                            size="sm"
                            className="text-white hover:text-purple-400 !p-[4px]"
                            iconClassName="w-[16px] h-[16px]"
                          />
                        </div>
                      )}

                      {/* Favorite + Download */}
                      {(track.guid || track.url || track.title) && (
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                          <DownloadButton
                            downloadTarget={{ type: 'track', track }}
                            size={20}
                            className="text-white"
                          />
                          <FavoriteButton
                            trackId={track.guid || track.url || `${album.feedId}-${track.title}`}
                            size={20}
                            className="text-white"
                          />
                        </div>
                      )}

                      {/* Boost Button - desktop only. On mobile, boosting is an act tied to
                          listening, so it lives on Now Playing and the player bar rather than
                          behind the kebab of every row of an album you are only browsing;
                          album-level Boost stays in the mobile action row. Desktop has the
                          width to carry it per-row, so it keeps it. */}
                      {(checkHasV4V(track) || checkHasV4V(album) || (track.valueTimeSplits && track.valueTimeSplits.length > 0)) && (
                        <div onClick={(e) => e.stopPropagation()} className="hidden lg:block">
                          <BoostButton
                            key={track.guid || track.url || `boost-${track.title}-${displayIndex}`}
                            trackId={track.id}
                            feedId={album.feedId}
                            trackTitle={track.title}
                            artistName={album.artist}
                            valueSplits={formatValueSplitsForBoost(track, album.artist) || formatValueSplitsForBoost(album, album.artist)}
                            lightningAddress={getPrimaryRecipient(track) || getPrimaryRecipient(album)}
                            episodeGuid={track.v4vValue?.itemGuid || track.valueTimeSplits?.find(v => v.remoteItem?.itemGuid)?.remoteItem?.itemGuid || track.guid}
                            remoteFeedGuid={track.v4vValue?.feedGuid || track.valueTimeSplits?.find(v => v.remoteItem?.feedGuid)?.remoteItem?.feedGuid || album.feedGuid}
                            remoteStartTime={track.v4vValue?.remoteStartTime ?? track.valueTimeSplits?.find(v => v.remoteItem)?.startTime}
                            feedUrl={album.feedUrl}
                            albumName={album.title}
                            publisherGuid={album.publisher?.feedGuid}
                            persons={[
                              ...((track as any).persons || []),
                              ...((album as any).persons || []),
                            ]}
                            className="text-xs px-2 py-1"
                          />
                        </div>
                      )}
                      </div>

                      {/* Mobile: fixed anchor at the right edge. Rendered last so the
                          actions above open to its left and it stays put when toggled. */}
                      <button
                        type="button"
                        className="lg:hidden flex-shrink-0 -mr-1 flex items-center justify-center rounded-full active:bg-white/10 transition-colors"
                        style={{ width: 32, height: 32, color: expandedTrackKey === trackKey ? '#fff' : undefined }}
                        aria-label={expandedTrackKey === trackKey ? 'Hide track actions' : 'Show track actions'}
                        aria-expanded={expandedTrackKey === trackKey}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedTrackKey(expandedTrackKey === trackKey ? null : trackKey);
                        }}
                      >
                        <MoreVertical size={18} className={expandedTrackKey === trackKey ? 'text-white' : 'text-gray-400'} />
                      </button>
                    </div>
                  </div>
                  );
                })}

                {/* PodRoll and Publisher Recommendations */}
            {podrollAlbums.length > 0 && (
              <div className="bg-black/40 backdrop-blur-sm rounded-lg p-6 mt-6">
                <h2 className="text-xl font-semibold mb-4">You Might Also Like</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {podrollAlbums.map((podrollAlbum, index) => (
                    <Link
                      key={index}
                      href={generateAlbumHref(podrollAlbum)}
                      className="group block"
                    >
                      <div className="bg-white/5 hover:bg-white/10 rounded-lg p-3 transition-all duration-200 hover:scale-105">
                        <div className="aspect-square relative mb-3">
                          <ArtworkImage
                            src={getAlbumArtworkUrl(podrollAlbum.coverArt || '', 'thumbnail')}
                            alt={podrollAlbum.title}
                            width={150}
                            height={150}
                            className="w-full h-full object-cover rounded-md"
                            onError={(e) => {
                              // Fallback to placeholder on error
                              const target = e.target as HTMLImageElement;
                              target.src = getPlaceholderImageUrl('thumbnail');
                            }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-md transition-all duration-200 flex items-center justify-center">
                            <Play className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                          </div>
                        </div>
                        <h3 className="font-semibold text-white text-sm mb-1 overflow-hidden line-clamp-2">
                          {podrollAlbum.title}
                        </h3>
                        <p className="text-gray-400 text-xs">
                          {podrollAlbum.artist}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
