---
name: catalog-display
description: "Use when working on what the catalog SHOWS and how albums are listed, sorted or linked: /api/albums-fast and its two Track selects, an album showing the wrong year or wrong release date, Feed.oldestItemPubdate, sort order, the format grouping (Albums/EPs/Singles), the \"New\" filter, search and trigram similarity, track ordering and trackOrder, the explicit flag, duration filtering, album links and generateAlbumHref, a link that opens the WRONG album, duplicate cards while scrolling the home grid, adding a new playlist, publisher pages, podcast:image artwork and canvas backgrounds, or episode/play-count markers."
---

# catalog-display

What the catalog shows: list endpoints, sorting, linking, artwork and publisher pages.

## Tests for this subsystem

```
npx tsx --test lib/url-utils.test.ts                # feed URL variants + generateAlbumHref
npx tsx --test lib/cdn-utils.test.ts                # animated-artwork detection
npx tsx --test lib/album-detail-routes.test.ts      # which routes render AlbumDetailClient
```

---

## `/api/albums-fast` track fields (critical gotchas)
Main-grid play button plays tracks straight from this endpoint — fields missing here don't show up on Now Playing.

- **Two Track `select` blocks** — general path (~line 163) and `case 'podcasts'` (~line 451). When adding a field, update **both** (different indentation — naive `replace_all` only hits one).
- **Must include `chaptersUrl`, `chapters`, `valueTimeSplits`** in both selects and both track-mapping blocks — otherwise chapter ticks/titles and VTS playback silently fail when playing from the grid.
- **`persons` and `podcastImages`** (the JSON fields parsed from XML) follow the same both-selects-both-mappings rule — feed-level and track-level. See [Podcasting 2.0 `<podcast:image>` Tag](#podcasting-20-podcastimage-tag-since-2026-06-12) for the full write/read path.
- **The rule does not stop at albums-fast.** `/api/albums/[slug]` (the album page) builds its own album shape, and `app/page.tsx`'s `rssAlbums` mapper copies the albums-fast album field by field — neither goes through `lib/catalog/album-shape.ts`. Both dropped `persons` until #261, so the album page's and the home grid's boosts tagged no artist even though albums-fast carried the key. The slug route now selects and maps track `persons` and puts `Feed.persons` on **both** `foundAlbum` objects; the home mapper keeps album-level `persons` (`API_VERSION` → `v19`). `lib/feeds/channel-persons.test.ts` scans all of it. Why it matters for boosts → `lightning-boost`, *Who a boost note names*.
- **Bump `API_VERSION` in `app/page.tsx`** whenever the response shape changes — main page caches under `localStorage['cachedAlbums_${N}_${API_VERSION}']` and without a bump, stale field-missing data sticks indefinitely.
- **Read-path cache stack** (each layer needs its own bust when debugging "feed minted but not visible"):
  1. **Railway in-memory, fingerprinted** (`lib/caches/albums-fast-cache.ts` over `lib/caches/fingerprinted-cache.ts`). Every 15 min a request triggers a ~0.5 s Postgres md5 over every active Feed row and their Track rows (32 bytes back); only a changed hash, an invalidation, or 6 h of age re-reads the catalog (~20 MB). A due check serves the old rows immediately and rebuilds behind the request, so a new track shows up on the request *after* the one that noticed it — still within ~15 min. Concurrent requests share one load. The `filter=podcasts` view has its own instance (it was uncached and re-read ~1,060 episodes per request). Each real rebuild logs `[albums-fast-cache] <catalog|podcasts> rebuilt (<reason>) in <ms>` via `console.warn`, so production logs show how often it happens. Auto-invalidates on `POST`/`PUT`/`DELETE /api/feeds` via `invalidateAlbumsFastCache()` (same hook busts the 5-min `searchCache` in `lib/caches/search-cache.ts`). Manual bust: `?refresh=true`, admin-only (bearer secret) — anyone could otherwise force a full catalog rescan in a loop.
  2. **Fastly CDN — NOT active as of 2026-09-19.** Responses carry no `x-railway-cdn-edge` or `age` header, and consecutive requests each reach the origin (distinct `x-railway-request-id`, full response time), so `s-maxage` currently saves nothing. It was once there (Railway edge, `x-railway-cdn-edge: fastly/…`), and if it comes back the old warning applies: **do not raise `s-maxage` back to 900** without a Fastly purge hook (issue #110 traced hours-long invisibility to the old 15+30 min window). Check the headers before reasoning from either state.
  3. **Client localStorage** `cachedAlbums_${N}_${API_VERSION}` in `app/page.tsx`. Server invalidation can't reach this — persists until hard-reload or `API_VERSION` bump. Expect a 1-app-load lag after a new feed mints.
  4. **PWA service worker** (`next-pwa`, `next.config.js`). `/api/*` is **excluded** so API responses are never SW-cached; HTML shells are NetworkFirst with 1-hour TTL and 3s network timeout.

---

## Sorting
`/api/albums-fast` accepts `sort` param (`added-desc`, `added-asc`, `year-desc`, `year-asc`, `name-asc`, `name-desc`, `tracks-desc`, `tracks-asc`). **Do NOT send `sort=name-asc` as default** — bypasses format grouping (Albums → EPs → Singles). Date fields: `Feed.oldestItemPubdate` = release date, `Feed.createdAt` = when added.

---

## Release Date (`Feed.oldestItemPubdate`) — 7 read paths, keep them identical
The album year shown everywhere and the `year-*` sorts both come from `Feed.oldestItemPubdate`. **The formula is always `feed.oldestItemPubdate || feed.createdAt`** — never `feed.lastFetched`, which is when we last *crawled* the feed, and never bare `createdAt`, which is when the feed was added to StableKraft. Issue #169 (a 2025 album displaying "2026") was those two mistakes stacked.

- **Write side — `syncOldestItemPubdate(feedId)` in `lib/feed-pubdate.ts`.** Derives the value from the feed's oldest `Track.publishedAt` and never throws (a pub-date refresh must not fail a feed import). Call it from **every** path that writes tracks, *after* the tracks are persisted. Current callers: `lib/feed-parsing.ts` (`importFeedToDatabase`), `lib/album-import.ts` (`mintAlbumFromPiFeed`), `POST /api/feeds` (**both** `createMany` sites — bulk import and admin add), and `app/api/admin/feeds/[id]/reparse`. The reparse call is deliberately **unconditional** (not inside the `newItems.length > 0` branch) because a reparse also upserts existing tracks and can correct their `publishedAt` — that is also what repairs historical rows.
- **Read side — 7 sites, all must match**: `albums-fast` (×2), `feeds/recent`, `albums/[slug]` (×2 feed-backed album objects **plus** `publisherAlbums`), `albums`, `publishers/[id]`, `publishers-by-id`, `parsed-feeds` (×2 — the track-level one keeps `track.publishedAt` as its first choice). Same family as the albums-fast dual-select gotcha: fixing only the grid leaves the album detail page lying, which is the surface users actually complain about.
- **Safety net**: Step 2e in `refresh-playlists.yml` POSTs `/api/admin/backfill-oldest-pubdate` nightly. That endpoint fills **only null rows** and skips feeds whose tracks carry no `publishedAt` (publisher rows, track-less albums) — those legitimately have no release date and keep the `createdAt` fallback.
- Changing these values changes API *content* but not *shape*; server caches invalidate but `localStorage['cachedAlbums_*']` cannot be reached, so bump `API_VERSION` in `app/page.tsx` when you run a mass correction.

---

## "New" filter (`/api/feeds/recent`)
Music-only feeds ordered by `Feed.createdAt desc` — recently added to the app, **not** new releases. **Do not** revert the sort to `MAX(latest Track.createdAt, Feed.createdAt)` — re-using an old album whose tracks updated surfaces false-positives already in the catalog (PR #116 originally shipped with that ranking and was changed for exactly this reason).

Three exclusion layers, each catches what the others miss: `where: { type: 'album' }` drops correctly-typed podcasts; `isPlaylistSourceFeedUrl()` drops curated-playlist source podcasts (HGH, MMM, Two For Tunestr) still mis-typed as `'album'`; `isBowlAfterBowlPodcastEntry()` drops BAB while keeping Bowl Covers.

**Page size is 50** (`ALBUMS_PER_PAGE`), same as other filters. Was briefly 200 to push historical re-import noise (feeds deleted-and-re-imported, resetting `createdAt`) off page 1 faster, but rendering 200 `AlbumCard`s — each with its own `IntersectionObserver` for prefetch — made iOS Safari scrolling and filter-swap latency noticeably worse than other filters, so the perf parity won out over the dedup nicety. **No client sort**: `ControlsBar` is hidden on `'new'` and the render branch in `app/page.tsx` renders `filteredAlbums` directly — server controls rank order.

---

## Search
- PostgreSQL trigram `similarity()`, flat 0.3 threshold. Do NOT lower below 0.3 — causes false positives.
- Artist search groups by `LOWER(artist)`. Exact mode: `?fuzzy=false`.
- Podcasts searchable by title/artist/description (queries `type: 'podcast'` feeds).

---

## Track Ordering
`Track.trackOrder` drives album display (`orderBy trackOrder asc`; the API's `trackNumber` is positional, not the stored value). Order sources, best to worst:
1. Episode/season tags via `calculateTrackOrder` (`lib/rss-parser-db.ts`) = `season*1000 + episode`. The app's RSS parser reads both `itunes:` and `podcast:` namespace tags; **PI's episodes API only surfaces `itunes:episode` — `<podcast:episode>`-only feeds (e.g. Henrik Flyman's) come through PI with `episode: null`**.
2. Index fallback over the episodes array. `getEpisodesFromAPI` (`lib/feed-parsing.ts`) sorts PI episodes by `datePublished` ascending — do **not** remove the sort; PI returns newest-first and the raw order reversed every PI-imported album without itunes episode tags (PR #150).
3. Identical-timestamp items stay in PI's arbitrary tie order. Corrective: admin reparse, which uses RSS document order (also auto-runs nightly for newly imported feeds via Step 5c).

---

## Duration Filtering
Tracks over 2 hours filtered as non-music (silent, no warnings).

---

## Explicit Flag
Show-level `album.explicit` uses `feed.explicit ?? false` only (channel `<itunes:explicit>`). Do **not** aggregate from track-level explicit flags — that diverges from Apple Podcasts convention. Per-track `explicit` is unchanged; `AlbumDetailClient` renders per-row "E" badges on individual explicit episodes. Call sites: `app/api/albums/[slug]/route.ts`, `app/api/albums/route.ts`, `app/api/parsed-feeds/route.ts`.

---

## Album links — always `generateAlbumHref(album)`, never `generateAlbumUrl(album.title)`
Album titles are **not unique** — four active feeds are titled exactly `Singles` (`the-horse-heads-singles`, `frankie-peroni-singles`, `nathan-abbott-singles`, `singles-1768078067901`). Every album link used to be `generateAlbumUrl(album.title)`, so all four minted `/album/singles`, and `/api/albums/[slug]` picked the winner by **max track count, first-wins on ties** — Horseheads and Frankie Peroni both have 3 tracks, so the Horseheads publisher card loaded Frankie Peroni's album (issue #183). Link by the Feed row's primary key instead: `generateAlbumHref(album)` in `lib/url-utils.ts` (tests: `npx tsx --test lib/url-utils.test.ts`).

- **`feedId` beats `id`, and that ordering is the whole fix.** `/api/albums` returns a **synthetic** `id` — `` `${generateAlbumSlug(title)}-${feed.id.split('-')[0]}` ``, e.g. `all-thats-haunting-me-ariel` — alongside the real `feedId`. That synthetic id **404s**. Preferring `id` would take the podroll tiles and the publisher-page client fallbacks from "wrong album" to "no album". Same pattern at `app/api/albums/[slug]/route.ts`, `app/api/publishers/[id]/route.ts`, `app/api/publishers-by-id/route.ts`. A unit test pins it.
- **There is no single place a link is minted** — every surface builds its own href from whatever album object it holds (publisher grid + list, `AlbumCard`, the home list views, `/search`, `SearchBar`'s album *and* track rows, podroll, Now Playing, `RadioPlayer`, boost/share URLs). Adding a new one? Use the helper. Same "derived in N places, so N places can disagree" family as the `currentTrackIndex` problem in [End of Album](#end-of-album--rewind-the-media-not-just-the-index-contextsaudiocontexttsx).
- **No route change was needed and none should be made.** `/api/albums/[slug]`'s first rung is already an exact case-insensitive `id` match, and **every title rung must stay** so previously-shared `/album/singles`-style links keep resolving.
- **`/podcast/` links stay title-slug-driven** — they have their own canonical-slug redirect machinery in `lib/podcast-feeds.ts`. `AlbumCard`'s `isPodcast` branch still calls `generateAlbumUrl(title, 'podcast')`. Note `app/page.tsx` strips `isPodcast` when mapping albums-fast results, so podcast cards on the home grid reach `/podcast/` via the `/album/<id>` → `/podcast/<canonical>` redirect — which is why **every curated podcast needs its DB id in `PODCAST_SLUGS`**, not just its canonical slug (Upbeats was missing its own and would have skipped the redirect once links became id-based).
- Accepted trade-off: PI/Wavlake-imported feeds get a UUID URL (`/album/e19d84d9-…`). Id-based album URLs were already public-facing via `ShareButton`, `AdminPanel` and `/favorites`.
- **Publisher URLs have the same collision shape and are NOT fixed.** `/publisher/horseheads` is a name slug from `generatePublisherSlug`, and publisher ids are themselves name-derived synthetics (`artist-$2-holla`), so the only unique handle is a raw `feedGuid`. Left deliberately; don't half-fix it.

---

## Home Grid Pagination (`app/page.tsx` `loadMoreAlbums`)
Infinite-scroll offset **must** be the count of items already loaded (`displayedAlbums.length`), NOT `(page-1)*ALBUMS_PER_PAGE`: the albums phase loads variable-size batches (up to `ALBUMS_PER_PAGE * 2`), so page arithmetic drifts behind the real count and re-fetches rows → **duplicate cards** (adjacent after the format-group sort). The publishers path uses `offset=currentCount` for the same reason. A dedup-by-id safety net on merge also halts paging when a fetch returns only duplicates.

---

## Adding New Playlists
Files to modify (9 total):
1. `lib/playlist/configs.ts` - Config entry
2. `app/api/playlist/[id]/route.ts` - Main API route
3. `app/api/playlist/[id]-fast/route.ts` - Fast API route
4. `lib/playlist-track-counts.ts` - `FALLBACK_COUNTS` and `PLAYLIST_URLS`
5. `app/api/playlists-fast/route.ts` - Playlist summary
6. `app/page.tsx` - Fallback `Promise.allSettled` array
7. `app/playlist/[id]/page.tsx` - Dedicated page (`PlaylistTemplateCompact`)
8. `app/favorites/page.tsx` - `playlistTitles`, `playlistImageFallbacks`, `playlistSlugOverrides`
9. `.github/workflows/refresh-playlists.yml` - Add to `PLAYLISTS` array

Populate: `curl -H "Authorization: Bearer $ADMIN_SECRET" "https://stablekraft.app/api/playlist/[id]?refresh=true"` — exactly `true`; any other value (`?refresh`, `?refresh=1`) is an ordinary read, not a refresh (`isForceRefresh` in `lib/admin-route-policy.ts`).

---

## Publisher Pages (`app/publisher/[id]/page.tsx`)
Matched by title slug, artist slug, or URL path. Multi-feed support with per-platform sections. Album resolution: (1) GUIDs/URLs from publisher feed XMLs → (2) `publisherId`-linked albums → (3) artist name matching. Do NOT re-add platform filters — they hide legitimate cross-platform albums.

**Section labels** use the publisher feed's URL for platform detection (not album URLs), so a self-hosted publisher feed referencing Wavlake-hosted albums shows "(henrikflyman.com)" not "(Wavlake)". **`linkAlbumsToPublisher`** only links albums with `publisherId: null` — already-linked albums are skipped. To re-link, use `PUT /api/feeds` with `{ id, publisherId }`.

**Phantom publisher IDs**: some albums have a `publisherId` that doesn't correspond to a feed record (e.g., Wavlake artist GUIDs auto-assigned during import). The publisher page creates synthetic feed info for these.

**Blacklist filtering** (`isNotBlacklistedFeed` in `page.tsx`, PR #156): the page queries the DB directly, so it must apply `isBlacklistedFeedId()`/`isBlacklistedFeedUrl()` itself — the middleware/import gates don't reach it. Filtered on all three feed sources (remoteItem/URL matches, `publisherId`-linked, and artist-name matches). Without this, blacklisted rows that still exist in the DB (e.g. Henrik Flyman's dead Wavlake mirrors) resurface here — most often under "More from Artist" via platform-blind artist-name matching — even though they're gone from the grid and search. This is a **targeted** reuse of the existing blacklist, NOT a platform filter (do not add a blanket "hide Wavlake" rule — see the cross-platform warning above). To hide a newly-surfaced mirror, add its URL to `BLACKLISTED_FEED_URLS`; it takes effect on the publisher page too.

**Henrik Flyman → hide all Wavlake** (page-scoped `keepFeed` + `isHenrikFlymanWavlakeMirror` in `lib/feed-exclusions.ts`): Wavlake keeps minting brand-new mirror feeds for Henrik (2026 releases like Unbreakable / Is This The End / The Writing's on the Wall / They Intend to Destroy Beauty) faster than their `/feed/music/<uuid>` URLs can be added to `BLACKLISTED_FEED_URLS`. He pulled **all** his music off Wavlake and self-hosts at henrikflyman.com, so on **his publisher page only** (`isHenrikFlymanPage`, matched by artist name or the `henrik-flyman` slug), `keepFeed` drops **every** `wavlake.com` feed regardless of its stored artist string — not just ones whose artist field exactly equals "Henrik Flyman" (mirrors sometimes carry a slightly different/empty artist). `isHenrikFlymanWavlakeMirror` (artist-scoped) still runs inside `isNotBlacklistedFeed` as a second layer. This is the **one sanctioned exception** to the no-platform-filter rule and it is **page-scoped to Henrik**; do NOT generalize it into a global "hide Wavlake" filter for other publishers.

---

## Podcasting 2.0 `<podcast:image>` Tag (since 2026-06-12)
The newer `<podcast:image>` tag ([spec](https://podcasting2.org/docs/podcast-namespace/tags/image), replaces deprecated `<podcast:images srcset>`) — multiple instances allowed at **channel and item** level, each with `href` (required) + `alt`/`aspect-ratio`/`width`/`height`/`type`/`purpose` (tokens: `artwork`, `canvas`, `circular`, `banner`, `social`, …). Stored as a `podcastImages Json?` array on **both** `Feed` and `Track` (migration `20260612000000_add_podcast_images_to_feed_and_track` — already applied to prod; remember the issue #122 Railway `db:migrate` gotcha for future columns).

- **Pure pickers live in `lib/podcast-images.ts`** (dependency-free on purpose — client components import it without pulling `rss-parser`/`fast-xml-parser` into the browser bundle). `lib/rss-parser-db.ts` re-exports them so existing server import sites keep resolving. Helpers: `pickSquareArtwork()` (1/1 → artwork/circular), `pickCanvasBackground(images, 'landscape'|'portrait')` (16/9 vs 9/16; prefers `purpose=canvas`, else any matching ratio, else `undefined` — never cross-stretch).
- **Parsing** (`lib/rss-parser-db.ts`): `parseChannel/ItemPodcastImagesFromXML` (regex over the channel block / per-item, reusing the generic `parsePersonAttrs`). Channel images ride on `ParsedFeed.podcastImages` (canonical source); item images on `ParsedItem.podcastImages`, applied by `applyParsedItemFields()`.
- **Write paths — there are three, keep them in sync** (the `persons`-style multi-path gotcha): (1) admin add `POST /api/feeds` writes `parsedFeed.podcastImages` at **all three** `feed.create`/`upsert` sites; (2) `app/api/admin/feeds/[id]/reparse` updates it (this is how an **already-existing** feed gets it — admin add's upsert `update` branch only touches `lastFetched`, like `image`/`v4v`); (3) `importFeedToDatabase` (`lib/feed-parsing.ts`, used by refresh-by-url / nightly) parses channel images from `xmlText`. **Prisma JSON typing**: assign with an `as any` cast (`PodcastImage[]` isn't a valid `InputJsonValue` — same trick `v4vValue` uses by being typed `any`).
- **Surfaced via API**: `albums-fast` (both dual selects + both mappings), `feeds/recent`, and `albums/[slug]` (both feed-backed album objects; `API_VERSION` bumped to `v15`).
- **Rendering — responsive canvas background** (`app/album/[id]/AlbumDetailClient.tsx`, shared by `/album/[id]` **and** `/podcast/[id]`): the full-bleed page background uses the 16:9 canvas on desktop / 9:16 on mobile via `pickCanvasBackground(album.podcastImages, isDesktop ? 'landscape' : 'portrait')`, falling back to `coverArt`. `isDesktop` is in the main effect's deps so it re-picks on a mobile↔desktop resize; the desktop preload effect preloads the landscape canvas. The square corner thumbnail always stays album art.
  - **Anti-flicker background cache**: the page passes `initialAlbum=null` and always fetches album data client-side, so each navigation remounts with `backgroundImage=null` → the default dark gradient flashed until the fetch resolved (worst when clicking through one artist's albums). Fixed with a **module-scoped** cache (`backgroundCacheById` + `lastShownBackground` in `AlbumDetailClient.tsx`, module scope survives client-side route remounts): the `backgroundImage` `useState` initializer seeds from this album's last-resolved art, else the previously-shown art as a hold-over. A sync effect writes `lastShownBackground` on every non-null background, but keys `backgroundCacheById[albumId]` **only once `album && !isLoading`** — otherwise a carried-over previous background would get cached under the new album's id. SSR renders `null` (empty cache on the server) and the client initializer also sees an empty cache on first load, so no hydration mismatch; the cache only kicks in on subsequent in-session navigations.
- **Legacy `image` fallback**: `importFeedToDatabase` backfills the single `Feed.image` from `pickSquareArtwork(...)` **only when** the feed otherwise has no image — so feeds shipping *only* `<podcast:image>` still get album art. Does not override an existing itunes/legacy image.
- Not yet wired: NowPlaying background and `circular`-as-avatar rendering (data is available, UI is a future task).

---

## Artwork size — four render paths, and three things that do not do what they say

Measured 2026-09-20 while building Data Saver. None of this is broken; all of it is expensive, and the
misleading parts are the reason nobody had added it up.

**How big it actually is.** Forty real catalog covers, through `AlbumCard`'s own resolution path:
a typical Wavlake cover is **2.0 MB at 1400x1400**, drawn in a 160-300px box. Through the optimizer at
`w=256&q=50` the same file is **5.5 KB** of AVIF. Across the 34 that Next can resize: 21,078 KB → 134 KB.

**There are FOUR artwork paths**, and a change to one reaches none of the others:
`components/AlbumCard.tsx` (its own `next/image`), `components/CDNImage.tsx` (+ `CDNImageLazy`),
`components/ArtworkImage.tsx`, and **33 raw `<img>` tags** across 20 files (`AdminPanel` alone has 7).
Anything about artwork size belongs in `artworkPlan()` (`lib/data-saver.ts`). The first three ask it; the raw
`<img>` tags do **not**, so they are unaffected by Data Saver and still ship the full original — including
hot ones like `NowPlayingBar` (a 64px box), `NowPlayingScreen`, and `PlaylistTemplateCompact`'s 32px/48px
track rows, where a 200-track playlist requests 200 full-size files. Known gap, not an oversight.

**`AlbumCard` cancels its own sizing.** It sets `width={300}`, `height={300}`, `loading="lazy"` and a correct
`sizes`, then adds `unoptimized` — so Next never resizes and every one of those hints is dead. `271a6ba8`
added the flag **deliberately**, to fix artwork that looked blurry. It is lifted only under Data Saver, which
is the user electing to take the softer image. The same hardcoded flag is at `app/favorites/page.tsx` (a 40px
avatar) and `app/publisher/[id]/PublisherDetailClient.tsx`.

**Phones get no optimization at all.** `CDNImage` branches on `isMobile` and renders a plain `<img>` instead of
`next/image` — the audience most likely to be on mobile data is the one that bypasses the optimizer.

Three things that read as if they shrink an image and do not:

- **`getAlbumArtworkUrl(url, size, …)` ignores `size` for real artwork** (`lib/cdn-utils.ts`). It picks a
  placeholder when the URL is missing, and otherwise returns the URL unchanged. **35 call sites** ask for
  `'thumbnail'` or `'medium'` — including 32px and 48px track rows in `PlaylistTemplateCompact` — and every one
  gets the full original. Known, not fixed.
- **`/api/proxy-image` never downsizes.** It streams the upstream bytes through. Its only `sharp` path is
  `enhance=true&minWidth=1920&minHeight=1080`, which **upscales** and re-encodes at JPEG q95, so it routinely
  returns *more* bytes than the original. That is the page backdrop — a second copy of the cover already on
  screen, which CSS then blurs by 4px. Data Saver drops it by passing `null` to
  `buildPageBackgroundStyle`, an already-supported state that cannot reopen #201.
- **`/api/gif-placeholder` cannot help the covers that need it.** It answers **413** above the 12 MB cap in
  `lib/safe-fetch.ts`, and both animated covers in the catalog are over it — `autumn.gif` is **21.0 MB** and
  `the satellite skirmish mku.gif` is **18.7 MB**. Worse, `CDNImage` fetches the still frame **and then the
  full animation anyway**, so outside Data Saver the placeholder has never saved a byte, only latency.
  Pre-converted `.mp4`/`.webm` for both exist in `data/optimized-images/` (`the-satellite-skirmish-mku.mp4`
  is 226 KB; `autumn.mp4` is 2.1 MB) and
  `GIF_TO_VIDEO_MAP` in `CDNImage` uses them — but `AlbumCard` renders an `<img>` and cannot. So an animated
  cover on the grid still ships whole, in either mode. Open.

**`/api/optimized-images/[filename]` does not resize either.** It serves the pre-baked file with a content
type; the `?w=&h=&q=&f=webp` parameters `CDNImage` builds for it are ignored.

---

## Episode/Play Count Markers
`<podcast:txt purpose="episode">` or `<podcast:txt purpose="playcount">` in XML. Parser decodes XML entities via `decodeXmlEntities()` in `lib/playlist/parser.ts`. Original titles stored in `SystemPlaylistTrack.episodeTitle` — do NOT reverse-engineer from episode IDs (lossy). Refresh: `curl https://stablekraft.app/api/playlist/[id]?refresh`
