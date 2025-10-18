# Scripts Directory

This directory contains utility scripts and test files for the StableKraft project.

## Directory Structure

### `/scripts/tests/`
Test scripts for validating various components and functionality:
- `test-album-pages.js` - Album page functionality tests
- `test-all-feeds-background.js` - Background feed processing tests
- `test-client-data-service.js` - Client-side data service tests
- `test-missing-albums.js` - Missing album detection tests
- `test-music-parser.js` - Music parsing functionality tests
- `test-podcastindex-v4v.js` - Podcast Index V4V integration tests
- `test-publisher-feed.js` - Publisher feed tests
- `test-quick-feeds.js` - Quick feed validation tests
- `test-rss-debug.js` - RSS parsing debug tests
- `test-stay-awhile.js` - Stay Awhile feed tests
- `test-stay-awhile-debug.js` - Stay Awhile debug tests
- `test-with-app-parser.js` - Application parser tests

### `/scripts/utils/`
Utility scripts for maintenance and fixes:
- `check-missing-albums.js` - Identify albums missing metadata
- `check-missing-albums-and-cdn.js` - Check albums and CDN status
- `cleanup-and-consolidate-scripts.js` - Script consolidation utility
- `clear-v4v-cache.js` - Clear Value4Value cache
- `fix-dane-ray-coleman.js` - Specific artist metadata fix
- `fix-titles-now.js` - Title metadata correction
- `force-v4v-resolution.js` - Force V4V metadata resolution
- `lookup-ep54-feeds.js` - Episode 54 feed lookup
- `lookup-ep56-feeds.js` - Episode 56 feed lookup
- `lookup-missing-feed.js` - Missing feed detection
- `preview-itdv.js` - Preview ITDV feed content
- `quick-duration-fix.js` - Fix track duration metadata
- `search-podcast-index-for-placeholders.js` - Find placeholder content

### Root `/scripts/`
Production-ready scripts for database operations and feed management:
- `fix-missing-track-metadata.ts` - Populate missing album/artist metadata
- `resync-feeds-missing-audio.ts` - Resync feeds with missing audio URLs
- `identify-missing-publisher-albums.ts` - Find missing publisher content
- `sync-missing-publisher-albums.ts` - Sync missing publisher albums
- `resync-errored-feeds.ts` - Retry failed feed fetches
- `generate-feed-report.ts` - Generate comprehensive feed reports

## Usage

### Running Test Scripts
```bash
node scripts/tests/test-album-pages.js
```

### Running Utility Scripts
```bash
node scripts/utils/clear-v4v-cache.js
```

### Running Production Scripts (TypeScript)
```bash
npx tsx scripts/fix-missing-track-metadata.ts
```

## Notes

- Test scripts are for development/debugging and not part of the automated test suite
- Utility scripts are one-off tools for specific maintenance tasks
- Production scripts use TypeScript and Prisma for database operations
- Always backup the database before running fix/sync scripts
