import { NextResponse } from 'next/server';

// Interface for parsed track data
interface ParsedTrack {
  feedGuid: string;
  itemGuid: string;
  index: number;
}

export async function GET() {
  try {
    // Fetch the HGH playlist XML from GitHub
    const response = await fetch(
      'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml',
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }

    const xmlText = await response.text();
    
    // Parse the XML to extract podcast:remoteItem elements
    const remoteItemRegex = /<podcast:remoteItem\s+feedGuid="([^"]+)"\s+itemGuid="([^"]+)"\/>/g;
    const tracks: ParsedTrack[] = [];
    let match;
    let index = 0;

    while ((match = remoteItemRegex.exec(xmlText)) !== null) {
      tracks.push({
        feedGuid: match[1],
        itemGuid: match[2],
        index: index++
      });
    }

    // Also extract channel metadata
    const titleMatch = xmlText.match(/<title>([^<]+)<\/title>/);
    const descriptionMatch = xmlText.match(/<description>\s*([^<]+)\s*<\/description>/);
    const imageUrlMatch = xmlText.match(/<image>\s*<url>\s*([^<]+)\s*<\/url>/);
    
    const metadata = {
      title: titleMatch ? titleMatch[1] : 'Homegrown Hits music playlist',
      description: descriptionMatch ? descriptionMatch[1].trim() : 'Every music reference from Homegrown Hits podcast',
      imageUrl: imageUrlMatch ? imageUrlMatch[1].trim() : null,
      totalTracks: tracks.length,
      lastUpdated: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      metadata,
      tracks
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      }
    });

  } catch (error) {
    console.error('Error fetching HGH playlist:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch HGH playlist',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}