# Publisher Albums Import

## Problem
Publisher pages (like `/publisher/ollie-publisher`) show "No Albums Available" because the albums referenced in publisher feeds haven't been parsed and added to the database.

## Solution
Publisher feeds contain `<podcast:remoteItem>` entries that point to album feeds. These need to be:
1. Extracted from publisher feeds
2. Fetched and parsed individually
3. Added to the Prisma database as Feed + Track records

## Scripts Available

### `add-publisher-albums-to-db.ts` (Recommended)
Directly adds publisher albums to the Prisma database.

```bash
npx tsx scripts/add-publisher-albums-to-db.ts
```

**Features:**
- Reads `data/publisher-feed-results.json`
- For each publisher, fetches their RSS feed
- Extracts `<podcast:remoteItem>` entries
- Parses each album feed
- Creates Feed + Track records in database
- Includes rate limiting (3s between requests)
- Includes retry logic for 429 errors
- Skips existing albums automatically

### `parse-publisher-remote-items.js` (Alternative)
Parses publisher albums and writes to JSON (not recommended for production use).

```bash
node scripts/parse-publisher-remote-items.js
```

## Current Status

**Publisher feeds that need processing:**
- bennyjeans (11 albums)
- Big Awesome (5 albums)
- Charlie Crown (12 albums)
- Ollie (25 albums) ⭐ Main issue
- R.O. Shapiro (2 albums)
- Ryan Fonda (15 albums)
- Sara Jade (15 albums)
- Seth Fonda (1 album)
- And ~17 more publishers

**Total:** Approximately 100+ albums need to be added to the database.

## How to Run

1. **Ensure database is running:**
   ```bash
   # Check DATABASE_URL in .env
   cat .env | grep DATABASE_URL
   ```

2. **Run the import script:**
   ```bash
   npx tsx scripts/add-publisher-albums-to-db.ts
   ```

3. **Monitor progress:**
   The script will show progress for each publisher and album.

4. **Verify in database:**
   ```bash
   # Check feed count before
   npx prisma studio
   # Or via SQL:
   # SELECT COUNT(*) FROM Feed WHERE type = 'album';
   ```

## Expected Results

After running the script:
- ✅ Ollie's publisher page will show 25 albums
- ✅ All other publisher pages will show their albums
- ✅ Albums API will include new albums
- ✅ Search will find the new albums

## Rate Limiting

The script includes:
- 3 second delay between album fetches
- 10 second delay on rate limit retries
- Up to 3 retries with exponential backoff
- Respectful of Wavlake API limits

## Troubleshooting

### "HTTP 429" errors
If you get too many rate limit errors, increase the delay in the script:
```typescript
// Change from 3000 to 5000 or more
await new Promise(resolve => setTimeout(resolve, 5000));
```

### Albums not showing on publisher page
1. Check if albums were added: Check Prisma Studio or logs
2. Clear cache: Restart Next.js dev server
3. Check publisher feedGuid matches in database

### TypeScript errors
Make sure you have tsx installed:
```bash
npm install -g tsx
# Or use npx
npx tsx scripts/add-publisher-albums-to-db.ts
```

## Implementation Notes

The script creates:
- **Feed records** with:
  - `type: 'album'`
  - `status: 'active'`
  - `priority: 'normal'`
  - Artist, title, description, image

- **Track records** with:
  - Audio URL, title, duration
  - Track order, album, artist
  - Explicit flag, images

This matches the structure expected by the `/api/albums` endpoint.
