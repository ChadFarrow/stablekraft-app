'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MusicTrack } from '@/lib/music-track-parser';
import MusicTrackDetail from '@/components/MusicTrackDetail';
import LoadingSpinner from '@/components/LoadingSpinner';
import { ArrowLeft } from 'lucide-react';

export default function TrackDetailPage() {
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
      // Since we don't have a dedicated track API endpoint yet,
      // we'll load all tracks and find the specific one
      // In a production app, you'd want a dedicated /api/music-tracks/[id] endpoint
      
      const feedUrls = [
        'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml'
      ];

      let foundTrack: MusicTrack | null = null;
      const allTracks: MusicTrack[] = [];

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

      if (!foundTrack) {
        throw new Error('Track not found');
      }

      setTrack(foundTrack);

      // Find related tracks (same artist or same episode)
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