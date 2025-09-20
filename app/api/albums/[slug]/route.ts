import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    console.log(`🔍 Database Album API: Looking for slug "${slug}"`);
    
    // Get all feeds with their tracks from database
    const feeds = await prisma.feed.findMany({
      where: { status: 'active' },
      include: {
        tracks: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ]
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    console.log(`📊 Loaded ${feeds.length} feeds from database for album lookup`);
    
    // Transform feeds into albums and search for matching slug
    let foundAlbum = null;
    
    // First pass: collect all potential matches
    const potentialMatches = [];
    
    for (const feed of feeds) {
      if (feed.tracks.length === 0) continue;
      
      // Create album from feed
      const albumTitle = feed.title;
      const albumSlug = generateAlbumSlug(albumTitle);
      const albumId = albumSlug + '-' + feed.id.split('-')[0];
      
      // Check if this album matches the requested slug
      if (albumId === slug || albumSlug === slug || albumTitle.toLowerCase().replace(/\s+/g, '-') === slug) {
        console.log(`🔍 Found potential match: "${albumTitle}" with ${feed.tracks.length} tracks`);
        potentialMatches.push({ feed, trackCount: feed.tracks.length });
      }
    }
    
    // If we have multiple matches, prefer the one with the most tracks (full album over single)
    if (potentialMatches.length > 0) {
      const bestMatchData = potentialMatches.reduce((best, current) => 
        current.trackCount > best.trackCount ? current : best
      );
      
      const feed = bestMatchData.feed;
      console.log(`✅ Selected best match: "${feed.title}" with ${feed.tracks.length} tracks`);
      
      const tracks = feed.tracks
        .filter((track: any, index: number, self: any[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: any) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: any, index: number) => ({
        title: track.title,
        duration: track.duration ? 
          Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') : 
          track.itunesDuration || '0:00',
        url: track.audioUrl,
        trackNumber: index + 1,
        subtitle: track.subtitle || '',
        summary: track.description || '',
        image: track.image || feed.image || '',
        explicit: track.explicit || false,
        keywords: track.itunesKeywords || []
      }));
      
      // Determine if this is a playlist based on track variety
      const isPlaylist = tracks.length > 1 && 
        new Set(tracks.map((t: any) => t.artist || feed.artist)).size > 1;
      
      const albumTitle = feed.title;
      const albumSlug = generateAlbumSlug(albumTitle);
      const albumId = albumSlug + '-' + feed.id.split('-')[0];
      
      foundAlbum = {
        id: albumId,
        title: albumTitle,
        artist: feed.artist || 'Unknown Artist',
        description: feed.description || '',
        summary: feed.description || '',
        subtitle: '',
        coverArt: feed.image || `/api/placeholder-image?title=${encodeURIComponent(albumTitle)}&artist=${encodeURIComponent(feed.artist || 'Unknown Artist')}`,
        releaseDate: feed.lastFetched || feed.createdAt,
        explicit: tracks.some((t: any) => t.explicit) || feed.explicit,
        tracks: tracks,
        podroll: isPlaylist ? { enabled: true } : null,
        publisher: feed.type === 'album' && feed.artist ? {
          feedGuid: feed.id,
          feedUrl: feed.originalUrl,
          title: feed.artist,
          artistImage: feed.image
        } : null,
        funding: null,
        feedId: feed.id,
        feedUrl: feed.originalUrl,
        lastUpdated: feed.updatedAt
      };
    }
    
    // If not found by exact slug match, try more flexible matching
    if (!foundAlbum) {
      console.log(`🔍 Trying flexible matching for slug: "${slug}"`);
      
      const searchSlug = slug.toLowerCase();
      const decodedSlug = decodeURIComponent(searchSlug);
      const titleFromSlug = decodedSlug.replace(/-/g, ' ');
      
      const flexibleMatches = [];
      
      for (const feed of feeds) {
        if (feed.tracks.length === 0) continue;
        
        const albumTitle = feed.title;
        const albumTitleLower = albumTitle.toLowerCase();
        
        // Try various matching strategies
        const matches = [
          albumTitleLower === searchSlug,
          albumTitleLower === decodedSlug,
          albumTitleLower === titleFromSlug,
          albumTitleLower.replace(/\s+/g, '-') === searchSlug,
          albumTitleLower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-') === searchSlug,
          searchSlug.length > 5 && albumTitleLower.includes(searchSlug),
          titleFromSlug.length > 5 && albumTitleLower.includes(titleFromSlug)
        ];
        
        if (matches.some(match => match)) {
          console.log(`🔍 Found flexible match: "${albumTitle}" with ${feed.tracks.length} tracks`);
          flexibleMatches.push({ feed, trackCount: feed.tracks.length });
        }
      }
      
      // If we have flexible matches, prefer the one with the most tracks
      if (flexibleMatches.length > 0) {
        const bestFlexibleMatch = flexibleMatches.reduce((best, current) => 
          current.trackCount > best.trackCount ? current : best
        );
        
        const feed = bestFlexibleMatch.feed;
        console.log(`✅ Selected best flexible match: "${feed.title}" with ${feed.tracks.length} tracks`);
        
        const tracks = feed.tracks
        .filter((track: any, index: number, self: any[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: any) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: any, index: number) => ({
          title: track.title,
          duration: track.duration ? 
            Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') : 
            track.itunesDuration || '0:00',
          url: track.audioUrl,
          trackNumber: index + 1,
          subtitle: track.subtitle || '',
          summary: track.description || '',
          image: track.image || feed.image || '',
          explicit: track.explicit || false,
          keywords: track.itunesKeywords || []
        }));
        
        const isPlaylist = tracks.length > 1 && 
          new Set(tracks.map((t: any) => t.artist || feed.artist)).size > 1;
        
        const albumTitle = feed.title;
        const albumSlug = generateAlbumSlug(albumTitle);
        const albumId = albumSlug + '-' + feed.id.split('-')[0];
        
        foundAlbum = {
          id: albumId,
          title: albumTitle,
          artist: feed.artist || 'Unknown Artist',
          description: feed.description || '',
          summary: feed.description || '',
          subtitle: '',
          coverArt: feed.image || `/api/placeholder-image?title=${encodeURIComponent(albumTitle)}&artist=${encodeURIComponent(feed.artist || 'Unknown Artist')}`,
          releaseDate: feed.lastFetched || feed.createdAt,
          explicit: tracks.some((t: any) => t.explicit) || feed.explicit,
          tracks: tracks,
          podroll: isPlaylist ? { enabled: true } : null,
          publisher: feed.type === 'album' && feed.artist ? {
            feedGuid: feed.id,
            feedUrl: feed.originalUrl,
            title: feed.artist,
            artistImage: feed.image
          } : null,
          funding: null,
          feedId: feed.id,
          feedUrl: feed.originalUrl,
          lastUpdated: feed.updatedAt
        };
      }
    }
    
    if (!foundAlbum) {
      console.log(`❌ No album found for slug: "${slug}"`);
      return NextResponse.json({ 
        album: null, 
        error: 'Album not found' 
      }, { status: 404 });
    }
    
    console.log(`✅ Database Album API: Returning album "${foundAlbum.title}" by ${foundAlbum.artist}`);
    
    return NextResponse.json({
      album: foundAlbum,
      lastUpdated: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });

  } catch (error) {
    console.error('Error in database album lookup API:', error);
    return NextResponse.json({ 
      album: null, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}