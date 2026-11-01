---
name: mobile-layout
description: "Use when working on layout, especially on phones: content hidden under the status bar or navigation bar, safe-area insets and --sk-safe-*, a control cut off at the bottom of the screen, the player bar overlapping page content, --sk-player-reserve, a visible band above the player bar, a pinned header that does not stay pinned, inner-scroll pages, the Now Playing screen layout, artwork stretched into a rectangle, buttons inflated by the OS font-size setting, the mobile album/podcast page, an untappable account avatar, floating buttons, the back/home button row, toasts, or a settings row whose description text is squeezed into a narrow column beside its control."
---

# mobile-layout

Layout and chrome, mostly mobile. Verification here is measurement with puppeteer-core, not eyeballing — each section says what to assert.

## Tests for this subsystem

```
npx tsx --test lib/album-detail-routes.test.ts      # which routes render AlbumDetailClient
node lib/ui-menu-scroll.browser-probe.mjs           # UserMenu dropdown + LoginModal reachability (needs `npm run dev`)
node lib/settings-row-layout.browser-probe.mjs      # Settings rows keep their label width on a phone (needs `npm run dev`)
```

---

## A `justify-between` row on a phone pays for the control out of the label
`SettingsRow` (`components/Settings/SettingsLayout.tsx`) is label-left / control-right. The control is
`flex-shrink-0` — correct, a segmented control or an input must not be squashed — so the label column was the only
part that could yield, and it yielded all of it. Reported from a phone against **Favorites on Nostr**, whose three
options are ~262px wide: measured at a 393px viewport the description got **61px and wrapped to 19 lines**, one
word per line down the side of an otherwise empty row, while the options themselves hung 15px past the right edge
of the screen. Every row on the page shares the shape, so the same defect sat on Default Boost Name and both
Danger Zone buttons.

- **The row is `flex-wrap` with a `basis-56` floor on the label** (`min-w-0 grow shrink basis-56`). The label never
  drops below 14rem, so a control that no longer fits beside it wraps to its own line and left-aligns under the
  description. Anything narrow — a toggle, a 96px number input — still sits on the right at 360px and wider; below
  that (Android Display size turned up) every row stacks.
- **Write it as `grow shrink basis-56`, never `flex-1 basis-56`.** The `flex` shorthand also sets `flex-basis`, so
  which value wins depends on Tailwind's emission order rather than on the order you wrote the classes — the same
  equal-specificity trap as `text-gray-400` vs `text-white` on the album page icons.
- **The control wrapper needs `max-w-full` alongside `flex-shrink-0`.** `max-width` still clamps a flex item that
  cannot shrink, so a control wider than the line wraps inside itself instead of pushing the page sideways.
- **A control that wraps onto its own line must not be right-aligned.** `FavoritesPrivacyControl`'s radiogroup is
  `justify-start`; on a wide row it is flush right anyway (the box is sized to its content), so `justify-end` only
  ever decided where the wrapped third button landed — and on a phone it floated the group away from the text it
  belongs to.
- **Once rows stack, the gap between rows has to beat the gap inside one.** `SettingsSection` is
  `space-y-6 sm:space-y-4` against the row's `gap-y-3`, or a control reads as belonging to the label *below* it.
  The Auto-Boost pair in `UserSettings` sits outside that container and carries its own copy.
- **Don't hand-roll the shape.** `DangerSettings` had its own `flex items-start justify-between` + `flex-1` +
  `flex-shrink-0` copy and therefore its own copy of the bug; it uses `SettingsRow` now, whose `description` takes
  a `ReactNode` so a live favorites count can live in it.
- **Verify by measuring:** `node lib/settings-row-layout.browser-probe.mjs` (needs `npm run dev`). It seeds the
  allowlisted pubkey into `localStorage` so the real `FavoritesPrivacyControl` renders — a logged-out `/settings`
  does not show the row this was reported against — and asserts both halves across six viewports: the label keeps
  its width and the page never scrolls sideways, **and** the NIP-38 toggle still sits beside its label. A fix that
  only checks the first half is a fix that has quietly stacked every row on the page.

---

## Every `position: fixed` panel needs a height bound and its own scroll
A fixed overlay that outgrows the screen is not merely cut off — it is **unreachable**. The document cannot scroll a
fixed element into view, so without `overflow-y: auto` on the element itself there is no gesture that gets to its
last row. `UserMenu`'s dropdown was `top: 80px` with no `max-height`, and its last row is **Sign in with Nostr**: on
a Pixel 4a with Android's Display size turned up and a wallet connected, logging in was impossible (measured: the
button at y≈1247 in a 693px viewport). Nothing about this is visible at desktop sizes or at a 1.0 font scale.

