'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MusicTrack } from '@/lib/music-track-parser';
import MusicTrackDetail from '@/components/MusicTrackDetail';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ArrowLeft } from 'lucide-react';

export default function TrackDetailClient() {
  const params = useParams();
  const router = useRouter();
  const trackId = params?.trackId as string;
  
  const [track, setTrack] = useState<MusicTrack | null>(null);
  const [relatedTracks, setRelatedTracks] = useState<MusicTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!trackId) return;
    
    loadTrackDetails();
  }, [trackId]);

  const loadTrackDetails = async () => {
    setIsLoading(true);
    setError(null);

    try {
      let foundTrack: MusicTrack | null = null;
      const allTracks: MusicTrack[] = [];

      // First, try to fetch the track from the database API
      try {
        const response = await fetch(`/api/music-tracks/${encodeURIComponent(trackId)}`);

        if (response.ok) {
          const data = await response.json();

          if (data.success && data.data) {
            // Transform database track to MusicTrack format
            // Map database source types to valid MusicTrack source types
            let trackSource: 'chapter' | 'value-split' | 'description' | 'external-feed' = 'external-feed';
            if (data.data.source === 'chapter' || data.data.source === 'value-split' ||
                data.data.source === 'description' || data.data.source === 'external-feed') {
              trackSource = data.data.source;
            }

            foundTrack = {
              id: data.data.id,
              title: data.data.title,
              artist: data.data.artist || 'Unknown Artist',
              episodeId: data.data.feedGuid || data.data.feedId || '',
              episodeTitle: data.data.episodeTitle || '',
              episodeDate: data.data.episodeDate ? new Date(data.data.episodeDate) : new Date(),
              startTime: data.data.startTime || 0,
              endTime: data.data.endTime || 0,
              duration: data.data.duration || 0,
              audioUrl: data.data.audioUrl,
              image: data.data.image || '',
              description: data.data.description || '',
              source: trackSource,
              feedUrl: data.data.feedUrl || '',
              discoveredAt: data.data.discoveredAt ? new Date(data.data.discoveredAt) : new Date(),
              valueForValue: data.data.valueForValue,
            };

            console.log('✅ Found track in database:', foundTrack.title);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch track from database:', err);
        // Continue to RSS feed fallback
      }

      // If not found in database, search RSS feeds
      if (!foundTrack) {
        const feedUrls = [
          'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml'
        ];

        for (const feedUrl of feedUrls) {
          try {
            const response = await fetch(`/api/music-tracks?feedUrl=${encodeURIComponent(feedUrl)}`);

            if (response.ok) {
              const data = await response.json();

              if (data.success && data.data.tracks) {
                allTracks.push(...data.data.tracks);

                // Look for our specific track
                if (!foundTrack) {
                  foundTrack = data.data.tracks.find((t: MusicTrack) => t.id === trackId);
                }
              }
            }
          } catch (err) {
            console.warn(`Failed to load tracks from ${feedUrl}:`, err);
          }
        }
      }

      if (!foundTrack) {
        throw new Error('Track not found');
      }

      setTrack(foundTrack);

      // Find related tracks (same artist or same episode)
      // TODO: Could fetch related tracks from database as well
      const related = allTracks
        .filter(t =>
          t.id !== foundTrack!.id && (
            t.artist.toLowerCase() === foundTrack!.artist.toLowerCase() ||
            t.episodeId === foundTrack!.episodeId
          )
        )
        .slice(0, 6);

      setRelatedTracks(related);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load track details');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlayTrack = (playTrack: MusicTrack) => {
    console.log('Playing track:', playTrack);
    // TODO: Integrate with audio player (Task 10)
  };

  const handleNavigateBack = () => {
    router.push('/music-tracks');
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
          <span className="ml-3 text-gray-400">Loading track details...</span>
        </div>
      </div>
    );
  }

  if (error || !track) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-4">Track Not Found</h1>
          <p className="text-gray-400 mb-6">{error || 'The requested track could not be found.'}</p>
          
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleNavigateBack}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Music Tracks
            </button>
            
            <button
              onClick={loadTrackDetails}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <MusicTrackDetail
        track={track}
        relatedTracks={relatedTracks}
        onPlay={handlePlayTrack}
        onNavigateBack={handleNavigateBack}
      />
    </div>
  );
}