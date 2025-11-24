import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// GET /api/tracks - List tracks with search and filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Search parameters
    const search = searchParams.get('search');
    const feedId = searchParams.get('feedId');
    const artist = searchParams.get('artist');
    const album = searchParams.get('album');
    const explicit = searchParams.get('explicit');
    const hasV4V = searchParams.get('hasV4V');
    
    // Pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = (page - 1) * limit;
    
    // Sorting
    const sortBy = searchParams.get('sortBy') || 'publishedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    
    // Build where clause
    const where: any = {};
    
    // Text search across multiple fields
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { artist: { contains: search, mode: 'insensitive' } },
        { album: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    // Filter by feed
    if (feedId) {
      where.feedId = feedId;
    }
    
    // Filter by artist
    if (artist) {
      where.artist = { contains: artist, mode: 'insensitive' };
    }
    
    // Filter by album
    if (album) {
      where.album = { contains: album, mode: 'insensitive' };
    }
    
    // Filter by explicit content
    if (explicit !== null && explicit !== '') {
      where.explicit = explicit === 'true';
    }
    
    // Filter by V4V support
    if (hasV4V === 'true') {
      where.v4vValue = { not: Prisma.JsonNull };
    }
    
    // Execute query
    const [tracks, total] = await Promise.all([
      prisma.track.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          Feed: {
            select: {
              id: true,
              title: true,
              artist: true,
              type: true
            }
          }
        }
      }),
      prisma.track.count({ where })
    ]);
    
    return NextResponse.json({
      tracks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching tracks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tracks' },
      { status: 500 }
    );
  }
}

// POST /api/tracks - Create a new track
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { feedId, title, audioUrl, ...otherData } = body;
    
    if (!feedId || !title || !audioUrl) {
      return NextResponse.json(
        { error: 'feedId, title, and audioUrl are required' },
        { status: 400 }
      );
    }
    
    // Check if feed exists
    const feed = await prisma.feed.findUnique({
      where: { id: feedId }
    });
    
    if (!feed) {
      return NextResponse.json(
        { error: 'Feed not found' },
        { status: 404 }
      );
    }
    
    // Create track
    const track = await prisma.track.create({
      data: {
        feedId,
        title,
        audioUrl,
        ...otherData
      },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true
          }
        }
      }
    });
    
    return NextResponse.json({
      message: 'Track created successfully',
      track
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating track:', error);
    return NextResponse.json(
      { error: 'Failed to create track' },
      { status: 500 }
    );
  }
}

// PUT /api/tracks - Update a track
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;
    
    if (!id) {
      return NextResponse.json(
        { error: 'Track ID is required' },
        { status: 400 }
      );
    }
    
    const track = await prisma.track.update({
      where: { id },
      data: updateData,
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true
          }
        }
      }
    });
    
    return NextResponse.json({
      message: 'Track updated successfully',
      track
    });
  } catch (error) {
    console.error('Error updating track:', error);
    return NextResponse.json(
      { error: 'Failed to update track' },
      { status: 500 }
    );
  }
}

// DELETE /api/tracks - Delete a track
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Track ID is required' },
        { status: 400 }
      );
    }
    
    await prisma.track.delete({
      where: { id }
    });
    
    return NextResponse.json({
      message: 'Track deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting track:', error);
    return NextResponse.json(
      { error: 'Failed to delete track' },
      { status: 500 }
    );
  }
}