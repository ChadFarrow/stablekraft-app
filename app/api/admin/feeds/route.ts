import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    console.log('🔍 Admin Feeds API: Getting all feeds from database');
    
    // Get all feeds from database
    const feeds = await prisma.feed.findMany({
      include: {
        _count: {
          select: {
            Track: true
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });
    
    // Transform to match expected admin format
    const adminFeeds = feeds.map(feed => ({
      id: feed.id,
      originalUrl: feed.originalUrl,
      type: feed.type,
      title: feed.title,
      artist: feed.artist,
      priority: feed.priority,
      status: feed.status,
      image: feed.image,
      description: feed.description,
      language: feed.language,
      category: feed.category,
      explicit: feed.explicit,
      trackCount: feed._count.Track,
      createdAt: feed.createdAt,
      updatedAt: feed.updatedAt,
      lastFetched: feed.lastFetched,
      lastError: feed.lastError
    }));
    
    console.log(`✅ Admin Feeds API: Returning ${adminFeeds.length} feeds from database`);
    
    return NextResponse.json({
      success: true,
      feeds: adminFeeds,
      count: adminFeeds.length
    });
  } catch (error) {
    console.error('Error fetching feeds from database:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch feeds',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, type = 'album', priority = 'low' } = body;

    console.log(`🔍 Admin Feeds API: Adding new feed ${url} (${type})`);

    // Validate inputs
    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL is required' },
        { status: 400 }
      );
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    if (!['album', 'publisher'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Type must be "album" or "publisher"' },
        { status: 400 }
      );
    }

    if (!['core', 'high', 'normal', 'low'].includes(priority)) {
      return NextResponse.json(
        { success: false, error: 'Priority must be "core", "high", "normal", or "low"' },
        { status: 400 }
      );
    }

    // Check if feed already exists in database
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: url }
    });

    if (existingFeed) {
      return NextResponse.json(
        { success: false, error: 'Feed already exists' },
        { status: 409 }
      );
    }

    // Generate a unique ID from the URL
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace(/\./g, '-');
    const pathname = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const baseId = `${hostname}-${pathname}`.toLowerCase();
    
    // Ensure unique ID by checking database
    let id = baseId;
    let counter = 1;
    while (await prisma.feed.findUnique({ where: { id } })) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    // Create new feed entry in database
    const newFeed = await prisma.feed.create({
      data: {
        id,
        originalUrl: url,
        type,
        title: `Feed from ${urlObj.hostname}`,
        priority,
        status: 'active',
        updatedAt: new Date()
      }
    });

    console.log(`✅ Added new RSS feed to database: ${url} (${type}) with ID: ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Feed added successfully',
      feed: {
        id: newFeed.id,
        originalUrl: newFeed.originalUrl,
        type: newFeed.type,
        title: newFeed.title,
        priority: newFeed.priority,
        status: newFeed.status,
        createdAt: newFeed.createdAt,
        updatedAt: newFeed.updatedAt
      }
    });
  } catch (error) {
    console.error('Error adding feed to database:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to add feed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}