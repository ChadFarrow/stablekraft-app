import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEvent, getEventHash } from 'nostr-tools';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { getSessionIdFromRequest } from '@/lib/session-utils';
import { normalizePubkey } from '@/lib/nostr/normalize';
import { publicKeyToNpub } from '@/lib/nostr/keys';

/**
 * POST /api/nostr/auth/login
 * Verifies a Nostr login event + syncs profile + ensures DB stores hex pubkeys.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      publicKey: rawPubkey,
      npub,
      challenge,
      signature,
      eventId,
      createdAt,
      kind,
      content
    } = body;

    if (!rawPubkey || !challenge || !signature || !eventId || !createdAt) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const hexPubkey = normalizePubkey(rawPubkey);

    if (!hexPubkey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey format (must be hex or npub)' },
        { status: 400 }
      );
    }

    let calculatedNpub = npub;
    if (!calculatedNpub || calculatedNpub.trim() === '') {
      try {
        calculatedNpub = publicKeyToNpub(hexPubkey);
      } catch (err) {
        return NextResponse.json(
          { success: false, error: 'Failed to derive npub' },
          { status: 400 }
        );
      }
    }

    const eventKind = kind ?? 1;
    const eventContent = content ?? 'Authentication challenge';

    const eventTemplate = {
      kind: eventKind,
      tags: [['challenge', challenge]],
      content: eventContent,
      created_at: createdAt,
      pubkey: hexPubkey,
    };

    const expectedEventId = getEventHash(eventTemplate);

    if (expectedEventId !== eventId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid event ID — mismatch with reconstructed event'
        },
        { status: 401 }
      );
    }

    const event = {
      ...eventTemplate,
      id: eventId,
      sig: signature,
    };

    if (!verifyEvent(event)) {
      return NextResponse.json(
        { success: false, error: 'Invalid signature' },
        { status: 401 }
      );
    }

    let profileMetadata: any = null;
    let relayList: string[] | null = null;

    try {
      const client = new NostrClient(getDefaultRelays());
      await client.connect();

      profileMetadata = await client.getProfile(hexPubkey);
      relayList = await client.getRelayList(hexPubkey);

      await client.disconnect();
    } catch (err) {
      console.warn('Failed to fetch profile or relays:', err);
    }

    const displayName = profileMetadata?.name || null;
    const avatar = profileMetadata?.picture || null;
    const bio = profileMetadata?.about || null;
    const lightningAddress =
      profileMetadata?.lud16 || profileMetadata?.lud06 || null;

    let user = await prisma.user.findUnique({
      where: { nostrPubkey: hexPubkey },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          nostrPubkey: hexPubkey,
          nostrNpub: calculatedNpub,
          displayName,
          avatar,
          bio,
          lightningAddress,
          relays: relayList || [],
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          nostrNpub: calculatedNpub,
          displayName,
          avatar,
          bio,
          lightningAddress,
          ...(relayList ? { relays: relayList } : {}),
        },
      });
    }

    const sessionId = getSessionIdFromRequest(request);

    if (sessionId) {
      try {
        // Migrate session tracks to user (batch operations to fix N+1)
        const sessionTracks = await prisma.favoriteTrack.findMany({
          where: { sessionId, userId: null },
        });

        if (sessionTracks.length > 0) {
          // Get all existing user tracks in one query
          const existingUserTracks = await prisma.favoriteTrack.findMany({
            where: {
              userId: user.id,
              trackId: { in: sessionTracks.map(t => t.trackId) }
            },
            select: { trackId: true }
          });
          const existingTrackIds = new Set(existingUserTracks.map(t => t.trackId));

          // Separate into tracks to migrate vs duplicates to delete
          const toMigrate = sessionTracks.filter(t => !existingTrackIds.has(t.trackId));
          const toDelete = sessionTracks.filter(t => existingTrackIds.has(t.trackId));

          // Batch update tracks to migrate
          if (toMigrate.length > 0) {
            await prisma.favoriteTrack.updateMany({
              where: { id: { in: toMigrate.map(t => t.id) } },
              data: { userId: user.id, sessionId: null }
            });
          }

          // Batch delete duplicates
          if (toDelete.length > 0) {
            await prisma.favoriteTrack.deleteMany({
              where: { id: { in: toDelete.map(t => t.id) } }
            });
          }
        }

        // Migrate session albums to user (batch operations to fix N+1)
        const sessionAlbums = await prisma.favoriteAlbum.findMany({
          where: { sessionId, userId: null },
        });

        if (sessionAlbums.length > 0) {
          // Get all existing user albums in one query
          const existingUserAlbums = await prisma.favoriteAlbum.findMany({
            where: {
              userId: user.id,
              feedId: { in: sessionAlbums.map(a => a.feedId) }
            },
            select: { feedId: true }
          });
          const existingFeedIds = new Set(existingUserAlbums.map(a => a.feedId));

          // Separate into albums to migrate vs duplicates to delete
          const toMigrate = sessionAlbums.filter(a => !existingFeedIds.has(a.feedId));
          const toDelete = sessionAlbums.filter(a => existingFeedIds.has(a.feedId));

          // Batch update albums to migrate
          if (toMigrate.length > 0) {
            await prisma.favoriteAlbum.updateMany({
              where: { id: { in: toMigrate.map(a => a.id) } },
              data: { userId: user.id, sessionId: null }
            });
          }

          // Batch delete duplicates
          if (toDelete.length > 0) {
            await prisma.favoriteAlbum.deleteMany({
              where: { id: { in: toDelete.map(a => a.id) } }
            });
          }
        }
      } catch (err) {
        console.error('Favorite migration failed:', err);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        nostrPubkey: user.nostrPubkey,
        nostrNpub: user.nostrNpub,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        lightningAddress: user.lightningAddress,
        relays: user.relays,
        loginType: 'extension',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Login failed',
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}