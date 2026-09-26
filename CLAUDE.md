# Stablekraft App

Next.js 15 music app for Podcasting 2.0 — RSS feeds, V4V/Lightning payments, Nostr, musicL playlists.

**Most of what was in this file now lives in project skills** (`.claude/skills/*/SKILL.md`), loaded on demand
rather than on every turn. See *Where things are documented* below. The detail is unchanged — it moved, verbatim.

## Reporting Language

Write every reply to the user in ASD-STE100 Simplified Technical English.

- Use only approved STE words, and use one meaning for each word.
- Write short sentences: 20 words maximum for an instruction, 25 for a
  description.
- Give one instruction in each sentence.
- Use the active voice and simple verb tenses.
- Do not use a noun cluster of more than three words.
- Keep the articles. Do not use slang, idioms, or jargon.

This rule applies to chat replies only. Code, code comments, commit messages,
pull request text, file contents, and quoted material keep their normal style —
do not rewrite existing prose into STE.

## Commands
```
npm run dev          # Start dev server
npm run build        # Build for production
npm run db:studio    # Open Prisma Studio
npm run deploy       # Build deployment package (local)
git push origin main # Deploy to production (Railway auto-deploys from git)

npm run typecheck    # tsc --noEmit; CI runs this + test:all + next lint
npm run test:all     # everything

# Tests — there is NO jest/vitest. The pattern is node:test + tsx.
# `lib/*.test.ts` does NOT recurse — it misses lib/nostr, lib/caches and lib/downloads.
npx tsx --test lib/*.test.ts lib/*/*.test.ts        # everything (also `npm run test:all`)

# Testing a WRITE. There is no preview environment, so a local relay is the only
# place a publish can be exercised without writing the real event under the real key.
npm run relay                    # ws://127.0.0.1:7777, in-memory, replaceable-event semantics
npm run seed:relay -- <npub>     # copies the real kind:10333 in — read-only against production
npm run dev:isolated -- -p 3001  # dev, publishing ONLY to the local relay
npm run e2e:favorites            # the whole loop on a throwaway key, with real NIP-44

# Reading PRODUCTION. `railway login` needs a real TTY — it fails in any non-interactive
# shell, so run it in a terminal of your own; the credentials then persist to disk. The
# --service/--environment flags are NOT enough on their own, the directory must be linked:
railway link --project StableKraft --environment production --service StableKraft
railway logs -n 400              # ALWAYS pass -n; the default STREAMS and never returns
railway logs --build -n 400      # the build, when a deploy is the suspect
railway variables --json         # dump: filter in code, never print a secret's value
railway domain                   # which hostnames actually serve this instance
# Only the current deployment's buffer is kept, and Next logs no successful request — so
# a quiet log is not evidence of no traffic. Ask what WOULD have been logged before
# concluding anything from silence.

