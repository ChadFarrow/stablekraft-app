import { Metadata } from 'next';
import TrackDetailClient from './TrackDetailClient';

// Generate metadata for each track
export async function generateMetadata({ params }: { params: Promise<{ trackId: string }> }): Promise<Metadata> {
  const { trackId } = await params;

  // Decode the track ID if URL-encoded
  let decodedTrackId: string;
  try {
    decodedTrackId = decodeURIComponent(trackId);
  } catch (error) {
    decodedTrackId = trackId;
  }

  // Try to fetch track data to get metadata for Open Graph
  let trackTitle: string = decodedTrackId;
  let trackImage: string | undefined;
  let trackArtist: string | undefined;
  let trackDescription: string | undefined;

  try {
    // Fetch from database API using the track ID
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app';
    const response = await fetch(`${baseUrl}/api/music-tracks/${decodedTrackId}`, {
      cache: 'no-store',
      next: { revalidate: 0 }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        trackTitle = data.data.title || decodedTrackId;
        trackImage = data.data.image || data.data.itunesImage;
        trackArtist = data.data.artist;
        trackDescription = data.data.description || data.data.itunesSummary;
      }
    }
  } catch (error) {
    console.warn('Failed to fetch track metadata:', error);
  }

  // Build description
  const description = trackArtist
    ? `Listen to "${trackTitle}" by ${trackArtist} on DoerfelVerse`
    : `Listen to "${trackTitle}" on DoerfelVerse`;

  return {
    title: `${trackTitle} | DoerfelVerse`,
    description: trackDescription || description,
    openGraph: {
      title: trackTitle,
      description: trackDescription || description,
      images: trackImage ? [{ url: trackImage }] : [],
      type: 'music.song',
    },
    twitter: {
      card: 'summary_large_image',
      title: trackTitle,
      description: trackDescription || description,
      images: trackImage ? [trackImage] : [],
    },
  };
}

export default function TrackDetailPage() {
  return <TrackDetailClient />;
}
