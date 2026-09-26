import { isBlacklistedFeedUrl } from '../feed-exclusions';

/**
 * The body `GET /api/feeds/exists?guid=` answers.
 *
 * It carries the URL we store, because the podping service cannot turn a guid
 * into a URL on its own and `refresh-by-url` needs one: a podping that named a
 * feed as `podcast:guid:<guid>` used to be skipped ("no URL variant in podping").
 * The URL is not new information — `/api/feeds/opml` publishes every feed URL.
 *
 * A blacklisted feed answers `exists: false`, as the `?url=` branch already
 * does, so a guid is not a way round the blacklist.
 */
export function guidExistsBody(
  match: { originalUrl: string } | null
): { exists: false } | { exists: true; url: string } {
  if (!match || isBlacklistedFeedUrl(match.originalUrl)) return { exists: false };
  return { exists: true, url: match.originalUrl };
}