# COST. The Usage page's Network Egress chart is a running total for the billing period, so
# it only ever rises — it is not a rate. For per-day, per-hour or per-service numbers, POST to
# https://backboard.railway.app/graphql/v2 with the token in ~/.railway/config.json:
#   usage(projectId, measurements:[NETWORK_TX_GB, NETWORK_RX_GB, MEMORY_USAGE_GB],
#         groupBy:[SERVICE_ID, ENVIRONMENT_ID], startDate, endDate)
# The StableKraft card does NOT include the database — it is a separate project (see below).
```
Per-subsystem test commands live in the skill that owns the subsystem — each skill opens with its own.

## Boundaries
- Never commit secrets (`.env`, API keys). `SESSION_SECRET` and `ADMIN_SECRET` live in Railway env only —
  `.env.local` carries neither (checked 2026-09-19), which matters for any local server; see the standalone
  recipe below.
- **`console.log` does not exist in production.** `next.config.js` sets `compiler.removeConsole` with
  `exclude: ['error', 'warn']`, so every `console.log` is compiled out of a production build and survives in dev.
  A diagnostic added with `log` is therefore absent from the one environment worth diagnosing — this cost a
  deploy-and-retest cycle on 2026-08-20, when stage timings added to chase a slow signing prompt printed nothing
  on stablekraft.app. Use `console.warn` for anything you intend to read in production.
- **A grep that returns nothing is not evidence that nothing exists.** Under zsh, an unquoted `--include=*.tsx` errors with `no matches found` and prints nothing — indistinguishable from a clean result. This produced three wrong conclusions during the security audit, including "this route has no callers" about a live endpoint that was nearly deleted. Quote the globs, and check the exit status before believing an empty result.
- **A local relay is not isolation on its own, and the difference is a real publish.** The commands
  are under Commands; the trap is here. Use **`npm run dev:isolated`**, never a hand-set
  `NEXT_PUBLIC_NOSTR_RELAYS` — the publish path unions the user's NIP-65 relays with the defaults, so
  a "local" test by a signed-in user published a real event under their real key, to their real
  relays, silently. `resolvePublishRelays` now returns only the defaults when every one is loopback;
  production is unchanged and pinned by `relay-isolation.test.ts`. Three separate places stripped
  loopback URLs before that worked — `getDefaultRelays`, the publish union, and
  `RelayManager.connect` — and the third one failed *only* the publish while reads kept working, so
  the symptom was "couldn't reach the relays" from a relay that was answering on the same URL.
- **`dev:isolated` does NOT isolate the database.** `.env.local` still points it at Railway
  production, deliberately, because testing a mode switch needs real favorites to move. The reconcile
  can only ADD, but a heart you tap is a real favorite — snapshot with `scripts/backup-favorites.ts`
  first, or override `DATABASE_URL` from `.env` on the command line. Never edit `.env.local`.
- Run `npm run build` before committing — but **stop `npm run dev` first**, *or* build into a
  different directory with `NEXT_DIST_DIR=.next-build npm run build`, which is what to do when a dev
  server is running. Changing the dev PORT does not help; the collision is the directory. Next
  rewrites `tsconfig.json` on every build, so `git checkout tsconfig.json` afterwards.
  Building over a live dev server replaces the chunks its running client already fetched, and every
  asset request 400s (`ERR_ABORTED` on `_next/static/...`) until the dev server is restarted. Symptom
  is a page stuck on its loading state with no obvious error. Recovery: kill dev, `rm -rf .next`,
  `npm run dev`. Any phone testing over the LAN needs a hard reload afterwards.
- **Testing on a phone over the LAN? The service worker will serve it stale content.** `next-pwa` is disabled in dev, but a production `npm run build` writes `public/sw.js` + `public/workbox-*.js`, and Next serves `public/` statically **even in dev** — so any device that registered the worker keeps getting its cached HTML shell and CSS from `http://<lan-ip>:3000`. Symptom: the phone shows a layout you already changed, often with CSS partly missing (flex `gap`s collapsing, so text runs together) because the shell and the stylesheet come from different builds. A plain reload does not fix it. Delete `public/sw.js` and `public/workbox-*.js` (both gitignored build artifacts) so `/sw.js` 404s — the browser then drops the registration on next load — and reload twice, or use a private tab. Worth deleting them after every local `npm run build` you didn't intend to deploy.
- **A clean `npm run build` is not evidence the server works.** It bundles; it does not run. Two separate
  server-only breakages passed a green build and only appeared when the built artifact was started —
  `ws` inlined by webpack throwing `b.mask is not a function` on every frame, and `ws` rethrowing a `close()`
  that landed on a still-connecting socket, both as `uncaughtException`. For anything touching a server route's
  runtime, run the real thing: `npm run build`, copy `.env.local` into `.next/standalone/`, then
  `cd .next/standalone && PORT=3009 NODE_ENV=production node server.js` — add
  `NODE_OPTIONS=--no-experimental-websocket` to stand in for `node:20-alpine`, which is the shape production
  actually has. Read the server log, not just the response body: the first version of that fix returned correct
  JSON while throwing uncaught exceptions behind it. Delete the copied `.env.local` afterwards.
  **That server is attached to the PRODUCTION database, and it has no admin gate.** The copied `.env.local` points
  at production and carries no `ADMIN_SECRET`, and `checkAdminAuth` fails OPEN without one — so every admin-gated
  route runs for real. On 2026-09-19 a test meant to prove `?refresh=true` returns 401 got 200 and rebuilt the
  `iam` playlist's `SystemPlaylistTrack` rows on production. Always start it with a throwaway secret:
  `ADMIN_SECRET=$(openssl rand -hex 24) PORT=3009 …`. With `NEXT_DIST_DIR=.next-build` the server is in
  `.next-build/standalone/`.
- No `src/` directory — all source lives in `app/`, `lib/`, `components/`, `contexts/`
- No `deploy-*/` artifacts in the repo — add to `.gitignore` if generated
- No JSON-file databases — all data is in PostgreSQL via Prisma
- Android keystore at `~/keystores/stablekraft-release.jks`, creds in `~/.stablekraft-android.env` — never commit either. Losing the keystore = losing the ability to ship updates to installed users.

## Tech Stack
- Next.js 15 (App Router), React 18, TypeScript, PostgreSQL/Prisma
- Podcast Index API for all feed lookups and resolution (never fetch directly from Wavlake — use PI API)
- Nostr for auth, Lightning (Alby/WebLN) for payments


