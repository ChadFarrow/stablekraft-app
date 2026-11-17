# Adding New Playlists to StableKraft

## A playlist is registered in FOUR places

Nothing fails if you miss one — the playlist just half-exists, and which half depends on which
registration you skipped. `top100` was the example until it was removed (2026-11-01): it had a route
and a page, but was absent from both `PLAYLIST_CONFIGS` and the nightly workflow array, so it never
auto-refreshed.

| # | File | What breaks if you skip it |
|---|---|---|
| 1 | `lib/playlist/configs.ts` → `PLAYLIST_CONFIGS` | The route has no config to hand the handler; also absent from `getAllPlaylistIds()` and playlist search |
| 2 | `app/api/playlist/<name>/route.ts` + `app/playlist/<name>/page.tsx` | Nothing to fetch, nothing to link to |
| 3 | `app/api/playlists-fast/route.ts` | Missing from the homepage playlist grid — that endpoint holds a hardcoded list and does **not** enumerate the route directory |
| 4 | `.github/workflows/refresh-playlists.yml` → `PLAYLISTS` array | Never refreshed by the nightly job; goes stale until someone forces a cache miss |

> Two unrelated types are both called `PlaylistConfig`. `lib/playlist/types.ts` is the **route**
> config (`id`, `url`, `name`, `cacheDuration`, `maxDuration`, …); `types/playlist.ts` is the
> **page** config (`cacheKey`, `apiEndpoint`, `title`, …). You need one of each.

## Quick Start

### 1. Add the route config

Add an entry to `PLAYLIST_CONFIGS` in `lib/playlist/configs.ts`:

```typescript
yourPlaylist: {
  id: 'your-playlist',
  url: `${GITHUB_BASE}/YOUR-music-playlist.xml`,
  name: 'Your Playlist Name',
  shortName: 'YRS',
  author: 'ChadF',
  description: 'Curated Value4Value selections',
  cacheDuration: CACHE_6_HOURS,
  maxDuration: TIMEOUT_STANDARD,
  playlistUrl: '/playlist/your-playlist',
  albumUrl: '/album/your-playlist',
},
```

### 2. Create the route

12 of the 13 playlists are four lines — the handler factory does everything:

```typescript
// app/api/playlist/your-playlist/route.ts
import { createPlaylistHandler, PLAYLIST_CONFIGS } from '@/lib/playlist';

export const maxDuration = 300;

export const GET = createPlaylistHandler(PLAYLIST_CONFIGS.yourPlaylist);
```

`app/api/playlist/template.example.ts` is the older hand-rolled approach. No route has used it since
`top100` was removed (2026-11-01). Use the factory.

### 3. Create the playlist page

```bash
cp app/playlist/iam/page.tsx app/playlist/your-playlist/page.tsx
```

Pages use `PlaylistTemplateCompact` with a page-level `PlaylistConfig` — see
[`playlist-page-template.md`](playlist-page-template.md).

### 4. Add it to the homepage grid and the nightly refresh

Add an entry to the array in `app/api/playlists-fast/route.ts`, and add the name to the `PLAYLISTS`
array in `.github/workflows/refresh-playlists.yml` (see [`PLAYLIST_REFRESH.md`](PLAYLIST_REFRESH.md)).

## How It Works

The playlist system automatically:

1. **Fetches the XML** from your GitHub repository or URL
2. **Parses remote items** (feedGuid + itemGuid pairs)
3. **Database lookup** - Checks if tracks already exist (from RSS processing)
4. **API resolution** - Uses Podcast Index API to resolve unresolved tracks
5. **Feed discovery** - Automatically discovers and adds new feeds to the database for future processing

### Automated Feed Discovery

When playlist items reference feeds that aren't in the database, the system automatically:

1. **Extracts unique feed GUIDs** from unresolved playlist items
2. **Resolves feed metadata** via Podcast Index API (URL, title, artist, image, type)
3. **Validates feed URLs** before storing
4. **Adds feeds to database** with proper type detection (album vs podcast based on `medium` field)
5. **Uses atomic operations** (upsert) to prevent race conditions

