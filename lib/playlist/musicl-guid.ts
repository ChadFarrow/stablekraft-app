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

export const NO_GUID_ERROR =
  'The playlist needs its own podcast:guid: pass guid (a UUID) or playlistFeedUrl (where the playlist is hosted).';

export const BAD_PUBLISHER_GUID_ERROR =
  'The publisher feed GUID must be a UUID: the podcast:guid of your medium="publisher" feed. Leave it empty for no back-link.';

export interface CheckedPlaylistIds {
  ok: true;
  guid: string;
  publisher: { feedGuid: string; feedUrl: string | null } | null;
}

export type MinimalPlaylistIds =
  | CheckedPlaylistIds
  | { ok: false; field: 'guid' | 'publisherFeedGuid'; error: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * The identity checks of a minimal-template build: the playlist's own guid and
 * the optional publisher back-link. No I/O, so the route runs it BEFORE it
 * fetches the source feed — run after the parse, a refused guid waited ~23 s
 * for its 400. A refusal names the field, so the maker can mark that input.
 *
 * A bad publisher guid is a 400 here; left to buildMinimalPlaylistXml, whose
 * throw is only a backstop, it was a 500 "Failed to generate playlist RSS".
 * An empty publisher guid means no back-link, as before.
 */
export function checkMinimalPlaylistIds(o: {
  guid?: unknown;
  playlistFeedUrl?: unknown;
  publisherFeedGuid?: unknown;
  publisherFeedUrl?: unknown;
}): MinimalPlaylistIds {
  const guid = playlistGuid(str(o.guid), str(o.playlistFeedUrl));
  if (!guid) return { ok: false, field: 'guid', error: NO_GUID_ERROR };

  const rawPub = o.publisherFeedGuid;
  if (!rawPub || (typeof rawPub === 'string' && !rawPub.trim())) {
    return { ok: true, guid, publisher: null };
  }
  if (!isUuid(rawPub)) return { ok: false, field: 'publisherFeedGuid', error: BAD_PUBLISHER_GUID_ERROR };
  const pubUrl = (str(o.publisherFeedUrl) || '').trim();
  return { ok: true, guid, publisher: { feedGuid: rawPub.trim(), feedUrl: pubUrl || null } };
}

