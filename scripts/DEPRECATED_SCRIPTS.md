# Deprecated Scripts - JSON Database Migration

Many scripts in this directory still reference the old JSON-based database system (`data/music-tracks.json`, `data/enhanced-music-tracks.json`). These scripts have been marked as deprecated since the codebase has migrated to PostgreSQL with Prisma.

## Migration Status

✅ **Application Code**: 100% migrated to Prisma  
⚠️ **Scripts**: Many scripts still use JSON (deprecated)  
✅ **API Routes**: All using Prisma  

## Using Prisma in Scripts

All new scripts should use Prisma instead of JSON files. Use the helper utility:

```typescript
import { getAllTracks, getFeeds, upsertTrack } from '../utils/prisma-helper';

// Get all tracks
const tracks = await getAllTracks();

// Get tracks with filters
const tracks = await getTracks({ artist: 'Artist Name', limit: 100 });

// Upsert a track
await upsertTrack({
  id: 'track-id',
  title: 'Track Title',
  artist: 'Artist',
  audioUrl: 'https://...',
  feedId: 'feed-id'
});
```

See `scripts/utils/prisma-helper.ts` for available functions.

## Scripts That Need Updating

The following scripts still reference JSON files and should be updated:

### Critical Scripts (Referenced in package.json)
- `scripts/reparse-main-branch-database.js` - ⚠️ Deprecated (uses JSON)
- `scripts/reparse-database-robust.js` - ⚠️ Deprecated (uses JSON)
- `scripts/validate-database-integrity.js` - ✅ Updated (uses Prisma)

### Maintenance Scripts
- `scripts/add-*-playlist-tracks.js` - Various playlist scripts
- `scripts/resolve-*-tracks.js` - Various resolution scripts
- `scripts/fix-*.js` - Various fix scripts
- `scripts/check-*.js` - Various check scripts

### Utility Scripts
- `scripts/utils/preview-itdv.js` - Uses JSON
- `scripts/utils/search-podcast-index-for-placeholders.js` - Uses JSON

## Migration Guide

When updating scripts:

1. **Import Prisma helper**:
   ```typescript
   import { getAllTracks, upsertTrack } from '../utils/prisma-helper';
   ```

2. **Replace JSON reads**:
   ```javascript
   // OLD (deprecated)
   const data = JSON.parse(fs.readFileSync('data/music-tracks.json', 'utf8'));
   const tracks = data.musicTracks;
   
   // NEW (use Prisma)
   const tracks = await getAllTracks();
   ```

3. **Replace JSON writes**:
   ```javascript
   // OLD (deprecated)
   tracks.push(newTrack);
   fs.writeFileSync('data/music-tracks.json', JSON.stringify(data));
   
   // NEW (use Prisma)
   await upsertTrack(newTrack);
   ```

4. **Add error handling**:
   ```typescript
   try {
     const tracks = await getAllTracks();
     // ... process tracks
   } finally {
     await prisma.$disconnect();
   }
   ```

## Notes

- Scripts marked with `@deprecated` in their comments should not be used in production
- All scripts that read/write JSON database files should be updated to use Prisma
- Test scripts and one-off utilities can remain as-is if they're not part of production workflows
- When in doubt, update the script to use Prisma

