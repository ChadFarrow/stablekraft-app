import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Find the Flowgnar playlist
    const playlist = await prisma.userPlaylist.findFirst({
      where: {
        name: {
          contains: 'Flowgnar',
          mode: 'insensitive'
        }
      }
    });

    if (!playlist) {
      return NextResponse.json(
        { error: 'Flowgnar playlist not found' },
        { status: 404 }
      );
    }

    // Get tracks for this playlist
    const playlistTracks = await prisma.playlistTrack.findMany({
      where: { playlistId: playlist.id },
      orderBy: {
        position: 'asc'
      }
    });

    // Get track details for each playlist track
    const trackIds = playlistTracks.map(pt => pt.trackId);
    const tracks = await prisma.track.findMany({
      where: {
        id: {
          in: trackIds
        }
      },
      include: {
        Feed: true
      }
    });

    // Create a map for quick track lookup
    const trackMap = new Map(tracks.map(track => [track.id, track]));

    const formattedTracks = playlistTracks.map(pt => {
      const track = trackMap.get(pt.trackId);
      if (!track) return null;
      
      return {
        id: track.id,
        title: track.title,
        artist: track.artist || (track.Feed.artist === 'Unresolved GUID' ? track.Feed.title : track.Feed.artist) || 'Unknown Artist',
        audioUrl: track.audioUrl,
        duration: track.duration || 0,
        image: track.image || track.Feed.image,
        album: track.album || track.Feed.title,
        startTime: track.startTime,
        endTime: track.endTime,
        publishedAt: track.publishedAt?.toISOString(),
        feedTitle: track.Feed.title,
        position: pt.position,
        v4vRecipient: track.v4vRecipient,
        v4vValue: track.v4vValue
      };
    }).filter(Boolean); // Remove null entries

    // Format as album for compatibility with other playlist endpoints
    const album = {
      id: playlist.id,
      title: playlist.name,
      artist: 'Various Artists',
      album: playlist.name,
      description: playlist.description,
      image: playlist.image,
      coverArt: playlist.image,
      url: `/playlist/flowgnar`,
      feedId: playlist.id,
      type: 'playlist',
      totalTracks: formattedTracks.length,
      tracks: formattedTracks,
      publishedAt: playlist.createdAt.toISOString(),
      isPlaylistCard: true,
      playlistUrl: `/playlist/flowgnar`,
      albumUrl: `/playlist/flowgnar`,
      playlistContext: {
        source: 'flowgnar-playlist',
        originalUrl: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml'
      }
    };

    return NextResponse.json({
      success: true,
      data: {
        playlist: {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          image: playlist.image
        }
      },
      tracks: formattedTracks,
      albums: [album],
      totalCount: 1,
      playlist: {
        title: playlist.name,
        items: [album]
      }
    });

  } catch (error) {
    console.error('❌ Failed to get Flowgnar playlist:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get Flowgnar playlist',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}