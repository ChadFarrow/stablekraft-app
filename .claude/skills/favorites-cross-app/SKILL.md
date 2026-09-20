---
name: favorites-cross-app
description: "Use when working on the cross-app shared favorites list StableKraft seeds and Boost Me Bitch reads: the kind:10333 replaceable event, NIP-73 podcast:guid / podcast:item:guid identifiers, lib/nostr/favorites-single-list.ts, lib/nostr/pc20-identifiers.ts, lib/nostr/relay-read.ts, the medium grouping, SHARED_FAVORITES_ALLOWLIST, SHARED_FAVORITES_APPLY_DELETES, SHARED_FAVORITES_IMPORT_UNKNOWN, /api/favorites/sync-shared, a degraded or untrustworthy relay read, favorites disappearing after a sync, the disclosure notice, or a dead default relay."
---

# favorites-cross-app

The second favorites channel: one shared, app-neutral list read by other Podcasting 2.0 apps. The per-item kind 30001 events are a separate channel — see the `favorites` skill. Don't collapse the two: the Community tab reads the 30001 events, and its author-scoped filters and d-tag ladder are tuned against real prod data.

## Tests for this subsystem

```
npx tsx --test lib/nostr/favorites-single-list.test.ts   # the format: build, parse, round trip
npx tsx --test lib/nostr/relay-read.test.ts              # the read, against scripted misbehaving relays (~7s)
npx tsx --test lib/nostr/relay-health.test.ts            # the dead-relay memo and the three limits that bound it
npx tsx lib/nostr/favorites.relay-probe.ts               # read-only smoke check against the REAL default relays (network; not in --test runs)
npx tsx scripts/backup-favorites.ts dump > fav.json      # snapshot favorites before enabling SHARED_FAVORITES_APPLY_DELETES
npm run check:conformance                                # the SPEC's 24 vectors against this merge (needs ../PC20-Nostr)
```

**`check:conformance` runs the document's own vectors, not ours.** `PC20-Nostr/conformance/vectors.test.mjs`
drives `lib/nostr/favorites-conformance-adapter.ts`, a thin shim over the real modules, and it needs the
spec checkout beside this one (or `PC20_NOSTR_DIR`). It is deliberately not in `test:all`, because CI has
no sibling checkout. Its first run found two real gaps here — the resurrection loop in the append pass
(vector 9) and refusing a public publish over a private half this signer cannot open (vector 12) — and
four vectors the document had wrong. When it and the unit suite disagree, the spec is the authority: fix
the code, or change the spec by PR at PC20-Nostr first.

**The local harness — because there is nowhere else to test a WRITE.** This repo has no preview
environment, and a dev server on localhost publishes to the real relays under the user's real npub.
A replaceable event keeps no history, so a bad publish while testing is not recoverable.

```
npm run relay                    # ws://127.0.0.1:7777, in-memory, REPLACEABLE-event semantics
npm run seed:relay -- <npub>     # copies the real kind:10333 in — read-only against production
npm run seed:relay -- <npub> --content 'AkQB…'   # force a private half to test the carry against
npm run dev:isolated             # dev, publishing ONLY to the local relay
npm run e2e:favorites            # the whole loop on a throwaway key: read → merge → publish → assert
npx tsx lib/nostr/favorites.relay-probe.ts --relay ws://127.0.0.1:7777
```

**`NEXT_PUBLIC_NOSTR_RELAYS` alone is NOT isolation, and that is why `dev:isolated` exists.** Setting
it points `getDefaultRelays()` at the local relay, and the publish path used to union the user's real
NIP-65 relays straight back in — so a "local" test by a signed-in user published a real event under
their real key, to their real relays, on an event that keeps no history. It failed silently: the
publish succeeded and looked like the test working. `resolvePublishRelays` (`relay.ts`) now returns
**only** the defaults when every one of them is loopback, and both publish paths use it — the
kind:10333 list and the kind:30001 per-item queue, because one heart toggle writes both. Pinned by
`relay-isolation.test.ts`, including the vector that production behaviour is unchanged.

**What still reaches the network, by design:** nostr-login's own hardcoded relays
(`purplepag.es`, `user.kindpag.es`, `relay.nos.social`, `relay.snort.social`) for profile metadata
and NIP-46 transport. A remote signer has to be reachable to sign, so isolating that would make the
signer path untestable. Nothing of yours is published there.

