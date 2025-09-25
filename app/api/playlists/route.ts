import { NextRequest, NextResponse } from 'next/server';
import { PlaylistManager } from '@/lib/playlist-manager';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playlistId = searchParams.get('id');
    const action = searchParams.get('action');
    
    if (playlistId) {
      const playlist = await PlaylistManager.getPlaylist(playlistId);
      
      if (!playlist) {
        return NextResponse.json(
          { error: 'Playlist not found' },
          { status: 404 }
        );
      }
      
      // Handle special actions
      if (action === 'export') {
        const exported = await PlaylistManager.exportToPodcasting20(playlistId);
        return NextResponse.json({
          success: true,
          data: exported
        });
      }
      
      return NextResponse.json({
        success: true,
        data: playlist
      });
    }
    
    // Get all playlists from PostgreSQL database
    console.log('🔍 Fetching playlists from database...');
    const dbPlaylists = await prisma.userPlaylist.findMany({
      orderBy: { createdAt: 'asc' }
    });
    
    console.log(`📊 Found ${dbPlaylists.length} playlists in database`);
    
    // Transform to match expected format
    const playlists = dbPlaylists.map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      image: playlist.image,
      coverImage: playlist.image,
      isPublic: playlist.isPublic,
      createdBy: playlist.createdBy,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      trackCount: 0 // We'll add tracks later
    }));
    
    return NextResponse.json({
      success: true,
      data: playlists,
      count: playlists.length
    });
    
  } catch (error) {
    console.error('❌ Failed to get playlists:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get playlists',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    
    switch (action) {
      case 'create': {
        const { name, description, feedUrl, tracks } = body;
        
        if (!name || !description) {
          return NextResponse.json(
            { error: 'Name and description are required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.createPlaylist(
          name,
          description,
          feedUrl || '',
          tracks || []
        );
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: `Playlist "${name}" created successfully`
        });
      }
      
      case 'sync-main': {
        const { feedUrl } = body;
        
        if (!feedUrl) {
          return NextResponse.json(
            { error: 'Feed URL is required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.createOrUpdateMainPlaylist(feedUrl);
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: 'Main playlist synced successfully'
        });
      }
      
      case 'add-tracks': {
        const { playlistId, tracks } = body;
        
        if (!playlistId || !tracks || !Array.isArray(tracks)) {
          return NextResponse.json(
            { error: 'Playlist ID and tracks array are required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.addTracksToPlaylist(playlistId, tracks);
        
        if (!playlist) {
          return NextResponse.json(
            { error: 'Playlist not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: `Added ${tracks.length} tracks to playlist`
        });
      }
      
      case 'remove-track': {
        const { playlistId, trackId } = body;
        
        if (!playlistId || !trackId) {
          return NextResponse.json(
            { error: 'Playlist ID and track ID are required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.removeTrackFromPlaylist(playlistId, trackId);
        
        if (!playlist) {
          return NextResponse.json(
            { error: 'Playlist not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: 'Track removed from playlist'
        });
      }
      
      case 'reorder': {
        const { playlistId, trackIds } = body;
        
        if (!playlistId || !trackIds || !Array.isArray(trackIds)) {
          return NextResponse.json(
            { error: 'Playlist ID and track IDs array are required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.reorderTracks(playlistId, trackIds);
        
        if (!playlist) {
          return NextResponse.json(
            { error: 'Playlist not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: 'Playlist tracks reordered'
        });
      }
      
      case 'sync': {
        const { playlistId, feedUrl } = body;
        
        if (!playlistId || !feedUrl) {
          return NextResponse.json(
            { error: 'Playlist ID and feed URL are required' },
            { status: 400 }
          );
        }
        
        const playlist = await PlaylistManager.syncPlaylistFromFeed(playlistId, feedUrl);
        
        if (!playlist) {
          return NextResponse.json(
            { error: 'Playlist not found' },
            { status: 404 }
          );
        }
        
        return NextResponse.json({
          success: true,
          data: playlist,
          message: 'Playlist synced with feed'
        });
      }
      
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
  } catch (error) {
    console.error('Playlist operation failed:', error);
    return NextResponse.json(
      { error: 'Playlist operation failed' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { playlistId, ...updates } = body;
    
    if (!playlistId) {
      return NextResponse.json(
        { error: 'Playlist ID is required' },
        { status: 400 }
      );
    }
    
    const playlist = await PlaylistManager.updatePlaylist(playlistId, updates);
    
    if (!playlist) {
      return NextResponse.json(
        { error: 'Playlist not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: playlist,
      message: 'Playlist updated successfully'
    });
    
  } catch (error) {
    console.error('Failed to update playlist:', error);
    return NextResponse.json(
      { error: 'Failed to update playlist' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playlistId = searchParams.get('id');
    
    if (!playlistId) {
      return NextResponse.json(
        { error: 'Playlist ID is required' },
        { status: 400 }
      );
    }
    
    const success = await PlaylistManager.deletePlaylist(playlistId);
    
    if (!success) {
      return NextResponse.json(
        { error: 'Playlist not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Playlist deleted successfully'
    });
    
  } catch (error) {
    console.error('Failed to delete playlist:', error);
    return NextResponse.json(
      { error: 'Failed to delete playlist' },
      { status: 500 }
    );
  }
}