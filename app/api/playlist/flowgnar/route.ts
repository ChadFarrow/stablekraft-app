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
      include: {
        track: {
          include: {
            feed: true
          }
        }
      },
      orderBy: {
        position: 'asc'
      }
    });

    const formattedTracks = playlistTracks.map(pt => ({
      id: pt.track.id,
      title: pt.track.title,
      artist: pt.track.artist || pt.track.feed.artist || 'Unknown Artist',
      audioUrl: pt.track.audioUrl,
      duration: pt.track.duration || 0,
      image: pt.track.image || pt.track.feed.image,
      album: pt.track.album || pt.track.feed.title,
      startTime: pt.track.startTime,
      endTime: pt.track.endTime,
      publishedAt: pt.track.publishedAt?.toISOString(),
      feedTitle: pt.track.feed.title,
      position: pt.position
    }));

    return NextResponse.json({
      success: true,
      data: {
        playlist: {
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          image: playlist.image,
          isPublic: playlist.isPublic,
          createdAt: playlist.createdAt.toISOString(),
          trackCount: formattedTracks.length
        },
        tracks: formattedTracks
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