- **The form is `maxHeight: calc(100dvh - <top offset> - var(--sk-safe-bottom) - 1rem)` + `overflow-y-auto
  overscroll-contain`.** The `1rem` gutter keeps the last row off the screen edge; `overscroll-contain` stops a
  flick at either end from chaining out to the page behind the backdrop.
- **`dvh`, never `vh`.** `vh` is the viewport with mobile browser chrome *hidden*, so a `max-h-[90vh]` card still
  overflowed the visible area while Chrome's toolbar was up — which is exactly what `LoginModal` did. A centred
  card in a non-scrolling `fixed inset-0` backdrop then clips at **both** ends, so the overflow isn't even all in
  one place.
- **A fixed panel anchored to a `--sk-safe-top`-offset trigger must include that inset in its own offset.** The
  dropdown's hardcoded `top: 80px` drifted away from its trigger (`top: calc(1rem + var(--sk-safe-top))` in
  `AppLayout`) under the native app's status bar.
- **Measuring this: `isMobile: false` in `setViewport`.** With mobile emulation on, Chrome shrink-to-fits the
  layout viewport as soon as content overflows horizontally, so `getBoundingClientRect()` stops being in
  visual-viewport coordinates and **every edge assertion compares against the wrong number** — a correct fix
  measures as still broken. Sweep the root font-size 1.0→2.0× at 320×693; the bug does not appear at 1.0×.

---

## Safe-Area Insets — always `var(--sk-safe-*)`, never bare `env(safe-area-inset-*)`
`targetSdk 36` forces edge-to-edge, so the native Capacitor WebView draws under the status and navigation bars. **Chromium does not reliably report Android *system bar* insets through `env(safe-area-inset-*)`** — which is exactly why Capacitor 8's built-in `SystemBars` plugin injects `--safe-area-inset-{top,right,bottom,left}` onto `<html>` instead (`injectSafeAreaCSS` in `SystemBars.java`; it does this *even in the passthrough branch*, which is the tell). Bare `env()` resolved to `0` on LineageOS and the Now Playing transport row ended up under the nav bar (issue #165).

- `app/globals.css` `:root` defines `--sk-safe-top/right/bottom/left`, each `max(var(--safe-area-inset-*, 0px), env(safe-area-inset-*, 0px))`. **Every consumer uses those** — `globals.css` utilities (`.pb-safe`, `.pt-safe-plus`, …), `NowPlayingScreen`, `GlobalNowPlayingBar`, `ShareLinkButton`, `AppLayout`, `RadioPlayer`. Adding a new inset-aware surface? Use the var.
- **Not double-padding**: when Capacitor pads the WebView's parent instead of passing insets through, it computes the injected values from a *zeroed* inset set and injects `0px` — so the var is 0 exactly when the WebView is already physically inset. On iOS and desktop the var is absent and `env()` wins unchanged.
- Ships via **web deploy** — it reaches installed APKs without a new release, since the APK is a thin WebView over the live site.
- **Verification needs a 3-button-nav device.** On gesture nav the bottom inset is the thin gesture pill (~24dp) rather than a ~48dp button bar, so the symptom is far less visible or absent.
- **Top insets only appear in a standalone PWA / the native app, never in Safari.** Browser chrome absorbs the status bar, so a page whose top padding is a fixed value looks correct in Safari and renders its first row under the clock once installed to the home screen. Test from the home-screen icon, not the browser. Two pages (`/publisher`, `/downloads`) carried this bug for a long time precisely because they were only ever checked in Safari — they had 8–12px of slack, enough for a 20–24px inset but not a notched iPhone's **59px**.
- **Any page-level top padding needs `pt-[calc(var(--sk-safe-top)+Npx)]`**, keeping the old fixed value as `N` so devices reporting no inset are unchanged. Include the inset in `md:`/`lg:` overrides too — an iPad in portrait is 820px wide, past `md:`, and still has an inset in standalone. Current call sites: `AlbumDetailClient`, `PublisherDetailClient`, `DownloadsClient`, `PlaylistTemplateCompact`. The playlist one was found the same way as `/publisher` and `/downloads` — reported from an installed PWA, invisible in Safari — so when adding a page, assume it has this bug until checked from the home-screen icon.
- **Auditing insets with puppeteer: inject via `addStyleTag` *after* `goto`, never `evaluateOnNewDocument`.** The latter appends the style to a document that navigation then replaces, so `--sk-safe-top` silently resolves to `max(0px, 0px)` and **every page measures as if there were no inset** — a full audit will report all-clear against a real bug, and will report a correct fix as still broken. Verify the harness itself by asserting `getComputedStyle(document.documentElement).getPropertyValue('--sk-safe-top')` is non-zero before trusting any result.

