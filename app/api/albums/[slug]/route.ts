import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug, getPublisherInfo } from '@/lib/url-utils';

const ITDV_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';
const HGH_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
const IAM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml';
const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

function parseArtworkUrl(xmlText: string): string | null {
  // Parse the <image><url>...</url></image> structure
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return null;
}

function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];
  
  // Simple regex parsing for podcast:remoteItem tags
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    const feedGuid = match[1];
    const itemGuid = match[2];
    
    if (feedGuid && itemGuid) {
      remoteItems.push({
        feedGuid,
        itemGuid
      });
    }
  }
  
  return remoteItems;
}

async function resolvePlaylistItems(remoteItems: RemoteItem[], playlistSource = 'database-album') {
  const startTime = Date.now();
  try {
    // Get unique item GUIDs from the playlist (these map to track.guid)
    const itemGuids = [...new Set(remoteItems.map(item => item.itemGuid))];
    console.log(`🔍 Database-only lookup for ${itemGuids.length} unique track GUIDs`);

    // DATABASE-ONLY: Find tracks in database by GUID
    const tracks = await prisma.track.findMany({
      where: {
        guid: { in: itemGuids },
        status: 'active'  // Only active tracks
      },
      select: {
        id: true,
        guid: true,
        title: true,
        artist: true,
        audioUrl: true,
        duration: true,
        publishedAt: true,
        image: true,
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            image: true
          }
        }
      }
    });

    const queryTime = Date.now() - startTime;
    console.log(`📊 Database query completed in ${queryTime}ms - found ${tracks.length}/${itemGuids.length} tracks`);

    // Create a map for quick lookup by track GUID
    const trackMap = new Map(tracks.map(track => [track.guid, track]));
    const resolvedTracks: any[] = [];

    // Resolve each playlist item to an actual track (DATABASE-ONLY)
    for (const remoteItem of remoteItems) {
      const track = trackMap.get(remoteItem.itemGuid);

      if (track && track.Feed && track.audioUrl) { // Only tracks with valid audio URLs
        // Create track object with feed context
        const resolvedTrack = {
          id: track.id,
          title: track.title,
          artist: track.artist || track.Feed.artist || 'Unknown Artist',
          audioUrl: track.audioUrl,
          duration: track.duration || 0,
          publishedAt: track.publishedAt?.toISOString() || new Date().toISOString(),
          image: track.image || track.Feed.image || '/placeholder-podcast.jpg',
          albumTitle: track.Feed.title,
          feedTitle: track.Feed.title,
          feedId: track.Feed.id,
          guid: track.guid,
          // Add playlist context
          playlistContext: {
            feedGuid: remoteItem.feedGuid,
            itemGuid: remoteItem.itemGuid,
            source: playlistSource
          }
        };

        resolvedTracks.push(resolvedTrack);
      }
      // NO API FALLBACK - albums should only use database content
    }

    const totalTime = Date.now() - startTime;
    const resolutionRate = ((resolvedTracks.length / remoteItems.length) * 100).toFixed(1);
    console.log(`🎯 DATABASE-ONLY RESOLUTION COMPLETE (${totalTime}ms): ${resolvedTracks.length}/${remoteItems.length} tracks (${resolutionRate}%)`);

    return resolvedTracks;
  } catch (error) {
    console.error('❌ Error resolving playlist items from database:', error);
    return [];
  }
}

