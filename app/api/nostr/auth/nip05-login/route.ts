import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { publicKeyToNpub } from '@/lib/nostr/keys';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * POST /api/nostr/auth/nip05-login
 * Login using NIP-05 identifier (read-only mode, no signature required)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { identifier } = body;

    // Validate required fields
    if (!identifier || typeof identifier !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'NIP-05 identifier is required (e.g., user@domain.com)',
        },
        { status: 400 }
      );
    }

    // Validate NIP-05 format
    const nip05Regex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!nip05Regex.test(identifier)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid NIP-05 identifier format. Expected: user@domain.com',
        },
        { status: 400 }
      );
    }

    // Split identifier into name and domain
    const [name, domain] = identifier.split('@');
    if (!name || !domain) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid NIP-05 identifier format',
        },
        { status: 400 }
      );
    }

    // Look up pubkey from NIP-05 identifier
    const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
    let nip05Response;
    try {
      nip05Response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
        },
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(10000), // 10 seconds
      });
    } catch (fetchError) {
      console.error('NIP-05 lookup error:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to fetch NIP-05 data from ${domain}. Please check your identifier.`,
        },
        { status: 400 }
      );
    }

    if (!nip05Response.ok) {
      return NextResponse.json(
        {
          success: false,
          error: `NIP-05 lookup failed: ${nip05Response.status} ${nip05Response.statusText}`,
        },
        { status: 400 }
      );
    }

    let nip05Data;
    try {
      nip05Data = await nip05Response.json();
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid response from NIP-05 server',
        },
        { status: 400 }
      );
    }

    // Extract pubkey from NIP-05 response
    const publicKey = nip05Data.names?.[name];
    if (!publicKey || typeof publicKey !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: `NIP-05 identifier "${identifier}" not found or invalid`,
        },
        { status: 404 }
      );
    }

    // Normalize pubkey (lowercase)
    const normalizedPubkey = publicKey.toLowerCase();

    // Calculate npub from public key
    let npub: string;
    try {
      npub = publicKeyToNpub(normalizedPubkey);
    } catch (error) {
      console.error('Failed to calculate npub:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to calculate npub from public key',
        },
        { status: 400 }
      );
    }

    // Fetch user's profile metadata from Nostr relays (kind 0)
    let profileMetadata: any = null;
    let relayList: string[] | null = null;
    try {
      const client = new NostrClient(getDefaultRelays());
      await client.connect();

      // Fetch profile metadata (kind 0)
      profileMetadata = await client.getProfile(normalizedPubkey);

      // Fetch relay list (kind 10002 - NIP-65)
      relayList = await client.getRelayList(normalizedPubkey);
      if (relayList && relayList.length > 0) {
        console.log(`✅ Fetched ${relayList.length} relays from Nostr profile:`, relayList);
      }

      await client.disconnect();
    } catch (error) {
      console.warn('Failed to fetch profile/relays from Nostr:', error);
      // Continue without profile metadata - not critical for login
    }

    // Extract profile fields from Nostr metadata (Nostr is source of truth)
    const displayName = profileMetadata?.name || null;
    const avatar = profileMetadata?.picture || null;
    const bio = profileMetadata?.about || null;
    const lightningAddress = profileMetadata?.lud16 || profileMetadata?.lud06 || null;
    const nip05FromProfile = profileMetadata?.nip05 || null;

    // Verify that the NIP-05 from profile matches what user entered (if available)
    if (nip05FromProfile && nip05FromProfile.toLowerCase() !== identifier.toLowerCase()) {
      console.warn(`NIP-05 mismatch: profile has ${nip05FromProfile}, user entered ${identifier}`);
      // Continue anyway - user might have entered a different valid identifier
    }

    // Get relay URLs - prioritize kind 10002 relay list (NIP-65), fall back to NIP-05 response
    // NIP-65 relay list is more up-to-date and user-controlled
    const nip05Relays: string[] = nip05Data.relays?.[normalizedPubkey] || [];
    const relays: string[] = (relayList && relayList.length > 0) ? relayList : nip05Relays;

    // Find existing user by pubkey
    let user = await prisma.user.findUnique({
      where: { nostrPubkey: normalizedPubkey },
    });

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          nostrPubkey: normalizedPubkey,
          nostrNpub: npub,
          displayName,
          avatar,
          bio,
          lightningAddress,
          relays,
        },
      });
    } else {
      // Update existing user with latest profile data from Nostr
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName: displayName || user.displayName,
          avatar: avatar || user.avatar,
          bio: bio || user.bio,
          lightningAddress: lightningAddress || user.lightningAddress,
          relays: relays.length > 0 ? relays : user.relays,
          updatedAt: new Date(),
        },
      });
    }

    // Migrate session-based favorites to user-based favorites (same as extension login)
    const sessionId = getSessionIdFromRequest(request);
    
    if (sessionId) {
      try {
        // Migrate favorite tracks
        const sessionTracks = await prisma.favoriteTrack.findMany({
          where: {
            sessionId,
            userId: null, // Only migrate tracks that aren't already user-based
          },
        });

        let migratedTracks = 0;
        for (const favorite of sessionTracks) {
          // Check if user already has this track favorited
          const existing = await prisma.favoriteTrack.findUnique({
            where: {
              userId_trackId: {
                userId: user.id,
                trackId: favorite.trackId,
              },
            },
          });

          if (!existing) {
            // Migrate to user-based favorite
            await prisma.favoriteTrack.update({
              where: { id: favorite.id },
              data: {
                userId: user.id,
                sessionId: null, // Remove sessionId
              },
            });
            migratedTracks++;
          } else {
            // User already has this favorite, delete the session-based one
            await prisma.favoriteTrack.delete({
              where: { id: favorite.id },
            });
          }
        }

        // Migrate favorite albums
        const sessionAlbums = await prisma.favoriteAlbum.findMany({
          where: {
            sessionId,
            userId: null,
          },
        });

        let migratedAlbums = 0;
        for (const favorite of sessionAlbums) {
          const existing = await prisma.favoriteAlbum.findUnique({
            where: {
              userId_feedId: {
                userId: user.id,
                feedId: favorite.feedId,
              },
            },
          });

          if (!existing) {
            await prisma.favoriteAlbum.update({
              where: { id: favorite.id },
              data: {
                userId: user.id,
                sessionId: null,
              },
            });
            migratedAlbums++;
          } else {
            await prisma.favoriteAlbum.delete({
              where: { id: favorite.id },
            });
          }
        }

        if (migratedTracks > 0 || migratedAlbums > 0) {
          console.log(`✅ Migrated ${migratedTracks} tracks and ${migratedAlbums} albums from session to user (NIP-05 login)`);
        }
      } catch (migrationError) {
        // Log error but don't fail login if migration fails
        console.error('⚠️ Failed to migrate favorites:', migrationError);
      }
    }

    // Return user data (similar to extension login)
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
        nip05Verified: true, // NIP-05 login means verified
        loginType: 'nip05', // Mark as NIP-05 login (read-only)
      },
    });
  } catch (error) {
    console.error('NIP-05 login error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'NIP-05 login failed',
      },
      { status: 500 }
    );
  }
}

