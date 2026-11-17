# Stablekraft

A Next.js application for discovering, organizing, and streaming music from Podcasting 2.0 RSS feeds, with Value4Value (V4V) Lightning Network payments and Nostr identity.

## Overview

Stablekraft ingests music from podcast RSS feeds via the Podcast Index API, stores them in PostgreSQL, and provides album browsing, curated playlists, offline downloads, and Bitcoin Lightning payments direct to artists.

### Tech Stack

- **Next.js 15** (App Router), **React 18**, **TypeScript**
- **Prisma** with **PostgreSQL**
- **PWA** (`next-pwa`) plus a **Capacitor** Android build distributed via zapstore
- **Nostr** for identity (NIP-07 / NIP-46 / NIP-55), favorites sync, and social features
- **WebLN / NWC / LNURL** for Lightning payments

> Feed data comes from the **Podcast Index API** for all lookups and resolution. Do not fetch
> directly from Wavlake — go through the PI API.

## Project Structure

```
app/
├── page.tsx                 # Homepage with album discovery
├── about/                   # About page
├── album/[id]/              # Album detail pages
├── podcast/                 # Music-podcast (show) pages
├── publisher/[id]/          # Publisher pages (official + matched albums)
├── playlist/                # Curated playlist views
├── music-tracks/            # Track browsing
├── favorites/               # User favorites (albums/tracks/publishers/playlists)
├── downloads/               # Offline downloads
├── offline/                 # Offline fallback shell
├── search/                  # Fuzzy search with typo tolerance
├── library/                 # User library
├── radio/                   # Radio mode
├── sandbox/, test-amber/    # Dev-only pages — notFound() when NODE_ENV=production
├── admin/                   # Admin panel (npub whitelist via /api/admin/verify)
├── settings/                # User settings
└── api/                     # 183 API routes

lib/
├── auth/                    # Signed session cookie, requireUser
├── lightning/               # Lightning Network integration
│   ├── webln.ts            # WebLN provider
│   ├── lnurl.ts            # LNURL support
│   ├── value-splits.ts     # V4V payment splits
│   └── fountain.ts         # Fountain address handling
├── nostr/                   # Nostr integration
│   ├── signer.ts           # NIP-07 / NIP-46 / NIP-55 signing
│   ├── favorites.ts        # Per-item favorites (kind 30001/30002)
│   ├── favorites-single-list.ts  # Cross-app shared list (kind 10333)
│   ├── favorites-sync-client.ts  # Publish, pull, merge, sync health
│   ├── pc20-identifiers.ts # NIP-73 podcast:guid / podcast:item:guid
│   ├── relay-read.ts       # Trusted replaceable-event read
│   ├── community-favorites.ts    # Community tab
│   ├── nwc-backup.ts       # Encrypted NWC wallet backup on Nostr
│   ├── publish-queue.ts    # Debounced Nostr event publishing
│   ├── playlist-events.ts  # Kind 34139 playlist publishing
│   └── relay.ts            # Relay connection management
├── downloads/               # Offline download manager, IndexedDB + Cache API
├── caches/                  # In-process and persisted caches
├── playlist/                # Playlist configuration & resolution
├── music-track-parser/      # Track extraction from feeds
├── rss-parser/              # RSS feed parsing
├── feed-lookup.ts           # Shared feed-by-URL lookup ladder
├── feed-parsing.ts          # Feed import & track parsing
├── feed-exclusions.ts       # Blacklists and playlist source feeds
├── url-security.ts          # SSRF guard (isSafePublicUrl)
├── monitoring.ts            # Server-side warn/error reporting
├── fuzzy-search.ts          # pg_trgm fuzzy matching
└── podcast-index-api.ts     # Podcast Index API client

contexts/
├── AudioContext.tsx         # Playback state and the audio elements
├── BatchedFavoritesContext.tsx  # Favorite-status cache
├── DownloadsContext.tsx     # Offline downloads
├── LightningContext.tsx     # Wallet connection
├── NostrContext.tsx         # Signer and identity
└── SessionContext.tsx       # Anonymous + authenticated session

components/
├── Lightning/               # Boost button, boost modal, wallet picker
├── Nostr/                   # Nostr auth & social components
├── favorites/               # Favorite buttons, shared-list notice & disclosure
├── downloads/               # Download controls
├── admin/                   # Feed management interface
├── Radio/, Settings/
├── NowPlayingBar.tsx        # Audio player controls
└── AlbumCard.tsx            # Album display cards
```

## Features

### Music Discovery
- Album, EP, single and publisher browsing with artwork
- Music-podcast (show) pages for feeds where a DJ plays other artists' tracks
- Publisher pages showing official releases and artist-matched albums
- Fuzzy search with typo tolerance (`pg_trgm`)
- Automated feed discovery from playlists via the Podcast Index API
- Near-real-time ingestion via a podping consumer, plus a nightly reparse

