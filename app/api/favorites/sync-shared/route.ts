import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SHOW_PREFIX, ITEM_PREFIX } from '@/lib/nostr/pc20-identifiers';
import { requireUser } from '@/lib/auth/require-user';

/**
 * Inbound half of the cross-app favorites sync. Spec:
 * https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md
 *
 * The client reads the shared kind:10333 list off relays — it holds the signer
 * and the relay connections — and POSTs the resolved identifiers here. This
 * route maps them onto DB rows and reconciles.
 *
 * RECONCILIATION DELETES ROWS, so the guards below are the whole design:
 *
 *   - `trustworthy` must be explicitly true. A degraded relay read looks
 *     exactly like an empty list, and acting on it wipes the user's favorites.
 *     The client already refuses to send otherwise; this is the second lock.
 *   - `userId` only, never `sessionId`. An anonymous session has no Nostr
 *     identity, so it has no shared list to be reconciled against.
 *   - Only favorites that COULD have appeared on the list are eligible for
 *     deletion: album/track rows whose Feed/Track carries a guid. A favorite
 *     with no portable identifier can never be missing from the wire, and
 *     publishers and playlists are out of scope entirely (synthetic ids, no
 *     external identifier). Those rows are never touched.
 */

interface SharedShow {
  feedGuid: string;
  feedUrl?: string;
  /** `<podcast:medium>` from the running `['medium', v]` tag above this
   *  entry, when the writing app knew it. (Under kind:30078 it rode at tag
   *  position 4 inside the `i` tag; in 10333 the `i` tags are bare and the
   *  medium is carried by position in the tag array instead.)
   *  Advisory and possibly stale — never trusted over a local answer, and
   *  absent means "not told", never a default. */
  medium?: string;
}

interface SharedTrack {
  itemGuid: string;
  feedGuid?: string;
  feedUrl?: string;
  /** The PARENT feed's medium; Podcasting 2.0 has no per-item one. */
  medium?: string;
}

// Out of scope for the shared list — StableKraft-local constructs with no
// portable identifier. Never published, and never reconciled away.
const UNSYNCED_FAVORITE_TYPES = new Set(['publisher', 'playlist']);

/**
 * Reconciliation is the ONLY destructive write in the cross-app sync, and this
 * database is the only copy of a StableKraft favorite. Boost Me Bitch can
 * re-derive its whole list from the relay event; these rows cannot be.
 *
 * So deletion ships OFF and is opted into with
 * `SHARED_FAVORITES_APPLY_DELETES=true`. Until then a reconcile still runs and
 * still reports what it *would* remove — which is the point: you get to watch
 * it be right for a while before it is allowed to be wrong. The cost of leaving
 * it off is that an unfavorite in another app doesn't propagate here; the cost
 * of it being wrong once is a library.
 */
const DELETES_ENABLED = process.env.SHARED_FAVORITES_APPLY_DELETES === 'true';

/**
 * Even with deletes enabled, refuse an implausibly large one.
 *
 * A mass removal arriving here means another app dropped a large share of the
 * entries THIS app also holds — which is a plausible bug and an implausible
 * user action, since the two apps' favorites barely overlap. A user who really
 * did clear everything gets it applied on the next pull once the set is small
 * enough, or clears the rest by hand. Cheap insurance against exactly the class
 * of bug that produced this guard.
 */
const DELETE_RATIO_CEILING = 0.5;
const DELETE_FLOOR = 5;

/**
 * Minting Feed rows from another app's favorites is off by default.
 *
 * Boost Me Bitch is a general podcast app; StableKraft is music. A shared list
 * will therefore carry talk podcasts, and importing them would put rows in a
 * catalogue that has whole subsystems — the blacklist, `medium=podcast`
 * detection, `fix-podcast-types` — devoted to keeping non-music out. Off during
 * the trial: unresolved guids are still reported, so you can see what a real
 * list contains before deciding whether any of it belongs here.
 */
const IMPORT_UNKNOWN_FEEDS = process.env.SHARED_FAVORITES_IMPORT_UNKNOWN === 'true';

function deletionBudget(eligibleCount: number): number {
  return Math.max(DELETE_FLOOR, Math.ceil(eligibleCount * DELETE_RATIO_CEILING));
}

