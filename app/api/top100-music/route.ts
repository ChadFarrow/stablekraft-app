import { NextRequest, NextResponse } from 'next/server';
import { TOP100_AUDIO_URL_MAP } from '@/data/top100-audio-urls';
import staticTop100Data from '@/data/top100-static-data.json';
import { getAlbumArtworkUrl } from '@/lib/cdn-utils';

interface Top100Track {
  id: string;
  position: number;
  title: string;
  artist: string;
  sats: string;
  satsNumber: number;
  artwork: string;
  podcastLink: string;
  audioUrl?: string;
  feedUrl?: string;
  itemGuid?: string;
}

export async function GET(request: NextRequest) {
  try {
    console.log('🎵 Loading Top 100 V4V Music data from static cache...');
    
    // Use static data instead of external API call for better performance
    const tracks = parseStaticTop100Data();
    
    console.log(`✅ Successfully loaded ${tracks.length} Top 100 V4V tracks from static cache`);
    
    return NextResponse.json({
      success: true,
      data: {
        tracks,
        totalTracks: tracks.length,
        lastUpdated: staticTop100Data.metadata.lastUpdated,
        source: staticTop100Data.metadata.source,
        description: staticTop100Data.metadata.description
      }
    });
    
  } catch (error) {
    console.error('❌ Error loading Top 100 data:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: {
        tracks: [],
        totalTracks: 0
      }
    }, { status: 500 });
  }
}

function parseStaticTop100Data(): Top100Track[] {
  const tracks: Top100Track[] = [];
  
  try {
    console.log(`📊 Processing ${staticTop100Data.tracks.length} static Top 100 tracks`);
    
    for (const item of staticTop100Data.tracks) {
      const title = item.title?.trim() || '';
      const artist = item.artist?.trim() || '';
      
      // Use static audio URL mapping for known tracks
      const audioUrl = TOP100_AUDIO_URL_MAP[title] || '';
      
      // Use getAlbumArtworkUrl utility for consistent image handling and proxying
      // This ensures all external domains are properly proxied and validated
      let finalArtwork = '';
      try {
        const originalArtwork = item.artwork?.replace('http://', 'https://') || '';
        finalArtwork = originalArtwork 
          ? getAlbumArtworkUrl(originalArtwork, 'thumbnail', true)
          : getAlbumArtworkUrl('', 'thumbnail'); // Will return placeholder
      } catch (error) {
        // If URL parsing fails, use placeholder
        console.warn(`⚠️ Invalid artwork URL for track "${title}":`, item.artwork);
        finalArtwork = getAlbumArtworkUrl('', 'thumbnail');
      }
      
      tracks.push({
        id: `v4v-${item.rank}`,
        position: item.rank,
        title: title,
        artist: artist,
        sats: String(item.boosts).toLocaleString(),
        satsNumber: Number(item.boosts) || 0,
        artwork: finalArtwork,
        podcastLink: item.podcastLink,
        audioUrl: audioUrl,
        feedUrl: '',
        itemGuid: ''
      });
    }
    
    console.log(`📊 Successfully parsed ${tracks.length} static V4V music tracks`);
    
    // Already sorted by rank in static data
    return tracks;
    
  } catch (error) {
    console.error('❌ Error parsing static Top 100 data:', error);
  }
  
  return tracks;
}

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // Cache for 1 hour