import { Metadata } from 'next';
import { RSSAlbum } from '@/lib/rss-parser';
import AlbumDetailClient from './AlbumDetailClient';
import { generateAlbumSlug } from '@/lib/url-utils';
import AppLayout from '@/components/AppLayout';

// Dynamic generation - disable static generation for now
// export async function generateStaticParams() {
//   // Disabled due to build-time RSS fetching issues
//   return [];
// }

// Helper function to find track by URL parameter (matches client-side logic)
function findTrackByParam(tracks: any[], trackParam: string): any | null {
  // 1. Try exact ID match
  let track = tracks.find((t: any) => t.id === trackParam);
  if (track) return track;

  // 2. Try GUID match
  track = tracks.find((t: any) => t.guid === trackParam);
  if (track) return track;

  // 3. Try slug-based match (-track-N pattern)
  const trackNumberMatch = trackParam.match(/-track-(\d+)$/);
  if (trackNumberMatch) {
    const trackNumber = parseInt(trackNumberMatch[1], 10);
    if (trackNumber >= 1 && trackNumber <= tracks.length) {
      return tracks[trackNumber - 1];
    }
  }

  // 4. Try title-based match
  const slugify = (str: string) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  track = tracks.find((t: any) => slugify(t.title) === slugify(trackParam));
  if (track) return track;

  return null;
}