---

## Bottom of the page — `--sk-player-reserve`, and the strip above the player bar
`GlobalNowPlayingBar` is `position: fixed; bottom: 0; z-50` (inline styles, **not** Tailwind classes — `.fixed.bottom-0` selectors do not match it). It overlays page content, so pages must keep room clear beneath them, and that room must be **exactly** the bar's footprint. Measured heights: **89px mobile, 81px at md+**, plus `--sk-safe-bottom`.

- **`--sk-player-reserve` (`app/globals.css`) is the single source for that number.** It is `0px` by default and only becomes `calc(88px + var(--sk-safe-bottom))` (md+: `80px`) under **`:root[data-player]`**, an attribute `GlobalNowPlayingBar` sets on `<html>` while it renders. Two consumers: the layout content wrapper's `pb-[var(--sk-player-reserve)]` (`app/layout.tsx`) and `app/favorites/page.tsx`'s height. Don't re-inline the numbers — they were duplicated once and immediately drifted.
- **Reserve too much and you get a visible band; reserve unconditionally and you get one whenever nothing is playing.** The wrapper is transparent above a `fixed inset-0` artwork layer, so *any* reserved padding the bar doesn't cover is bare background. A flat `pb-28` (112px) exceeded an 89px bar and showed 23px in Safari; making it unconditional then showed the full strip on the zapstore build with nothing playing. The 88/80 values sit 1px under the measured bar so they can never overshoot.
- **Safari reports a `0` bottom inset while its toolbar is showing; the PWA reports ~34px.** These are genuinely different geometries — a bottom-edge bug can be invisible in one and obvious in the other, so check both. There is deliberately **no** `body { padding-bottom }` in the standalone media query; it used to be there and pushed every page's background up while the bar stayed anchored.
- **Floating bottom overlays must clear the bar too.** `BackToTop` and `ToastContainer` sit at `bottom-[calc(var(--sk-safe-bottom)+6.5rem)]`; `bottom-24` (96px) put them behind a notched iPhone's 123px bar. `ShareLinkButton` instead returns `null` whenever `currentPlayingAlbum` is set, so it never coexists with the bar — don't "fix" it to offset as well.

---

## Pages that own the viewport (inner scroll) — `/favorites`
`app/favorites/page.tsx` is a flex column that scrolls an inner element rather than the document, so its header stays put (`973fcfef`). Two things are load-bearing and both were broken in practice:

- **The root height must subtract the reservation: `h-[calc(100dvh-var(--sk-player-reserve))]`.** A bare `h-[100dvh]` plus the layout wrapper's padding makes the *document* taller than the viewport; the body then scrolls ~88–122px and drags the whole page — "pinned" header included — up off the top. That is what "the header doesn't stay pinned" actually was.
- **iOS still elastically drags the document when a gesture starts somewhere non-scrollable** — i.e. on the pinned header itself. The page sets `overscroll-behavior: none` on `<html>` while mounted (restored on unmount, so pull-to-refresh is unaffected elsewhere) and `overscroll-contain` on the scroll port so reaching the end of the list can't chain out. `NowPlayingScreen` applies the same property plus a heavier `position: fixed` body treatment, which is the fallback if the light version ever proves insufficient.
- **Only the Back/Home row and the tabs are pinned.** The title, subtitle and Sync button live in the scroll area — pinning the whole header cost ~240px, about 30% of a phone screen. There are **five** tabs and the row is horizontally scrollable by design.
- **`BackToTop` drives `[data-scroll-container]` when one exists**, falling back to `window`. It is mounted in the root layout, so it runs **before** a page renders its scroll port — a single `querySelector` finds nothing, silently binds to a window that never scrolls, and the button never appears. It uses a `MutationObserver` to rebind when the port shows up, and re-queries on pathname change. Any new inner-scroll page just marks its port with `data-scroll-container`.

---