### Curated Playlists

12 playlists in Podcasting 2.0 musicL format:

`b4ts` · `flowgnar` · `greatest-hits` · `hgh` · `iam` · `itdv` · `lt` · `mmm` · `mmt` · `sas` · `tft` · `upbeats`

Each has a `/api/playlist/<name>` route (most also have a `-fast` variant) and a page under
`app/playlist/<name>/`.

### Audio Playback
- Streaming player with shuffle and repeat
- Background playback; iOS lockscreen and Android MediaSession controls
- Value time splits (VTS) — segment playback and chapter ticks

### Offline
- Download tracks and albums for offline listening (Cache API + IndexedDB)
- Manual Offline mode toggle

### Value4Value Payments
- Lightning boosts to artists via WebLN, NWC, and LNURL-pay
- Payment splits per the `podcast:value` spec
- AutoBoost on track end and on VTS segments
- Keysend fallback discovery from Lightning Addresses, for Helipad metadata
- BoostBox metadata for LNURL payments (which can't carry TLV records)
- Encrypted NWC wallet backup on Nostr

### Nostr Integration
- Login via NIP-07 (browser extension), NIP-46 (remote signer / Amber, Primal),
  NIP-55 (Android), or NIP-05 read-only
- Favorites published as per-item **kind 30001 / 30002** events (NIP-51), which feed the Community tab
- A separate **cross-app shared list at kind 10333** that other Podcasting 2.0 apps read
  (allowlist-gated; see [`docs/pc20-favorites.md`](docs/pc20-favorites.md))
- Zaps, follows, profile, and "now playing" shares

### Favorites System
- Anonymous session-based favorites (no account required)
- Favorite tracks, albums, publishers and playlists
- Persistent storage in PostgreSQL; synced to Nostr when signed in

### Admin
- Feed management, reparse, dead-feed sweep, orphan cleanup
- Diagnostics panel for boost failures and client error reports

## Environment Variables

[`.env.example`](.env.example) is the manifest — copy it to `.env.local` and fill it in.
`npm run check-env` validates one against the other, and `postinstall` runs it.

**Every uncommented key in `.env.example` is required and must be non-empty**; optional settings
are listed there as comments, which is what makes them optional. Adding a required variable means
adding it there, not only here.

```bash
# Database
DATABASE_URL="postgresql://..."

# Podcast Index API — all feed lookups go through this
PODCAST_INDEX_API_KEY="your_key"
PODCAST_INDEX_API_SECRET="your_secret"

# Auth — both live in Railway env + .env.local only, never committed
SESSION_SECRET="..."          # signs the session cookie; requireUser fails open without it
ADMIN_SECRET="..."            # bearer token gating /admin and /api/admin via middleware.ts
ADMIN_NPUBS="npub1...,npub2..."

# Base URL
NEXT_PUBLIC_BASE_URL="https://yourdomain.com"

# Nostr
NEXT_PUBLIC_NOSTR_RELAYS="wss://relay1.com,wss://relay2.com"

# Cross-app shared favorites (kind 10333) — off unless a pubkey is allowlisted
NEXT_PUBLIC_SHARED_FAVORITES_PUBKEYS=""   # npub or hex, comma-separated
SHARED_FAVORITES_APPLY_DELETES="false"    # the only destructive write; snapshot first
SHARED_FAVORITES_IMPORT_UNKNOWN="false"   # mint Feed rows from another app's list

# Lightning
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS="..."
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY="..."
BOOSTBOX_URL="https://boostbox.cloud"
BOOSTBOX_API_KEY="..."

# Optional
ENABLE_SERVER_SIDE_FETCH="false"
NEXT_PUBLIC_LOG_LEVEL="warn"
```

> **`NEXT_PUBLIC_*` values bake in at build time.** Set them *before* the deploy that should use
> them — changing one afterwards has no effect until the next build.

## Development

```bash
npm install
npm run dev
```

### Database

```bash
npm run db:generate      # prisma generate
npm run db:migrate:dev   # create + apply a migration locally
npm run db:studio        # Prisma Studio
```

Use migrations rather than `prisma db push` — `prisma/migrations/` is what production applies, and
a pushed schema silently diverges from it.

### Build

```bash
npm run build
npm start
```

> **Stop `npm run dev` before running `npm run build`.** Both write `.next/`, so building over a
> live dev server replaces the chunks its client already fetched and every asset request 400s.
> Recovery: kill dev, `rm -rf .next`, `npm run dev`.
>
> A production build also writes `public/sw.js` and `public/workbox-*.js`, which Next serves
> statically **even in dev** — so a phone that registered the service worker keeps getting stale
> HTML and CSS over the LAN. Delete both files after any local build you didn't intend to deploy.

### Testing

There is no jest or vitest. Tests are `node:test` run through `tsx`:

```bash
npm run test:all     # tsx --test lib/*.test.ts lib/*/*.test.ts
npm run typecheck    # tsc --noEmit
npx next lint
```

CI (`.github/workflows/ci.yml`) runs all three on every push to `main` and every pull request.

> The `lib/*.test.ts lib/*/*.test.ts` glob does **not** recurse further, so tests nested deeper
> than one directory are not picked up.

## API Endpoints

Roughly 190 routes under `app/api/`. The ones worth knowing:

### Feeds
- `GET/POST/PUT/DELETE /api/feeds` — feed CRUD
- `GET /api/feeds/exists` — lookup by URL
- `POST /api/feeds/refresh-by-url` — re-key and reparse a feed by its URL
- `GET /api/feeds/opml` — OPML export

### Albums & Tracks
- `GET /api/albums-fast` — album listing with caching (the homepage's source)
- `GET /api/albums/[slug]` — album details
- `GET /api/music-tracks` — track queries

### Favorites
- `GET/POST /api/favorites/albums`, `/api/favorites/tracks`
- `POST /api/favorites/check` — batch favorite status
- `POST /api/favorites/sync-to-nostr` — publish per-item events
- `POST /api/favorites/sync-shared` — cross-app kind 10333 reconcile

### Lightning
- `POST /api/lightning/boost`, `/api/lightning/boostbox`
- `GET /api/lightning/value-splits` — resolved V4V recipients

### Nostr
- `POST /api/nostr/auth/login`, `/logout`, `/nip05-login` — issues/clears the session cookie
- `GET /api/nostr/global-favorites` — Community tab

### Search & Playlists
- `GET /api/search` — fuzzy search across tracks/albums/artists
- `GET /api/playlist/[name]` — playlist data
- `GET /api/playlist-cache?refresh=all` — refresh every playlist cache

### Admin
`middleware.ts` requires the `ADMIN_SECRET` bearer token for all of `/api/admin/*` (except
`/api/admin/verify`, the npub-whitelist login check), for `PUT`/`DELETE` on `/api/feeds`, `DELETE`
on `/api/tracks`, for `/api/parse-feeds` and `/api/playlist-cache`, and for
`/api/playlist/*?refresh=true`.

Four feed endpoints stay **intentionally public** for the podping consumer: `GET /api/feeds/exists`,
`POST /api/feeds/refresh-by-url`, `POST /api/feeds`, `GET /api/feeds/opml`.

## Deployment

**`git push origin main` IS the production deploy.** Railway builds the `Dockerfile`
(`railway.toml`) and rolls it out. There is no preview environment.

**Railway does not run migrations.** The Dockerfile runs `prisma generate` and starts the server —
nothing applies `prisma/migrations/`. After merging a migration, apply it manually **before** the
code that reads the new column goes live:

```bash
railway run --service StableKraft --environment production npm run db:migrate
```

Skipping this means every query selecting the new column 500s (issue #122).

Health check: `GET /api/health` (configured in `railway.toml`).

### Android

The Capacitor build is a separate artifact from the web deploy — a web deploy does not update it.

```bash
npm run android:sync
npm run android:release
```

The release keystore lives at `~/keystores/stablekraft-release.jks` with credentials in
`~/.stablekraft-android.env`. Neither is in the repo, and losing the keystore means losing the
ability to ship updates to installed users.

## Scheduled Jobs

GitHub Actions, not in-app cron:

| Workflow | Schedule | Does |
|---|---|---|
| `refresh-playlists.yml` | `0 9 * * *` — daily, 4 AM EST | Refresh playlist caches, reparse music feeds, resolve remote items |
| `refresh-artists-targeted.yml` | `0 */3 * * *` — every 3 hours | Targeted artist feed refresh |
| `refresh-podcasts-targeted.yml` | `15,45 11,12,13 * * 0,2` — Sun & Tue | Targeted music-podcast reparse |
| `check-dead-feeds.yml` | `0 10 * * 1` — Mondays | Sweep for feeds that no longer resolve |

## Two-Repo Architecture

This app consumes playlist feeds generated by a separate repository:

- **Playlist Generator**: [musicL-playlist-updater](https://github.com/ChadFarrow/musicL-playlist-updater)
- **Feed Output**: [chadf-musicl-playlists](https://github.com/ChadFarrow/chadf-musicl-playlists)

The cross-app favorites wire format is specified in a third, app-neutral repo:
[PC20-Nostr](https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md).

## Further Documentation

- [`CLAUDE.md`](CLAUDE.md) — project instructions and cross-cutting invariants
- [`.claude/skills/`](.claude/skills/) — 13 per-subsystem deep dives (feed ingestion, catalog
  display, auth, favorites, audio, Android, Lightning, downloads, diagnostics, …)
- [`docs/`](docs/) — architecture notes and specs

## License

MIT License - see [LICENSE](LICENSE) for details.
