# Playlist Import Guide

## Overview
This guide documents the successful process for importing podcast playlists with Podcasting 2.0 `remoteItem` references and resolving them to real track data using the Podcast Index API.

## ITDV Playlist Success Story
- **Final Result**: 98.4% track resolution (124/126 tracks)
- **48 feeds imported** with 140+ tracks total
- **Process took ~2 hours** with systematic API imports

## Key API Endpoints Created

### 1. Core Playlist Endpoint
**File**: `/app/api/playlist/itdv/route.ts`
- Fetches XML from GitHub playlist repository
- Parses `podcast:remoteItem` tags for feedGuid/itemGuid pairs
- Resolves track GUIDs to actual database tracks
- Creates virtual album structure
- Handles both resolved tracks and placeholders

### 2. Feed Resolution Tools
**File**: `/app/api/resolve-missing-feeds/route.ts`
- Looks up feed metadata via Podcast Index API
- Returns feed info without importing

**File**: `/app/api/find-missing-feeds/route.ts`
- Analyzes playlist to identify missing tracks
- Compares playlist items to database tracks
- Groups missing items by feed GUID

**File**: `/app/api/investigate-missing-feeds/route.ts`
- Detailed investigation of specific feed GUIDs
- Tests feed URL accessibility
- Categorizes feeds by availability status

### 3. Import Systems
**File**: `/app/api/import-missing-feeds/route.ts`
- Bulk import system (processes 10 feeds at a time)
- Basic error handling and rate limiting

**File**: `/app/api/import-specific-feeds/route.ts` ⭐ **RECOMMENDED**
- Improved import with better error handling
- Checks for existing feeds/tracks to avoid duplicates
- Processes specific list of known missing GUIDs
- 100% success rate on available feeds

## Process Workflow

### Step 1: Create Playlist Endpoint
1. Parse playlist XML for `remoteItem` references
2. Extract feedGuid and itemGuid pairs
3. Query database for existing tracks by GUID
4. Create virtual album mixing resolved + placeholder tracks

### Step 2: Identify Missing Feeds
1. Use `find-missing-feeds` to analyze gaps
2. Use `investigate-missing-feeds` to check availability
3. Identify which feeds exist in Podcast Index

### Step 3: Import Missing Feeds
1. Use `import-specific-feeds` with curated GUID list
2. Skip problematic GUIDs (e.g., `5a95f9d8-35e3-51f5-a269-ba1df36b4bd8`)
3. Handle duplicates gracefully
4. Import both feed metadata and track data

### Step 4: Verify Results
1. Check playlist resolution percentage
2. Confirm track count matches expectations
3. Test playlist functionality in UI

## Technical Implementation

### Podcast Index API Integration
```typescript
function generateAuthHeaders() {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'FUCKIT-Feed-Importer/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}
```

### RSS Feed Parsing
```typescript
const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
```

### Database Import with Duplicate Handling
```typescript
// Check for existing feed
const existingFeed = await prisma.feed.findFirst({
  where: { originalUrl: feedData.url }
});

// Check for existing track
const existingTrack = await prisma.track.findFirst({
  where: { guid: episode.guid }
});
```

## UI Integration

### Filter System
**File**: `/components/ControlsBar.tsx`
- Added 'playlist' to FilterType union
- Playlist button in main navigation

**File**: `/app/page.tsx`
- Special handling for playlist filter
- Prevents infinite scroll for single playlist item
- Routes to `/api/playlist/itdv` endpoint

### Album Detail Support
**File**: `/app/api/albums/[slug]/route.ts`
- Added playlist support to existing album detail API
- Uses same track resolution logic as main playlist endpoint

## Environment Variables Required
```bash
PODCAST_INDEX_API_KEY=your_key_here
PODCAST_INDEX_API_SECRET=your_secret_here
```

## Future Playlist Setup

### For New Playlists:
1. **Create playlist-specific endpoint** (copy `/app/api/playlist/itdv/route.ts`)
2. **Update XML URL** to new playlist location
3. **Add filter option** to ControlsBar component
4. **Update page.tsx** routing for new filter
5. **Run import process**:
   - Use `find-missing-feeds` to identify gaps
   - Use `investigate-missing-feeds` to check availability  
   - Use `import-specific-feeds` to import missing feeds
   - Verify resolution percentage

### Recommended Feed Sources:
- **Wavlake**: Excellent RSS feeds, consistent format
- **RSS Blue**: Good compatibility
- **Doerfelverse**: Custom feeds, reliable
- **White Triangle/Independent**: Variable quality

### Common Issues:
- **Duplicate URL constraints**: Handle with existence checks
- **Malformed RSS**: Some feeds may fail parsing
- **Rate limiting**: Use 500ms delays between API calls
- **GUID mismatches**: Verify feedGuid vs itemGuid usage

## Files to Reference:
- `/app/api/playlist/itdv/route.ts` - Main playlist logic
- `/app/api/import-specific-feeds/route.ts` - Best import system
- `/app/api/find-missing-feeds/route.ts` - Gap analysis
- `/components/ControlsBar.tsx` - UI filter integration
- `/app/page.tsx` - Routing logic

## Success Metrics:
- **Target**: 95%+ track resolution
- **ITDV Result**: 98.4% (124/126 tracks)
- **Import Success**: 100% for available feeds
- **User Experience**: Fully functional playlist with real metadata