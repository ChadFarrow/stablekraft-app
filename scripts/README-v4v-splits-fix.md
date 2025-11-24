# V4V Splits Migration Guide

## Problem Fixed

Previously, tracks were incorrectly storing channel-level (feed-level) V4V payment splits instead of their track-specific splits. This meant all tracks in an album showed the same payment recipients, even when individual tracks had their own unique splits defined in the RSS feed.

## Changes Made

1. **`app/api/playlist/parse-feeds/route.ts`**:
   - Removed fallback to channel-level splits when storing track v4v data
   - Now only stores item-level v4v data on tracks
   - Added channel-level v4v storage on Feed records

2. **`app/api/proxy-image/route.ts`**:
   - Fixed GIF artwork handling to preserve animation
   - GIFs are no longer converted to JPEG (which lost animation)

3. **`scripts/fix-track-v4v-splits.ts`**:
   - Migration script to clean up existing database records
   - Identifies tracks with channel-level splits and clears them
   - Allows frontend to correctly fall back to feed-level splits

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

## Re-importing Feeds (Alternative)

Instead of running the migration, you can trigger a re-import of the affected feeds:

1. Go to: `https://stablekraft.app/api/playlist-cache?refresh=all`
2. This will clear the cache and trigger a fresh parse of all feeds
3. New imports will use the fixed logic

## Testing

Visit the following albums to verify correct splits:

- https://stablekraft.app/album/stay-awhile (check "Like Wine" track)
- https://stablekraft.app/album/the-heycitizen-experience
- https://stablekraft.app/album/12-rods-tour-eclipse-a-v4v-mirror-ball-stream-feat-mellow-cassette

Each track should show its own unique payment splits, not the album-level splits.

## Rollback

If issues occur, you can restore from database backups. The migration only modifies Track records by setting `v4vValue` and `v4vRecipient` to null for tracks that had channel-level data.

No data is permanently deleted - the correct splits still exist in the RSS feeds and will be re-imported on the next feed refresh.
