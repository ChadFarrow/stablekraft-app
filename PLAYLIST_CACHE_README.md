# Playlist Cache Management

## Overview

Static playlists are cached for 90 days and load instantly for users. Use the management API to manually refresh when playlists are updated.

## Cache Management API

### View Cache Stats
```bash
curl "http://localhost:3000/api/playlist-cache"
```

### Manual Refresh (when playlist content changes)

**Refresh Single Playlist:**
```bash
curl "http://localhost:3000/api/playlist-cache?refresh=iam"
curl "http://localhost:3000/api/playlist-cache?refresh=mmm" 
curl "http://localhost:3000/api/playlist-cache?refresh=itdv"
curl "http://localhost:3000/api/playlist-cache?refresh=hgh"
```

**Refresh All Playlists:**
```bash
curl "http://localhost:3000/api/playlist-cache?refresh=all"
```

### Clear Cache (forces next user to trigger refresh)

**Clear Single Playlist:**
```bash
curl -X DELETE "http://localhost:3000/api/playlist-cache?clear=iam-playlist"
```

**Clear All Caches:**
```bash
curl -X DELETE "http://localhost:3000/api/playlist-cache?clear=all"
```

## Production Usage

Replace `localhost:3000` with your production domain:

```bash
# Refresh MMM playlist on production after updating the XML
curl "https://music.podtards.com/api/playlist-cache?refresh=mmm"

# Check all cache stats
curl "https://music.podtards.com/api/playlist-cache"
```

## When to Refresh

- **After updating playlist XML files** in the GitHub repository
- **After adding new feeds** to the database that might resolve more tracks
- **Never needed for routine operation** - cache lasts 90 days automatically

## Performance

- **Cached requests**: 0.02 seconds (instant)
- **Refresh processing**: 90 seconds (IAM) to 6+ minutes (MMM)
- **Users never wait**: Only the admin refresh triggers processing

## Cache Files

Located in `.next/cache/playlists/` (ignored by git):
- `iam-playlist.json` - Cached playlist data
- `iam-playlist.meta.json` - Cache metadata
- Similar files for mmm, itdv, hgh playlists