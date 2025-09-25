import { NextRequest, NextResponse } from 'next/server';

// Import the resolved songs data
const resolvedSongsData = [
  {
    "feedGuid": "3ae285ab-434c-59d8-aa2f-59c6129afb92",
    "itemGuid": "d8145cb6-97d9-4358-895b-2bf055d169aa",
    "title": "Neon Hawk",
    "artist": "John Depew Trio",
    "feedUrl": "https://wavlake.com/feed/music/99ed143c-c461-4f1a-9d0d-bee6f70d8b7e",
    "feedTitle": "Bell of Hope",
    "episodeId": 40262390560,
    "feedId": 7422180
  },
  {
    "feedGuid": "6fc2ad98-d4a8-5d70-9c68-62e9efc1209c",
    "itemGuid": "aad6e3b1-6589-4e22-b8ca-521f3d888263",
    "title": "Grey's Birthday",
    "artist": "Big Awesome",
    "feedUrl": "https://wavlake.com/feed/music/5a07b3f1-8249-45a1-b40a-630797dc4941",
    "feedTitle": "Birdfeeder (EP)",
    "episodeId": 29982854680,
    "feedId": 7086035
  },
  {
    "feedGuid": "dea01a9d-a024-5b13-84aa-b157304cd3bc",
    "itemGuid": "52007112-2772-42f9-957a-a93eaeedb222",
    "title": "Smokestacks",
    "artist": "Herbivore",
    "feedUrl": "https://wavlake.com/feed/music/328f61b9-20b1-4338-9e2a-b437abc39f7b",
    "feedTitle": "Smokestacks",
    "episodeId": 16429855198,
    "feedId": 6685399
  }
  // Add more tracks as needed for testing
].filter(song => song.title && song.artist);

export async function GET() {
  try {
    console.log(`🎵 Resolving audio URLs for ${resolvedSongsData.length} ITDV tracks`);
    
    // Call the resolve-audio-urls API
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001'}/api/resolve-audio-urls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        songs: resolvedSongsData
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log(`✅ Resolved ${result.resolved} audio URLs, ${result.failed} failed`);
    
    return NextResponse.json({
      success: true,
      message: `Resolved ${result.resolved} audio URLs out of ${resolvedSongsData.length} tracks`,
      resolved: result.resolved,
      failed: result.failed,
      tracks: result.tracks.slice(0, 5), // Return first 5 for testing
      failedTracks: result.failedTracks.slice(0, 3), // Return first 3 failures for testing
      totalProcessed: resolvedSongsData.length
    });
    
  } catch (error) {
    console.error('Error resolving ITDV audio URLs:', error);
    return NextResponse.json(
      { 
        error: 'Failed to resolve ITDV audio URLs', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}