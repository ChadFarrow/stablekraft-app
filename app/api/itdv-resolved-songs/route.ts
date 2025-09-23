import { NextResponse } from 'next/server';
import resolvedSongsData from '@/data/itdv-resolved-songs.json';

export async function GET() {
  try {
    console.log('📊 Serving resolved songs data:', resolvedSongsData.length, 'songs');

    // Transform the data to match the expected playlist format
    const transformedTracks = resolvedSongsData.map((song, index) => ({
      id: `itdv-${song.feedGuid}-${song.itemGuid}`,
      title: song.title,
      artist: song.artist,
      episodeTitle: song.feedTitle || 'Unknown Episode',
      audioUrl: '', // Will be resolved via V4V
      startTime: 0,
      endTime: 0,
      duration: 180, // Default 3 minutes
      source: 'value-split',
      image: '',
      feedGuid: song.feedGuid,
      itemGuid: song.itemGuid,
      valueForValue: {
        feedGuid: song.feedGuid,
        itemGuid: song.itemGuid,
        remotePercentage: 100,
        resolved: true,
        resolvedTitle: song.title,
        resolvedArtist: song.artist,
        resolvedAudioUrl: `https://api.wavlake.com/track/play/${song.itemGuid}`,
        resolvedDuration: 180
      }
    }));

    const response = {
      tracks: transformedTracks
    };

    console.log(`🔍 ITDV API Response structure:`, {
      tracksCount: response.tracks.length,
      firstTrack: response.tracks[0],
      hasTracksProperty: 'tracks' in response,
      responseType: typeof response
    });

    return NextResponse.json(response, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  } catch (error) {
    console.error('Error serving resolved songs data:', error);
    return NextResponse.json(
      { error: 'Failed to load resolved songs data' },
      {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}