// Generate metadata for each album (supports ?track= param for track-specific previews)
export async function generateMetadata({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>,
  searchParams: Promise<{ track?: string }>
}): Promise<Metadata> {
  const { id } = await params;
  const { track: trackParam } = await searchParams;

  // Handle both URL-encoded and slug formats
  let albumTitle: string;
  try {
    // First try to decode URL-encoded characters (e.g., %20 -> space)
    albumTitle = decodeURIComponent(id);
  } catch (error) {
    // If decoding fails, use the original id
    albumTitle = id;
  }

  // Convert hyphens to spaces for slug format (e.g., "stay-awhile" -> "stay awhile")
  albumTitle = albumTitle.replace(/-/g, ' ');

  // Try to fetch album data to get the image for Open Graph
  let albumImage: string | undefined;
  let albumArtist: string | undefined;
  let albumTracks: any[] = [];

  const baseUrl = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : (process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app');

  try {
    // Fetch from database API using the album slug
    const response = await fetch(`${baseUrl}/api/albums/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      next: { revalidate: 0 }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.album) {
        // Ensure image URL is absolute for Open Graph
        const coverArt = data.album.coverArt;
        if (coverArt && !coverArt.startsWith('http')) {
          albumImage = `${baseUrl}${coverArt}`;
        } else {
          albumImage = coverArt;
        }
        albumArtist = data.album.artist;
        // Use the actual album title from the API
        albumTitle = data.album.title;
        // Store tracks for potential track-specific lookup
        albumTracks = data.album.tracks || [];
      }
    }
  } catch (error) {
    console.warn('Failed to fetch album metadata:', error);
  }

  // Check if we have a track parameter and can find the specific track
  let foundTrack: any = null;
  if (trackParam && albumTracks.length > 0) {
    foundTrack = findTrackByParam(albumTracks, trackParam);
  }

  // Build metadata based on whether we found a specific track
  if (foundTrack) {
    // Track-specific metadata
    const trackTitle = foundTrack.title;
    const trackArtist = foundTrack.subtitle || albumArtist || 'Unknown Artist';

    // Use track image if available, otherwise fall back to album image
    let trackImage = foundTrack.image;
    if (trackImage && !trackImage.startsWith('http')) {
      trackImage = `${baseUrl}${trackImage}`;
    }
    const ogImage = trackImage || albumImage;

    const trackDescription = `Listen to ${trackTitle} by ${trackArtist} from ${albumTitle} on DoerfelVerse`;
    const displayTitle = `${trackTitle} by ${trackArtist}`;

    return {
      title: `${displayTitle} | DoerfelVerse`,
      description: trackDescription,
      openGraph: {
        title: displayTitle,
        description: trackDescription,
        images: ogImage ? [{ url: ogImage }] : [],
        type: 'music.song',
      },
      twitter: {
        card: 'summary_large_image',
        title: displayTitle,
        description: trackDescription,
        images: ogImage ? [ogImage] : [],
      },
    };
  }

  // Album-level metadata (default)
  const description = albumArtist
    ? `Listen to ${albumTitle} by ${albumArtist} on DoerfelVerse`
    : `Listen to ${albumTitle} on DoerfelVerse`;

  return {
    title: `${albumTitle} | DoerfelVerse`,
    description,
    openGraph: {
      title: albumTitle,
      description,
      images: albumImage ? [{ url: albumImage }] : [],
      type: 'music.album',
    },
    twitter: {
      card: 'summary_large_image',
      title: albumTitle,
      description,
      images: albumImage ? [albumImage] : [],
    },
  };
}

// Server-side data fetching - use pre-parsed data API
async function getAlbumData(albumTitle: string): Promise<RSSAlbum | null> {
  try {
    // Only attempt server-side fetching in development or if explicitly enabled
    if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_SERVER_SIDE_FETCH) {
      console.log('Skipping server-side album fetch in production');
      return null;
    }
    
    // Fetch pre-parsed album data - use relative URL for production compatibility
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                   (process.env.NODE_ENV === 'production' ? 'https://stablekraft.app' : 'http://localhost:3000');
    
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(`${baseUrl}/api/albums`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn('Failed to fetch albums for metadata:', response.status);
      return null;
    }
    
    const data = await response.json();
    const albums = data.albums || [];
    
    // Find the matching album
    const foundAlbum = albums.find((album: any) => {
      const albumTitleLower = album.title.toLowerCase();
      const searchTitleLower = albumTitle.toLowerCase();
      
      // Exact match
      if (album.title === albumTitle) return true;
      
      // Case-insensitive match
      if (albumTitleLower === searchTitleLower) return true;
      
      // Contains match
      if ((typeof albumTitleLower === 'string' && albumTitleLower.includes(searchTitleLower)) || 
          (typeof searchTitleLower === 'string' && searchTitleLower.includes(albumTitleLower))) return true;
      
      // Normalized match
      const normalizedAlbum = albumTitleLower.replace(/[^a-z0-9]/g, '');
      const normalizedSearch = searchTitleLower.replace(/[^a-z0-9]/g, '');
      if (normalizedAlbum === normalizedSearch) return true;
      
      return false;
    });
    
    return foundAlbum || null;
  } catch (error) {
    console.error('Error fetching album data for metadata:', error);
    return null;
  }
}

export default async function AlbumDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Redirect old playlist album URLs to new playlist pages
  if (id === 'itdv-music-playlist') {
    // Use Next.js redirect
    const { redirect } = await import('next/navigation');
    redirect('/playlist/itdv');
  }

  if (id === 'hgh-music-playlist' || id === 'homegrown-hits-music-playlist') {
    const { redirect } = await import('next/navigation');
    redirect('/playlist/hgh');
  }

  if (id === 'iam-music-playlist' || id === 'its-a-mood-music-playlist') {
    const { redirect } = await import('next/navigation');
    redirect('/playlist/iam');
  }

  // Handle both URL-encoded and slug formats
  let albumTitle: string;
  try {
    // First try to decode URL-encoded characters (e.g., %20 -> space)
    albumTitle = decodeURIComponent(id);
  } catch (error) {
    // If decoding fails, use the original id
    albumTitle = id;
  }

  // Convert hyphens to spaces for slug format (e.g., "stay-awhile" -> "stay awhile")
  albumTitle = albumTitle.replace(/-/g, ' ');

  console.log(`🔍 Album page: id="${id}" -> albumTitle="${albumTitle}"`);

  // Skip server-side data fetching to prevent RSC payload issues
  // Let the client component handle data loading
  const album = null;

  // FIXED: Pass the original ID to the client component, not the converted title
  // This allows the client component to fetch the album using the correct ID format
  return (
    <AppLayout>
      <AlbumDetailClient albumTitle={albumTitle} albumId={id} initialAlbum={album} />
    </AppLayout>
  );
}