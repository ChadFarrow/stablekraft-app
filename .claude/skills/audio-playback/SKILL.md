---
name: audio-playback
description: "Use when working on audio playback behaviour in contexts/AudioContext.tsx: what happens at the end of an album, a track playing unprompted after switching apps, the wrong track title showing while different audio plays, currentTrackIndex, iOS PWA background audio, Android track transitions stalling when the screen is locked, the ping-pong dual audio element, a time display showing elapsed greater than total, a progress knob sliding off screen, or VTS (value time split) segment playback and chapter ticks."
---

# audio-playback

Playback state, track transitions and background audio. Payments triggered by playback (AutoBoost) live in `lightning-boost`; native Android keep-alive lives in `android-native`.

## Tests for this subsystem

```
npx tsx --test lib/playback-state.test.ts           # resume-where-you-left-off: session/position records
npx tsx --test lib/album-rewind.test.ts             # end-of-album rewind index (skips unavailable tracks)
```

---

## End of Album — rewind the media, not just the index (`contexts/AudioContext.tsx`)
When an album finishes with repeat off, `playNextTrack` rewinds to the first **available** track (`resolveAlbumRewindIndex`, `lib/album-rewind.ts`; tests: `npx tsx --test lib/album-rewind.test.ts`) and cues it **paused at 0:00** via `cueTrackPaused`. The branch used to be `setIsPlaying(false); setCurrentTrackIndex(0);` and nothing else, which produced four distinct bugs — every one of them a consequence of moving state without moving the media.