Feeds are stored with their GUID as the feed ID for compatibility. Tracks are extracted later via batch processing at `/api/playlist/parse-feeds`, which reads from the database.

**Key Functions:**
- `processPlaylistFeedDiscovery()` - Main entry point, extracts unique feed GUIDs and calls `addUnresolvedFeeds()`
- `addUnresolvedFeeds()` - Resolves GUIDs via Podcast Index API and adds to database
- `resolveFeedGuidWithMetadata()` - Fetches complete feed metadata including type determination

**Integration:** `createPlaylistHandler` (`lib/playlist/handler.ts`) calls
`processPlaylistFeedDiscovery` after track resolution, so every playlist built on the factory gets
feed discovery for free. A hand-rolled route must call it itself.

## Resolution Rates

With the current implementation, you can expect:
- **First load**: 30-50% resolution (database hits only)
- **With API resolution**: 88-99% resolution (database + API)
- **After feed processing**: Near 100% resolution

## Key Components

### `lib/playlist-resolver.ts`
Core resolution logic that achieves 96%+ resolution rates:
- Database lookup for existing tracks
- Podcast Index API resolution with multiple approaches
- Automatic progress tracking
- Rate limiting protection

### `lib/feed-discovery.ts`
Automated feed discovery and episode resolution via Podcast Index API:
- **Feed Discovery**: Automatically discovers feeds from playlists and adds them to the database
- **GUID Resolution**: Resolves feed GUIDs to full metadata (URL, title, artist, image, type)
- **Type Detection**: Determines feed type (album vs podcast) based on Podcast Index `medium` field
- **Episode Resolution**: Resolves individual episode/item GUIDs to track metadata
- **Race Condition Protection**: Uses atomic upsert operations to prevent duplicate feeds
- **URL Validation**: Validates feed URLs before storing in database

### Template Features
- **Caching**: 1-minute cache with `?refresh=1` override
- **Auto-discovery**: Automatically discovers and adds unresolved feeds to database via Podcast Index API
- **Error handling**: Graceful fallback for failed resolutions (feed discovery errors don't break playlists)
- **Progress logging**: Detailed console output for debugging
- **Non-blocking**: Feed discovery runs asynchronously and doesn't delay playlist creation

## Performance Tips

1. **API Limits**: The template processes up to 300 tracks via API
2. **Rate Limiting**: 50ms delay between API calls prevents throttling
3. **Caching**: Responses cached for 1 minute to reduce API load
4. **Batch Processing**: RSS feeds processed automatically in background

## Troubleshooting

### Low Resolution Rate?
1. Check if feeds are in the database: `/api/admin/all-feeds`
2. Trigger feed parsing: `POST /api/parse-feeds?action=parse`
3. Force refresh: Add `?refresh=1` to playlist URL

### API Errors?
1. Verify Podcast Index API credentials in `.env.local`
2. Check rate limiting (reduce `apiDelay` if needed)
3. Some GUIDs may not exist in Podcast Index

### Missing Tracks?
Some tracks may be:
- Private/unpublished content
- Deleted from the source
- Using incorrect GUIDs
- From feeds not in Podcast Index

## Example Playlist XML Structure

```xml
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Your Playlist Name</title>
    <description>Playlist description</description>
    <image>
      <url>https://your-image-url.com/artwork.jpg</url>
    </image>
    <item>
      <title>Playlist Entry</title>
      <podcast:remoteItem 
        feedGuid="feed-guid-here" 
        itemGuid="item-guid-here"/>
    </item>
    <!-- More items... -->
  </channel>
</rss>
```

## Expected resolution

Established playlists sit in the 96–99% range once their feeds have been through a nightly parse.
A new playlist reaches that over its first day or two rather than on first load — the unresolved
items are what feed discovery mints feeds from, and those feeds are parsed by the nightly job
afterwards.

Check a specific playlist's current rate from its API response rather than from a number written
down here; the counts move every time the source XML does.