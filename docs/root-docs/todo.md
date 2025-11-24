# TODO List

## High Priority
- [ ] Fix Amber disconnecting wallet on Android after login
- [ ] Fix Nostr login and wallet connect flow
- [ ] Fix Aegis (iOS bunker:// signer) - sign_event responses not reaching app (Aegis in beta)

## Medium Priority

## Low Priority

## Completed ✅
- [x] Check value splits for "Heycitizen" and "Stay Awhile" tracks
  - Fixed parser regex bug in `lib/rss-parser-db.ts` that was crossing item boundaries
  - Fixed tracks storing channel-level splits instead of item-level splits
  - Updated "Like Wine" track with correct 45/45/10 splits with Boo-bury
  - Created migration script `scripts/fix-track-v4v-splits.ts` (cleared 3,309 tracks)
  - Created test script `scripts/test-v4v-parser.ts` for regression testing
  - Note: Existing tracks need re-import via `/api/playlist-cache?refresh=all`