export async function POST(request: NextRequest) {
  try {
    const userId = requireUser(request, { write: true });
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Shared favorites sync requires a Nostr user' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const trustworthy = body?.trustworthy === true;
    const shows: SharedShow[] = Array.isArray(body?.shows) ? body.shows : [];
    const tracks: SharedTrack[] = Array.isArray(body?.tracks) ? body.tracks : [];
    // The ids this device last agreed with the relay on. A removal is
    // `baseline − incoming`, NEVER `everything in the DB − incoming`: on the
    // very first run the shared list is empty because nothing has published to
    // it yet, and the wider rule would read that as "the user cleared
    // everything" and delete their entire library. An absent baseline means
    // this device has never agreed to anything, so it may not delete at all.
    const baseline: string[] = Array.isArray(body?.baseline) ? body.baseline : [];
    const baselineFeedGuids = new Set(
      baseline.filter((id) => id.startsWith(SHOW_PREFIX)).map((id) => id.slice(SHOW_PREFIX.length))
    );
    const baselineItemGuids = new Set(
      baseline.filter((id) => id.startsWith(ITEM_PREFIX)).map((id) => id.slice(ITEM_PREFIX.length))
    );

    if (!trustworthy) {
      return NextResponse.json(
        { success: false, error: 'Refusing to reconcile against an untrusted relay read' },
        { status: 400 }
      );
    }

    const wantedFeedGuids = [...new Set(shows.map((s) => s.feedGuid).filter(Boolean))];
    const wantedItemGuids = [...new Set(tracks.map((t) => t.itemGuid).filter(Boolean))];

    // --- resolve incoming identifiers to local rows -------------------------
    const [matchedFeeds, matchedTracks] = await Promise.all([
      wantedFeedGuids.length
        ? prisma.feed.findMany({
            where: { guid: { in: wantedFeedGuids } },
            select: { id: true, guid: true, medium: true },
          })
        : Promise.resolve([]),
      wantedItemGuids.length
        ? prisma.track.findMany({
            where: { guid: { in: wantedItemGuids } },
            select: { id: true, guid: true },
          })
        : Promise.resolve([]),
    ]);

    const feedIdByGuid = new Map(matchedFeeds.map((f) => [f.guid as string, f.id]));
    // What the wire says each incoming show is. Used only to type a favorite we
    // are about to create — a local `Feed.medium` always wins over it, since a
    // hint is a cache of what a reader could resolve and can go stale.
    const mediumByGuid = new Map(
      shows.filter((s) => s.medium).map((s) => [s.feedGuid, s.medium as string])
    );
    const localMediumByGuid = new Map(
      matchedFeeds.filter((f) => f.medium).map((f) => [f.guid as string, f.medium as string])
    );
    const trackIdByGuid = new Map(matchedTracks.map((t) => [t.guid as string, t.id]));

    // Feed guids we've never seen. Returned so the client can hand them to the
    // existing PI import path rather than silently losing the favorite.
    const unresolvedFeedGuids = wantedFeedGuids.filter((g) => !feedIdByGuid.has(g));
    const unresolvedItemGuids = wantedItemGuids.filter((g) => !trackIdByGuid.has(g));

    // --- what this user already has ----------------------------------------
    const [existingAlbums, existingTracks] = await Promise.all([
      prisma.favoriteAlbum.findMany({
        where: { userId },
        select: { id: true, feedId: true, type: true },
      }),
      prisma.favoriteTrack.findMany({
        where: { userId },
        select: { id: true, trackId: true },
      }),
    ]);

    // --- add what the list has and the DB doesn't --------------------------
    const existingAlbumFeedIds = new Set(existingAlbums.map((f) => f.feedId));

    // A feed that has an incoming ITEM under it is not evidence the feed itself
    // was favorited, and in kind:10333 it usually isn't.
    //
    // That format carries an item's parent POSITIONALLY: an item belongs to the
    // feed group most recently opened above it, so naming the parent means
    // emitting a `podcast:guid` entry for it whether or not the user favorited
    // the feed. Nothing on the wire tells the two apart. Measured on real data:
    // 196 groups for 82 favorited feeds, the other 114 opened purely to place a
    // track — so reconciling this app's OWN list back in would have created 114
    // album favorites the user never made, on the next page load, silently.
    //
    // THE FORMAT HAS MOVED ON AND THIS RULE HAS NOT, deliberately. An item names
    // its own feed now, so this app writes a feed entry only for a feed the user
    // chose — but the rule is about what ANOTHER writer put on the list, and a
    // writer still on the old rules still writes placement groups. Loosening it
    // waits on confirming the other app's stage 3, not on our own.
    //
    // The conservative reading is the only safe one: a group with no items is
    // unambiguously a favorited feed, a group with items is unknowable, and
    // inventing a favorite is worse than missing one. The cost is that another
    // app favoriting both an album and a track from it propagates only the
    // track — recoverable, and it corrects itself the moment the album is the
    // only thing left on that group.
    const guidsWithIncomingItems = new Set(
      tracks.map((t) => t.feedGuid).filter((g): g is string => !!g)
    );
    const addedAlbums: string[] = [];
    for (const [guid, feedId] of feedIdByGuid) {
      if (guidsWithIncomingItems.has(guid)) continue;
      // A FavoriteAlbum.feedId is polymorphic (Feed.id | Feed.guid | synthetic
      // artist id), so an existing row may hold either form of the same album —
      // the same reason the track loop below checks both. Matching only on
      // `Feed.id` here created a SECOND row keyed by the id whenever the user
      // already had one under the guid, which `@@unique([userId, feedId])`
      // cannot reject because the strings differ. The album then rendered twice
      // in /favorites and was reported as newly arrived on every first pull.
      if (existingAlbumFeedIds.has(feedId) || existingAlbumFeedIds.has(guid)) continue;
      try {
        // What the entry IS, rather than what this app usually holds. The
        // shared list carries a general podcast app's favorites too, and
        // creating those as `album` files a talk show in the album grid with
        // nothing to distinguish it. Prefer the feed's own declared medium;
        // fall back to the wire hint; default to `album` only when neither
        // says — which is what this line always did.
        const medium = localMediumByGuid.get(guid) ?? mediumByGuid.get(guid);
        await prisma.favoriteAlbum.create({
          data: { userId, feedId, type: medium === 'podcast' ? 'podcast' : 'album' },
        });
        addedAlbums.push(feedId);
      } catch {
        // Unique-constraint race with a concurrent favorite — already there.
      }
    }

    const existingTrackIds = new Set(existingTracks.map((f) => f.trackId));
    const addedTracks: string[] = [];
    for (const [guid, trackId] of trackIdByGuid) {
      // A FavoriteTrack.trackId is polymorphic (Track.id | Track.guid |
      // audioUrl), so an existing row may hold either form of the same track.
      if (existingTrackIds.has(trackId) || existingTrackIds.has(guid)) continue;
      try {
        await prisma.favoriteTrack.create({ data: { userId, trackId } });
        addedTracks.push(trackId);
      } catch {
        // Unique-constraint race — already there.
      }
    }

    // --- remove what the DB has and the list doesn't -----------------------
    //
    // Resolve every existing favorite to its guid first. A row we cannot map to
    // a guid is not on the wire and is therefore NOT a candidate for deletion —
    // that is the difference between "the user unfavorited it elsewhere" and
    // "this app can't represent it".
    let blocked = false;
    let wouldRemoveAlbums = 0;
    let wouldRemoveTracks = 0;

    const removedAlbums: string[] = [];
    const eligibleAlbums = existingAlbums.filter(
      (f) => !UNSYNCED_FAVORITE_TYPES.has(f.type || 'album')
    );
    if (eligibleAlbums.length) {
      const ids = eligibleAlbums.map((f) => f.feedId);
      // feedId is polymorphic too — match by primary key and by guid column.
      const feeds = await prisma.feed.findMany({
        where: { OR: [{ id: { in: ids } }, { guid: { in: ids } }] },
        select: { id: true, guid: true },
      });
      const guidByFeedRef = new Map<string, string | null>();
      for (const feed of feeds) {
        guidByFeedRef.set(feed.id, feed.guid);
        if (feed.guid) guidByFeedRef.set(feed.guid, feed.guid);
      }
      const wantedFeedGuidSet = new Set(wantedFeedGuids);
      const doomed = eligibleAlbums.filter((fav) => {
        const guid = guidByFeedRef.get(fav.feedId);
        if (!guid) return false; // not representable ⇒ never reconciled away
        if (!baselineFeedGuids.has(guid)) return false; // never agreed ⇒ not ours to delete
        return !wantedFeedGuidSet.has(guid);
      });
      if (doomed.length > deletionBudget(eligibleAlbums.length)) {
        blocked = true;
        console.warn(
          `🛑 Shared favorites: refusing to delete ${doomed.length} of ${eligibleAlbums.length} album favorites for user ${userId} in one pass — over the sanity cap. Nothing removed.`
        );
      } else if (!DELETES_ENABLED) {
        wouldRemoveAlbums = doomed.length;
        if (doomed.length) {
          console.log(
            `ℹ️ Shared favorites: would remove ${doomed.length} album favorite(s) — set SHARED_FAVORITES_APPLY_DELETES=true to apply:`,
            doomed.map((d) => d.feedId)
          );
        }
      } else if (doomed.length) {
        await prisma.favoriteAlbum.deleteMany({
          where: { id: { in: doomed.map((d) => d.id) } },
        });
        removedAlbums.push(...doomed.map((d) => d.feedId));
      }
    }

    const removedTracks: string[] = [];
    if (existingTracks.length) {
      const refs = existingTracks.map((f) => f.trackId);
      const trackRows = await prisma.track.findMany({
        where: { OR: [{ id: { in: refs } }, { guid: { in: refs } }] },
        select: { id: true, guid: true },
      });
      const guidByTrackRef = new Map<string, string | null>();
      for (const track of trackRows) {
        guidByTrackRef.set(track.id, track.guid);
        if (track.guid) guidByTrackRef.set(track.guid, track.guid);
      }
      const wantedItemGuidSet = new Set(wantedItemGuids);
      const doomed = existingTracks.filter((fav) => {
        const guid = guidByTrackRef.get(fav.trackId);
        if (!guid) return false; // audioUrl-keyed or unknown ⇒ not on the wire
        if (!baselineItemGuids.has(guid)) return false; // never agreed ⇒ not ours to delete
        return !wantedItemGuidSet.has(guid);
      });
      if (doomed.length > deletionBudget(existingTracks.length)) {
        blocked = true;
        console.warn(
          `🛑 Shared favorites: refusing to delete ${doomed.length} of ${existingTracks.length} track favorites for user ${userId} in one pass — over the sanity cap. Nothing removed.`
        );
      } else if (!DELETES_ENABLED) {
        wouldRemoveTracks = doomed.length;
        if (doomed.length) {
          console.log(
            `ℹ️ Shared favorites: would remove ${doomed.length} track favorite(s) — set SHARED_FAVORITES_APPLY_DELETES=true to apply:`,
            doomed.map((d) => d.trackId)
          );
        }
      } else if (doomed.length) {
        await prisma.favoriteTrack.deleteMany({
          where: { id: { in: doomed.map((d) => d.id) } },
        });
        removedTracks.push(...doomed.map((d) => d.trackId));
      }
    }

    // Import feeds the list references and we've never seen, so the favorite
    // resolves on a later pull rather than being lost. Fire-and-forget and
    // capped: the list is user-controlled in size and each import is a PI call.
    if (unresolvedFeedGuids.length && IMPORT_UNKNOWN_FEEDS) {
      import('@/lib/feed-discovery')
        .then(({ addUnresolvedFeeds }) => addUnresolvedFeeds(unresolvedFeedGuids.slice(0, 10)))
        .catch((e) => console.warn('⚠️ Shared favorites: feed import failed:', e));
    }

    // Favorites this app holds that aren't on the shared list yet. The client
    // uses this to decide whether to push — on first run it is the user's whole
    // library, which is exactly what needs to go up.
    const localOnly =
      matchedFeeds.length + matchedTracks.length <
      existingAlbums.filter((f) => !UNSYNCED_FAVORITE_TYPES.has(f.type || 'album')).length +
        existingTracks.length;

    return NextResponse.json({
      success: true,
      localOnly,
      added: { albums: addedAlbums.length, tracks: addedTracks.length },
      removed: { albums: removedAlbums.length, tracks: removedTracks.length },
      // Reported whether or not deletes are enabled, so a dry run is legible
      // from the response and not only from the server log.
      deletesEnabled: DELETES_ENABLED,
      wouldRemove: { albums: wouldRemoveAlbums, tracks: wouldRemoveTracks },
      blocked,
      unresolved: { feedGuids: unresolvedFeedGuids, itemGuids: unresolvedItemGuids },
    });
  } catch (error) {
    console.error('Error reconciling shared favorites:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
