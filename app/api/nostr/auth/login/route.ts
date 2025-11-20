import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyEvent, getEventHash } from 'nostr-tools';
import { NostrClient } from '@/lib/nostr/client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { getSessionIdFromRequest } from '@/lib/session-utils';

/**
 * POST /api/nostr/auth/login
 * Verify signature challenge and create/update user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { publicKey, npub, challenge, signature, eventId, createdAt, kind, content } = body;

    // Validate required fields
    if (!publicKey || !challenge || !signature || !eventId || !createdAt) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: publicKey, challenge, signature, eventId, createdAt',
        },
        { status: 400 }
      );
    }

    // Calculate npub from publicKey if not provided
    let calculatedNpub = npub;
    if (!calculatedNpub || calculatedNpub.trim() === '') {
      try {
        const { publicKeyToNpub } = await import('@/lib/nostr/keys');
        calculatedNpub = publicKeyToNpub(publicKey);
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
    }

    // Verify the signature
    // Reconstruct the event that was signed using the client's properties
    // All login methods now use kind 1 with consistent content "Authentication challenge"
    // Default to kind 1 for backward compatibility, but prefer explicit kind from client
    const eventKind = kind ?? 1;
    const eventContent = content ?? 'Authentication challenge';
    
    const eventTemplate = {
      kind: eventKind,
      tags: [['challenge', challenge]],
      content: eventContent,
      created_at: createdAt,
      pubkey: publicKey,
    };
    
    // Log event reconstruction for debugging
    console.log('🔍 Login API: Reconstructing event for verification:', {
      kind: eventKind,
      content: eventContent,
      challenge: challenge.slice(0, 16) + '...',
      pubkey: publicKey.slice(0, 16) + '...',
    });

    // Verify event ID matches
    const calculatedEventId = getEventHash(eventTemplate);
    if (calculatedEventId !== eventId) {
      console.error('❌ Login API: Event ID mismatch:', {
        calculated: calculatedEventId,
        received: eventId,
        template: {
          kind: eventTemplate.kind,
          content: eventTemplate.content,
          tags: eventTemplate.tags,
          created_at: eventTemplate.created_at,
        },
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid event ID - event reconstruction mismatch. Please ensure you are using the latest client version.',
        },
        { status: 401 }
      );
    }
    
    // Create full event with id and sig
    const event = {
      ...eventTemplate,
      id: eventId,
      sig: signature,
    };

    // Verify the event signature
    const isValid = verifyEvent(event);

    if (!isValid) {
      console.error('❌ Login API: Invalid event signature:', {
        eventId: event.id,
        pubkey: event.pubkey.slice(0, 16) + '...',
        kind: event.kind,
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid signature - event signature verification failed',
        },
        { status: 401 }
      );
    }
    
    console.log('✅ Login API: Event signature verified successfully');

    // Fetch user's profile metadata from Nostr relays FIRST (kind 0)
    // Nostr profile data takes precedence over database data
    let profileMetadata: any = null;
    let relayList: string[] | null = null;
    try {
      const client = new NostrClient(getDefaultRelays());
      await client.connect();

      // Fetch profile metadata (kind 0)
      profileMetadata = await client.getProfile(publicKey);

      // Fetch relay list (kind 10002 - NIP-65)
      relayList = await client.getRelayList(publicKey);
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
    const nip05 = profileMetadata?.nip05 || null;

    // Find existing user
    let user = await prisma.user.findUnique({
      where: { nostrPubkey: publicKey },
    });

    if (!user) {
      // Create new user with profile data from Nostr (Nostr is primary source)
      user = await prisma.user.create({
        data: {
          nostrPubkey: publicKey,
          nostrNpub: calculatedNpub,
          displayName: displayName || null, // Use Nostr name first
          avatar: avatar || null, // Use Nostr avatar first
          bio: bio || null, // Use Nostr bio first
          lightningAddress: lightningAddress || null, // Use Nostr lightning address first
          relays: relayList || [], // Use relay list from Nostr profile (NIP-65)
        },
      });
    } else {
      // Update user with Nostr profile data (Nostr overwrites database)
      // Always use Nostr data when available, even if it means clearing old data
      const updateData: any = {
        nostrNpub: calculatedNpub,
      };

      // Nostr profile data takes precedence - update with Nostr values
      updateData.displayName = displayName || null;
      updateData.avatar = avatar || null;
      updateData.bio = bio || null;
      updateData.lightningAddress = lightningAddress || null;

      // Update relay list if found in Nostr profile (NIP-65)
      if (relayList && relayList.length > 0) {
        updateData.relays = relayList;
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    // Migrate session-based favorites to user-based favorites
    // Get sessionId from request if available
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
            userId: null, // Only migrate albums that aren't already user-based
          },
        });

        let migratedAlbums = 0;
        for (const favorite of sessionAlbums) {
          // Check if user already has this album favorited
          const existing = await prisma.favoriteAlbum.findUnique({
            where: {
              userId_feedId: {
                userId: user.id,
                feedId: favorite.feedId,
              },
            },
          });

          if (!existing) {
            // Migrate to user-based favorite
            await prisma.favoriteAlbum.update({
              where: { id: favorite.id },
              data: {
                userId: user.id,
                sessionId: null, // Remove sessionId
              },
            });
            migratedAlbums++;
          } else {
            // User already has this favorite, delete the session-based one
            await prisma.favoriteAlbum.delete({
              where: { id: favorite.id },
            });
          }
        }

        if (migratedTracks > 0 || migratedAlbums > 0) {
          console.log(`✅ Migrated ${migratedTracks} tracks and ${migratedAlbums} albums from session to user`);
        }
      } catch (migrationError) {
        // Log error but don't fail login if migration fails
        console.error('⚠️ Failed to migrate favorites:', migrationError);
      }
    }

    // Set session/cookie (in production, use secure session management)
    // For now, we'll return the user and let the client manage the session

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
        loginType: 'extension', // Mark as extension login
      },
      message: 'Login successful',
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Login failed',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}

