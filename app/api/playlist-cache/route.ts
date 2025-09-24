import { NextResponse, NextRequest } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

export async function GET() {
  try {
    const stats = playlistCache.getCacheStats();
    
    return NextResponse.json({
      success: true,
      cacheStats: stats,
      totalCaches: stats.length,
      message: 'Use ?clear=playlist-id or ?clear=all to clear caches'
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