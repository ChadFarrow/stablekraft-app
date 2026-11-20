/**
 * The guid rule for musicL playlists (#309). Server only: it uses node's
 * crypto for SHA-1. The pure readers and the writer are in musicl-feed.ts.
 */
import { createHash } from 'crypto';
import { isUuid } from './musicl-feed';

/** The namespace UUID the podcast:guid tag defines for UUIDv5 feed guids. */
const PODCAST_GUID_NS = 'ead4c236-bf58-58c6-a2c6-a6b28d128cb6';

/**
 * The podcast:guid of a feed URL, as the podcast:guid tag defines it: UUIDv5
 * in the podcast namespace, of the URL with its scheme and trailing slashes
 * removed. '' for an empty URL.
 */
export function podcastGuidFromUrl(feedUrl: string | null | undefined): string {
  const name = String(feedUrl || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/\/+$/, '');
  if (!name) return '';
  const ns = Buffer.from(PODCAST_GUID_NS.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The guid a playlist build uses: the caller's guid if it is a UUID, else the
 * UUIDv5 of the playlist's own feed URL. null when neither is given — the
 * caller must refuse rather than mint one, because a guid minted per build is
 * a new feed every time to Podcast Index, favorites and boosts.
 */
export function playlistGuid(guid: string | null | undefined, playlistFeedUrl?: string | null): string | null {
  if (isUuid(guid)) return guid.trim().toLowerCase();
  const fromUrl = podcastGuidFromUrl(playlistFeedUrl);
  return fromUrl || null;
}

