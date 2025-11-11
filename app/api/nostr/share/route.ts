import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createNote } from '@/lib/nostr/events';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';

/**
 * POST /api/nostr/share
 * Share a track or album to Nostr
 * Body: { trackId?: string, feedId?: string, message?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-nostr-user-id');
    const privateKey = request.headers.get('x-nostr-private-key');

    if (!userId || !privateKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID and private key required',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackId, feedId, message } = body;

    if (!trackId && !feedId) {
      return NextResponse.json(
        {
          success: false,
          error: 'trackId or feedId is required',
        },
        { status: 400 }
      );
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'User not found',
        },
        { status: 404 }
      );
    }

    // Build share content
    let content = message || '';
    let track: any = null;
    let feed: any = null;

    if (trackId) {
      track = await prisma.track.findUnique({
        where: { id: trackId },
        include: { Feed: true },
      });

      if (!track) {
        return NextResponse.json(
          {
            success: false,
            error: 'Track not found',
          },
          { status: 404 }
        );
      }

      const trackUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/music-tracks/${trackId}`;
      content = `${content}\n\n🎵 ${track.title}${track.artist ? ` by ${track.artist}` : ''}\n${trackUrl}`;
    } else if (feedId) {
      feed = await prisma.feed.findUnique({
        where: { id: feedId },
      });

      if (!feed) {
        return NextResponse.json(
          {
            success: false,
            error: 'Album not found',
          },
          { status: 404 }
        );
      }

      const albumUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/album/${feedId}`;
      content = `${content}\n\n💿 ${feed.title}${feed.artist ? ` by ${feed.artist}` : ''}\n${albumUrl}`;
    }

    // Create Nostr note
    const tags: string[][] = [];
    if (trackId) {
      tags.push(['t', 'music-track']);
      tags.push(['r', `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/music-tracks/${trackId}`]);
    } else if (feedId) {
      tags.push(['t', 'album']);
      tags.push(['r', `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/album/${feedId}`]);
    }

    const event = createNote(content.trim(), privateKey, tags);

    // Publish to Nostr
    // Use user's relays or default relays
    const relays = user.relays.length > 0 ? user.relays : getDefaultRelays();
    const client = new NostrClient(relays);
    await client.connect();
    const results = await client.publish(event, {
      relays,
      waitForRelay: true,
    });
    await client.disconnect();

    // Store in database
    const post = await prisma.nostrPost.create({
      data: {
        userId,
        eventId: event.id,
        kind: 1,
        content: event.content,
        trackId: trackId || null,
        feedId: feedId || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        post,
        event: {
          id: event.id,
          content: event.content,
        },
        published: results.some(r => r.status === 'fulfilled'),
      },
      message: 'Shared to Nostr successfully',
    });
  } catch (error) {
    console.error('Share error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to share to Nostr',
      },
      { status: 500 }
    );
  }
}

