import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { connectServerNostrClient } from '@/lib/nostr/server-client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { publicKeyToNpub } from '@/lib/nostr/keys';
import { normalizePubkey } from '@/lib/nostr/normalize';

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
      const client = await connectServerNostrClient(getDefaultRelays(), 'nip05-login');
      profile = await client.getProfile(hexPubkey);
      relayList = await client.getRelayList(hexPubkey) || [];
      await client.disconnect();
    } catch (error) {
      // Non-fatal: the profile is decoration, and login proceeds without it.
      // But it was a bare `catch {}` on a LOGIN path, so a relay problem here
      // was indistinguishable from a user with no profile. console.warn, not
      // log — next.config.js strips `log` from production builds.
      console.warn(
        '⚠️ nip05-login: could not fetch profile/relay list from the default relays:',
        error instanceof Error ? error.message : error
      );
    }

    const displayName = profile?.name ?? null;
    const avatar = profile?.picture ?? null;
    const bio = profile?.about ?? null;
    const lightningAddress = profile?.lud16 ?? profile?.lud06 ?? null;

    const nip05Relays = nip05Data.relays?.[hexPubkey] || [];
    const relays = relayList.length > 0 ? relayList : nip05Relays;

    // Look up or create the User row for this pubkey. Deliberately no UPDATE
    // path for an existing row — see the no-cookie note below. This handler
    // has no proof the caller owns hexPubkey, so it must not overwrite an
    // existing account's profile (displayName/avatar/bio/lightningAddress) or
    // its `relays` list, which is the server-side publish target for boosts
    // and shares and is sourced here from unsanitised nip05Data.relays.
    let user = await prisma.user.findUnique({ where: { nostrPubkey: hexPubkey } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: hexPubkey, // Use pubkey as ID since it's unique
          nostrPubkey: hexPubkey,
          nostrNpub: npub,
          displayName,
          avatar,
          bio,
          lightningAddress,
          relays,
          updatedAt: new Date()
        }
      });
    }

    const response = NextResponse.json({
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

    // NO SESSION COOKIE IS ISSUED HERE, deliberately.
    //
    // The pubkey above came from /.well-known/nostr.json on a domain the
    // CALLER named, and nothing binds that document to the caller. Anyone can
    // host one claiming any pubkey. Issuing a signed cookie for it would hand
    // out a durable, 90-day, server-issued read credential for an account the
    // requester never proved they own — every read route would then serve that
    // account's private data.
    //
    // This stays a client-side read-only convenience: the browser renders a
    // profile, and any request needing real authority fails the way it does
    // for a signed-out user. Giving it a real session requires real proof —
    // i.e. a signed event, which is what /api/nostr/auth/login already does.

    return response;
  } catch (err: any) {
    console.error('NIP-05 login error:', err);
    return NextResponse.json(
      { success: false, error: 'NIP-05 login failed' },
      { status: 500 }
    );
  }
}