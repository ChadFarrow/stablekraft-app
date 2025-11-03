# StableKraft Music Update Workflow

## Quick Commands

After adding new music to your database, run these commands to ensure everything is properly processed:

### 🚀 **Main Command (Run Everything)**
```bash
npm run update-music
```
**This runs the complete workflow automatically!**

### 🎯 **Individual Commands** (if you need specific steps)
```bash
npm run discover-publishers   # Find new Wavlake publisher feeds
npm run integrate-publishers  # Add publisher info to albums (sidebar integration)
npm run check-artwork         # Check all artwork comprehensively  
npm run fix-artwork          # Fix any album artwork issues
```

### 📱 **Direct Script Execution**
```bash
node scripts/update-music-workflow.js           # Complete workflow
node scripts/discover-wavlake-publisher-feeds.js # Publisher discovery only
node scripts/check-all-artwork-comprehensive.js  # Artwork check only
node scripts/fix-all-album-artwork.js           # Artwork fix only
```

## What the Workflow Does

The `update-music` workflow automatically runs these steps in order:

1. **🔍 Publisher Feed Discovery**
   - Scans all Wavlake albums for publisher feed references
   - Discovers new artist feeds not previously known
   - Updates `publisher-feed-results.json`

2. **🎨 Track Artwork Check**
   - Verifies all individual tracks have artwork
   - Reports any missing track images
   - 100% coverage expected

3. **🖼️ Album Artwork Fix**
   - Checks all album covers against feed sources
   - Updates any incorrect album artwork
   - Ensures albums use proper unified covers

4. **📊 Comprehensive Verification**
   - Final check across albums, publisher feeds, and tracks
   - Reports overall artwork coverage statistics
   - Verifies all 3 levels are properly configured

5. **🔗 Publisher Feed Integration**
   - Links discovered publisher feeds to their albums
   - Adds publisher information to album metadata
   - **Enables publishers to appear in the left sidebar menu**

6. **🔄 Feed Rebuild**
   - Rebuilds parsed feeds from music tracks
   - Ensures data consistency across files
   - Updates album structures

## When to Run

**Run the workflow whenever you:**
- ✅ Add new podcast:remoteItem tags (new tracks/albums)
- ✅ Resolve new remote items with scripts
- ✅ Import music from new Wavlake artists
- ✅ Notice artwork issues on the website
- ✅ Want to ensure database integrity

## Expected Results

After running `npm run update-music`, you should see:

```
🏁 StableKraft MUSIC UPDATE WORKFLOW COMPLETE
📊 Steps completed: 6/6
🎉 All steps completed successfully!
✅ Your music database is now fully updated with:
   • All new publisher feeds discovered
   • Publisher feeds integrated into sidebar menu
   • All artwork verified and fixed  
   • All feeds properly parsed and structured
   • Comprehensive coverage verification complete

📈 UPDATED DATABASE STATISTICS:
🎵 Total tracks: XXX
💿 Total albums: XXX  
🏢 Total publisher feeds: XXX
```

## Troubleshooting

If any step fails:
1. Check the detailed output above the summary
2. Run individual commands to isolate the issue
3. Ensure `.env.local` has required API keys
4. Check that data files exist in `/data/` directory

## Integration Ideas

You could integrate this into your existing workflows:

```bash
# After resolving remote items
node scripts/batch-resolve-all-fixed.js && npm run update-music

# As part of deployment
npm run update-music && npm run build

# Weekly maintenance  
npm run update-music && git add . && git commit -m "chore: update music database"
```

---

**💡 Pro Tip:** The workflow is designed to be safe to run multiple times. If no new content is found, it will complete quickly without making unnecessary changes.