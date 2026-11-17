import type { PrismaClient } from '@prisma/client';

/**
 * What a failed refresh writes on a feed row.
 *
 * `status: 'error'` hides a feed from every listing — albums-fast, search and the
 * publisher pages all filter on `status: 'active'` — so it is kept for a feed that has
 * nothing to show. A feed that already has tracks keeps its status: its cached tracks
 * still play, and one refused fetch says nothing about the feed. This is the same rule
 * the nightly recovery step (`/api/admin/fix-feed-status`) applies after the fact, moved
 * to the moment of the failure, where it cannot lose a race with the reparse.
 *
 * Measured 2026-10-18: Wavlake refused the nightly reparse's burst for ~2,000 feeds a
 * night, each was marked error, and on nights the recovery step ran before the reparse
 * finished, about half the catalog stayed hidden until the next night.
 *
 * Hiding a feed that is really gone is `Feed.markedDead`'s job (the dead-feed sweep and
 * the admin "Hide Feed" card), not this status.
 */
export function refreshFailureData(errorMessage: string, hasTracks: boolean) {
  return {
    lastError: errorMessage,
    lastFetched: new Date(),
    ...(hasTracks ? {} : { status: 'error' as const }),
  };
}

/** Record a failed refresh of `feedId` by the rule above. */
export async function recordRefreshFailure(
  db: Pick<PrismaClient, 'feed' | 'track'>,
  feedId: string,
  errorMessage: string
): Promise<void> {
  const trackCount = await db.track.count({ where: { feedId } });
  await db.feed.update({
    where: { id: feedId },
    data: refreshFailureData(errorMessage, trackCount > 0),
  });
}
