import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { publicKeyToNpub } from '@/lib/nostr/keys';
import { normalizePubkey } from '@/lib/nostr/normalize';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * POST /api/nostr/auth/nip05-login
 * Login using NIP-05 identifier (read-only mode, no signature required)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier } = body;

    if (!identifier || typeof identifier !== 'string') {
      return NextResponse.json(
        { success: false, error: 'NIP-05 identifier required' },
        { status: 400 }
      );
    }

    const [name, domain] = identifier.split('@');
    if (!name || !domain) {
      return NextResponse.json(
        { success: false, error: 'Invalid NIP-05 identifier' },
        { status: 400 }
      );
    }

    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;

    let nip05Data;
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        return NextResponse.json(
          { success: false, error: `NIP-05 lookup failed: ${res.status}` },
          { status: 400 }
        );
      }
      nip05Data = await res.json();
    } catch {
      return NextResponse.json(
        { success: false, error: `Failed to fetch NIP-05 data for ${identifier}` },
        { status: 400 }
      );
    }

    const rawPubkey = nip05Data.names?.[name];
    if (!rawPubkey) {
      return NextResponse.json(
        { success: false, error: `NIP-05 name not found: ${identifier}` },
        { status: 404 }
      );
    }

    const hexPubkey = normalizePubkey(rawPubkey);
    if (!hexPubkey) {
      return NextResponse.json(
        { success: false, error: 'Invalid pubkey returned by NIP-05 server' },
        { status: 400 }
      );
    }

    let npub: string;
    try {
      npub = publicKeyToNpub(hexPubkey);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Failed to derive npub from pubkey' },
        { status: 400 }
      );
    }

    let profile = null;
    let relayList: string[] = [];
    try {
      const client = new NostrClient(getDefaultRelays());
      await client.connect();
      profile = await client.getProfile(hexPubkey);
      relayList = await client.getRelayList(hexPubkey) || [];
      await client.disconnect();
    } catch {}

    const displayName = profile?.name ?? null;
    const avatar = profile?.picture ?? null;
    const bio = profile?.about ?? null;
    const lightningAddress = profile?.lud16 ?? profile?.lud06 ?? null;

    const nip05Relays = nip05Data.relays?.[hexPubkey] || [];
    const relays = relayList.length > 0 ? relayList : nip05Relays;

    let user = await prisma.user.findUnique({ where: { nostrPubkey: hexPubkey } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          nostrPubkey: hexPubkey,
          nostrNpub: npub,
          displayName,
          avatar,
          bio,
          lightningAddress,
          relays
        }
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          nostrNpub: npub,
          displayName: displayName ?? user.displayName,
          avatar: avatar ?? user.avatar,
          bio: bio ?? user.bio,
          lightningAddress: lightningAddress ?? user.lightningAddress,
          relays: relays.length > 0 ? relays : user.relays,
          updatedAt: new Date()
        }
      });
    }

    const sessionId = getSessionIdFromRequest(request);
    if (sessionId) {
      try {
        const tracks = await prisma.favoriteTrack.findMany({ where: { sessionId, userId: null } });
        for (const fav of tracks) {
          const exists = await prisma.favoriteTrack.findUnique({ where: { userId_trackId: { userId: user.id, trackId: fav.trackId } } });
          if (!exists) {
            await prisma.favoriteTrack.update({ where: { id: fav.id }, data: { userId: user.id, sessionId: null } });
          } else {
            await prisma.favoriteTrack.delete({ where: { id: fav.id } });
          }
        }

        const albums = await prisma.favoriteAlbum.findMany({ where: { sessionId, userId: null } });
        for (const fav of albums) {
          const exists = await prisma.favoriteAlbum.findUnique({ where: { userId_feedId: { userId: user.id, feedId: fav.feedId } } });
          if (!exists) {
            await prisma.favoriteAlbum.update({ where: { id: fav.id }, data: { userId: user.id, sessionId: null } });
          } else {
            await prisma.favoriteAlbum.delete({ where: { id: fav.id } });
          }
        }
      } catch {}
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        nostrPubkey: user.nostrPubkey,
        nostrNpub: user.nostrNpub,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        lightningAddress: user.lightningAddress,
        relays: user.relays,
        nip05Verified: true,
        loginType: 'nip05'
      }
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message ?? 'NIP-05 login failed' },
      { status: 500 }
    );
  }
}