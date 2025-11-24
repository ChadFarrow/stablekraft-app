# V4V Splits Migration Guide

## Problems Fixed

### 1. Tracks Storing Channel-Level Splits (Fixed)

Previously, tracks were incorrectly storing channel-level (feed-level) V4V payment splits instead of their track-specific splits. This meant all tracks in an album showed the same payment recipients, even when individual tracks had their own unique splits defined in the RSS feed.

### 2. Parser Regex Bug (Fixed)

The `parseItemV4VFromXML` function had a regex bug where it would match across multiple `<item>` boundaries, causing tracks to extract v4v data from the wrong item. For example, "Like Wine" was showing 50/50 splits (from "Makin' Beans") when it should show 45/45/10 with Boo-bury.

## Changes Made

1. **`app/api/playlist/parse-feeds/route.ts`**:
   - Removed fallback to channel-level splits when storing track v4v data
   - Now only stores item-level v4v data on tracks
   - Added channel-level v4v storage on Feed records

2. **`app/api/proxy-image/route.ts`**:
   - Fixed GIF artwork handling to preserve animation
   - GIFs are no longer converted to JPEG (which lost animation)

3. **`lib/rss-parser-db.ts`**:
   - Fixed `parseItemV4VFromXML` regex bug that was crossing item boundaries
   - Changed to two-step approach: first split all items, then find the specific item
   - Now correctly extracts item-level v4v data without cross-contamination

4. **`scripts/fix-track-v4v-splits.ts`**:
   - Migration script to clean up existing database records
   - Identifies tracks with channel-level splits and clears them
   - Allows frontend to correctly fall back to feed-level splits
   - Successfully cleared 3,309 tracks with channel-level data

5. **`scripts/reimport-stay-awhile.ts`**:
   - Script to update "Like Wine" track with corrected v4v splits
   - Demonstrates how to fix individual tracks after parser fix

6. **`scripts/test-v4v-parser.ts`**:
   - Test script to verify parser correctly extracts v4v splits
   - Useful for regression testing

## How to Run the Migration

### Option 1: Railway CLI (Recommended)

```bash
# From the project root
railway run npx tsx scripts/fix-track-v4v-splits.ts
```

### Option 2: One-off Dyno (if using Heroku)

```bash
heroku run npx tsx scripts/fix-track-v4v-splits.ts --app your-app-name
```

### Option 3: Production Environment

SSH into your production server and run:

```bash
cd /path/to/app
npx tsx scripts/fix-track-v4v-splits.ts
```

## What the Migration Does

1. Finds all feeds with v4v data
2. For each feed, compares track v4v data with feed v4v data
3. If they match (meaning track has channel-level data), clears the track's v4v fields
4. Tracks with unique item-level splits are preserved

## Expected Results

After running the migration:

- Tracks with item-specific splits will show their own recipients
- Tracks without item-specific splits will fall back to feed-level recipients (handled by frontend)
- Albums like "Stay Awhile", "The Heycitizen Experience", and "12 Rods Tour Eclipse" will show correct splits per track

## Re-importing Feeds to Apply Parser Fix

After deploying the parser fix, you need to refresh all feeds to update tracks with corrected v4v splits:

### Option A: Use the refresh script (Recommended)

```bash
# Via Railway CLI
railway run npx tsx scripts/refresh-all-feed-v4v.ts

# Or locally with production database
npx dotenv -e .env.local -- npx tsx scripts/refresh-all-feed-v4v.ts
```

This script will:
- Re-fetch all active RSS feeds
- Re-parse v4v data with the fixed parser
- Update tracks with correct item-level splits
- Clear tracks that don't have item-level splits (they'll use feed-level)

### Option B: Wait for daily sync

The GitHub Actions workflow runs daily at 2 AM UTC and will automatically refresh feeds with the fixed parser.

## Testing

Visit the following albums to verify correct splits:

- https://stablekraft.app/album/stay-awhile (check "Like Wine" track)
- https://stablekraft.app/album/the-heycitizen-experience
- https://stablekraft.app/album/12-rods-tour-eclipse-a-v4v-mirror-ball-stream-feat-mellow-cassette

Each track should show its own unique payment splits, not the album-level splits.

## Rollback

If issues occur, you can restore from database backups. The migration only modifies Track records by setting `v4vValue` and `v4vRecipient` to null for tracks that had channel-level data.

No data is permanently deleted - the correct splits still exist in the RSS feeds and will be re-imported on the next feed refresh.