- **There is no `currentTrack` in the context.** `GlobalNowPlayingBar`, `NowPlayingScreen` and `RadioPlayer` each independently derive `currentPlayingAlbum.tracks[currentTrackIndex]`, so the displayed title is a pure function of the index and is *not* tied to `audioElement.src`. Only `playAlbum` normally keeps the two in step. **Any new code path that moves `currentTrackIndex` must move the media too** — that decoupling is the whole bug family.
- **`setIsPlaying(false)` does not pause anything.** It is React state; the element keeps playing. Skipping past the last track kept the previous song audible while the UI showed track 1. Pause the element explicitly (both of them — see the ping-pong section).
- **`cueTrackPaused` is deliberately not `playAlbum`.** `playAlbum` autoplays, sets `hasUserInteracted`, clears `userInitiatedPauseRef`, flips shuffle off, runs the seamless/ping-pong transition and toasts through the offline gate. The cue does a bare `src` + `load()` into the **active** element (never repoint `activeAudioRef` — that is the ping-pong promotion's job alone). **Every failure path leaves the element empty on purpose**, so `resume()`'s `hasUsableSrc` check reads false and the next tap cold-starts through `playAlbum`.
- **`albumCompleteRef` exists because the visibility net would otherwise start track 2.** The element stays `ended` after an album finishes (`handlePause` swallows the pause that accompanies an end), so the foreground-return net at the top of the file re-entered `playNextTrack` — which, post-rewind, advances from index 0 to **track 2, unprompted, on every app switch**. A successful cue clears `ended` by itself; the ref covers the paths where the cue leaves the element empty. Do **not** overload `trackEndProcessedRef` for this — it is a per-track double-advance guard with three writers. Clear `albumCompleteRef` at all six restart sites (`playAlbum`, `playShuffledTrack`, `playTrack`, `resume`, `stop`, `handlePlay`).
- **`userInitiatedPauseRef.current = true` at album end is load-bearing.** The net's *second* branch auto-resumes anything `paused && src && !userInitiatedPause` — after the cue all three hold, so without it an app switch auto-plays track 1.
- **`lastNonZeroPositionRef.current = 0` is load-bearing.** `resume()` falls back to it when the element's `currentTime` is ~0, which a freshly cued element always is — leave it and the first tap on play starts track 1 and immediately seeks it to wherever the *last* track ended.
- **`handleError` must not auto-skip when `albumCompleteRef` is set.** A cue has no `play()` promise to fail on, so a dead URL surfaces as an `error` event, and the existing 300ms auto-skip would call `playNextTrack` from the rewound index — the same "track 2 plays unprompted" bug in a new costume. `playbackSessionRef` does not guard it (the error arrives after the cue's own bump).
- **Persistence**: a completed album has no resume point, so the branch deletes `PLAYBACK_POSITION_KEY`. Otherwise the position effect writes the last track's end position next to the rewound index and the next launch restores minutes into the wrong track.
- **Shuffle end-of-playlist does not rewind** — a shuffled queue's "first" item is an artifact of the last shuffle. It stays on the track that just played, but stops for real (pause both elements + the same three ref resets).

---

## iOS PWA Background Audio (`contexts/AudioContext.tsx`)
Three-layer strategy: (1) preload at 15s before end, (2) proactive timer at 5s before end, (3) visibility change safety net. `trackEndProcessedRef` prevents double-advance. **Critical**: do not auto-resume if user explicitly paused. All three layers sit inside a `nextTrack` existence check, so none of them fire on the last track with repeat off — end of album is reached only via `handleEnded` or a manual/lock-screen Next.

---

## Android Background Audio — Ping-Pong Dual Element (`contexts/AudioContext.tsx`)
Android (Chrome / "add to home screen" PWA) drops `play()` when a track transition does `src=…; load(); play()` on the **same** `<audio>` element while the screen is locked — the `.load()` tears the element down and the follow-up `play()` counts as a fresh background autoplay, which Android blocks. Symptom: music stalls at every track boundary until the user wakes/foregrounds the phone (the visibility safety net was the only recovery). iOS is unaffected — it *relies* on the single-element seamless src-swap to keep its audio session warm.

Fix = **start the next track on a second `<audio>` element while the first is still playing**, then swap active + pause the old one — playback never fully stops, so Android doesn't block it. **Android-gated; iOS/desktop keep the single-element path untouched.**

- **Two audio elements**: `audioRef` (`#stablekraft-audio-player`) + `audioRefB` (`#stablekraft-audio-player-b`). `activeAudioRef` points at the current one; **it is only ever repointed inside the Android ping-pong branch**, so on iOS/desktop `getActiveAudioEl()` always === `audioRef.current`.
- **`getActiveAudioEl()` / `getIdleAudioEl()`** are the indirection. **Every "current playback element" access must go through `getActiveAudioEl()`** (never raw `audioRef.current`) — pause/resume/seek/stall-detection/media-session/NIP-38/visibility-safety-net all do. The media-session `seekto` handler and `stop()` were the easy-to-miss ones (`stop()` pauses **both** audio elements).
- **Listener guard**: media event listeners bind to **both** audio elements; each handler early-returns via `shouldProcess(e)` unless `e.currentTarget` is the true current element (`getActiveAudioEl()`, or the video el in video mode). Without this the idle element's preload events (`loadedmetadata`, etc.) would drive state — e.g. seek the active element to `startTime`.
- **Preload**: at 5s the cross-element preload targets `getIdleAudioEl()` on Android audio→audio (previously a no-op since `nextElement === currentElement`); `attemptPingPongPlayback` reuses it if `readyState >= 2`.
- **Transition path**: `attemptPingPongPlayback(track, album, sessionId)` runs **before** `attemptSeamlessPlayback` in both `playAlbum` and `playShuffledTrack`, gated `isAndroidRef.current && !isVideoMode`. Audio-only (returns false for video/HLS → falls through). On failure it falls through to the existing seamless/full path (no regression). A platform-neutral stopgap (reassert `playbackState='playing'` + one `NotAllowedError` retry, no second `load()`) also lives in `attemptSeamlessPlayback`.
- **Promotion must adopt the new element's clock** (issue #166). `handleLoadedMetadata` is gated by `shouldProcess()`, which rejects events from an element while it is idle — and the incoming element is *always* idle when its metadata arrives, in both the preloaded and the fresh-`load()` path. So the promotion in `attemptPingPongPlayback` explicitly `setDuration(idle.duration)` + syncs `currentTime`/`currentTimeRef`, and a **`durationchange` listener** (bound to both audio elements + video, same `shouldProcess` guard) self-heals metadata that resolves after the swap. Without these, `duration` stays pinned to the *previous* track for the whole song — the time label reads wrong and the progress knob slides off screen. Symptom on device: elapsed exceeding total (e.g. `1:31 / 1:20`).
- **Clamp anything derived from `duration`.** `progress = (currentTime / duration) * 100` drives both the fill width and the knob's `left`, so an over-100% value translates the knob off the right edge. Clamped in `NowPlayingScreen`, `RadioPlayer`, `DatabaseMusicPlayer`. `navigator.mediaSession.setPositionState` reads `currentElement.duration` directly and was never affected — only React state.
- **Verification is device-only**: the locked-screen autoplay policy does not reproduce on desktop/emulator. Test on a physical Android phone + Bluetooth earbuds, screen locked, ≥3 auto boundaries untouched; watch logs for `✅ Ping-pong transition succeeded` and no background `NotAllowedError`.

---

## VTS (Value Time Splits) Playback (`components/NowPlayingScreen.tsx`)
VTS podcasts embed `<podcast:valueTimeSplit>` segments mapping time ranges to different tracks/artists. Features: chapter tick marks on progress bar, per-song favoriting via `remoteItem`, V4V blending (`remotePercentage` splits between song and show recipients, deduped by address, `isHost` flag for grouping). GUID collision detection via `chapterTitle` param to `/api/lightning/value-splits`. When VTS blending produces both song and show recipients, BoostButton shows **Song/Show section headers** sorted track-first.

- **VTS extraction** (`lib/rss-parser-db.ts`): `applyParsedItemFields` applies chapters, VTS, and other parsed fields. **VTS remoteItem interface** (`lib/podcast-types.ts`): `feedGuid`, `itemGuid`, `medium`.
- **XML entity gotcha**: `parseItemV4VFromXML` finds the item's raw block by its title, and the title it holds is the parser's DECODED one. That lookup is `findItemBlockByTitle` (`lib/feeds/item-block.ts`), shared with the persons, images and funding item parsers: it decodes each raw `<title>` (`&apos;`, `&quot;`, `&#39;`, `&#8217;` …, CDATA unwrapped) and compares text to text, ignoring case. The four copies before it re-encoded only `&`, `<` and `>`, so a track titled with an apostrophe found no block and boosted on the ALBUM's split instead of its own (2026-11-01). Tests: `npx tsx --test lib/feeds/item-block.test.ts`.
- **Chapters fallback**: `fetchChapters()` fetches from `podcast:chapters` URL. If the `reflex.livewire.io` proxy returns 400, it extracts the direct URL from the proxy path (`.../chapters/https://actual-url.json`) and retries.
