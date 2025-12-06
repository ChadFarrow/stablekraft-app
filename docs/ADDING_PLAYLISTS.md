# Adding New Playlists to StableKraft

## Quick Start (5 minutes to 96%+ resolution!)

### 1. Copy the Template
```bash
cp app/api/playlist/template.example.ts app/api/playlist/YOUR_PLAYLIST_NAME/route.ts
```

### 2. Update the Playlist Configuration
Edit your new route file and update the TODO sections:

- `PLAYLIST_URL`: Your playlist XML URL
- Playlist metadata (id, title, description, etc.)
- Source name identifier

### 3. Create the Playlist Page (Optional)
```bash
cp app/playlist/iam/page.tsx app/playlist/YOUR_PLAYLIST_NAME/page.tsx
```

Update the configuration in the page file.

### 4. Add to Main Page Loading
Edit `app/page.tsx` and add your playlist to the `loadPlaylists` function:

```typescript
const [itdvResponse, hghResponse, iamResponse, yourResponse] = await Promise.allSettled([
  fetch('/api/playlist/itdv'),
  fetch('/api/playlist/hgh'),
  fetch('/api/playlist/iam'),
  fetch('/api/playlist/YOUR_PLAYLIST_NAME') // Add this
]);
```

## How It Works

The playlist system automatically:

1. **Fetches the XML** from your GitHub repository or URL
2. **Parses remote items** (feedGuid + itemGuid pairs)
3. **Database lookup** - Checks if tracks already exist (from RSS processing)
4. **API resolution** - Uses Podcast Index API to resolve unresolved tracks
5. **Feed discovery** - Automatically discovers and adds new feeds to the database for future processing

### Automated Feed Discovery

When playlist items reference feeds that aren't in the database, the system automatically:

1. **Extracts unique feed GUIDs** from unresolved playlist items
2. **Resolves feed metadata** via Podcast Index API (URL, title, artist, image, type)
3. **Validates feed URLs** before storing
4. **Adds feeds to database** with proper type detection (album vs podcast based on `medium` field)
5. **Uses atomic operations** (upsert) to prevent race conditions

Feeds are stored with their GUID as the feed ID for compatibility. Tracks are extracted later via batch processing at `/api/playlist/parse-feeds`, which reads from the database.

**Key Functions:**
- `processPlaylistFeedDiscovery()` - Main entry point, extracts unique feed GUIDs and calls `addUnresolvedFeeds()`
- `addUnresolvedFeeds()` - Resolves GUIDs via Podcast Index API and adds to database
- `resolveFeedGuidWithMetadata()` - Fetches complete feed metadata including type determination

**Integration:** Feed discovery is automatically called in playlist routes (flowgnar, iam, itdv) after track resolution, ensuring all referenced feeds are available for future processing.

## Resolution Rates

With the current implementation, you can expect:
- **First load**: 30-50% resolution (database hits only)
- **With API resolution**: 88-99% resolution (database + API)
- **After feed processing**: Near 100% resolution

## Key Components

### `/lib/playlist-resolver.ts`
Core resolution logic that achieves 96%+ resolution rates:
- Database lookup for existing tracks
- Podcast Index API resolution with multiple approaches
- Automatic progress tracking
- Rate limiting protection

### `/lib/feed-discovery.ts`
Automated feed discovery and episode resolution via Podcast Index API:
- **Feed Discovery**: Automatically discovers feeds from playlists and adds them to the database
- **GUID Resolution**: Resolves feed GUIDs to full metadata (URL, title, artist, image, type)
- **Type Detection**: Determines feed type (album vs podcast) based on Podcast Index `medium` field
- **Episode Resolution**: Resolves individual episode/item GUIDs to track metadata
- **Race Condition Protection**: Uses atomic upsert operations to prevent duplicate feeds
- **URL Validation**: Validates feed URLs before storing in database

### Template Features
- **Caching**: 1-minute cache with `?refresh=1` override
- **Auto-discovery**: Automatically discovers and adds unresolved feeds to database via Podcast Index API
- **Error handling**: Graceful fallback for failed resolutions (feed discovery errors don't break playlists)
- **Progress logging**: Detailed console output for debugging
- **Non-blocking**: Feed discovery runs asynchronously and doesn't delay playlist creation

## Performance Tips

1. **API Limits**: The template processes up to 300 tracks via API
2. **Rate Limiting**: 50ms delay between API calls prevents throttling
3. **Caching**: Responses cached for 1 minute to reduce API load
4. **Batch Processing**: RSS feeds processed automatically in background

## Troubleshooting

### Low Resolution Rate?
1. Check if feeds are in the database: `/api/admin/all-feeds`
2. Trigger feed parsing: `POST /api/parse-feeds?action=parse`
3. Force refresh: Add `?refresh=1` to playlist URL

### API Errors?
1. Verify Podcast Index API credentials in `.env.local`
2. Check rate limiting (reduce `apiDelay` if needed)
3. Some GUIDs may not exist in Podcast Index

### Missing Tracks?
Some tracks may be:
- Private/unpublished content
- Deleted from the source
- Using incorrect GUIDs
- From feeds not in Podcast Index

## Example Playlist XML Structure

```xml
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Your Playlist Name</title>
    <description>Playlist description</description>
    <image>
      <url>https://your-image-url.com/artwork.jpg</url>
    </image>
    <item>
      <title>Playlist Entry</title>
      <podcast:remoteItem 
        feedGuid="feed-guid-here" 
        itemGuid="item-guid-here"/>
    </item>
    <!-- More items... -->
  </channel>
</rss>
```

## Success Metrics

Current playlist resolution rates:
- **ITDV**: 99% (125/126 tracks)
- **HGH**: 97% (822/841 tracks)
- **IAM**: 96% (329/342 tracks)

Your new playlist should achieve similar rates automatically!