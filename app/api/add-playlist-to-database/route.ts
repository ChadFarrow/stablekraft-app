import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

interface PlaylistTrack {
  feedGuid: string;
  itemGuid: string;
  title: string;
  artist: string;
  audioUrl: string | null;
  artworkUrl: string | null;
  duration: number | null;
  feedTitle: string;
  feedUrl: string;
}

interface PlaylistRequest {
  playlistName: string;
  playlistDescription?: string;
  tracks: PlaylistTrack[];
  source?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { playlistName, playlistDescription, tracks, source = 'playlist' }: PlaylistRequest = await request.json();

    if (!playlistName || !Array.isArray(tracks) || tracks.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: playlistName and tracks array' },
        { status: 400 }
      );
    }

    console.log(`🎵 Adding ${tracks.length} tracks from "${playlistName}" to database`);

    const newTracks: any[] = [];
    const skippedTracks: any[] = [];

    // Process each track
    for (const track of tracks) {
      const guid = `${track.feedGuid}-${track.itemGuid}`;
      
      // Check if track already exists by guid
      const existingTrack = await prisma.track.findUnique({
        where: { guid }
      });

      if (existingTrack) {
        skippedTracks.push({
          title: track.title,
          artist: track.artist,
          reason: 'Already exists in database'
        });
        continue;
      }

      // Find or create feed
      let feed = await prisma.feed.findFirst({
        where: { originalUrl: track.feedUrl }
      });

      if (!feed) {
        feed = await prisma.feed.create({
          data: {
            id: `feed-${track.feedGuid}`,
            title: track.feedTitle || playlistName,
            originalUrl: track.feedUrl,
            type: 'album',
            status: 'active',
            updatedAt: new Date()
          }
        });
      }

      // Create track ID
      const trackId = `track-${track.feedGuid}-${track.itemGuid}-${Date.now()}`;

      // Prepare track data with V4V information
      const v4vValue = {
        lightningAddress: '',
        suggestedAmount: 0,
        remotePercentage: 90,
        feedGuid: track.feedGuid,
        itemGuid: track.itemGuid,
        resolved: !!track.audioUrl,
        resolvedTitle: track.title,
        resolvedArtist: track.artist,
        resolvedAudioUrl: track.audioUrl,
        resolvedImage: track.artworkUrl,
        playlist: {
          name: playlistName,
          description: playlistDescription || `Track from ${playlistName} playlist`,
          source: source
        }
      };

      try {
        const createdTrack = await prisma.track.create({
          data: {
            id: trackId,
            guid: guid,
            feedId: feed.id,
            title: track.title,
            artist: track.artist || null,
            album: track.feedTitle || null,
            audioUrl: track.audioUrl || '',
            duration: track.duration ? Math.round(track.duration) : null,
            image: track.artworkUrl || null,
            publishedAt: new Date(),
            v4vValue: v4vValue,
            updatedAt: new Date()
          }
        });

        newTracks.push({
          id: createdTrack.id,
          title: createdTrack.title,
          artist: createdTrack.artist,
          audioUrl: createdTrack.audioUrl,
          image: createdTrack.image
        });
      } catch (trackError) {
        console.error(`Failed to create track ${trackId}:`, trackError);
        skippedTracks.push({
          title: track.title,
          artist: track.artist,
          reason: `Database error: ${trackError instanceof Error ? trackError.message : 'Unknown error'}`
        });
      }
    }

    if (newTracks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new tracks to add - all tracks already exist in database',
        added: 0,
        skipped: skippedTracks.length,
        skippedTracks
      });
    }

    console.log(`✅ Added ${newTracks.length} new tracks to database, skipped ${skippedTracks.length} duplicates`);

    return NextResponse.json({
      success: true,
      message: `Successfully added ${newTracks.length} tracks from "${playlistName}" to database`,
      added: newTracks.length,
      skipped: skippedTracks.length,
      skippedTracks: skippedTracks.length > 0 ? skippedTracks : undefined,
      sampleTracks: newTracks.slice(0, 3).map(t => ({
        title: t.title,
        artist: t.artist,
        hasAudio: !!t.audioUrl,
        hasArtwork: !!t.image
      }))
    });

  } catch (error) {
    console.error('Error adding playlist to database:', error);
    return NextResponse.json(
      { 
        error: 'Failed to add playlist to database',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve playlist information
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const playlistName = url.searchParams.get('playlist');

    if (playlistName) {
      // Return tracks for a specific playlist
      // Search for tracks where v4vValue contains the playlist name
      const tracks = await prisma.track.findMany({
        where: {
          v4vValue: {
            path: ['playlist', 'name'],
            equals: playlistName
          }
        },
        include: {
          Feed: {
            select: {
              id: true,
              title: true,
              originalUrl: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      const playlistTracks = tracks.map(track => ({
        id: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album,
        audioUrl: track.audioUrl,
        duration: track.duration,
        image: track.image,
        feedUrl: track.Feed.originalUrl,
        publishedAt: track.publishedAt
      }));

      return NextResponse.json({
        playlistName,
        trackCount: playlistTracks.length,
        tracks: playlistTracks
      });
    } else {
      // Return all playlists by extracting from v4vValue
      const tracks = await prisma.track.findMany({
        where: {
          v4vValue: {
            path: ['playlist'],
            not: Prisma.JsonNull
          }
        },
        select: {
          v4vValue: true
        }
      });

      const playlists = new Map<string, {
        name: string;
        description?: string;
        trackCount: number;
        hasAudio: number;
        hasArtwork: number;
      }>();

      let totalTracks = 0;

      for (const track of tracks) {
        const v4v = track.v4vValue as any;
        if (v4v?.playlist?.name) {
          const name = v4v.playlist.name;
          if (!playlists.has(name)) {
            playlists.set(name, {
              name,
              description: v4v.playlist.description,
              trackCount: 0,
              hasAudio: 0,
              hasArtwork: 0
            });
          }
          const playlist = playlists.get(name)!;
          playlist.trackCount++;
          totalTracks++;
        }
      }

      // Get more accurate counts by querying tracks with audio/image
      for (const [name, playlist] of playlists.entries()) {
        const tracksWithData = await prisma.track.count({
          where: {
            v4vValue: {
              path: ['playlist', 'name'],
              equals: name
            }
          }
        });

        const tracksWithAudio = await prisma.track.count({
          where: {
            v4vValue: {
              path: ['playlist', 'name'],
              equals: name
            },
            audioUrl: { not: '' }
          }
        });

        const tracksWithArtwork = await prisma.track.count({
          where: {
            v4vValue: {
              path: ['playlist', 'name'],
              equals: name
            },
            image: { not: null }
          }
        });

        playlist.hasAudio = tracksWithAudio;
        playlist.hasArtwork = tracksWithArtwork;
      }

      return NextResponse.json({
        playlists: Array.from(playlists.values()),
        totalTracks: totalTracks
      });
    }

  } catch (error) {
    console.error('Error retrieving playlist data:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retrieve playlist data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}