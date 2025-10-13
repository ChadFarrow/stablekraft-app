# Wavlake Feed Sync Scripts

## Overview

These scripts use the Podcast Index API to sync Wavlake feeds without hitting rate limits.

## Scripts

### 1. `test-podcast-index.ts`
Tests if feeds can be found in the Podcast Index API.

```bash
npx tsx scripts/test-podcast-index.ts
```

### 2. `sync-wavlake-feeds-small.ts`
Syncs 10 feeds as a test (recommended to run first).

```bash
npx tsx scripts/sync-wavlake-feeds-small.ts
```

**Test Results:** 80% success rate (8/10 feeds synced)

### 3. `sync-wavlake-feeds.ts`
Full sync of all 1,018 error feeds (estimated time: ~51 minutes).

```bash
npx tsx scripts/sync-wavlake-feeds.ts
```

## How It Works

1. **Query Podcast Index API** for feed metadata (no rate limits)
2. **Fetch RSS feed** from Wavlake URL with 3-second delays
3. **Update database** with fresh tracks and metadata
4. **Mark feeds as active** once successfully synced

## Rate Limiting

- **Podcast Index API:** 100ms delay (high rate limits)
- **Wavlake RSS:** 3 seconds delay (respects rate limits)
- **Batch processing:** 50 feeds per batch with 5-second pause between batches

## Expected Results

Based on test run:
- **Success rate:** ~80%
- **Failed feeds:** ~20% (mostly 404/dead URLs)
- **Time:** ~3 seconds per feed + batch delays
- **Total time:** ~51 minutes for 1,018 feeds

## Recovery After Sync

After running the full sync, you should see:
- **~800-850 feeds** moved from error to active status
- **~7,000-8,000 new tracks** added to database
- **Database health** improved from 45% active to 80%+ active

## Monitoring Progress

The script outputs real-time progress:
- Current feed being processed
- Success/failure status
- Progress percentage
- Batch summaries

## Re-running

You can safely re-run the scripts:
- Already synced feeds will be skipped (they're marked as active)
- Failed feeds will be retried
- No duplicate data will be created