Two repos: **musicL-playlist-updater** generates playlist XML feeds; **stablekraft-app** (this one) consumes them.

## Cross-cutting invariants

These span several subsystems, so they stay here rather than in any one skill. The skill named at the end of each
line holds the full story.

- **`git push origin main` IS the production deploy.** There is no preview environment. `NEXT_PUBLIC_*` bakes at
  build time, so set it *before* the deploy that should use it. There WAS one, unnoticed: a `test` environment
  (a 2026-04-23 deploy of a feature branch, `test.stablekraft.app`, plus its own Postgres) ran for five months,
  served ~0.1 GB, and was ~42% of the project's memory bill. Deleted 2026-09-19. An environment is billed 24/7
  whether or not anyone uses it.
- **The production database is a SEPARATE Railway project ("Postgres"), reached over the public TCP proxy, and
  that is a decision, not an accident to fix.** Private networking does not cross projects, so every query result
  is billed as egress on that project — ~65 GB (~$3.25) for Aug 19 → Sep 19 2026, more than the app's own egress,
  and invisible on the StableKraft card. A move into this project was prepared and **declined on 2026-09-19**: the
  saving did not justify touching a working production database. Do not re-propose it. To cut that traffic, change
  what the app READS — it pulled 1–4 GB/day from a 129 MB database, mostly `albums-fast` re-reading the whole
  catalog (~20 MB: Prisma's per-feed `take` is applied AFTER the read) every 15 minutes although the rows had
  changed in ~3% of those windows. It now re-reads only when a Postgres-side md5 of the rows changes
  (`lib/caches/fingerprinted-cache.ts`); count its `[albums-fast-cache] … rebuilt` warnings to see how often
  that is. It is also why `railway run --service StableKraft` works from a laptop: the app's
  `DATABASE_URL` is the public URL, so any future move to `*.railway.internal` breaks every documented
  `railway run` command.
- **Railway does not run migrations on deploy.** The Dockerfile has no `prisma migrate deploy`, so after merging a
  migration run `railway run --service StableKraft --environment production npm run db:migrate` **before** the code
  that reads the new column goes live — otherwise every query selecting it 500s (issue #122).
- **The server has exactly ONE relay read, and it must bring its own WebSocket.** Everything else Nostr happens in
  the browser; `/api/nostr/global-favorites` is the exception. `node:20-alpine` runs `node server.js` with no
  `--experimental-websocket`, and **Node 20 exposes the `WebSocket` global only behind that flag** (v22 exposes it
  unconditionally). Next does not polyfill it. So the sweep runs on `ws`, installed by `installNodeWebSocket()`
  before the pool is constructed — which is why `ws` is a **production** dependency and why `next.config.js` sets
  `serverExternalPackages: ['ws']`. Do not drop either: webpack inlines `ws`, its native helpers do not survive the
  bundle, and every frame then throws `TypeError: b.mask is not a function` as an `uncaughtException`. Marking it
  external is also what traces it into `.next/standalone/node_modules` → `favorites`, `nostr-signer`.
- **A relay sweep that reached nobody looks EXACTLY like one that found nothing.** `querySync` swallows a connect
  failure inside nostr-tools and resolves to `[]`, so a per-filter `catch` never fires and **nothing is logged** —
  the route answered `success: true`, `status: 'empty'`, zero people, in silence. Connectivity is a separate
  question from emptiness and has to be asked separately: `pool.listConnectionStatus()`, and zero reached is an
  **error**, never an empty result. Same exit as an unreadable private half → `favorites`.
- **Do not raise the base image to Node 22 on its own.** Node 22's undici re-fires `error` from inside `close()` on
  a socket that already failed, and `nostr-tools` >= 2.25.2 calls `this.ws?.close?.()` from its own `onerror`, so
  the two recurse until `RangeError: Maximum call stack size exceeded`. Browsers make that `close()` a no-op, so
  only Node is affected. `ws` avoids it entirely — which is the other reason the server is on `ws` → `nostr-signer`.
- **Four guards decide who may use this backend, each behind its own switch, and three ship in LOG mode.**
  `NEXT_PUBLIC_FOREIGN_SHELL_GATE` (defaults to `block`), `PROXY_HOST_MODE`, `CORS_MODE` and
  `RATE_LIMIT_MODE` (all default to `log`). A log-mode guard must be **indistinguishable from before**, and
  the way that breaks is latency, not responses: `checkProxyTarget` consults the catalog in log mode too —
  it has to, to report what it *would* have refused — so a blocking cache there made every proxy request pay
  for a refresh in the mode that is meant to change nothing. Adding a route means asking which of the four
  applies: a costly route wants `enforceRateLimit`, a catalog JSON route wants `corsHeaders()`. The
  `NEXT_PUBLIC_*` pair bakes in at BUILD time; the other three are plain server variables and need no
  rebuild. Flip them **one at a time**, reading each guard's own log prefix in between → `auth-and-security`.
- **The Android APK is a WebView pointed at production, so a fork can serve itself off this instance.**
  `capacitor.config.ts` sets `server.url` and there is no `output: 'export'`. The gate keys on the Android
  `applicationId`, which a fork cannot keep, and it is **inert on any host but ours** — a fork that
  self-hosts is meant to work, and does. Every uncertain branch ALLOWS: not native, no Capacitor, no
  `@capacitor/app`, a rejected or hanging `getInfo()`. Checked 2026-09-06 against the installed
  `app.unstablekraft`: it runs a complete backend of its own and `stablekraft.app` appears **nowhere** in
  its APK, so the gate is deterrence against a one-line change, not a live rescue → `auth-and-security`.
- **`isSafePublicUrl` answers SSRF, not abuse — and there are THREE external-host lists, not one.**
  It blocks *private* addresses and permits *every public host*, so it never made the media proxies
  anything but an open proxy for the internet; `lib/proxy-host-allowlist.ts` is the separate control that
  binds them to the catalog, and it runs **after**. The lists it must stay in step with are
  `CORS_PROBLEMATIC_DOMAINS` and `DIRECT_FIRST_DOMAINS` (`lib/audio-url-utils.ts`) and
  `ALLOWED_IMAGE_DOMAINS` (`lib/cdn-utils.ts`) — seeding from only the first two left two hosts carrying
  real playlist artwork matching nothing. `next.config.js` `images.remotePatterns` hand-mirrors the third
  and cannot import it (CommonJS, loaded before the app). Matching is **dot-boundary, never `includes`** —
  `includes` accepts `wavlake.com.attacker.net`. And the HGH/ITDV playlists hardcode ~1800 media URLs in
  `data/`, whose source feeds are in `PLAYLIST_SOURCE_FEED_URLS` and therefore *deliberately absent from
  the catalog*, so the catalog binding does not cover them — `PLAYLIST_MEDIA_HOSTS` and a test over those
  data files does → `auth-and-security`.
- **`isSafePublicUrl()` returns `{ ok, ... }`, not a boolean.** `if (!isSafePublicUrl(u))` negates an object, is
  always `false`, and silently turns the SSRF guard into dead code — and `tsc --noEmit` stays clean. Always
  `const c = isSafePublicUrl(u); if (!c.ok)`. Verify empirically, never by reading it → `auth-and-security`.
- **A gate and the handler it guards must read the same input through the SAME function.** The admin gate asked
  `get('refresh') === 'true'` while the playlist handler asked `has('refresh')`, so `?refresh=1` skipped the gate
  and still rebuilt the playlist from an anonymous GET (#268). Both now call `isForceRefresh()`, and a test fails
  if a refresh-gated route reads `refresh` any other way. Adding a query-param gate means one shared predicate,
  never a second expression of it → `auth-and-security`.
- **User identity is the signed session cookie, never a request header.** `requireUser(request)` is the only way a
  route learns who is calling; `grep -rn "x-nostr-user-id" app/api` must stay empty → `auth-and-security`.
- **`Feed.image` / `Track.image` may carry OUR version, `?skv=<8 letters>`, which the feed never wrote.** An artist
  can replace a cover at the same URL and podping from anywhere, so the podping refresh asks the image host and puts
  its answer in the URL — the only thing every cache (proxy, `/_next/image`, browsers, offline) keys on. Compare a
  stored image with a feed's only after `stripImageVersion`, and a new path that overwrites an existing image must
  call `preserveImageVersion` or it strips the version every run → `feed-ingestion`.
- **Bump `API_VERSION` in `app/page.tsx`** whenever the `/api/albums-fast` response shape changes, or clients keep
  serving field-missing data out of localStorage indefinitely → `catalog-display`.
- **`compress: true` does NOT compress route handlers — return large JSON with `compressedJson()`.** Next copies a
  route's headers with `res.appendHeader()`, which makes `Content-Type` an array, and the compression middleware
  then calls it "not compressible". Pages, JS and CSS are gzipped; every `/api/*` JSON body went out raw — 645 KB
  for `albums-fast` (62 KB gzipped) and 1–10 MB per full playlist, most of this app's billed egress. There is no
  CDN in front of Railway, so `s-maxage` saves nothing. `lib/compressed-json.ts` gzips when the caller accepts it;
  use it for any success body over a few KB. Check with `curl -D - -o /dev/null -H 'Accept-Encoding: gzip'`, never
  a bare `curl`, which asks for no encoding and so always gets the raw body.
- **There is a Data Saver mode, and OFF must stay byte-for-byte what it is today.** A manual switch
  (`sk_data_saver`, Settings → Data & Offline), never auto-enabled — `navigator.connection.saveData` is
  deliberately not consulted, for the reason Offline mode ignores `navigator.onLine`. It spans artwork, the
  catalog fetch, audio prefetch and the wallet chunk, so the decision lives in **one** pure function,
  `artworkPlan()` in `lib/data-saver.ts` — a branch per component is the N-places bug this file keeps
  describing. **Three** of the four artwork paths ask it today (`AlbumCard`, `CDNImage`, `ArtworkImage`); the
  33 raw `<img>` tags do not, and simply save nothing. Wire a new one by calling `artworkPlan`, never by
  reading the flag directly. With the flag off that function returns each caller's own baseline
  field for field, and `lib/data-saver.test.ts` pins that for every surface: it is the contract, so it is the
  test. Audio is **prefetch only** — the `preload` attribute, the ping-pong elements and every playback URL are
  untouched, and the Android blob prefetch is *delayed* to the 15s mark rather than dropped, because it is what
  keeps a locked-screen handoff gapless → `catalog-display`, `downloads`.
- **`/_next/image` answers HTTP 400 for a host not in `remotePatterns` — it does not return a bigger image, it
  returns none.** So lifting `unoptimized` on an unlisted host *deletes* the artwork rather than merely leaving
  it large, and the 30-byte JSON error body is easy to mistake for a very small image. Measured 2026-09-20 against
  `hogstory.net`, `music.jimmyv4v.com` and `justcast.sfo2.digitaloceanspaces.com`, all of which carry real
  catalog covers. `ALLOWED_IMAGE_DOMAINS` (`lib/cdn-utils.ts`) is the in-app mirror of that list and is what
  `isNextOptimizable()` consults — the two are **hand-mirrored**, because `next.config.js` is CommonJS and loads
  before the app, so a host added to one alone is a missing cover on whichever feed uses it.
  `lib/data-saver.test.ts` compares them and fails on a seeded drift. This is the same hand-mirroring hazard as
  the three external-host lists above → `catalog-display`, `auth-and-security`.
- **The same field is often written or read from N places, and fixing one is the standard bug here.**
  `/api/albums-fast` has **two** Track selects; `podcastImages` has
  **three** write paths; the release date has **seven** read paths; `Feed.medium` has **ten** create/upsert paths
  and the first pass at it caught one; `AlbumDetailClient` duplicates props across its mobile and desktop rows.
  Adding or fixing a field means finding all of them → the owning skill. `grep -rn "prisma.<model>.create\|upsert"`
  before believing you have. Watch for **re-key** paths especially — `refresh-by-url` deletes a row and recreates it
  from a field-by-field copy, so a column missing from that list is silently dropped rather than merely unset.
  The favorites id ladders were three such copies and are now **one** — `lib/favorites/resolve-favorite-rows.ts`,
  used by `favorites/albums`, `favorites/tracks` and `favorites/sync-items`. Keep new readers on it: both stored ids
  are polymorphic (`Feed.id` vs `Feed.guid`; `Track.id` vs `Track.guid` vs `audioUrl`), every rung carries real
  rows, and a rung present on one path and not another means a favorite that renders on the page and is missing
  from the published Nostr list → `favorites-cross-app`.
  **There are two album shapes, not one.** `lib/catalog/album-shape.ts` serves `albums-fast` and `feeds/recent`;
  `/api/albums/[slug]` — the album page — builds its own, and `app/page.tsx` then copies the albums-fast album field
  by field. A field added to the shared shape reaches neither. `Feed.persons` was written on every parse (#259, #260)
  and still reached no album-page boost until #261, because both copies dropped it → `catalog-display`.
- **A boost note names people from ONE list, and each entry is both a `p` tag and an @mention.**
  `boostNotifiedPubkeys` (`lib/nostr/boost-note.ts`) merges the feed's `<podcast:person>` / `<podcast:txt>` npubs —
  persons first — with the split recipients' resolved pubkeys. Built separately, an artist is notified but invisible
  in the body: that shipped, and Jumble showed only the booster, reached through the MSP 2.0 split. Only **five of
  fourteen** `BoostButton` call sites pass a `persons` prop, so the button also names whatever its own boost-time
  lookups return — `/api/music-tracks/[id]` (track and `Feed.persons`) and `/api/feeds/[id]`. Those two routes must
  keep returning `persons`, or every playlist, favorites, track-card and now-playing boost names nobody again, in
  silence. `channel-persons.test.ts` pins the write side, the read side and both lookups → `lightning-boost`.
- **`remoteFeedGuid` beats `BoostButton`'s own lookup ON PURPOSE, so a wrong one is published as fact.** For a VTS
  segment `NowPlayingScreen` passes the remote item's feed, which legitimately differs from the episode's; preferring
  the lookup would break that. The price is that every caller must be right. The playlist database fast path returned
  `Track.guid` — the ITEM guid — as `feedGuid` for 137 of 137 ITDV tracks, so every playlist boost published
  `podcast:guid:<item guid>`, a feed that does not exist, on a note that cannot be edited (#264). Fix a wrong guid at
  its source (`lib/playlist/db-track.ts` for playlists), never by reordering the button's fallbacks →
  `lightning-boost`.
- **`Feed.type` is this app's classification; `Feed.medium` is what the feed declared.** They are not
  interchangeable and the difference is load-bearing. `type` defaults to `"album"`, so it always has a value and
  that value is often a guess; `medium` is NULL until a feed actually says, and **nothing may default it**. Only
  `medium` goes on the cross-app favorites list, where a guess is sticky and no other app will correct it. Use
  `type` for local behaviour, `medium` for anything published or shown as fact → `favorites-cross-app`,
  `feed-ingestion`.
- **The shared favorites wire format is sequenced reader-first, across two repos and a spec.** The order is: land
  it in [PC20-Nostr](https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md), teach
  **both** apps to *read* the new form, and only then start *writing* it. Writing a form the other app can't read
  doesn't fail — it silently makes favorites invisible on the far side, which is worse than the format it
  replaced. The channel is now **kind 10333**, one plain replaceable event; the kind:30078 two-list design it
  replaced is deleted, and its events survive on the relays only as a rollback path.
  **This is not theory, and the order is not a formality.** On 2026-08-25 this app shipped the private
  half and switched a real account to Private while Boost Me Bitch still hardcoded `content: ''`. For
  about an hour, one favorite toggled there would have erased 436 encrypted entries — silently, no
  undo, on an event that keeps no history. Nothing was wrong with any rule; the halves shipped in the
  wrong sequence. **Before switching on anything that writes a new form, go and read the other app's
  shipped `main` and confirm it handles it** — not its open PR → `favorites-cross-app`.
- **An item entry may name its own feed, and the ELEMENT COUNT is the only thing that says which is which.**
  `['i','podcast:guid:<feed>']` is a feed favorite; `['i','podcast:guid:<feed>','podcast:item:guid:<item>']` is one
  item of that feed; `['i','podcast:item:guid:<item>']` is the LEGACY form and still takes its feed from the entry
  above it. Position 1 is byte-for-byte the same string on the first two, so a reader that branches on it turns one
  saved episode into a followed show — it does not lose the item, it silently promotes it. A position 2 we do not
  recognise makes the whole entry unreadable, never a feed favorite. An entry's kind is the kind of its LAST
  identifier, or `podcast:item:guid` stops reaching the `k` tags and `#k` discovery misses every item favorite.
  **This app now READS AND WRITES the new form (stages 1, 2 and 4).** A legacy item is rewritten once, with the
  identifier MOVED to position 2 — never appended as a third element — using the feed it was read under, and the
  rewrite is idempotent. An item whose feed nobody knows goes back exactly as it arrived: a placeholder guid is an
  invented one. **A new item no longer needs a feed entry above it**, so a feed the user never favorited stops
  reaching the list; a placement entry already on the wire is still carried, never retracted (stage 3). Reading the
  legacy form stays mandatory — every list published before the revision writes items that way, and dropping the
  path makes them unresolvable rather than unlabelled → `favorites-cross-app`,
  [`pc20-favorites-feed-guid-migration.md`](https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites-feed-guid-migration.md).
- **Rule 5 compares the read PUT THROUGH THIS WRITER'S OWN FRAMING, never as it arrived, and that is a different
  question from the digest.** The digest asks "did WE publish exactly this before"; rule 5 asks "does the RELAY
  already hold it" — and only the second notices another app editing the event, while a device that has never
  published has no digest at all and republishes a list nothing had changed on its first load. Two conforming
  events differ byte for byte: a `k` beside every `i` and one `k` per distinct kind at the end are both legal and
  mean the same list, and the positions of `alt` and `visibility` are free the same way. `readAsWeWouldWriteIt`
  renders the parsed read through `tagsFromNodes` — the same emitter the plan used, rather than a second
  normaliser to keep in step — and carries the visibility the READ states, because ours would make a list that
  predates the tag differ from itself forever → `favorites-cross-app`.
- **A published-record claim on an ITEM is the PAIR, and the record is keyed by BARE GUID throughout.** An item
  guid is unique only inside its feed, so a record keyed on the guid alone cannot tell two items in two feeds
  apart: take one back and the merge reads the other as ours-and-removed and drops it. `itemClaim(itemGuid,
  feedGuid)` is `feed|item` — feed first, because a feed guid is a UUID and an item guid is routinely a permalink
  URL. `claimedItem` accepts the bare legacy form too, and that IS the migration: a stored record keeps working and
  is rewritten paired by the next publish. **`publishedRecordFrom` claims a feed only when `favorited !== false`** —
  claiming a placement group asserts an entry that was never on the event, and two cycles later the merge deletes
  another app's feed favorite for that guid. `suppressOwnRemovals` builds the pair from the track's own `feedGuid`
  and falls back to `claimsAnyItem` when it has none: failing to match there fails OPEN, and the entry it lets
  through is re-created as an inbound favorite minutes after the user deleted it → `favorites-cross-app`.
- **Rule 5's framing must NOT re-band.** `frameForCompare` regenerates `alt`, restates `visibility` and rebuilds the
  trailing `k` tags, and deliberately leaves the ORDER alone. Rendering the parsed read through `tagsFromNodes`
  instead — which is what this started as — normalises the order too, so a list that arrived interleaved compares
  equal to our banded output and the reordering is never published: the event stays unbanded forever while this
  writer believes it agrees with it. `SingleList.tags` carries the read's raw array for exactly this comparison →
  `favorites-cross-app`.
- **`projectNodes` may not edit the node list it projects from.** `groups` aliases each node's own group object, so
  folding an item entry's guid into one by pushing would add it to the NODE LIST too — and the republish would then
  emit that item twice, once as a group member and once as its own entry. Copy the group into the projection
  instead. The projection is what this app models; the node list is what it republishes → `favorites-cross-app`.
- **Kind 10333 has TWO live writers, so every publish must read first and merge.** Publishing replaces the whole
  event, so a writer that sends what it holds without reading deletes everything the other app added — silently,
  on someone else's device, with no undo. Boost Me Bitch started publishing 2026-08-13, which retired the
  single-writer assumption this file used to state. `publishSingleList` therefore reads, merges via
  `mergeSingleList` against the device-local `sk_single_list_published:<pubkey>` record, and refuses to publish on
  a degraded read → `favorites-cross-app`.
- **The parsed list is an ORDERED NODE LIST, and a republish must be rendered from `nodes` — never from
  `groups`.** `groups`/`orphanItemGuids` are a *projection* holding only what this app can model; the node list is
  what also carries foreign tag types, foreign `k` values, `podcast:publisher:guid` entries and malformed
  `podcast:guid:` values, whole and in position (spec §4, *Carry what you can't read*). Rendering the projection
  instead compiles, type-checks and silently deletes every one of them on the other app's behalf — which is what
  shipped until 2026-08-14. A loose node also must **not** close the open feed group: dropping a non-UUID
  `podcast:guid:` reparented every item after it to the previous feed, well-formed and invisible →
  `favorites-cross-app`.
- **Favorites have a public/private/off choice, and the private half is a SECOND list in `content`.**
  Public entries are `i` tags; private ones are a NIP-44 encrypt-to-self of a tag array. Three rules
  only work together, and each shipped as a production bug in the sibling app: the digest compares
  **decrypted tags, never ciphertext** (NIP-44's nonce makes ciphertext differ every time, so a
  ciphertext digest republishes forever); the baseline is **two records**, with the inactive half's
  claims **carried forward and cleared by the move, never re-derived** (nothing feeds that half, so a
  derived claim goes unbacked and cycle 2 deletes what cycle 1 merely carried — it takes **two
  cycles** to show); and the inactive half is carried on the wire but **never painted into local
  state**, because local state comes back as `local` and is republished into the *active* half, which
  private→public is a disclosure. Seeding a device's mode from the wire must have **each half answer
  only for itself** — public-first fails open and republishes a private list as plaintext, indexed
  tags → `favorites-cross-app`.
- **The privacy choice belongs to the LIST, not to this app.** Whichever half holds entries is the
  mode, and going private takes **everything** — including entries this app did not write and cannot
  resolve. The alternative was measured: 436 entries encrypted and **13 left public** because the
  other app wrote them, with nothing on screen saying which. 97% private is worse than a clear no.
  The move is **one direction only**: public→private may take another app's entries (it only reduces
  exposure, carries them whole, and anything that can decrypt undoes it), private→public may not (it
  publishes an `i` tag relays index and cannot be taken back). **Moved foreign entries are NOT
  claimed in the baseline** — nothing local backs the claim, so it reads as our own removal next
  cycle and deletes them. `strandedInPublicHalf` reports anything a switch could not move, and the
  control says it out loud: silence was the actual defect, the split was only the cause →
  `favorites-cross-app`.
- **An unreadable private half is a degraded read, not an empty one.** Same exit as a silent relay.
  `decodePrivateFavorites` returns `null` rather than `[]` for valid JSON that is not a tag array —
  a `JSON.parse` that succeeds on a non-array marks the blob readable-and-empty, and the next
  republish rewrites `content` from those empty lists. NIP-55 and read-only nip05 sessions **cannot
  encrypt at all**, which is a normal state, not an error → `favorites-cross-app`, `nostr-signer`.
- **Inbound removals do not propagate.** `favorites-sync-client.ts` hardcodes `baseline: []` on the
  `/api/favorites/sync-shared` call and `SHARED_FAVORITES_APPLY_DELETES` defaults off, so unfavoriting in the
  other app never reaches this one. This fails safe — nothing is destroyed — but it is not symmetric with our
  outbound removals, which do work → `favorites-cross-app`.
- **A favorites entry is ambiguous in TWO directions, and each guard is wrong without the others.** Naming a
  track's parent means emitting a feed entry, so a group appears whether or not the feed was favorited (196 groups
  for 82 favorited feeds), and an entry on the list we don't hold locally is either another app's or one we just
  removed. Four rules answer that, and 2026-08-13 shipped four production bugs by having some but not all of
  them (#210–#214): an **itemless** group is a real favorite and one with items is unknowable; the merge drops
  what we published and no longer hold but carries what we never published; the device-local
  `sk_single_list_published:<pubkey>` record that makes those answerable is written on the digest-**unchanged**
  path too, or it never bootstraps; and the **inbound reconcile applies the same filter**, because it runs
  *before* the push and otherwise re-creates what the publish has not yet removed → `favorites-cross-app`.
- **Favorites bugs are verified against the relay and the database, never the UI.** The heart clearing, the row
  being gone, and the entry leaving the list are three different facts, and on 2026-08-13 they disagreed three
  times in a row — a removed favorite still sitting in Postgres, then one deleted and silently re-created two
  minutes later while the published event never moved. Read the event with
  `npx tsx lib/nostr/favorites.relay-probe.ts` and the rows with `railway run`, and compare `createdAt` before
  believing anything changed → `favorites-cross-app`.
- **Verify UI changes by measuring, not eyeballing** — puppeteer-core against the real component, asserting all
  four edges. Several bugs here survived a sweep that only checked one → `mobile-layout`.

## Where things are documented

Each is a skill under `.claude/skills/`; invoke it when the work touches its area.

| Skill | Covers |
|---|---|
| `feed-ingestion` | How feeds get in: podping consumer, the `lib/feed-lookup.ts` URL ladder, nightly cron, RSS parsing, adding a music podcast |
| `feed-curation` | How feeds get hidden or removed: `markedDead`, blacklists, dead-feed sweep, admin feed management, orphan cleanup |
| `catalog-display` | What the catalog shows: `albums-fast`, sorting, release date, search, album links, publisher pages, artwork |
| `auth-and-security` | `ADMIN_SECRET`, `SESSION_SECRET`, the SSRF guard, CORS/CSP/response headers, CI |
| `nostr-signer` | NIP-46/55/07 signers, the login modal, post-login flow, the publish queue |
| `favorites` | The favorites data model, polymorphic `feedId`, album-vs-track, the status cache, the Community tab |
| `favorites-cross-app` | The shared kind:10333 list StableKraft seeds and Boost Me Bitch reads |
| `audio-playback` | `AudioContext` playback: end of album, background audio, Android ping-pong, VTS |
| `android-native` | The Capacitor/zapstore APK: foreground service, wake lock, MediaSession, back button |
| `mobile-layout` | Safe-area insets, the player bar reserve, Now Playing, the mobile album page |
| `lightning-boost` | Wallets, NWC backup, BoostBox/Helipad, value splits, AutoBoost, failure triage |
| `downloads` | Offline downloads and manual Offline mode |
| `diagnostics` | Client error reporting and the admin diagnostics panel |