## Now Playing Layout (`components/NowPlayingScreen.tsx`) — one flexible row, everything else fixed
The fullscreen screen is `fixed inset-0 overflow-hidden` at `100dvh`. That `overflow-hidden` **clips** — it does not scroll — so if the column's rows sum to more than the viewport, the excess is silently sliced off the bottom, which is where the transport controls live. The original layout gave every row a fixed height (`pt-12` artwork + `pt-16` info + `pb-6` progress + `pb-4` controls) around a hard `aspect-square` cover, so nothing could yield and the play button was cut in half on a 3-button-nav Pixel 4.

- **Exactly one row may flex: the artwork** (`flex-1 min-h-0`). Every other row is `flex-shrink-0`. Adding a row? Make it `flex-shrink-0` — if you make a second row flexible, space distribution becomes unpredictable and the guarantee is gone.
- **This is not a safe-area bug and more `paddingBottom` makes it worse.** The container's `max(var(--sk-safe-bottom), 20px)` was always correct; the content simply exceeded it. See the Safe-Area Insets section above.
- **The artwork stays 1:1 via `container-type: size` on the wrapper + `width: min(100cqw, 100cqh)` on the cover.** Do **not** "simplify" this to `height:100%` + `aspect-ratio:1/1` + `max-width:100%` — height wins, `max-width` clamps only the width, and the cover silently becomes a **portrait rectangle** (measured 421×280 on a tall screen). The container-query form sizes the square to whichever axis is scarcer.
- **Touch targets are px, never rem.** Android's Font size setting (and Android 14 accessibility scaling to 2.0×) scales the root font size, and Tailwind's `p-*`, `w-*`, `max-w-*` are all rem — so the OS text setting was inflating *buttons*, not just text. At 1.5× the 5-button transport row wanted ~480px inside a 393px screen and shuffle/repeat ran off the edges; the action circles got squeezed into ovals. Transport and action buttons now carry explicit `width`/`height` in px with `flex-shrink-0`, lucide icons use `size={n}` (px) rather than `className="w-6 h-6"`, and the row caps at `min(320px, 100%)` instead of `max-w-xs`. Only text should scale with the OS setting.
- **`UserMenu`'s trigger is the profile picture only — no display name, anywhere.** The name used to sit beside the avatar and was suppressed on Now Playing alone (via a `showName` prop, now deleted) because it crushed the album name in the flexible middle slot from 182px to 25px. It was dropped globally after the same width covered album card titles on the home grid — the cluster is `fixed` over page content, and the name is what made it wide. The name still appears in the dropdown, which is what identifies *which* account. **The avatar slot must always render when authenticated** — do not gate it on `user.avatar`, and don't let a broken URL hide it (`onError` swaps in a placeholder rather than `display:none`). The hamburger beside it renders whether or not you're signed in and its colour encodes *wallet* state, not auth, so an empty slot reads as logged out — which is the one thing this cluster exists to convey.
- **Verification is measurement, not eyeballing** — and it must check **all four edges plus squareness**. A bottom-only check reported `PASS` while the artwork was stretched into a rectangle and, later, while next/repeat sat off the right edge. Drive the real component with `puppeteer-core` — **not a declared dependency**, it only resolves transitively through `lighthouse`, so `npm i -D puppeteer-core` if that path ever disappears — pointing `executablePath` at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Render at 393×829 (Pixel 4 logical px) with `--safe-area-inset-top`/`-bottom` set to `24px`/`48px` to stand in for the native shell, then sweep the root font-size 1.0→2.0×. Regression baseline: artwork square at every step, zero clipped controls, artwork ≥200px at 2.0×.

---

## Mobile Album/Podcast Page (`app/album/[id]/AlbumDetailClient.tsx`)
One component serves **both** `/album/[id]` and `/podcast/[id]`, so every change here lands on both. Mobile order is one "identity block" — artwork → title → artist → stats → description toggle — then the action row as the divider, then the track list. Do **not** move the stats or description below the track list: they are part of the album's identity and splitting them puts half a screen-scroll between the halves.

The page renders its background from the album artwork, so a translucent control has no fixed backdrop to contrast against. The mobile action row (shuffle · Boost · **$ funding** (only when the feed has a `<podcast:funding>` link) · favourite · download · share, `lg:hidden`) is the one place album-level actions live.

