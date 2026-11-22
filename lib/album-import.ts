import { prisma } from '@/lib/prisma';
import { generatePodcastIndexHeaders } from '@/lib/podcast-index-api';
import { getEpisodesFromAPI, parseDuration } from '@/lib/feed-parsing';
import { calculateTrackOrder } from '@/lib/rss-parser-db';
import { generateAlbumSlug, normalizeUrl } from '@/lib/url-utils';
import { isBlacklistedFeedUrl, isHenrikFlymanWavlakeMirror } from '@/lib/feed-exclusions';
import { syncOldestItemPubdate } from '@/lib/feed-pubdate';

export const PI_API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

/**
 * Search Podcast Index API for music feeds by artist name.
 *
 * Filters to `medium === 'music'` feeds whose `author` EXACTLY matches the
 * search term (case-insensitive). Callers MUST pass the original artist
 * display string, never a punctuation-stripped normalized key — the author
 * match is against PI's raw `author` value.
 */
export async function searchMusicFeedsByArtist(artistName: string): Promise<any[]> {
  try {
    const headers = await generatePodcastIndexHeaders();
    const url = `${PI_API_BASE_URL}/search/byterm?q=${encodeURIComponent(artistName)}`;
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`⚠️ PI search failed for "${artistName}": ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (data.status !== 'true' || !data.feeds) return [];

    // Filter to music medium feeds with exact author match (case insensitive)
    const searchLower = artistName.toLowerCase();
    return data.feeds.filter((feed: any) => {
      if (feed.medium !== 'music') return false;
      const author = (feed.author || '').toLowerCase();
      return author === searchLower;
    });
  } catch (error) {
    console.error(`❌ PI search error for "${artistName}":`, error);
    return [];
  }
}

export function generateFeedId(artist: string | undefined, title: string): string {
  const parts = [];
  if (artist) parts.push(generateAlbumSlug(artist));
  parts.push(generateAlbumSlug(title));
  let baseId = parts.join('-');
  if (!baseId || baseId.length < 2) baseId = `feed-${Date.now()}`;
  return baseId;
}

export type MintResult =
  | { status: 'imported'; feedId: string; tracks: number; detail: string }
  | { status: 'wouldImport'; feedId: string; title: string; feedUrl: string; detail: string }
  | { status: 'skipped'; detail: string };

/**
 * Mint a single album Feed (+ tracks) from a Podcast Index feed object, applying
 * every dedup/exclusion guard. Shared by:
 *   - the publisher-album cron (`/api/admin/publishers/import-albums`), which
 *     passes the publisher's id so matched existing rows get linked, and
 *   - the existing-artist sweep (`/api/admin/artists/import-new-albums`), which
 *     passes `publisherId: null` (these artists have no publisher feed).
 *
 * Behavior is identical to the original inline loop body in the publisher route
 * — the guard order, `markedDead`/blacklist semantics, and PI-episode → track
 * mapping are unchanged. When `publisherId` is null, the publisher-link
 * side-effects are simply skipped.
 *
 * When `dryRun` is true, all guards and the episodes check run but no rows are
 * written — the function returns a `wouldImport` result instead of creating.
 *
 * Throws on unexpected DB/PI errors; callers wrap per-feed and count failures.
 */
export async function mintAlbumFromPiFeed(
  piFeed: any,
  { publisherId, dryRun = false }: { publisherId: string | null; dryRun?: boolean }
): Promise<MintResult> {
  const feedUrl = normalizeUrl(piFeed.url || piFeed.originalUrl || '');
  const podcastGuid = piFeed.podcastGuid || '';

  // Skip blacklisted URLs. Prevents the 4 AM cron from recreating
  // feed rows the user has intentionally deleted.
  if (feedUrl && isBlacklistedFeedUrl(feedUrl)) {
    return { status: 'skipped', detail: `blacklisted:${piFeed.title}|${feedUrl}` };
  }

  // Henrik Flyman pulled all his music off Wavlake (self-hosts at
  // henrikflyman.com). Never re-mint his Wavlake mirrors from PI
  // artist search — new ones appear faster than URLs can be listed.
  if (isHenrikFlymanWavlakeMirror({ artist: piFeed.author || '', feedUrl: piFeed.url || piFeed.originalUrl || feedUrl })) {
    return { status: 'skipped', detail: `henrik-wavlake:${piFeed.title}|${feedUrl}` };
  }

  // Multi-check dedup: URL, podcastGuid as ID, podcastGuid as guid column
  const conditions: any[] = [];
  if (feedUrl) conditions.push({ originalUrl: feedUrl });
  if (podcastGuid) {
    conditions.push({ id: podcastGuid });
    conditions.push({ guid: podcastGuid });
  }

  if (conditions.length === 0) {
    return { status: 'skipped', detail: `no-identifiers:${piFeed.title}` };
  }

  const existing = await prisma.feed.findFirst({ where: { OR: conditions } });

  if (existing) {
    // Manually flagged dead (e.g. taken down upstream), or blocked by the
    // feed's own <podcast:block> — leave it untouched. The row stays put, so no
    // fresh copy is minted. A block lifts at the feed's next parse, never here.
    if (existing.markedDead || existing.blocked) {
      return {
        status: 'skipped',
        detail: `${existing.markedDead ? 'dead' : 'blocked'}:${existing.id}|${existing.title}`,
      };
    }
    if (publisherId && !existing.publisherId && !dryRun) {
      await prisma.feed.update({
        where: { id: existing.id },
        data: { publisherId }
      });
    }
    return { status: 'skipped', detail: `exists:${existing.id}|${existing.title}|pubId:${existing.publisherId}` };
  }

  // Get episodes via PI API
  const episodes = await getEpisodesFromAPI(piFeed.id);
  if (!episodes || episodes.length === 0) {
    return { status: 'skipped', detail: `no-episodes:${piFeed.title}` };
  }

  // Generate feed ID
  let feedId = generateFeedId(piFeed.author, piFeed.title);
  const idExists = await prisma.feed.findUnique({ where: { id: feedId } });
  if (idExists) feedId = `${feedId}-${Date.now()}`;

  // Secondary dedup by podcastGuid
  if (podcastGuid) {
    const guidExists = await prisma.feed.findFirst({ where: { guid: podcastGuid } });
    if (guidExists) {
      if (publisherId && !guidExists.publisherId && !dryRun) {
        await prisma.feed.update({
          where: { id: guidExists.id },
          data: { publisherId }
        });
      }
      return { status: 'skipped', detail: `guid:${guidExists.id}|${guidExists.title}|pubId:${guidExists.publisherId}` };
    }
  }

  // All guards passed and episodes are present. On a dry run, stop here.
  if (dryRun) {
    return { status: 'wouldImport', feedId, title: piFeed.title, feedUrl, detail: `${piFeed.title}|${feedUrl}|${episodes.length} tracks` };
  }

  // Format feed-level v4v data from PI API
  let v4vValue = null;
  let v4vRecipient = null;
  if (piFeed.value?.model && piFeed.value?.destinations) {
    v4vValue = {
      type: piFeed.value.model.type || 'lightning',
      method: piFeed.value.model.method || 'keysend',
      suggested: piFeed.value.model.suggested,
      recipients: piFeed.value.destinations.map((r: any) => ({
        name: r.name,
        type: r.type,
        address: r.address,
        split: r.split,
        customKey: r.customKey,
        customValue: r.customValue,
        fee: r.fee || false
      }))
    };
    v4vRecipient = piFeed.value.destinations[0]?.address || null;
  }

  // Create feed
  const feed = await prisma.feed.create({
    data: {
      id: feedId,
      guid: podcastGuid || null,
      originalUrl: feedUrl,
      cdnUrl: feedUrl,
      type: 'album',
      // What Podcast Index says the feed declared; empty stays NULL.
      medium: piFeed.medium?.toLowerCase() || null,
      priority: 'normal',
      title: piFeed.title,
      description: piFeed.description || null,
      artist: piFeed.author || null,
      image: piFeed.artwork || piFeed.image || null,
      language: piFeed.language || null,
      category: piFeed.categories ? (Object.values(piFeed.categories)[0] as string) : null,
      explicit: piFeed.explicit === 1,
      ...(v4vValue && { v4vValue }),
      ...(v4vRecipient && { v4vRecipient }),
      publisherId: publisherId,
      lastFetched: new Date(),
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  });

  // Create tracks from PI API episodes
  const tracksData = episodes.map((ep, index) => {
    // Format episode-level v4v data
    let trackV4v = null;
    let trackV4vRecipient = null;
    if (ep.v4vValue?.destinations) {
      trackV4v = {
        type: ep.v4vValue.model?.type || 'lightning',
        method: ep.v4vValue.model?.method || 'keysend',
        suggested: ep.v4vValue.model?.suggested,
        recipients: ep.v4vValue.destinations.map((r: any) => ({
          name: r.name,
          type: r.type,
          address: r.address,
          split: r.split,
          customKey: r.customKey,
          customValue: r.customValue,
          fee: r.fee || false
        }))
      };
      trackV4vRecipient = ep.v4vValue.destinations[0]?.address || null;
    }

    return {
      id: `${feed.id}-${ep.guid || `track-${index}-${Date.now()}`}`,
      feedId: feed.id,
      guid: ep.guid,
      title: ep.title,
      description: ep.description || null,
      audioUrl: ep.audioUrl,
      duration: parseDuration(ep.duration),
      image: ep.image || null,
      publishedAt: ep.pubDate ? new Date(ep.pubDate) : new Date(),
      trackOrder: ep.episode ? calculateTrackOrder(ep.episode, ep.season) : index + 1,
      ...(trackV4v && { v4vValue: trackV4v }),
      ...(trackV4vRecipient && { v4vRecipient: trackV4vRecipient }),
      updatedAt: new Date()
    };
  });

  await prisma.track.createMany({
    data: tracksData,
    skipDuplicates: true
  });

  // Release date for the grid + "Year" sort, from the tracks just imported
  await syncOldestItemPubdate(feed.id);

  return { status: 'imported', feedId: feed.id, tracks: episodes.length, detail: `${piFeed.title} (${episodes.length} tracks)` };
}
