# Adding New Playlists to FUCKIT

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
5. **Feed discovery** - Adds new feeds to the database for future processing

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
Feed and episode resolution via Podcast Index:
- Multiple API approaches (by feed ID, URL, GUID)
- Episodes by feed listing
- Automatic RSS processing for discovered feeds

### Template Features
- **Caching**: 1-minute cache with `?refresh=1` override
- **Auto-discovery**: Adds unresolved feeds to database
- **Error handling**: Graceful fallback for failed resolutions
- **Progress logging**: Detailed console output for debugging

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