---
name: feed-ingestion
description: "Use when working on how feeds get INTO the catalog: feed import, the podping consumer (msp-podping-service) and its four public endpoints, /api/feeds, /api/feeds/exists, /api/feeds/refresh-by-url, /api/feeds/opml, the shared feed-by-URL lookup ladder in lib/feed-lookup.ts, duplicate or encoding-variant feed rows, a reparse that reports success but writes nothing, a null Feed.guid that no reparse fills, missing podcast:guid / podcast:medium / podcast:publisher / categories, channel tags that sit after the <item>s, the nightly refresh-playlists.yml cron, targeted podcast reparse, playlist remoteItem resolution, or adding a new music podcast such as Upbeats or Two For Tunestr."
---

# feed-ingestion

How feeds get into the catalog: the podping consumer, the shared URL lookup ladder, the nightly cron, and RSS parsing gotchas. For hiding, blacklisting or deleting feeds see the `feed-curation` skill.

## Tests for this subsystem

```
npx tsx --test lib/url-utils.test.ts                # feed URL variants (podping ladder) + generateAlbumHref
npx tsx --test lib/rss-channel-metadata.test.ts     # channel tags found before AND after the <item>s
npx tsx --test lib/feeds/image-version.test.ts      # image URL versions + every path that writes one
npx tsx --test lib/feeds/refresh-coalescer.test.ts  # refresh-by-url per-feed window
```

---

## Two-Repo Setup
- **musicL-playlist-updater** - Generates playlist XML feeds
- **stablekraft-app** (this repo) - Consumes and displays playlists

---