**The DATABASE is not isolated by `dev:isolated`** — `.env.local` still points it at Railway
production. That is deliberate: testing a mode switch needs real favorites to move. The reconcile
can only ADD (`baseline` is `[]`, `SHARED_FAVORITES_APPLY_DELETES` off), so nothing is destroyed, but
snapshot first with `scripts/backup-favorites.ts` and expect any favorite you toggle to be a real
one. To isolate it too, override `DATABASE_URL` from `.env` on the command line — never by editing
`.env.local`.

Point the app at it with `NEXT_PUBLIC_NOSTR_RELAYS=ws://127.0.0.1:7777`. That works because
`getDefaultRelays()` returns an explicitly configured list **without** `filterReachableRelays` —
which drops every loopback URL, and used to leave the app with an empty relay list rather than an
error. Also override `DATABASE_URL` from `.env`: **`.env.local` points `npm run dev` at Railway
production**, and the shared-favorites reconcile is the only destructive write in this subsystem.
Do not edit `.env.local` — override it per-command.

The e2e is where the bugs are. Every unit vector here is a pure function, and the ones that shipped
— the blanked `content`, the republish from `groups`, the baseline defects — all passed the unit
suite and failed in the wiring between the pieces.

---

## The format — kind 10333, one flat list

Spec: [`PC20-Nostr/pc20-favorites.md`](https://github.com/ChadFarrow/PC20-Nostr/blob/main/pc20-favorites.md), the canonical app-neutral copy kept outside both implementing repos. **That document, not this code, is what a third app implements against.** One plain (non-`d`-tagged) replaceable event, so exactly one per pubkey; `i` tags grouped under a running `medium`. Republishing the whole tag list IS the sync.

## The private half — `content` is a second list

**Public / private / not-on-Nostr**, per the spec's private-half section. Public entries stay in
tags; private ones go in `content` as a NIP-44 encrypt-to-self of a **tag array** — the same shape
as `event.tags`, so `parseSingleList` reads it unchanged and the grouping rules apply inside it.
Files: `favorites-privacy.ts` (the pure planner), `favorites-private-half.ts` (decrypt + status),
`nip44.ts` (one NIP-44 implementation, shared with the NWC backup), `FavoritesPrivacyControl.tsx`,
`FavoritesPrivacyPrompt.tsx`. Tests: `npx tsx --test lib/nostr/favorites-privacy.test.ts`.

**Why the choice exists:** `i` is a single-letter tag and relays INDEX those, so a `#i` filter
answers *which pubkeys favorited this feed*. The list is searchable in reverse, not merely readable
by someone who has the pubkey.

- **The digest compares DECRYPTED tags, never ciphertext.** NIP-44 draws a fresh nonce, so identical
  entries encrypt differently every time; a ciphertext comparison republishes forever. `publishPlan`
  returns `privateTags` for exactly this reason.
- **The baseline is TWO records** (`PrivacyBaseline`), and the active half's claims are derived from
  local state while **the inactive half's are carried forward and cleared by the move, never
  re-derived**. Nothing feeds the inactive half next cycle, so a derived claim goes unbacked and the
  removal test fires on the whole half: cycle 1 claims another writer's entries, cycle 2 deletes
  them. **This needs two cycles to show** — every single-cycle vector passes over it. `parseBaseline`
  reads the old `{feeds, items}` shape as the **public** half.
- **The inactive half is carried on the wire but NOT painted into local state.** Local state writes
  through and comes back as `local`, which goes wholly into the active half — so an adopted entry is
  republished into this one. `reconcileInput` filters it through `claimedByBaseline`: our own entries
  (mid-move) yes, another writer's no. Private→public that would be a **disclosure**.
- **The privacy choice belongs to the LIST, not to this app.** Whichever half holds entries is the
  mode, and going private takes everything — including entries this app did not write and cannot
  resolve. The alternative was measured on a real account: 436 entries encrypted, **13 left public**
  and relay-indexed because Boost Me Bitch had written them, with nothing on screen saying which.
  97% private is worse than a clear no. **`WHOLE_LIST_PRIVACY_MOVE` is ON** since 2026-08-26 — BMB reads the private half
  (boostmebitch#222) and renders it (boostmebitch#232) — an app must be able to render `content` before entries are moved
  into it on its behalf, or the move looks like a deletion there. `PublishPlan.carriedInOtherHalf` and `inBothHalves` are the
  guard rail: they report what a switch could not move and what is in both halves at once, and the
  control says it out loud rather than leaving a user 97% private in silence. Spec: PC20-Nostr#25.
  They replaced `strandedInPublicHalf`, which answered only the private direction and was pinned to
  zero the moment the whole-list move shipped — so the one both-halves signal the app had went dark
  on the day it started to matter.
- **The move is ONE DIRECTION.** public→private may take another app's entries: it only reduces
  exposure, carries them whole, and anything that can decrypt can undo it. private→public may not —
  it publishes an `i` tag relays index and cannot be taken back, so it moves only what
  `baseline.private` claims. **Moved foreign entries are NOT claimed in the baseline**: nothing local
  backs the claim, so it would read as our own removal next cycle and delete them (defect 3 by
  another road). Pinned across two cycles, with the suite green under BOTH flag settings.
- **`local` IS A DATABASE, and the inbound reconcile is add-only — so `claimedByBaseline` is not
  enough on its own.** `runPull` posts `baseline: []` and the route refuses to delete anything the
  baseline never claimed, so an entry adopted while the mode was Private outlives a switch to Public
  and comes back in `local`, which goes wholly into the ACTIVE half. `withoutCarried` (in
  `favorites-privacy.ts`) is the second line: anything left on the other half after **its own merge**
  is not ours to republish into this one. Derived from the MERGED half, never the raw read — what
  this device claims there has already been removed by that merge, which is what lets a real mode
  switch still complete. **Present in the active half wins**: dropping an entry that is in both would
  drop it from `publishedRecordFrom` too, un-claiming something we do publish and making it foreign
  forever. Measured before the fix: 284 in the tags, 287 encrypted, all 284 in both.
- **`["visibility","public"|"private"]` states the mode, and it outranks the inference.**
  Multi-letter so relays cannot index it — `#v=private` would enumerate the pubkeys that keep a
  private list. `parseSingleList` reads it into `ParsedSingleList.visibility` and does NOT let it
  fall through to `foreignTags` (that would emit it twice, the second copy stale), and it drops one
  found inside the private half, where the mode is a claim no reader may act on. `withVisibility`
  adds it to the EVENT's tags only; `tagsFromNodes` builds both halves and must stay ignorant of it.
  **Absent is a real answer**, so nothing defaults it: a legacy list is not stamped with a mode
  nobody picked, and on a list that already has a private half that stamp is what would license
  disclosing it. Only `userChose` — the same signal as `intent: 'resolve'` — may write or change it,
  and only a writer that can read BOTH halves may change it. With the tag present the
  private → public whole-list move is licensed; without it the old conservative rule stands. Spec:
  PC20-Nostr, "The list is public or private, and the event says which".
- **The mode is per-app and per-device; the event is shared, and nothing on the wire says which half
  it intends to be.** So two apps can hold opposite answers and whichever loads last silently
  rewrites the whole list. `publishGate` holds an AUTOMATIC publish when the stored mode names an
  empty half while the other holds entries, and `FavoritesModeConflictNotice` asks. Three things it
  must not do: adopt the wire's mode by itself (that discards a stated privacy choice), fire on a
  list that really is in both halves (that is ambiguous, not contradictory — `seedModeFromWire`
  already answers `null` there), or compute a verdict from an **unreadable** private half, which
  presents as an empty one and would tell a private user their list is public. `intent: 'resolve'`
  is the only thing that publishes over it, and only the privacy control and the notice pass it — a
  heart tap does not consent to moving the whole list between halves.
- **`seedModeFromWire` has each half answer only for itself.** Public-first fails open: a device
  seeded `'public'` over a private account republishes every decrypted entry as a plaintext, indexed
  tag. Both halves, or neither, means **ask the user**.
- **An unreadable private half is a DEGRADED READ, not an empty one** — same exit as a silent relay
  for anything that would have to TOUCH it: seeding a mode, a private-mode publish, a publish on a list
  that says private, the reconcile. `decodePrivateFavorites` returns **null** for valid JSON that is
  not a tag array, and that is the guard that matters: a `JSON.parse` succeeding on a non-array marks
  the blob readable-and-empty, and the next republish rewrites `content` from those empty lists.
  **A PUBLIC writer on a list that does not say private still publishes the public half**, carrying
  the ciphertext byte for byte (`publishPlan` with `canReadPrivate: false` returns `privateTags: null`,
  which `buildContent` turns into the bytes it read, and the private claims are carried, not cleared).
  Refusing that too — which this app did until spec vector 12 caught it — stranded every favorite a
  NIP-55 user made here the moment any other app put anything in `content`.
- **NIP-55 and read-only nip05 sessions cannot encrypt.** `nip55-client.ts` implements `sign_event`
  only. That is a normal state for a real user, not an error — gate on `signerSupportsNip44()` and
  **state the reason on screen**, because a phone has no hover for a `title` tooltip.
- **`?` is written as its six-character JSON escape** in the plaintext. Amber URL-decodes the whole
  `nostrsigner:` URI then splits on `?`, and item guids are routinely permalink URLs. This app signs
  over NIP-46 and is unaffected; BMB reads what we write and may not be.
- **Plaintext stays under 60,000 bytes.** NIP-44 v2 as first published capped it at 65535, and a
  library built to that text rejects anything past it — which reads as an empty list, not an error.

**`content` is CARRIED, never written by an app that does not use it.** This app puts nothing there and reads nothing from it, and it must still return `event.content` byte-for-byte on every republish — `fetchSingleList` captures it and `templateFromTags` takes it with **no default**. The rule is not in the spec: rule 4, *carry what you can't read*, is written about **tags** and says nothing about `content`, so a writer following the document to the letter republishes the empty string the format has specified from the start. `content` is the only free slot in a one-event, many-writer format, and Boost Me Bitch puts a NIP-44 private half there. Blanking it deletes another app's data silently, on someone else's device, with no undo, on an event that keeps no history. A default parameter is how a `''` gets written back in by habit, which is why there isn't one; `singleListTemplate` builds a list from scratch and legitimately passes `''`. The digest gate is unaffected — unchanged tags publish nothing, so `content` is not rewritten either.

It **replaced** the two-list NIP-78 kind:30078 design, which proved overcomplicated and has been deleted from both this repo and the spec repo. Events at `d:podcast:favorites` and `d:podcast:favorites:items` are still on the relays and are the rollback path; nothing in this app reads or writes them.

Files: `lib/nostr/pc20-identifiers.ts` (the NIP-73 vocabulary, which outlives any one format), `lib/nostr/favorites-single-list.ts` (build + parse + fetch), `lib/nostr/relay-read.ts` (the trusted read), `lib/nostr/favorites-sync-client.ts` (DB→identifier mapping, debounce, publish, pull, sync health), `app/api/favorites/sync-shared/route.ts` (inbound reconcile), `app/api/favorites/sync-items/route.ts` (what this device holds, as identifiers).

**Do not read the sync input from the display endpoints.** `loadLocalItems` used to call `/api/favorites/albums` and `/api/favorites/tracks` — the two `/favorites` renders from — and keep three fields per row. Those resolve publisher artwork through Podcast Index and scan the `Feed` table, and the whole payload sat in front of the signing prompt: 1,272,733 bytes and ~1,260ms to extract 45,807 bytes of identifiers, paid twice on `/favorites` because the page fetched the same thing. `sync-items` runs the same id ladders and selects only `guid`/`medium`/`type`. What it must NOT diverge on is what changes the SET of favorites: `favorite.type || feed.type` for albums (the stored type wins, and `buildLocalItems` drops publishers on the strength of it) and the title+artist dedup for tracks.

**A failed load must THROW, never resolve to `[]`.** The merge reads "published once, absent locally" as a removal, so one failed request answered with an empty list republishes an empty event over the user's entire list. `syncSharedFavoritesNow` catches it and reports a degraded sync — the same answer a degraded relay read gets.

**The debounce is 600ms** (was 1500ms), sized off the burst it exists to absorb: favoriting an album writes one `FavoriteTrack` per track, measured at 12ms apart in production. Each cycle costs one signing prompt, so do not shave it without a number that concrete.

## An entry names its own feed, and only `medium` is positional

An item entry is `['i','podcast:guid:<feed>','podcast:item:guid:<item>']` — it carries the guid of its feed on its own tag, so reordering the array moves nothing. `medium` is the exception and is still a running value: it applies to every entry after it until the next `medium` tag, and an entry before any `medium` tag has an UNKNOWN medium that nothing may default.

- **Nothing is on this list for structural reasons.** A feed entry appears only when the user favorited the feed, so a reader never has to work out whether an entry is a favorite or scaffolding. A group this app holds only to supply its items' feed guid says `favorited: false` and emits its items and no feed tag.
- **Unfavoriting a feed while a track of it stays favorited is an ordinary removal.** It used to be invisible: the placement group and the favorite were the same bytes, so the removal could not be stated until the last track went too. That is what the first revision cost — 82 favorited feeds, 159 distinct parents, **196 groups**, 114 of them feeds nobody chose on a list relays index under `#i`.
- **A feed entry our own record does not claim is another app's.** Not holding it here does not beat it: delete it and that app restates it next cycle, and the two rewrite the event at each other forever. The record is the only thing that separates our removal from their addition.
- **The LEGACY two-element item is still positional and reading it stays mandatory.** `['i','podcast:item:guid:<item>']` takes its feed from the entry above it. A writer rewrites such a tag once, WHOLE — the identifier moves to position 2 and position 1 becomes the feed's. An item whose feed nobody knows goes back as it arrived, in band 0, ahead of every feed entry in its run.
- **A track whose feed has no `<podcast:guid>` cannot be expressed** and is dropped on write. The two-list format could carry it parentless. No favorite is in that state today; the fix is an admin reparse, not an invented parent.

## A republish renders from `nodes`, never from `groups`

The parse returns an **ordered node list**. `groups` and `orphanItemGuids` are a *projection* of it (`projectNodes`) holding only what this app can model; `nodes` is what also carries foreign tag types, foreign `k` values, `podcast:publisher:guid` entries and malformed `podcast:guid:` values — whole and in position. Spec §4, *Carry what you can't read*.

**Rendering the projection compiles, type-checks and silently deletes every one of them on the other app's behalf.** That is what shipped until 2026-08-14 (#216). There is no failing test, no error and no visible symptom on this device; the entries are simply gone from someone else's app.

- **`tagsFromNodes(nodes, foreignTags, foreignKinds)` is the only entry point for anything derived from a READ.** `tagsFromGroups` exists solely for `buildSingleListTags`, which builds from local state where there is nothing foreign to carry. Reaching for it after a read is the bug.
- **A `LooseNode` re-emits `tag` WHOLE** — never rebuilt from what we understood of it — so a third element the spec reserves and nothing uses yet survives the round trip.
- **A loose node does NOT close the open feed group.** An `i` we can't read sitting between a feed and its items must not re-parent the ones after it. Dropping a non-UUID `podcast:guid:` here reparented every item after it to the previous feed — well-formed, and invisible.
- **Position is the data, which is why the model has to hold it.** Re-emitting unreadable entries at a fixed place rather than where they sat makes two apps rewrite the event against each other forever, each publish locally reasonable, the only symptom being that it never stops.
- `foreignTags` replay in read order ahead of the entries (they take no part in grouping); `foreignKinds` append after the `k` tags we derived.
- **`k` tags are derived from what was ACTUALLY emitted**, in emission order — never from the model, or a `k` could name a kind that isn't on the list.

- **Inside a group, items keep their WIRE order and a new one goes at the end.** `mergeSingleList`
  emitted `mine.itemGuids` first until 2026-09-02; Boost Me Bitch keeps what it read, so each app's
  publish put a group's items in ITS order and the other's next cycle put them back — the event
  rewritten on every load for three weeks, every publish locally reasonable. Tag order is semantic,
  so that was the meaningful part of the event moving. Spec vector 18.
- **A group this device published and no longer finds on the wire is NOT re-appended** unless it
  holds something genuinely new under it. Another app removed it; re-adding it is the resurrection
  loop in the other direction (spec vector 9). The published record still claims it while it is held
  here, so an unfavorite-and-refavorite (which drops and re-adds the row) publishes it again.

Where the spec's two ordering rules conflict — preserve read order vs. keep same-medium feeds contiguous — **contiguity wins**. Reordering within a medium block costs nothing because items always follow their own group; breaking contiguity silently re-labels every entry after the boundary.

## The event has no baseline, so this DEVICE keeps one

The format cannot tell "another app added this" from "I removed this" — a publish replaces the event with what this app holds, and a reader learns nothing about who wrote what. But a writer still has to answer that question, so this app records what it published in `localStorage['sk_single_list_published:<pubkey>']` (`{feeds, items}`, beside the digest). Nothing on the wire changes; it is local memory, not the kind:30078 baseline returning.

**Four production bugs on 2026-08-13 came from having some of the rules below and not others.** They are individually correct and only work together — check all four before changing any of them.

1. **An itemless group is a real favorite; a group with items is unknowable.** The reconcile creates a `FavoriteAlbum` for incoming feed guids, and a placement group is indistinguishable from a chosen one, so without this it manufactures favorites — reading our own list back would have created **114** (#210). **This is the INBOUND rule and it still stands**, even though this app no longer writes a placement entry: it is about what another writer may have put on the list, and a writer still on the old rules writes them. Loosening it waits on confirming Boost Me Bitch's stage 3.
2. **The merge drops what we published and no longer hold, and carries what we never published.** Getting "foreign" to mean "not in our favorites" made an unfavorited album carry forever, get read back as an itemless group, and be re-created by rule 1 — unfavoriting undid itself on every load (#212).
3. **The published record is written on the digest-unchanged path too.** Writing it only after a real publish left it empty forever on a device whose list already matched, so rule 2 could never engage (#213).
4. **The inbound reconcile applies the same filter** (`suppressOwnRemovals`). `runPull` is read → reconcile → push, so between an unfavorite and its publish the list still carries the entry; the reconcile re-creates the row, the push then sees it as local, produces identical tags, and the digest gate skips it. Nothing ever propagates (#214).

An **empty record must treat nothing as a removal and suppress nothing** — a device that has agreed to nothing may not delete anything, and suppressing on a fresh device would hide the user's own library from the reconcile.

**StableKraft seeds, Boost Me Bitch reads,** and that is what keeps the whole thing safe. The record makes a second writer *survivable*, not safe: two apps publishing concurrently still race, because there is no merge. Inbound removals from another app do not propagate — the reconcile is passed a permanently empty `baseline`, so it may add but never delete.

## The medium hint

Position: a `["medium", …]` tag applies to every entry that follows it until the next one. Same-medium feeds must stay contiguous or entries get silently re-labelled.

- **Published only from `Feed.medium`, never `Feed.type`.** `type` defaults to `"album"`, so publishing it would be guessing, and a guess here is sticky across every app that reads it.
- **Groups with no medium are emitted FIRST**, ahead of any `medium` tag. Every alternative is worse: appending them inherits whatever was declared last, and inventing `["medium","unknown"]` writes a value no reader was told about.
- **On READ, an entry before any `medium` tag is UNKNOWN, not `podcast`** — a deliberate divergence from the spec's stated default. This app writes its own unknown-medium groups in exactly that position, so honouring the default would round-trip "not told" into "podcast" and file a music release under Podcasts. The hint is advisory and a resolved answer wins.
- `/favorites` reads the medium into a Podcasts tab that only appears when there is something in it. The split is `medium === 'podcast'`, falling back to `Feed.type` only for rows whose medium hasn't been parsed yet; anything unknown stays where it has always been rather than being called music.

## `k` tags — one per distinct KIND, trailing

**The spec's rule since PC20-Nostr #8, which this implementation drove.** An earlier revision paired a `k` with every `i`; this app writes one per kind at the end and READS both forms. They carry identical information — `k` names an identifier kind and the kind is already the identifier's prefix — but the paired form cost **423 tags holding two distinct values, ~11 KB of a 36 KB event**. Trailing is safe because only `i` and `medium` are positional.

A reader must take an entry's kind from position 1. One that walks `i`/`k` in pairs will not read what this writes.

**Kinds come from the table in `identifierKind`, never string-scanning.** `Track.guid` is routinely a permalink URL, so "everything before the last colon" yields `podcast:item:guid:https` — a tag no relay filter matches, breaking discovery with nothing visibly wrong. Pinned by a test.

## The trusted read (`relay-read.ts`)

`trustworthy: false` means "nothing answered", NOT "the list is empty". The two are indistinguishable at exactly one point in the pipeline, and the wrong call there wipes a library.

- **It cannot be built on `pool.subscribeMany`'s aggregate `oneose`** — that was a bug for the feature's whole life, found only once there was a harness scripting a misbehaving relay. Two non-answers fold into that callback and both report as an answered read: (1) `AbstractRelay.baseEoseTimeout` (4400ms) **synthesizes** an EOSE on a timer when a relay never sends one — under the 5s default, so a relay that accepted the socket then said nothing read as `trustworthy` (measured, 4424ms); (2) a **failed connection** also counts, so an offline device reported `trustworthy` in **19ms**.
- So the read subscribes **per relay**: answered means connected *and* sent a real EOSE inside the window. The bar is `reached > 0 && answered === reached`.
- `eoseTimeout` sits just past our own deadline — **a large value leaves a real timer pending long after the read returns** (110s of dangling timer once, which is why a test file took 114s).
- `CONNECT_TIMEOUT_MS` (2s) is capped well under the overall budget because **one dead relay sized to the full remaining budget burns the entire window** — `wss://nostr.oxtr.dev` did exactly that, turning every read into 5s.
- **`EOSE_TIMEOUT_MS` (2s) caps the wait AFTER connecting, for the same reason.** The connect cap alone does not help a relay that accepts the socket and then says nothing: its per-relay timer used to be the whole remaining deadline, so it held the read open to the full 5s while every other relay had answered. Measured in production 2026-08-20, reads pinned at 5006–5007ms with nine of ten relays answering in 33–1073ms. The verdict is unchanged — a silent relay is still unanswered, still degrading an empty read — it just arrives sooner. **The cap has a hard constraint**: it must stay under `baseEoseTimeout` (4400ms) and `eoseTimeout` must stay above it, or the synthetic EOSE lands inside the window and a silent relay reads as trustworthy. `eoseTimeout` is now sized off the per-relay wait, not the overall timeout.
- **A failed relay is remembered for 5 minutes and skipped** (`relay-health.ts`, `localStorage['sk_relay_unreachable']`). Without it the same dead relay is paid for on every read. It trades a little safety for a lot of time, and **three limits are what keep the trade honest — do not remove one without the others**: (1) nothing is recorded unless another relay answered in the same read, so an offline device does not write off every relay it has; (2) at most half the set is ever held back, so a majority still answers; (3) notes expire in 5 minutes and a relay that answers is cleared at once. The risk being bounded is that a skipped relay has recovered and holds a *newer* copy of the event — reading a stale one and republishing over it is how this list loses entries. Pinned by `relay-health.test.ts`.
- **Read the `🛰️ relay read` line before theorising.** Both halves above report per-relay outcomes for exactly this reason: the first diagnosis of the 5s read blamed `relay.damus.io`, which was 503ing — but a 503 rejects in ~206ms and cannot account for 5007ms. The real culprit was `filter.nostr.wine`, and one reload with the line in place found it.
- **A merely unreachable relay drops out of the denominator; one that hangs makes the read degraded.** Deliberate asymmetry: a default list can ship a dead relay, so counting unreachable ones would leave the feature permanently degraded, while a hung relay genuinely is an unknown.
- **Nothing prunes dead *defaults* automatically** — the memo above is per-device and expires — and there have been two (`relay.nsec.app`, then `nostr.oxtr.dev`). **A relay failing for one user is not evidence to remove it from the defaults**: `relay.damus.io` 503s in Chad's Firefox and answers in 269ms elsewhere, so dropping it would slow everyone to fix one browser. **Check a relay before adding one**: connect, send a REQ, require a real EOSE. `favorites.relay-probe.ts` does that against the live list and is the fastest way to spot the next one.
- **Author check at INTAKE, not on the winner** (`preferAuthoredEvent`). A foreign event with a high `created_at` would otherwise take the slot and displace the genuine one, and rejecting it afterwards discards the real event too — turning a good read into an empty one.

## Reporting failure

- **A degraded read is reported, not just handled** (`SharedSyncStatus`, rendered by `components/favorites/SharedFavoritesNotice.tsx`). A degraded read and an empty list render identically, so correct behaviour looks exactly like data loss — in the sibling app that produced half an hour of production debugging and a near-revert of a correct commit.
- **Read and write health are SURFACED as one flag but TRACKED as two** (`setSyncHealth('read'|'write', …)`). The push runs on every toggle, so one shared flag let a successful write clear a `degraded` raised by a failed read — the notice then vanished the next time the user favorited anything, taking the Retry button (the only thing that re-runs the pull) with it. Reporting success is worse than staying silent.
- **Every exit path must settle the status**, including a throw: the read opens with a dynamic `import('nostr-tools/pool')` that rejects offline — exactly the population the notice exists for — and an unhandled rejection left the flag pinned at `'syncing'`, which renders as nothing.
- **The status-cache invalidation is dispatched BEFORE the push**, not after. The push can throw, and an enclosing catch then swallowed the dispatch even though the reconcile had already written rows — stale hearts, i.e. issue #190 again.
- The pull is **single-flight, keyed on pubkey**. Unkeyed, an account switch without a reload joins the previous user's run and resolves with their result.
- `'off'` (not allowlisted) and signed-out both render nothing — there is no sync to fail, and claiming a relay problem would be a lie.

## Gates that are still on

- **The allowlist** (`SHARED_FAVORITES_ALLOWLIST` in `favorites-sync-client.ts`, unioned with `NEXT_PUBLIC_SHARED_FAVORITES_PUBKEYS`, npub or hex) is **not off by default** — it holds Chad's npub. Empty array *and* unset env means entirely off: no relay read, no publish, no reconcile, nothing on any page load. It exists because **this repo has no preview environment** — `git push origin main` IS the production deploy — and the pull effect fires for every signed-in user, so shipping ungated would publish everyone's favorites to a public list they never asked for. `NEXT_PUBLIC_` bakes at build time. **Deleting `sharedFavoritesEnabledFor` and its call sites is what "ship to everyone" means.**
- **The disclosure notice** (`components/favorites/SharedFavoritesDisclosure.tsx`) is the prerequisite for removing that gate, and it exists. Two states render nothing on purpose, and keeping them that way is what makes it a disclosure rather than a lie: signed out (no key, nothing published) and a `nip05` read-only session (no signer, so nothing is ever signed or sent). Deliberately **not** dismissible.
- **Reconciliation ships with deletes OFF** (`SHARED_FAVORITES_APPLY_DELETES`). It is the only destructive write, and `FavoriteAlbum`/`FavoriteTrack` rows are the only copy. With the empty baseline above it cannot delete anyway; the flag is the second lock. **Snapshot first**: `railway run --service StableKraft --environment production npx tsx scripts/backup-favorites.ts dump > favorites-$(date +%F).json`, restored with `restore <file>` (additive and idempotent).
- **Minting `Feed` rows from another app's list is OFF too** (`SHARED_FAVORITES_IMPORT_UNKNOWN`). BMB is a general podcast app and this one is music, so a shared list carries talk podcasts — and importing them writes rows into a catalogue with whole subsystems devoted to keeping non-music out. The guids still come back as `unresolvedFeedGuids`, which is how you see what a real list contains before deciding.
- **A sanity cap applies even when deletes are on**: a pass refuses to remove more than `max(5, 50%)` of eligible rows, logs `🛑`, and removes nothing.

## Reconciliation

- **Only what could have been on the wire is eligible.** `userId`-scoped (never `sessionId`), album/track only (publishers use synthetic `artist-*` ids and playlists are curated slugs — out of scope both directions), and resolving to a non-null guid. **Something that can never appear on the list can never be missing from it.**
- **The ADD loops must match every id format.** `FavoriteAlbum.feedId` and `FavoriteTrack.trackId` are both polymorphic (`Feed.id` vs `Feed.guid`; `Track.id` vs `Track.guid` — 99 of 235 favorite tracks matched `Track.id`, the rest matched `Track.guid`). The album loop once matched only `Feed.id` while the track loop beside it checked both, so a favorite stored under `Feed.guid` found no match and a **second row** was created, which `@@unique([userId, feedId])` cannot reject because the strings differ. The album then rendered twice. Keep the loops symmetric.
- **Unfavorite fires the shared sync outside the `nostrEventId` guard** (`FavoriteButton`). A kind-5 needs the id of the event it deletes, so a favorite whose 30001 publish once failed can never be unfavorited on that channel — this list has no such dependency.

## Both relay harnesses need a `WebSocket` global Node 20 lacks

This repo targets Node 20 (`.nvmrc`, `node:20-alpine`); the global only arrived in Node 21. `nostr-tools` captures it once at module load, so `installNodeWebSocket()` (`lib/nostr/node-websocket.ts`) supplies `ws`. **It patches three places and all three are load-bearing**: the global, plus `useWebSocketImplementation` on **both** the CJS and ESM copies of `nostr-tools/pool` — this repo is CommonJS, so a static import resolves the CJS build while a dynamic `await import()` resolves the ESM build, two module instances with two `_WebSocket` variables. **The symptom points nowhere near the cause**: the degraded-read cases keep passing (a failed connection is indistinguishable from the degradation they assert) while only the "a relay answers" cases fail, and the probe reports **every** default relay dead. Reproduce on a newer Node with `NODE_OPTIONS=--no-experimental-websocket`. (This is also why the helper aliases the import: eslint reads any `useFoo()` call as a React hook and `next lint` errors.)
