# TODO List

## High Priority
- [ ] Fix remaining 5 "Wavlake Album #" titles in production database
  - [ ] Wavlake Album 1 → "Tinderbox" by Nate Johnivan
  - [ ] Wavlake Album 16 → "THEY RIDE" by IROH
  - [ ] Wavlake Album 2 → "Singles" by Nate Johnivan
  - [ ] Wavlake Album 5 → "Fight!" by Nate Johnivan

## Medium Priority
- [ ] Test and optimize performance on production site
- [ ] Verify all publisher feeds are working correctly
- [ ] Check for any other generic album titles that need fixing

## Low Priority
- [ ] Add monitoring for future RSS feed parsing issues
- [ ] Consider automating title extraction for new feeds

## Completed ✅
- [x] Fixed scroll sensitivity causing accidental clicks on main page
  - [x] Increased movement threshold from 10px to 20px
  - [x] Extended scroll detection timeouts (150ms → 300ms)
  - [x] Improved touch end handling (100ms → 250ms)
  - [x] Enhanced click prevention thresholds (100ms → 200ms)
- [x] Created migration API endpoints for title fixes
- [x] Built local and production database scripts
- [x] Identified and documented the original feeds.json structure
- [x] Fixed album slug collision issues
- [x] Optimized API performance (25x improvement)
- [x] Migrated from JSON files to database-driven APIs
- [x] Fixed Railway build performance (85-90% improvement)
- [x] Resolved publisher feed confusion issues
- [x] Fixed My Friend Jimi album titles (9 albums)
- [x] Fixed Joe Martin album titles with generic names