import { NextRequest, NextResponse } from 'next/server';
import { FeedParser } from '@/lib/feed-parser';
import { FeedManager } from '@/lib/feed-manager';
import { discoverAllPublishers } from '@/lib/publisher-discovery';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    if (action === 'stats') {
      // Return current parse statistics
      const stats = FeedParser.getParseStats();
      const parsedFeeds = FeedParser.getParsedFeeds();
      
      return NextResponse.json({
        success: true,
        stats,
        lastUpdated: parsedFeeds.length > 0 ? parsedFeeds[0].lastParsed : null,
        totalFeeds: parsedFeeds.length
      });
    }
    
    if (action === 'albums') {
      // Return parsed albums
      const albums = FeedParser.getParsedAlbums();
      const coreAlbums = FeedParser.getAlbumsByPriority('core');
      const extendedAlbums = FeedParser.getAlbumsByPriority('extended');
      const lowAlbums = FeedParser.getAlbumsByPriority('low');
      
      return NextResponse.json({
        success: true,
        albums: {
          all: albums,
          core: coreAlbums,
          extended: extendedAlbums,
          low: lowAlbums
        },
        count: albums.length
      });
    }
    
    if (action === 'search') {
      // Search albums
      const query = searchParams.get('q');
      if (!query) {
        return NextResponse.json({ 
          success: false, 
          error: 'Query parameter "q" is required' 
        }, { status: 400 });
      }
      
      const results = FeedParser.searchAlbums(query);
      return NextResponse.json({
        success: true,
        query,
        results,
        count: results.length
      });
    }
    
    // Default: return basic info
    const activeFeeds = FeedManager.getActiveFeeds();
    const stats = FeedParser.getParseStats();
    
    return NextResponse.json({
      success: true,
      message: 'Feed Parser API',
      availableActions: ['stats', 'albums', 'search', 'parse'],
      currentStats: stats,
      activeFeeds: activeFeeds.length
    });
    
  } catch (error) {
    console.error('Error in parse-feeds API:', error);
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
    
    if (action === 'parse') {
      // Parse all feeds
      console.log('🔄 Starting feed parsing via API...');
      
      const report = await FeedParser.parseAllFeeds();
      
      return NextResponse.json({
        success: true,
        message: 'Feed parsing completed',
        report
      });
    }
    
    if (action === 'parse-single') {
      // Parse a single feed
      const feedId = searchParams.get('feedId');
      if (!feedId) {
        return NextResponse.json({
          success: false,
          error: 'feedId parameter is required'
        }, { status: 400 });
      }

      const result = await FeedParser.parseFeedById(feedId);

      return NextResponse.json({
        success: true,
        message: 'Single feed parsing completed',
        result
      });
    }

    if (action === 'discover-publishers') {
      // Discover and store all publishers from existing album feeds
      console.log('🔍 Starting publisher discovery from all album feeds...');

      const result = await discoverAllPublishers();

      return NextResponse.json({
        success: true,
        message: 'Publisher discovery completed',
        result
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use "parse", "parse-single", or "discover-publishers"'
    }, { status: 400 });
    
  } catch (error) {
    console.error('Error in parse-feeds API:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 