- **One mobile boundary for the whole page: `lg:` (1024px).** The left column, action row, description toggle, Tracks heading and `ControlsBar` are all `lg:`-gated. The track rows used to switch at `md:`, which produced a hybrid at 768–1023px — mobile chrome around desktop rows, per-track Boost visible, and no heading or ControlsBar at all. That band is real hardware (iPad portrait, most Android tablets, a Pixel 4 in landscape at 829px). Do not reintroduce `md:` into the track-list block; the remaining `md:` uses on the page are responsive typography and podroll/video grid columns, independent of this split.
- **Nothing on this page may sit at `z-40`, and prefer no fixed overlay at the top at all.** `AppLayout` renders `UserMenu` at `fixed top-… right-4 z-40`, occupying the rightmost 56px. A full-bleed bar that renders later in the DOM wins at equal z-index and **swallows taps on the account avatar** — pressing it fires the bar's own control instead, putting login/favorites/downloads/settings out of reach on every scrolled mobile album page. Two fixes are both required: drop below `z-40`, **and** inset the controls (`paddingRight: 68`) — z-order alone isn't enough, because the bar's transparent padding still intercepts.
- **The compact sticky header that taught this lesson is gone (2026-07-26); don't reintroduce it.** It pinned a thumbnail + title + shuffle + play to the top past 220px of scroll. Two independent problems, both reported from a real phone: it appeared while the cover (260px, starting ~76px down), the title and the whole action row were *still on screen*, so it was redundant and occluded what it summarized; and its full-bleed background ran edge-to-edge **underneath** `UserMenu`, so the avatar looked buried in it while the bar's own title truncated inside a 68px dead zone. Its Play duplicated `GlobalNowPlayingBar` (fixed bottom, `z-50`) whenever audio was loaded and track row 1 otherwise, and its thumbnail/title weren't even tappable. In three days it produced a blocker (untappable avatar) and an a11y bug (off-screen controls still tabbable). Cost of removal: shuffle-all now needs a scroll back up to the action row, since `ControlsBar` is `hidden lg:flex`. If that ever bites on a long podcast, show the Tracks heading row with a shuffle on mobile — **do not** add a fixed bar back.
- **The description is fully collapsed on mobile** behind an "About this album" / "About this podcast" chevron, expanding to the *full* text (no second Show-more step). Desktop keeps the inline 200-character preview. Both share one `descriptionExpanded` state so the presentations can't drift.
- **Per-track Boost is desktop-only** (`hidden lg:block` inside the row's action group). Boosting is tied to listening — on mobile it lives on Now Playing and the player bar, not behind the kebab of every row you're browsing. Album-level Boost is in the mobile action row.
- **The album-level `BoostButton` props live in one `albumBoostProps` object**, spread at both the mobile and desktop call sites. They were duplicated verbatim — the same failure family as the `/api/albums-fast` dual-select gotcha, where a later `remoteFeedGuid` or `persons` fix lands on one breakpoint and the other silently keeps sending wrong boost metadata.
- **Floating buttons hide themselves here.** `BackToTop` and `ShareLinkButton` would land on the track-row kebab column, so both call `isAlbumDetailRoute()` from `lib/album-detail-routes.ts` (tests: `npx tsx --test lib/album-detail-routes.test.ts`). It covers `/sandbox/album` too — that route renders the same component, and the predicate was previously copy-pasted into both components with that case missed in each. Add new floating overlays to the helper rather than re-inlining the check.

- **`className="text-white"` on `FavoriteButton` / `DownloadButton` / `ShareButton` is dead code.** Each renders a lucide icon carrying its *own* `text-*` class set directly on the element, so an inherited colour from the wrapper `<button>` never reaches it. All three take an **`iconClassName`** prop for this — use it. Defaults reproduce the historical grey (`text-gray-400 …`), so unstyled call sites (home grid `AlbumCard`, album track rows, Now Playing) are unaffected; only pass `iconClassName` where the surface actually needs a different colour.
- **Do not "fix" this by concatenating both classes.** `text-gray-400` and `text-white` have identical CSS specificity, so the winner is decided by emission order in the generated stylesheet, not by the order you build the string — it works or doesn't work arbitrarily across builds. An explicit prop is the only deterministic form.
- **Circles are `bg-black/45 ring-1 ring-white/25 backdrop-blur-md shadow-lg`, icons white at 20px.** The earlier `bg-white/[0.18]` washed out over pale artwork. Composited over pure white, `black/45` yields `#8c8c8c`, putting a white glyph at ~3.4:1 — above the 3:1 WCAG minimum for UI controls, so it holds over both dark and bright covers. `ShareButton`'s glyph size derives from its `size` prop (`sm` → 16px), so it needs an explicit px `iconClassName` (e.g. `w-[20px] h-[20px]`) to match its neighbours.
- **The circle must be the tap target, not just paint.** `FavoriteButton` / `DownloadButton` / `ShareButton` each render their **own** padding-less `<button>`, so a 44px wrapper `<div>` leaves the real target at the 20px glyph — the affordance lies about where to press. The wrapper carries `[&>button]:w-full [&>button]:h-full [&>button]:rounded-full` so the child fills it. Styling the child through `className` instead means fighting each component's own classes at equal specificity — the same emission-order trap as the icon colour above.
- **Boost is deliberately the only filled/coloured control** (yellow circle, black glyph, `iconOnly`). Keep the other four neutral — the contrast between "one primary action" and "four secondary ones" is the point; making them all coloured flattens the hierarchy. `iconOnly` also removes the last rem-sized *text* from the row.
- **The px-not-rem rule covers the expanded kebab group too**, not just the action row. Track titles are `min-w-0 truncate`, so when a rem-sized sibling grows the overflow surfaces as the **title silently shrinking to nothing** rather than as a clipped control — a collapsed-state sweep passes while an opened row at 2.0× has no title at all (measured 0px). Gaps and `ShareButton` padding there are px, and the title carries a `min-w-[64px]` floor.
- **Verify by measuring, not eyeballing**, with the same `puppeteer-core` recipe as Now Playing above (393×829). The sweep must exercise **both scroll positions** (to confirm nothing fixed occludes the track rows once scrolled) and **both kebab states** — every defect found in review survived an earlier sweep that only ran collapsed and at scroll 0. Assert: zero clipped controls, `document.documentElement.scrollWidth <= viewport` (**not** `document.scrollWidth` — that is `undefined`, so the assertion never tests anything), every interactive box ≥44px in the action row, `elementFromPoint` at the `UserMenu` centre resolving *inside* the menu **at both scroll positions** (this is the standing guard against the fixed-overlay class of bug above), no short `position: fixed` bar painting in the top band (when writing that check, exclude full-viewport backdrops — the album artwork background is legitimately `fixed inset-0 z-0` and a naive query flags it), and — crucially — re-probe `.favorite-button svg` / `.download-button svg` on the **home grid** to confirm they still compute `rgb(156, 163, 175)`; a shared-component change that only looks right on the album page is the failure mode here.

---

## BackButton (`components/BackButton.tsx`) + HomeButton
Uses `window.history.length`. Do NOT use `document.referrer` — doesn't update during SPA navigation.

`components/HomeButton.tsx` is a plain `Link href="/"` styled to match, rendered **beside** `BackButton` (never replacing it) on album detail, publisher detail, and `/downloads` — Back walks one step up the stack, Home escapes it entirely. `/podcast/*` has the row too, because it renders the same `AlbumDetailClient`. `/playlist/*` has the row as well (`PlaylistTemplateCompact`), except its Back is a plain `Link` to `/?filter=playlist` rather than `BackButton` — a named destination beats a history step there, and it keeps the existing "Back to Playlists" label; it borrows `BackButton`'s classes so the pair still reads as one control group. Routes without a Back row (`/favorites`, `/search`) deliberately don't have one yet; mount it globally in `layout.tsx` alongside `BackToTop` if that changes.

**Four routes render `AlbumDetailClient`**: `/album/[id]`, `/podcast/[id]`, `/album/beach-trash/demo`, and `/sandbox/album`. A change to that component lands on all four — and route-matching helpers that special-case the album page (e.g. `isAlbumDetailRoute` in `lib/album-detail-routes.ts`, which hides the floating buttons) must cover all four, not just the obvious two. Both copies of that predicate missed `/sandbox/album` before it was extracted.

**The `history.length` heuristic here is web-only — do not copy it into the Android back handler.** `AndroidBackButton` uses the native `canGoBack` payload instead, because `history.length` counts *total* entries and never shrinks, so it still reads `> 1` after you've stepped back to the first page. See the Android Hardware Back Button section.

---

## Toast API (`components/Toast.tsx`)
Event-driven via `window.dispatchEvent(new CustomEvent('toast', ...))`. Helpers `toast.success/error/warning/info(message, { duration, action })` return the toast id (string). Use `toast.dismiss(id)` to programmatically remove a toast (used by `signer-nudge.ts` to clear the "Waiting on your signer…" toast the moment signing completes).
