# The Nightly Refresh

## Overview

There is **no in-app cron endpoint and no `CRON_SECRET`.** Everything scheduled runs as a GitHub
Action that curls the production app with the admin bearer token.

The main job is [`.github/workflows/refresh-playlists.yml`](../.github/workflows/refresh-playlists.yml),
which despite its name does far more than refresh playlists — it is the nightly catalog maintenance
pass. It runs at **`0 9 * * *`** (9 AM UTC / 4 AM EST) and can be triggered by hand with
`workflow_dispatch`.

### Auth

```yaml
BASE_URL:    ${{ secrets.PLAYLIST_BASE_URL || 'https://stablekraft.app' }}
AUTH_HEADER: "Authorization: Bearer ${{ secrets.ADMIN_SECRET }}"
```

Most steps hit `/api/admin/*` or the gated maintenance routes, so `ADMIN_SECRET` must match the
value in Railway. `checkAdminAuth` fails open while the server-side variable is unset, which is why
the workflow keeps working before the secret is configured — and why setting it on only one side
breaks the whole job at once.

## What the job actually does

| Step | Endpoint | Purpose |
|---|---|---|
| 1 | `GET /api/playlist-cache` | Auth probe: fails the job if `ADMIN_SECRET` doesn't match Railway's. Until 2026-09-19 this was `?refresh=all`, which refreshed nothing — see below |
| 2 | `POST /api/admin/reparse-feeds?type=all&maxAgeHours=24&limit=5000` | Reparse all music feeds to pick up new tracks — runs **before** the playlist refresh, so new tracks exist by the time playlists resolve |
| 2b | `POST /api/admin/feeds/{id}/reparse` | Per-feed reparse for the curated music podcasts (UpBeats, Two For Tunestr) — they're blacklisted from album view, so the bulk pass skips them |
| 2c | `POST /api/admin/fix-stale-vts` | Repair value-time-split rows with empty remoteItem GUIDs left by pre-entity-fix parsing |
| 2d | `POST /api/admin/fix-feed-status` | Flip feeds stuck at `status='error'` back to active when they still have tracks. A transient fetch hiccup in step 2 sets `error` and nothing else clears it, so the feed silently vanishes from the grid |
| 2e | `POST /api/admin/backfill-oldest-pubdate` | Backfill `Feed.oldestItemPubdate`. Read paths resolve the release date as `oldestItemPubdate \|\| createdAt`, so a null column makes a feed report the date it was *added* as its release year (issue #169) |
| 3 | `GET /api/playlist/{name}?refresh=true` | Refresh each playlist with full RSS parsing, including V4V data |
| 4 | `POST /api/playlist/parse-feeds` | Parse newly discovered feeds, 50 at a time, looping up to 10 times or until nothing new is parsed |
| 5 | `POST /api/parse-feeds?action=parse-publishers` | Parse publisher feeds and link albums |
| 5b | `POST /api/admin/publishers/import-albums` | Import albums referenced by publisher feeds but missing locally |
| 5c | `POST /api/admin/feeds/{id}/reparse` | Reparse each feed created in 5b from its real RSS — the PI API misses `podcast:episode`/`podcast:season` ordering, chapters and VTS. Scoped to feeds created this run, so fetch volume stays low |
| 5d | `POST /api/admin/artists/import-new-albums` | Import new albums from artists with no publisher feed (self-hosted sites), paginated 50 at a time. Only imports when the host matches one the artist already uses |
| 6 | `GET /api/playlist/{name}?refresh=true` | Final playlist refresh, so newly parsed tracks land in `SystemPlaylist` |
| 7 | `DELETE /api/admin/diagnostics?olderThanDays=30` | Prune old boost failures and client error reports |

Steps 2 through 7 are all non-fatal — a failure logs a warning and the job continues. Only step 1
exits non-zero, which is why it exists: with a mismatched secret every later step would log a 401
warning and the run would still go green.

**Step 1 used to be `?refresh=all`, and it never did anything.** The route re-fetched
`/api/playlist/<id>?refresh=true` (for iam, mmm, itdv, hgh) on its own origin. In production that
fetch failed to connect — `"error": "fetch failed"` for all four, on every run checked (2026-09-17 to
19) — and it sent no `Authorization` header, so it would have got 401 anyway. The route still
answered 200 with `"success": true` at the top level, so the job printed ✅. It was also redundant:
Step 3 and Step 6 refresh all twelve playlists, and Step 1 ran before Step 2's reparse. The refresh
branch is gone; `?refresh` on `/api/playlist-cache` now answers 410 and names the right call.

## The playlist roster

The workflow's `PLAYLISTS` array is the operative list:

```
hgh  mmt  sas  mmm  iam  itdv  b4ts  upbeats  flowgnar  lt  tft  greatest-hits
```

That is **12**. There are 13 playlist routes under `app/api/playlist/` — `top100` has a route and a
page but is not in the nightly array, so it is not refreshed by this job.

When adding a playlist, add it to this array too, or it will only ever refresh on a cache miss.

## Manual refresh

A single playlist:

```bash
curl -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://stablekraft.app/api/playlist/hgh?refresh=true"
```

`?refresh=true` is gated by `middleware.ts` — public reads of `/api/playlist/*` stay open, but the
expensive refresh variant requires the bearer token.

All of them: loop over the `PLAYLISTS` array above with the same call, or re-run the whole job from the Actions tab via **Run workflow** (`workflow_dispatch`).

## The other scheduled jobs

| Workflow | Schedule | Purpose |
|---|---|---|
| `refresh-artists-targeted.yml` | `0 */3 * * *` — every 3 hours | Targeted artist feed refresh |
| `refresh-podcasts-targeted.yml` | `15,45 11,12,13 * * 0,2` — Sun & Tue | Targeted music-podcast reparse, for shows that publish on a known schedule |
| `check-dead-feeds.yml` | `0 10 * * 1` — Mondays | Sweep for feeds that no longer resolve; see the `feed-curation` skill |

Near-real-time ingestion does not come from any of these — it comes from the podping consumer
pushing to `POST /api/feeds/refresh-by-url`. The nightly pass is the safety net for hosts podping
doesn't cover. See the `feed-ingestion` skill for the host coverage table.

## Troubleshooting

**A playlist isn't updating.** Check whether it's in the `PLAYLISTS` array above — `top100` isn't.
Then refresh it by hand with `?refresh=true` and read the response rather than the page, since the
client also caches.

**The whole job fails at step 1.** `ADMIN_SECRET` in GitHub secrets doesn't match Railway. Every
later step logs a warning and continues, so a mismatch shows up as step 1 failing and everything
after it reporting HTTP 401 warnings.

**A feed disappeared from the grid overnight.** Likely a transient fetch failure flipped it to
`status='error'`. Step 2d exists for exactly this and runs on the next pass; to fix it now, call
`POST /api/admin/fix-feed-status`.

**An album shows the wrong year.** `Feed.oldestItemPubdate` is null and the read path fell back to
`createdAt`. Step 2e backfills it; see the `catalog-display` skill for the seven read paths involved.
