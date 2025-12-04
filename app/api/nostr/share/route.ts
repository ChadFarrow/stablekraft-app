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

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'User ID required',
        },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { trackId, feedId, message, signedEvent } = body;

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

      // Use album URL with track parameter if Feed is available
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
      const trackUrl = track.Feed 
        ? `${baseUrl}/album/${track.Feed.id}?track=${trackId}`
        : `${baseUrl}/music-tracks/${trackId}`;
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

    // Use signed event from client (signed by user's signer: NIP-07, NIP-46, or NIP-55)
    if (!signedEvent) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event is required. Please ensure you have a signer connected (NIP-07 extension, NIP-46, or NIP-55).',
        },
        { status: 400 }
      );
    }
    
    // Verify the event structure and signature
    const { verifyEvent } = await import('nostr-tools');
    if (!verifyEvent(signedEvent)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid signed event - signature verification failed',
        },
        { status: 400 }
      );
    }
    
    // Verify the event is signed by the user
    if (signedEvent.pubkey !== user.nostrPubkey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Signed event does not match user public key',
        },
        { status: 400 }
      );
    }
    
    // Verify it's a kind 1 note
    if (signedEvent.kind !== 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'Event must be a kind 1 note',
        },
        { status: 400 }
      );
    }
    
    const event = signedEvent;

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

