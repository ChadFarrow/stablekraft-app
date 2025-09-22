/**
 * Consolidated Cache API Route
 * Handles all cache-related operations in a single endpoint
 */
import { NextRequest, NextResponse } from 'next/server';
import { FeedCache } from '@/lib/feed-cache';
import { CacheAPIHandler } from '@/lib/api/cache-handler';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    if (action === 'stats') {
      // Return cache statistics
      const stats = FeedCache.getCacheStats();
      return NextResponse.json({
        success: true,
        stats
      });
    }
    
    if (action === 'cleanup') {
      // Clean up old cache items
      const result = await FeedCache.cleanupCache();
      return NextResponse.json({
        success: true,
        message: 'Cache cleanup completed',
        result
      });
    }
    
    // Default: return basic info
    const stats = FeedCache.getCacheStats();
    
    return NextResponse.json({
      success: true,
      message: 'Feed Cache API',
      availableActions: ['stats', 'cleanup', 'cache', 'clear'],
      currentStats: stats
    });
    
  } catch (error) {
    console.error('Error in cache API:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    if (action === 'cache') {
      // Cache all feeds
      console.log('🔄 Starting feed caching via API...');
      
      const result = await FeedCache.cacheAllFeeds();
      
      return NextResponse.json({
        success: true,
        message: 'Feed caching completed',
        result
      });
    }
    
    if (action === 'clear') {
      // Clear entire cache
      await FeedCache.clearCache();
      
      return NextResponse.json({
        success: true,
        message: 'Cache cleared successfully'
      });
    }
    
    if (action === 'initialize') {
      // Initialize cache system
      await FeedCache.initialize();
      
      return NextResponse.json({
        success: true,
        message: 'Cache system initialized'
      });
    }
    
    return NextResponse.json({ 
      success: false, 
      error: 'Invalid action. Use "cache", "clear", or "initialize"' 
    }, { status: 400 });
    
  } catch (error) {
    console.error('Error in cache API:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 