// Helper function to validate image URLs
function isValidImageUrl(url: any): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  return trimmed !== '' && trimmed !== 'null' && trimmed !== 'undefined';
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    console.log(`🔍 Database Album API: Looking for slug "${slug}"`);
    
    // Handle playlist-specific album requests
    if (slug === 'itdv-playlist' || slug === 'itdv-music-playlist' || slug === 'into-the-valueverse-playlist') {
      console.log('🎵 Fetching ITDV playlist album details...');

      // Fetch the playlist XML
      const response = await fetch(ITDV_PLAYLIST_URL, {
        headers: {
          'User-Agent': 'StableKraft-Playlist-Parser/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log('📄 Fetched playlist XML, length:', xmlText.length);

      // Parse the XML to extract remote items and artwork
      const remoteItems = parseRemoteItems(xmlText);
      const artworkUrl = parseArtworkUrl(xmlText);
      console.log('📋 Found remote items:', remoteItems.length);
      console.log('🎨 Found artwork URL:', artworkUrl);

      // Resolve playlist items to get actual track data from the database
      console.log('🔍 Resolving playlist items to actual tracks...');
      const resolvedTracks = await resolvePlaylistItems(remoteItems, 'itdv-playlist');
      console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

      // Create a map of resolved tracks by itemGuid for quick lookup
      const resolvedTrackMap = new Map(
        resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
      );

      // Create tracks for ALL remote items, using resolved data when available
      const tracks = remoteItems.map((item, index) => {
        const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

        if (resolvedTrack) {
          // Use real track data
          return {
            title: resolvedTrack.title,
            duration: resolvedTrack.duration ? `${Math.floor(resolvedTrack.duration / 60)}:${(resolvedTrack.duration % 60).toString().padStart(2, '0')}` : '3:00',
            url: resolvedTrack.audioUrl || '',
            trackNumber: index + 1,
            subtitle: resolvedTrack.artist,
            summary: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in ITDV podcast (from ${resolvedTrack.feedTitle})`,
            image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: [],
            albumTitle: resolvedTrack.albumTitle,
            feedTitle: resolvedTrack.feedTitle,
            guid: resolvedTrack.guid
          };
        } else {
          // Use placeholder data
          return {
            title: `Music Reference #${index + 1}`,
            duration: '3:00',
            url: '',
            trackNumber: index + 1,
            subtitle: 'Featured in ITDV Podcast',
            summary: `Music track referenced in Into The Doerfel-Verse podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`,
            image: artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: []
          };
        }
      });

      // Create the album object compatible with AlbumDetailClient
      const playlistAlbum = {
        id: 'itdv-playlist',
        title: 'ITDV Music Playlist',
        artist: 'Various Artists',
        description: 'Every music reference from Into The Doerfel-Verse podcast',
        summary: 'Every music reference from Into The Doerfel-Verse podcast',
        subtitle: '',
        coverArt: artworkUrl || '/placeholder-podcast.jpg',
        releaseDate: new Date().toISOString(),
        explicit: false,
        tracks: tracks,
        podroll: null,
        publisher: null,
        funding: null,
        feedId: 'itdv-playlist',
        feedUrl: ITDV_PLAYLIST_URL,
        lastUpdated: new Date().toISOString()
      };

      console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

      return NextResponse.json({
        album: playlistAlbum,
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
    }

    // Handle HGH playlist
    if (slug === 'hgh-playlist' || slug === 'homegrown-hits-music-playlist' || slug === 'homegrown-hits-playlist') {
      console.log('🎵 Fetching HGH playlist album details...');

      // Fetch the playlist XML
      const response = await fetch(HGH_PLAYLIST_URL, {
        headers: {
          'User-Agent': 'StableKraft-Playlist-Parser/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log('📄 Fetched playlist XML, length:', xmlText.length);

      // Parse the XML to extract remote items and artwork
      const remoteItems = parseRemoteItems(xmlText);
      const artworkUrl = parseArtworkUrl(xmlText);
      console.log('📋 Found remote items:', remoteItems.length);
      console.log('🎨 Found artwork URL:', artworkUrl);

      // Resolve playlist items to get actual track data from the database
      console.log('🔍 Resolving playlist items to actual tracks...');
      const resolvedTracks = await resolvePlaylistItems(remoteItems, 'hgh-playlist');
      console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

      // Create a map of resolved tracks by itemGuid for quick lookup
      const resolvedTrackMap = new Map(
        resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
      );

      // Create tracks for ALL remote items, using resolved data when available
      const tracks = remoteItems.map((item, index) => {
        const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

        if (resolvedTrack) {
          // Use real track data
          return {
            title: resolvedTrack.title,
            duration: resolvedTrack.duration ? `${Math.floor(resolvedTrack.duration / 60)}:${(resolvedTrack.duration % 60).toString().padStart(2, '0')}` : '3:00',
            url: resolvedTrack.audioUrl || '',
            trackNumber: index + 1,
            subtitle: resolvedTrack.artist,
            summary: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in Homegrown Hits podcast (from ${resolvedTrack.feedTitle})`,
            image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: [],
            albumTitle: resolvedTrack.albumTitle,
            feedTitle: resolvedTrack.feedTitle,
            guid: resolvedTrack.guid
          };
        } else {
          // Use placeholder data
          return {
            title: `Music Reference #${index + 1}`,
            duration: '3:00',
            url: '',
            trackNumber: index + 1,
            subtitle: 'Featured in Homegrown Hits Podcast',
            summary: `Music track referenced in Homegrown Hits podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`,
            image: artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: []
          };
        }
      });

      // Create the album object compatible with AlbumDetailClient
      const playlistAlbum = {
        id: 'hgh-playlist',
        title: 'Homegrown Hits Music Playlist',
        artist: 'Various Artists',
        description: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
        summary: 'Curated playlist from Homegrown Hits podcast featuring Value4Value independent artists',
        subtitle: '',
        coverArt: artworkUrl || '/placeholder-podcast.jpg',
        releaseDate: new Date().toISOString(),
        explicit: false,
        tracks: tracks,
        podroll: null,
        publisher: null,
        funding: null,
        feedId: 'hgh-playlist',
        feedUrl: HGH_PLAYLIST_URL,
        lastUpdated: new Date().toISOString()
      };

      console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

      return NextResponse.json({
        album: playlistAlbum,
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
    }

    // Handle IAM playlist
    if (slug === 'iam-playlist' || slug === 'its-a-mood-music-playlist' || slug === 'its-a-mood-music-playlist') {
      console.log('🎵 Fetching IAM playlist album details...');

      // Fetch the playlist XML
      const response = await fetch(IAM_PLAYLIST_URL, {
        headers: {
          'User-Agent': 'StableKraft-Playlist-Parser/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log('📄 Fetched playlist XML, length:', xmlText.length);

      // Parse the XML to extract remote items and artwork
      const remoteItems = parseRemoteItems(xmlText);
      const artworkUrl = parseArtworkUrl(xmlText);
      console.log('📋 Found remote items:', remoteItems.length);
      console.log('🎨 Found artwork URL:', artworkUrl);

      // Resolve playlist items to get actual track data from the database
      console.log('🔍 Resolving playlist items to actual tracks...');
      const resolvedTracks = await resolvePlaylistItems(remoteItems, 'iam-playlist');
      console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

      // Create a map of resolved tracks by itemGuid for quick lookup
      const resolvedTrackMap = new Map(
        resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
      );

      // Create tracks for ALL remote items, using resolved data when available
      const tracks = remoteItems.map((item, index) => {
        const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

        if (resolvedTrack) {
          // Use real track data
          return {
            title: resolvedTrack.title,
            duration: resolvedTrack.duration ? `${Math.floor(resolvedTrack.duration / 60)}:${(resolvedTrack.duration % 60).toString().padStart(2, '0')}` : '3:00',
            url: resolvedTrack.audioUrl || '',
            trackNumber: index + 1,
            subtitle: resolvedTrack.artist,
            summary: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in It's A Mood podcast (from ${resolvedTrack.feedTitle})`,
            image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: [],
            albumTitle: resolvedTrack.albumTitle,
            feedTitle: resolvedTrack.feedTitle,
            guid: resolvedTrack.guid
          };
        } else {
          // Use placeholder data
          return {
            title: `Music Reference #${index + 1}`,
            duration: '3:00',
            url: '',
            trackNumber: index + 1,
            subtitle: 'Featured in It\'s A Mood Podcast',
            summary: `Music track referenced in It's A Mood podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`,
            image: artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: []
          };
        }
      });

      // Create the album object compatible with AlbumDetailClient
      const playlistAlbum = {
        id: 'iam-playlist',
        title: 'It\'s A Mood Music Playlist',
        artist: 'Various Artists',
        description: 'Every music reference from It\'s A Mood podcast',
        summary: 'Every music reference from It\'s A Mood podcast',
        subtitle: '',
        coverArt: artworkUrl || '/placeholder-podcast.jpg',
        releaseDate: new Date().toISOString(),
        explicit: false,
        tracks: tracks,
        podroll: null,
        publisher: null,
        funding: null,
        feedId: 'iam-playlist',
        feedUrl: IAM_PLAYLIST_URL,
        lastUpdated: new Date().toISOString()
      };

      console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

      return NextResponse.json({
        album: playlistAlbum,
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
    }

    // Handle MMM playlist
    if (slug === 'mmm-playlist' || slug === 'modern-music-movements-playlist') {
      console.log('🎵 Fetching MMM playlist album details...');

      // Fetch the playlist XML
      const response = await fetch(MMM_PLAYLIST_URL, {
        headers: {
          'User-Agent': 'StableKraft-Playlist-Parser/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.status}`);
      }

      const xmlText = await response.text();
      console.log('📄 Fetched playlist XML, length:', xmlText.length);

      // Parse the XML to extract remote items and artwork
      const remoteItems = parseRemoteItems(xmlText);
      const artworkUrl = parseArtworkUrl(xmlText);
      console.log('📋 Found remote items:', remoteItems.length);
      console.log('🎨 Found artwork URL:', artworkUrl);

      // Resolve playlist items to get actual track data from the database
      console.log('🔍 Resolving playlist items to actual tracks...');
      const resolvedTracks = await resolvePlaylistItems(remoteItems, 'mmm-playlist');
      console.log(`✅ Resolved ${resolvedTracks.length} tracks from database`);

      // Create a map of resolved tracks by itemGuid for quick lookup
      const resolvedTrackMap = new Map(
        resolvedTracks.map(track => [track.playlistContext?.itemGuid, track])
      );

      // Create tracks for ALL remote items, using resolved data when available
      const tracks = remoteItems.map((item, index) => {
        const resolvedTrack = resolvedTrackMap.get(item.itemGuid);

        if (resolvedTrack) {
          // Use real track data
          return {
            title: resolvedTrack.title,
            duration: resolvedTrack.duration ? `${Math.floor(resolvedTrack.duration / 60)}:${(resolvedTrack.duration % 60).toString().padStart(2, '0')}` : '3:00',
            url: resolvedTrack.audioUrl || '',
            trackNumber: index + 1,
            subtitle: resolvedTrack.artist,
            summary: `${resolvedTrack.title} by ${resolvedTrack.artist} - Featured in Modern Music Movements podcast (from ${resolvedTrack.feedTitle})`,
            image: resolvedTrack.image || artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: [],
            albumTitle: resolvedTrack.albumTitle,
            feedTitle: resolvedTrack.feedTitle,
            guid: resolvedTrack.guid
          };
        } else {
          // Use placeholder data
          return {
            title: `Music Reference #${index + 1}`,
            duration: '3:00',
            url: '',
            trackNumber: index + 1,
            subtitle: 'Featured in Modern Music Movements Podcast',
            summary: `Music track referenced in Modern Music Movements podcast episode - Feed ID: ${item.feedGuid} | Item ID: ${item.itemGuid}`,
            image: artworkUrl || '/placeholder-podcast.jpg',
            explicit: false,
            keywords: []
          };
        }
      });

      // Create the album object compatible with AlbumDetailClient
      const playlistAlbum = {
        id: 'mmm-playlist',
        title: 'Modern Music Movements Playlist',
        artist: 'Various Artists',
        description: 'Music featured in Modern Music Movements podcast',
        summary: 'Music featured in Modern Music Movements podcast',
        subtitle: '',
        coverArt: artworkUrl || '/placeholder-podcast.jpg',
        releaseDate: new Date().toISOString(),
        explicit: false,
        tracks: tracks,
        podroll: null,
        publisher: null,
        funding: null,
        feedId: 'mmm-playlist',
        feedUrl: MMM_PLAYLIST_URL,
        lastUpdated: new Date().toISOString()
      };

      console.log(`✅ Created playlist album with ${playlistAlbum.tracks.length} tracks`);

      return NextResponse.json({
        album: playlistAlbum,
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
    }
    
    // OPTIMIZED: Try targeted database queries first instead of loading all feeds
    const trackInclude = {
      Track: {
        where: { audioUrl: { not: '' } },
        orderBy: [
          { trackOrder: 'asc' as const },
          { publishedAt: 'asc' as const },
          { createdAt: 'asc' as const }
        ]
      }
    };

    let potentialMatches: Array<{ feed: any; trackCount: number }> = [];

    // 1. Try exact ID match first (fastest)
    const exactMatch = await prisma.feed.findFirst({
      where: {
        status: 'active',
        id: { equals: slug, mode: 'insensitive' }
      },
      include: trackInclude
    });

    if (exactMatch && exactMatch.Track.length > 0) {
      console.log(`⚡ Found exact ID match: "${exactMatch.title}" (feed ID: ${exactMatch.id})`);
      potentialMatches.push({ feed: exactMatch, trackCount: exactMatch.Track.length });
    }

    // 2. Try matching by generated slug from feed titles (most accurate for title-based slugs)
    // First, try to find feeds with titles that could generate this slug
    if (potentialMatches.length === 0) {
      // Convert slug back to title words for searching (e.g., "all-thats-haunting-me" -> "all thats haunting me")
      const titleSearch = slug.replace(/-/g, ' ');
      // Also try without "the" prefix if present
      const titleSearchWithoutThe = titleSearch.replace(/^the\s+/i, '');

      // Build OR conditions array
      const orConditions: any[] = [
        { title: { contains: titleSearch, mode: 'insensitive' as const } }
      ];
      if (titleSearchWithoutThe !== titleSearch) {
        orConditions.push({ title: { contains: titleSearchWithoutThe, mode: 'insensitive' as const } });
      }

      const candidateFeeds = await prisma.feed.findMany({
        where: {
          status: 'active',
          OR: orConditions
        },
        include: trackInclude,
        take: 50 // Limit candidates to prevent performance issues
      });

      // Verify each candidate's generated slug matches
      for (const feed of candidateFeeds) {
        if (feed.Track.length > 0) {
          const albumSlug = generateAlbumSlug(feed.title);
          if (albumSlug === slug) {
            console.log(`🔍 Found slug match: "${feed.title}" (feed ID: ${feed.id}) with ${feed.Track.length} tracks`);
            potentialMatches.push({ feed, trackCount: feed.Track.length });
          }
        }
      }
    }

    // 3. Try ID contains match (e.g., "bloodshot-lies" matches "bloodshot-lies-album")
    // Also try matching slug as part of feed ID (e.g., "all-thats-haunting-me" matches "ariel-powell-all-that-s-haunting-me")
    if (potentialMatches.length === 0) {
      // Try matching slug with variations (with/without hyphens in common words)
      // Handle cases like "thats" vs "that-s" vs "that's"
      const slugVariations = [
        slug,
        slug.replace(/thats/g, 'that-s'),
        slug.replace(/thats/g, 'that s'),
        slug.replace(/thats/g, "that's"),
        slug.replace(/dont/g, "don't"),
        slug.replace(/dont/g, "don-t"),
        slug.replace(/cant/g, "can't"),
        slug.replace(/cant/g, "can-t")
      ].filter((v, i, arr) => arr.indexOf(v) === i); // Remove duplicates

      const orConditions: any[] = [
        { id: { contains: slug, mode: 'insensitive' as const } },
        { id: { startsWith: slug, mode: 'insensitive' as const } },
        { guid: { equals: slug, mode: 'insensitive' as const } }
      ];
      
      // Add variations - check if feed ID contains or ends with the variation
      // Also check if feed ID ends with "-{variation}" (common pattern like "ariel-powell-all-that-s-haunting-me")
      for (const variation of slugVariations) {
        if (variation !== slug) {
          orConditions.push({ id: { contains: variation, mode: 'insensitive' as const } });
          orConditions.push({ id: { endsWith: variation, mode: 'insensitive' as const } });
          orConditions.push({ id: { endsWith: `-${variation}`, mode: 'insensitive' as const } });
        }
      }
      
      // Also try matching the slug itself with the "-" prefix pattern
      orConditions.push({ id: { endsWith: `-${slug}`, mode: 'insensitive' as const } });

      const containsMatches = await prisma.feed.findMany({
        where: {
          status: 'active',
          OR: orConditions
        },
        include: trackInclude
      });

      for (const feed of containsMatches) {
        if (feed.Track.length > 0) {
          console.log(`🔍 Found ID/GUID match: "${feed.title}" (feed ID: ${feed.id}) with ${feed.Track.length} tracks`);
          potentialMatches.push({ feed, trackCount: feed.Track.length });
        }
      }
    }

    // 4. Try title-based match if no ID matches found (fallback)
    if (potentialMatches.length === 0) {
      // Convert slug back to title words (e.g., "bloodshot-lies" -> "bloodshot lies")
      const titleSearch = slug.replace(/-/g, ' ');

      const titleMatches = await prisma.feed.findMany({
        where: {
          status: 'active',
          title: { contains: titleSearch, mode: 'insensitive' }
        },
        include: trackInclude
      });

      for (const feed of titleMatches) {
        if (feed.Track.length > 0) {
          // Verify slug actually matches
          const albumSlug = generateAlbumSlug(feed.title);
          if (albumSlug === slug || feed.title.toLowerCase().replace(/\s+/g, '-') === slug) {
            console.log(`🔍 Found title match: "${feed.title}" (feed ID: ${feed.id}) with ${feed.Track.length} tracks`);
            potentialMatches.push({ feed, trackCount: feed.Track.length });
          }
        }
      }
    }

    console.log(`📊 Found ${potentialMatches.length} potential matches for slug "${slug}"`);

    // Transform feeds into albums and search for matching slug
    let foundAlbum = null;

    // If we have multiple matches, prefer the one with the most tracks (full album over single)
    if (potentialMatches.length > 0) {
      const bestMatchData = potentialMatches.reduce((best, current) =>
        current.trackCount > best.trackCount ? current : best
      );
      
      const feed = bestMatchData.feed;
      console.log(`✅ Selected best match: "${feed.title}" with ${feed.Track.length} tracks`);
      
      // Helper function to parse v4vValue from JSON string to object
      const parseV4VValue = (v4vValue: any): any => {
        if (!v4vValue) return null;
        if (typeof v4vValue === 'string') {
          try {
            return JSON.parse(v4vValue);
          } catch (e) {
            console.warn('Failed to parse v4vValue JSON string:', e);
            return null;
          }
        }
        return v4vValue;
      };

      const tracks = feed.Track
        .filter((track: any, index: number, self: any[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: any) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: any, index: number) => ({
        id: track.id,
        guid: track.guid,
        title: track.title,
        duration: track.duration ?
          Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') :
          track.itunesDuration || '0:00',
        url: track.audioUrl,
        trackNumber: index + 1,
        subtitle: track.subtitle || '',
        summary: track.description || '',
        image: (isValidImageUrl(track.image) ? track.image : (isValidImageUrl(feed.image) ? feed.image : '')),
        explicit: track.explicit || false,
        keywords: track.itunesKeywords || [],
        v4vRecipient: track.v4vRecipient,
        v4vValue: parseV4VValue(track.v4vValue),
        status: track.status || 'active'
      }));
      
      // Determine if this is a playlist based on track variety
      const isPlaylist = tracks.length > 1 && 
        new Set(tracks.map((t: any) => t.artist || feed.artist)).size > 1;
      
      const albumTitle = feed.title;
      const albumSlug = generateAlbumSlug(albumTitle);
      const albumId = albumSlug + '-' + feed.id.split('-')[0];
      
      // Check if this is a publisher feed ID and resolve artist name
      let artistName = feed.artist;
      if (!artistName || artistName === 'Unknown Artist') {
        // Try to resolve from publisher mapping
        const publisherInfo = getPublisherInfo(slug) || getPublisherInfo(feed.id);
        if (publisherInfo?.name) {
          artistName = publisherInfo.name;
          console.log(`✅ Resolved artist name from publisher mapping: "${artistName}"`);
        }
      }
      
      foundAlbum = {
        id: albumId,
        title: albumTitle,
        artist: artistName || 'Unknown Artist',
        description: feed.description || '',
        summary: feed.description || '',
        subtitle: '',
        coverArt: (isValidImageUrl(feed.image) ? feed.image : `/api/placeholder-image?title=${encodeURIComponent(albumTitle)}&artist=${encodeURIComponent(feed.artist || 'Unknown Artist')}`),
        releaseDate: feed.lastFetched || feed.createdAt,
        explicit: tracks.some((t: any) => t.explicit) || feed.explicit,
        tracks: tracks,
        podroll: isPlaylist ? { enabled: true } : null,
        publisher: await (async () => {
          if (feed.type !== 'album' || !feed.artist) return null;

          // Look up actual publisher feed by artist name
          const publisherFeed = await prisma.feed.findFirst({
            where: {
              type: 'publisher',
              OR: [
                { artist: { equals: feed.artist, mode: 'insensitive' } },
                { title: { equals: feed.artist, mode: 'insensitive' } }
              ]
            },
            select: { id: true, originalUrl: true, title: true, artist: true, image: true }
          });

          if (publisherFeed) {
            return {
              feedGuid: publisherFeed.id,
              feedUrl: publisherFeed.originalUrl,
              title: publisherFeed.artist || publisherFeed.title,
              artistImage: (isValidImageUrl(publisherFeed.image) ? publisherFeed.image : null)
            };
          }

          // Fallback: return album as pseudo-publisher (for artist link to work)
          return {
            feedGuid: feed.id,
            feedUrl: feed.originalUrl,
            title: feed.artist,
            artistImage: (isValidImageUrl(feed.image) ? feed.image : null)
          };
        })(),
        funding: null,
        feedId: feed.id,
        feedUrl: feed.originalUrl,
        lastUpdated: feed.updatedAt,
        v4vRecipient: feed.v4vRecipient || feed.Track?.[0]?.v4vRecipient || null,
        v4vValue: parseV4VValue(feed.v4vValue) || parseV4VValue(feed.Track?.[0]?.v4vValue) || null
      };
    }
    
    // If not found by exact slug match, try more flexible matching
    if (!foundAlbum) {
      console.log(`🔍 Trying flexible matching for slug: "${slug}"`);

      const searchSlug = slug.toLowerCase();
      const decodedSlug = decodeURIComponent(searchSlug);
      const titleFromSlug = decodedSlug.replace(/-/g, ' ');

      // Get all active feeds with tracks for flexible matching
      const feeds = await prisma.feed.findMany({
        where: { status: 'active' },
        include: trackInclude
      });

      const flexibleMatches = [];

      for (const feed of feeds) {
        if (feed.Track.length === 0) continue;
        
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
          titleFromSlug.length > 5 && albumTitleLower.includes(titleFromSlug),
          feed.guid === slug,  // Podcast Index GUID match
          feed.guid?.toLowerCase() === searchSlug  // Case-insensitive GUID match
        ];
        
        if (matches.some(match => match)) {
          console.log(`🔍 Found flexible match: "${albumTitle}" with ${feed.Track.length} tracks`);
          flexibleMatches.push({ feed, trackCount: feed.Track.length });
        }
      }
      
      // If we have flexible matches, prefer the one with the most tracks
      if (flexibleMatches.length > 0) {
        const bestFlexibleMatch = flexibleMatches.reduce((best, current) => 
          current.trackCount > best.trackCount ? current : best
        );
        
        const feed = bestFlexibleMatch.feed;
        console.log(`✅ Selected best flexible match: "${feed.title}" with ${feed.Track.length} tracks`);
        
        // Helper function to parse v4vValue from JSON string to object
        const parseV4VValue = (v4vValue: any): any => {
          if (!v4vValue) return null;
          if (typeof v4vValue === 'string') {
            try {
              return JSON.parse(v4vValue);
            } catch (e) {
              console.warn('Failed to parse v4vValue JSON string:', e);
              return null;
            }
          }
          return v4vValue;
        };

        const tracks = feed.Track
        .filter((track: any, index: number, self: any[]) => {
          // Deduplicate tracks by URL and title
          return self.findIndex((t: any) => 
            t.audioUrl === track.audioUrl && t.title === track.title
          ) === index;
        })
        .map((track: any, index: number) => ({
        id: track.id,
        guid: track.guid,
        title: track.title,
        duration: track.duration ?
          Math.floor(track.duration / 60) + ':' + String(track.duration % 60).padStart(2, '0') :
          track.itunesDuration || '0:00',
        url: track.audioUrl,
        trackNumber: index + 1,
        subtitle: track.subtitle || '',
        summary: track.description || '',
        image: (isValidImageUrl(track.image) ? track.image : (isValidImageUrl(feed.image) ? feed.image : '')),
        explicit: track.explicit || false,
        keywords: track.itunesKeywords || [],
        v4vRecipient: track.v4vRecipient,
        v4vValue: parseV4VValue(track.v4vValue),
        status: track.status || 'active'
        }));

        const isPlaylist = tracks.length > 1 &&
          new Set(tracks.map((t: any) => t.artist || feed.artist)).size > 1;

        const albumTitle = feed.title;
        const albumSlug = generateAlbumSlug(albumTitle);
        const albumId = albumSlug + '-' + feed.id.split('-')[0];
        
        // Check if this is a publisher feed ID and resolve artist name
        let artistName = feed.artist;
        if (!artistName || artistName === 'Unknown Artist') {
          // Try to resolve from publisher mapping
          const publisherInfo = getPublisherInfo(slug) || getPublisherInfo(feed.id);
          if (publisherInfo?.name) {
            artistName = publisherInfo.name;
            console.log(`✅ Resolved artist name from publisher mapping: "${artistName}"`);
          }
        }
        
        foundAlbum = {
          id: albumId,
          title: albumTitle,
          artist: artistName || 'Unknown Artist',
          description: feed.description || '',
          summary: feed.description || '',
          subtitle: '',
          coverArt: (isValidImageUrl(feed.image) ? feed.image : `/api/placeholder-image?title=${encodeURIComponent(albumTitle)}&artist=${encodeURIComponent(feed.artist || 'Unknown Artist')}`),
          releaseDate: feed.lastFetched || feed.createdAt,
          explicit: tracks.some((t: any) => t.explicit) || feed.explicit,
          tracks: tracks,
          podroll: isPlaylist ? { enabled: true } : null,
          publisher: await (async () => {
            if (feed.type !== 'album' || !feed.artist) return null;

            // Look up actual publisher feed by artist name
            const publisherFeed = await prisma.feed.findFirst({
              where: {
                type: 'publisher',
                OR: [
                  { artist: { equals: feed.artist, mode: 'insensitive' } },
                  { title: { equals: feed.artist, mode: 'insensitive' } }
                ]
              },
              select: { id: true, originalUrl: true, title: true, artist: true, image: true }
            });

            if (publisherFeed) {
              return {
                feedGuid: publisherFeed.id,
                feedUrl: publisherFeed.originalUrl,
                title: publisherFeed.artist || publisherFeed.title,
                artistImage: (isValidImageUrl(publisherFeed.image) ? publisherFeed.image : null)
              };
            }

            // Fallback: return album as pseudo-publisher
            return {
              feedGuid: feed.id,
              feedUrl: feed.originalUrl,
              title: feed.artist,
              artistImage: (isValidImageUrl(feed.image) ? feed.image : null)
            };
          })(),
          funding: null,
          feedId: feed.id,
          feedUrl: feed.originalUrl,
          lastUpdated: feed.updatedAt,
          v4vRecipient: feed.v4vRecipient || feed.Track?.[0]?.v4vRecipient || null,
          v4vValue: parseV4VValue(feed.v4vValue) || parseV4VValue(feed.Track?.[0]?.v4vValue) || null
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