import { NextResponse, NextRequest } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const refreshParam = url.searchParams.get('refresh');
    
    // Handle manual refresh of specific playlist
    if (refreshParam && refreshParam !== 'all') {
      const refreshUrl = `/api/playlist/${refreshParam}?refresh=true`;
      try {
        const response = await fetch(`${url.origin}${refreshUrl}`);
        if (response.ok) {
          return NextResponse.json({
            success: true,
            message: `Playlist ${refreshParam} refreshed successfully`,
            refreshedAt: new Date().toISOString()
          });
        } else {
          return NextResponse.json({
            success: false,
            error: `Failed to refresh playlist ${refreshParam}: ${response.status}`
          }, { status: 400 });
        }
      } catch (error) {
        return NextResponse.json({
          success: false,
          error: `Error refreshing playlist ${refreshParam}: ${error instanceof Error ? error.message : 'Unknown error'}`
        }, { status: 500 });
      }
    }

    // Handle refresh all playlists
    if (refreshParam === 'all') {
      const playlists = ['iam', 'mmm', 'itdv', 'hgh'];
      const results = [];
      
      for (const playlist of playlists) {
        try {
          const refreshUrl = `/api/playlist/${playlist}?refresh=true`;
          const response = await fetch(`${url.origin}${refreshUrl}`);
          results.push({
            playlist,
            success: response.ok,
            status: response.status
          });
        } catch (error) {
          results.push({
            playlist,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      return NextResponse.json({
        success: true,
        message: 'All playlists refresh attempted',
        results,
        refreshedAt: new Date().toISOString()
      });
    }

    // Default: return cache stats
    const stats = playlistCache.getCacheStats();
    
    return NextResponse.json({
      success: true,
      cacheStats: stats.map(stat => ({
        ...stat,
        age: Date.now() - stat.timestamp,
        ageFormatted: formatAge(Date.now() - stat.timestamp),
        validFor: '90 days (manual refresh available)'
      })),
      totalCaches: stats.length,
      commands: {
        viewStats: 'GET /api/playlist-cache',
        refreshSingle: 'GET /api/playlist-cache?refresh=playlist-id (iam, mmm, itdv, hgh)',
        refreshAll: 'GET /api/playlist-cache?refresh=all',
        clearSingle: 'DELETE /api/playlist-cache?clear=playlist-id',
        clearAll: 'DELETE /api/playlist-cache?clear=all'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

function formatAge(ageMs: number): string {
  const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const clearParam = url.searchParams.get('clear');
    
    if (!clearParam) {
      return NextResponse.json(
        { success: false, error: 'Missing clear parameter' },
        { status: 400 }
      );
    }

    if (clearParam === 'all') {
      playlistCache.clearAllCaches();
      return NextResponse.json({
        success: true,
        message: 'All playlist caches cleared'
      });
    } else {
      playlistCache.clearCache(clearParam);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for ${clearParam}`
      });
    }
  } catch (error) {
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}