import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';

/**
 * ITDV Music Playlist API
 * Returns V4V value-split tracks with remoteItem references from ITDV feed
 */
export async function GET(request: NextRequest) {
  try {
    const feedUrl = 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml';
    
    console.log('🎵 Extracting V4V music tracks from ITDV feed...');
    
    // Directly call the parser instead of HTTP fetch
    const result = await MusicTrackParser.extractMusicTracks(feedUrl);
    
    if (!result || !result.tracks) {
      return NextResponse.json({
        success: false,
        error: 'Failed to extract tracks',
        tracks: []
      }, { status: 500 });
    }
    
    // Filter only V4V value-split tracks with remoteItem references
    const v4vTracks = result.tracks.filter((track: any) => 
      track.source === 'value-split' && 
      track.valueForValue?.feedGuid && 
      track.valueForValue?.itemGuid
    );
    
    console.log(`✅ Found ${v4vTracks.length} V4V tracks from ${result.tracks.length} total tracks`);
    
    // Convert to PlaylistTemplateCompact format
    const formattedTracks = v4vTracks.map((track: any) => ({
      id: track.id,
      title: track.title,
      duration: track.duration || '0:00',
      url: track.url || track.audioUrl || '',
      trackNumber: track.trackOrder || 0,
      subtitle: track.episodeTitle,
      summary: track.description,
      image: track.image,
      explicit: track.explicit || false,
      keywords: track.keywords || [],
      artist: track.artist || 'Unknown Artist',
      albumTitle: track.episodeTitle || 'ITDV Episode',
      feedGuid: track.valueForValue?.feedGuid,
      itemGuid: track.valueForValue?.itemGuid
    }));
    
    return NextResponse.json({
      success: true,
      tracks: formattedTracks,
      playlist: {
        title: 'ITDV Music Library',
        description: 'Original music tracks from Into The Doerfel Verse with V4V resolution',
        artwork: null,
        link: null
      },
      metadata: {
        totalTracks: formattedTracks.length,
        source: 'itdv-v4v-tracks',
        lastUpdated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error loading ITDV music playlist:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load playlist',
      tracks: []
    }, { status: 500 });
  }
}