## Daily Workflow (`.github/workflows/refresh-playlists.yml`)
Scheduled `0 9 * * *` (4 AM EST), but GitHub's cron drift is hours here — the runs of 2026-09-15 to 19 started between 12:49 and 14:06 UTC, so correlate logs by the run's real start time. Checks the admin secret (Step 1, the job's only fatal step — every later step just warns, so a mismatched `ADMIN_SECRET` would otherwise run green) → reparses feeds → refreshes playlists → parses publishers → imports missing albums from publisher feeds (Step 5b via PI API) → reparses each newly imported feed from its real RSS (Step 5c, driven by `importedFeedIds` in the Step 5b response). Step 5c exists because PI's episodes API doesn't surface `<podcast:episode>`/`<podcast:season>` ordering, chapters, or VTS — only the RSS has them. The `PLAYLISTS` array must include ALL playlist IDs — missing ones won't get nightly processing. Step 1 used to be `GET /api/playlist-cache?refresh=all`, which refreshed nothing: its self-fetch of `/api/playlist/<id>?refresh=true` failed to connect ("fetch failed" for all four playlists on every run checked) and sent no secret, while the job printed ✅. It is now a plain `GET /api/playlist-cache` auth probe, and `?refresh` there answers 410. Refresh a playlist only via `/api/playlist/<id>?refresh=true` with the bearer token.

---

## Podping Consumer Integration
External service `msp-podping-service` (repo `ChadFarrow/msp-podping-service`) tails Hive for `pp_music_*` / `pp_podcast_*` podpings. For each ping the consumer (`consumer/src/index.ts:handleIri`) calls `/api/feeds/exists`; if it exists, calls `/api/feeds/refresh-by-url` **regardless of signer**. Only `/api/feeds` (new-feed minting) is gated to signer=`chadf` via `fromMsp` check in the consumer.

Four public endpoints (intentionally exempt from the `ADMIN_SECRET` middleware gate — see Admin API Auth below; consumer-side auth only). `refresh-by-url` is rate-limited 30 req/min/IP (in-memory, per Railway instance):
- `GET /api/feeds/exists?url=<URL>` or `?guid=<GUID>` → `{ exists: boolean }`. Blacklisted URLs always return `false` (reuses `isBlacklistedFeedUrl()` from `lib/feed-exclusions.ts`). URL lookup delegates to the shared ladder in `lib/feed-lookup.ts` (see below). The `?guid=` branch is a plain `Feed.guid` query and doesn't use the ladder.
- `POST /api/feeds/refresh-by-url` with `{ originalUrl }` — same shared ladder, then a primary-key `findUnique` for the full row. **Does NOT mint new feeds** unless caller passes explicit `feedId` in body (guards against rogue unauthed POSTs creating garbage rows). Must stay fast + idempotent. Current `feedId` callers: LNURL and Podtards test-feed buttons in `AdminPanel.tsx`.
- `POST /api/feeds` with `{ originalUrl, type: 'album' }` — **consumer-gated to signer=`chadf`** (only our MSP can mint new feed records). Stranger podpings drop at the consumer's `!exists && fromMsp` branch. Server-side has no auth. Its pre-existence 409 check uses the **same shared ladder** — this is the endpoint that mints, so a lookup narrower than the consumer's `exists` check turns a case-variant URL into a duplicate row. The two `feed.upsert` `where: { originalUrl: normalizedOriginalUrl }` clauses below it are only reached when the ladder found nothing — leave them exact.
- `GET /api/feeds/opml?type=<album|podcast|publisher>&grouped=<false>` → OPML 2.0 XML of every active, non-blacklisted feed. Filters `BLACKLISTED_FEED_IDS`/`BLACKLISTED_FEED_URLS` (does **not** filter `PLAYLIST_SOURCE_FEED_URLS`). 15-min in-memory cache keyed off full feed list; `type` filter applies in-memory. `?refresh=true` bypasses.

**Shared feed-by-URL lookup ladder (`lib/feed-lookup.ts`)** — `findFeedIdByUrl(...urls)` returns `{ id, matchedVia }` or null. Three rungs, and the **order is load-bearing**:
1. Exact `originalUrl` match on any variant from `buildFeedUrlVariants()` (pure, in `lib/url-utils.ts`, tested by `npx tsx --test lib/url-utils.test.ts`) — normalized form first, raw form when it differs. Uses the `@unique` btree index.
2. **Loose** match — `mode: 'insensitive'` over `buildFeedUrlLooseVariants()`, so it is case- *and* encoding-insensitive in one query. Logs `🔠 feed-lookup:` on hit. Two dimensions, both of which produced silent duplicate mints:
   - **Case** — `normalizeUrl` lowercases the hostname but leaves **path and query casing alone**, and self-hosted hosts have no UUID for rung 3, so for them exact-string was the only signal (`headstarts.uk` mixes conventions: `/msp/nat-hills-music/Nat_Hills_Music.xml` vs `/msp/Nathan Abbott/…`). RFC 3986 does treat paths as case-sensitive; accepted deviation, since rung 1 still wins whenever both rows exist.
   - **Encoding** — `buildFeedUrlLooseVariants` adds a **percent-decoded** form (path/query/hash only; the origin is never decoded, so a `%2F` can't rewrite the host). Only the decode direction is new — `normalizeUrl` already encodes an incoming literal space to `%20`. It's needed because ~69 rows store `originalUrl` with **literal spaces**, written by the paths deliberately left off the ladder, so a podping broadcasting the correct `%20` form couldn't see them. That minted **17 duplicate rows** (deleted 2026-07-25) before it was caught; the gap survived PR #172, which closed only the case dimension.
3. `extractUuidFromUrl()` → `Feed.guid`/`Feed.id`. **Keep this** — without it, Podhome podpings for UpBeats (broadcasts `serve.podhome.fm/rss/<uuid>` while DB stores `feeds.rssblue.com/upbeats`) silently no-op.

Three callers: `exists`, `refresh-by-url`, `POST /api/feeds`. **Do not re-inline the ladder into a route** — it used to be copy-pasted into the first two and the divergence caused the Podhome/UpBeats silent-skip bug. **Rung 1 must stay exact on `buildFeedUrlVariants`** — folding the loose variants into its `IN` list would make `findFirst` pick arbitrarily between two rows that differ only by case or encoding, instead of each resolving to itself. No index backs rung 2 (a case-insensitive compare can't use the btree, so it's a seq scan over ~4.5k rows) — deliberate, to avoid the issue #122 Railway `db:migrate` gotcha; it only runs after rung 1 misses and `refresh-by-url` is capped at 30 req/min/IP. `isBlacklistedFeedUrl()`/`isPlaylistSourceFeedUrl()` compare over the same lowercased loose-variant set and **must stay in sync** with rung 2 — otherwise a URL can be un-findable as an existing feed yet still not recognized as blacklisted. Feed-by-URL lookups elsewhere (admin tooling, bulk-import, playlist import, `lib/feed-discovery.ts`) are intentionally **not** on the ladder — which is *why* rows keep arriving un-normalized and the decode rung has to exist.

When modifying these endpoints, check consumer expectations in `msp-podping-service/consumer/src/index.ts` — if adding auth, wire a shared-secret env var into the consumer too.

**What the consumer does with our answer** (read 2026-09-26 at `7758531`): it retries only a network error or a 5xx (0 s, 2 s, 8 s); **any other status — 202 and 429 included — is logged as `refresh <status>` and treated as done**. So a 429 from `refresh-by-url` LOSES that update until the nightly job. It de-duplicates only by Hive transaction id, in memory, and rewinds 200 blocks (~10 min) on every restart, so a restart replays recent podpings. It awaits each refresh in sequence with no timeout, so one slow refresh holds the whole stream. A podping that names the feed as `podcast:guid:<guid>` instead of a URL is **skipped** for existing feeds (`no URL variant in podping; skip refresh`).

**Anyone can podping any feed, so `refresh-by-url` has a per-feed window** (`lib/feeds/refresh-coalescer.ts`, 5 min). A request inside a feed's window, or while its refresh runs, answers **202 `{ queued: true, runAt }`** and arms ONE trailing refresh at the window end; further requests join it. A burst costs one refresh per window and a real second update is still read — a plain skip would drop it, and a 429 would too (see above). An authenticated admin (secret set AND matched — `checkAdminAuth` alone fails open) bypasses the window. In memory, per process. The trailing run calls `refreshFeed()` directly — never a self-fetch of the route.

**An image can change at the SAME URL, so the refresh versions image URLs** (`lib/feeds/image-version.ts`). An artist can replace a cover in place and podping from podping.me without MSP running (Hip-Hop Taoist, 2026-09-26: the album showed the old cover for as long as `/_next/image` held it). `refresh-by-url` and `admin/feeds/[id]/reparse` ask the image host — `HEAD` for `ETag`/`Last-Modified`, else a capped GET and a hash of the bytes, always through `safeFetch` — and write `…?skv=<8 letters a-p>` into `Feed.image` and every `Track.image` (existing and new). A new URL is what makes every cache refetch. **The podping is never an input**: it can cause a re-read, only the host can change a version. Letters only because `getAlbumArtworkUrl` turns any URL containing `404` into a placeholder. Skipped: Wavlake hosts, Blossom (64-hex hash in the path), signed URLs, our own. Keep-on-failure: a host that cannot answer keeps the stored version. **Every other path that overwrites an existing feed image** — nightly `admin/reparse-feeds`, `feeds/[id]/refresh`, `refresh-all-feeds`, `importFeedToDatabase` and `parse-feeds-stream` (Podcast Index images) — calls `preserveImageVersion` and does **not** ask the host (decided 2026-09-26: ~1,000+ host requests a night; the 1-day `/_next/image` TTL covers an un-podpinged swap). Without that guard each of them writes the plain URL back and the URL flips every night. `lib/feeds/image-version.test.ts` scans all seven paths. Offline covers are keyed without the version (`coverCacheKey`). **Compare a stored image URL with a feed's only after `stripImageVersion`.**

**Host latency summary:** Fountain ≈ real-time via podping; Wavlake + self-hosted music sites = nightly 4 AM reparse only. Full per-host table and HafSQL provenance in `reference_podping_host_coverage.md` memory.

---

## Targeted Podcast Reparse (`.github/workflows/refresh-podcasts-targeted.yml`)
Every 30 min from 11:00–13:59 UTC on Sundays (UpBeats) and Tuesdays (Two For Tunestr) — the observed publish windows (7 AM Eastern year-round, UTC shifts ±1h on DST). Belt-and-suspenders safety net for consumer outages or Podhome emission gaps; catches new episodes within ~30 min of publish. Day-of-week check inside the workflow means off-day cron ticks early-exit at zero cost. When adding a curated podcast with a predictable publish schedule, update both this file's `PODCAST_FEEDS` array (and day switch if a new weekday) **and** `refresh-playlists.yml` Step 2b.

---

## Playlist Resolution
Playlists use `<podcast:remoteItem>` with `feedGuid` + `itemGuid`. On `?refresh=true` (admin-only): discover feeds via PI API → parse → discover publishers → resolve tracks. Resolution rate ~80-90%.

**Feed deduplication pattern**: multi-check dedup (normalized URL, raw URL, feedGuid as ID, feedGuid as GUID column, feedGuid-in-URL substring, then secondary `podcastGuid` check). New feeds get slug-based IDs via `generateAlbumSlug`. When modifying feed import code, follow this pattern — weak dedup causes duplicate entries.

**Podcast type detection**: Non-Wavlake feeds with `<podcast:medium>podcast</podcast:medium>` auto-detect as `type: 'podcast'` on import. Wavlake feeds are excluded (they use `medium=podcast` for music). Feeds with `type: 'podcast'` auto-appear under the Podcasts filter (direct `type='podcast'` query bypassing the blacklist) and hide from the album grid. **`POST /api/admin/fix-podcast-types` flips `type: 'podcast'` → `'album'` for any feed NOT in the curated `PODCAST_FEED_IDS`/`PODCAST_FEED_URLS` allowlist** (`lib/podcast-feeds.ts`) — use to clean up misdetected podcasts, NOT to promote albums (use admin Podcast dropdown for that).

**PI API status gotcha**: `normalizeFeedResponse` in `lib/podcast-index-api.ts` must accept both `status: 'true'` (string) and `status: true` (boolean). Use `data.status !== 'true' && data.status !== true` for rejection checks.

**Podroll exclusion**: `process-remote-items/route.ts` strips `<podcast:podroll>` before extracting `<podcast:remoteItem>` tags — without this, podroll-referenced feeds get imported as albums.

---

## Channel-level tags may sit AFTER the `<item>`s (`channelMetadataXml`, `lib/rss-parser-db.ts`)
**Element order inside `<channel>` is unconstrained by RSS, and real feeds use both layouts** — the MSP-generated music feeds put `<podcast:guid>`, `<podcast:medium>` and friends *after* the last item (measured on a live feed: guid at byte **17041**, first `<item>` at **664**). Four readers used to take `channelContent.split(/<item[\s>]/)[0]` — everything before the first item — and so returned **nothing at all** for those feeds: `parsePodcastGuidFromXML` (→ `Feed.guid`), `parsePodcastMediumFromXML` (→ album-vs-podcast typing), the `<podcast:publisher>` reader (→ publisher detection), and `parsePodcastCategoriesFromXML`.

- **It fails silently and looks like the feed's fault.** The parse succeeds; the feed simply appears to declare no guid, no medium, no categories. A feed that clearly ships `<podcast:medium>music</podcast:medium>` reads as declaring nothing.
- **The tell is a reparse that reports success and changes nothing.** Seven feeds sat with a null `Feed.guid` no reparse could fill — each one returned `success: true` and wrote no guid, because the parser never found one. If a reparse "works" but the column is still null, suspect this before suspecting the data.
- All four now go through **one** `channelMetadataXml` helper that **strips `<item>…</item>` blocks** rather than slicing at the first one. Correct for both layouts, and it still can't pick up an item-level tag. An **unclosed `<item>`** falls back to the old pre-item slice — narrower, but never wrong. Adding a fifth channel-level reader? Use the helper.
- Tests: `npx tsx --test lib/rss-channel-metadata.test.ts` (before/after/interleaved, item-level tag ignored, unclosed-item fallback). Pinned because the failure is invisible — the mutation that restores the old slice fails only the after-items cases.

**Setting a guid can still fail on `@unique`.** `Feed.guid` is unique, so if a duplicate row already holds it the update throws `Unique constraint failed on the fields: (guid)` and the reparse 400s. Both cases found were **empty duplicates** (0 tracks, 0 favorites) minted from the `%20` form of a literal-space URL, holding the guid the real row needed; the fix was `DELETE /api/feeds?id=<empty row>` then reparse. Note these were created **2026-07-25/26, after the PR #173 ladder fix** — so something still mints encoding-duplicate pairs; the ladder covers *lookups*, not whatever creation path this is.

---

## `Feed.medium` — what the feed declared, as opposed to what we concluded

`<podcast:medium>` was parsed for years and thrown away: `parsePodcastMediumFromXML` ran, picked a `Feed.type`, and nothing kept the value. It has a column now because the cross-app favorites list publishes it at tag position 4 — that is how another app tells a music album from a talk show without resolving every entry (`favorites-cross-app`).

- **NULL means "the feed didn't say", and nothing may default it.** Not from `Feed.type`, which defaults to `"album"` and is therefore a guess for anything that never declared. A guess written here reaches the shared Nostr list, where it is **sticky**: no other app will correct it, and by the format's own rules this one may not either. Leaving it NULL costs a missing hint; filling it wrongly costs every app that reads the list.
- **Ten paths create or upsert a `Feed`; nine of them dropped the medium** on the first pass at this. The ones that carry it now: `lib/feed-parsing.ts` (`importFeedToDatabase` — playlist resolution and podping ingest), `app/api/feeds/route.ts` (×3, including the guid-collision retry upsert and the auto-discovered publisher feed), `feeds/refresh-by-url` (×3), `feeds/[id]/process-remote-items`, `lib/album-import.ts`, `lib/auto-populate-feeds.ts`, `lib/publisher-discovery.ts`, `admin/feeds/import-from-pi`, plus the four reparse **updates** (`admin/reparse-feeds`, `admin/feeds/[id]/reparse`, `admin/feeds`, `admin/refresh-all-feeds`) — which is what makes the nightly cron a backfill.
- **The re-key path in `refresh-by-url` is the dangerous shape.** It deletes a row and recreates it under a new id from a field-by-field copy, so a column absent from that list is *discarded*, not merely unset. Any new `Feed` column has to be added there too.
- **The other nine creation sites are deliberately left alone** (`music-tracks/*`, `import-missing-feeds`, `populate-feeds`, …). They mint placeholder rows from shapes that carry no medium; a reparse fills the column later.
- **Backfill: `scripts/backfill-feed-medium.ts`** (dry run by default, `--apply` to write, `--limit N`, reruns are free — it selects `medium IS NULL`). Two passes: Podcast Index first, then the feed itself for anything PI couldn't answer, through the same `parsePodcastMediumFromXML` — **except on Wavlake, which is PI-only** per the stack rule in CLAUDE.md. Run on production 2026-08-13: **4,409 of 5,003 (88%)**.
- **What stays NULL is neither dead feeds nor feeds missing the tag** — that guess was wrong twice before it was measured. Of the 594: **501 are `type=publisher`**, 500 of them Wavlake *artist* feeds, which PI does not index in any URL form (`Feed url not found` for `/feed/artist/<uuid>`, with or without `www`, slash, or the `/feed/` form) — it indexes the album feeds beneath them instead. The other 93 PI knows by URL but answers **`This feed has no meta-data yet`**, by guid and by url alike. Genuinely dead (404/403): **17**. Serve XML and declare no medium: **2**. The publisher rows matter least of all, since publisher favorites never reach the shared list (`UNSYNCED_FAVORITE_TYPES`).
- **Podcast Index rate-limits harder than a short trial reveals.** Four unpaced workers passed a 25-feed run and then took HTTP 429 on **3,270 of 5,003**. Pacing at 4/s failed the same way but *invisibly*: Cloudflare fronts the API and answers `retry-after: 9`, so every worker sat in backoff while the process looked alive and the log looked like progress. **1 req/s, single worker**, and let a 429 slow the whole run rather than one request.
- **Hosts rate-limit too, and "lots of different hosts" is worth checking before relying on it.** The fallback pass was written as if it fanned out over hundreds of origins; 573 of the 594 feeds it existed for were one host. Wavlake answered 429 to four-at-a-time, the pass recorded that as "refused", and a classification run at six-at-a-time reported 531 feeds unreachable that were fine. It now paces **per host** and never asks Wavlake at all.

---

## Adding Music Podcasts (like Upbeats, Two For Tunestr, B4TS)
Import via `/admin` (paste RSS URL). Non-Wavlake feeds with `<podcast:medium>podcast</podcast:medium>` automatically get `type: 'podcast'`, appear under the Podcasts filter, hide from the album grid, and are searchable — no config edits needed. `/podcast/[id]` dynamic route handles display.

**If the feed is also a playlist source** (B4TS, MMM, HGH, LT, Upbeats, IAM, ITDV, Two For Tunestr): it's in `PLAYLIST_SOURCE_FEED_URLS`, which blocks nightly auto-import but leaves admin add open. After import, register it as a curated podcast in `lib/podcast-feeds.ts`: add to `PODCAST_FEED_IDS` + `PODCAST_FEED_URLS` so `fix-podcast-types` can't flip it back to album, plus `PODCAST_SLUGS` + `PODCAST_SLUG_TO_FEED_ID` + `PODCAST_CANONICAL_SLUGS` to redirect `/album/<slug>` → `/podcast/<canonical-slug>`.

**Slug redirects**: if the auto-generated feed ID differs from the desired URL slug (e.g., `silvie-two-for-tunestr` vs `two-for-tunestr`), add mappings to `PODCAST_SLUG_TO_FEED_ID` and `PODCAST_CANONICAL_SLUGS`.

**After import**: reparse from the admin page to ensure chapters and VTS are populated (initial import may miss them if the chapters proxy is down).
