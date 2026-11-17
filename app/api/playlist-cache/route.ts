import { NextResponse, NextRequest } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    // This route used to refresh playlists (?refresh=<id> / ?refresh=all) by
    // re-fetching /api/playlist/<id>?refresh=true on its own origin. In production
    // that fetch failed to connect ("fetch failed" for all four playlists on every
    // nightly run checked, 2026-09-17 to 19) and carried no admin secret, so it
    // refreshed nothing while the nightly job reported success. Refresh the
    // playlist route directly instead.
    if (url.searchParams.has('refresh')) {
      return NextResponse.json({
        success: false,
        error: 'Refreshing through /api/playlist-cache was removed. Call GET /api/playlist/<id>?refresh=true with the admin bearer token.'
      }, { status: 410 });
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
        refreshPlaylist: 'GET /api/playlist/<id>?refresh=true (admin)',
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