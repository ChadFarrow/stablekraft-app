# Playlist Auto-Refresh Setup

## Overview

Playlists are configured to cache for **6 hours** to balance between fresh data and API performance. To ensure daily updates, a cron job should refresh all playlists automatically.

## Manual Refresh

To manually refresh a specific playlist, visit:
```
https://stablekraft.app/api/playlist/{playlist-name}?refresh=true
```

Replace `{playlist-name}` with: `mmm`, `hgh`, `itdv`, `upbeats`, `iam`, `mmt`, `sas`, or `b4ts`

## Automated Refresh

### Using the Cron Endpoint

The application includes a cron endpoint that refreshes all playlists:

```
GET /api/cron/refresh-playlists
```

### Security

For production, set the `CRON_SECRET` environment variable and include it in requests:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://stablekraft.app/api/cron/refresh-playlists
```

### Setup Options

#### Option 1: Railway Cron (Recommended for Railway deployments)

Railway doesn't have built-in cron support, but you can use Railway's plugin ecosystem or external cron services.

#### Option 2: External Cron Service (cron-job.org)

1. Go to [cron-job.org](https://cron-job.org)
2. Create a free account
3. Add a new cron job:
   - **Title**: StableKraft Playlist Refresh
   - **URL**: `https://stablekraft.app/api/cron/refresh-playlists`
   - **Schedule**: Daily at 2:00 AM (or your preferred time)
   - **Request Method**: GET
   - **Headers**: `Authorization: Bearer YOUR_CRON_SECRET` (if CRON_SECRET is set)

#### Option 3: GitHub Actions

Create `.github/workflows/refresh-playlists.yml`:

```yaml
name: Refresh Playlists Daily

on:
  schedule:
    # Run daily at 2:00 AM UTC
    - cron: '0 2 * * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - name: Refresh Playlists
        run: |
          curl -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://stablekraft.app/api/cron/refresh-playlists
```

Add `CRON_SECRET` to your GitHub repository secrets.

#### Option 4: EasyCron

1. Sign up at [EasyCron](https://www.easycron.com)
2. Create a new cron job:
   - **URL**: `https://stablekraft.app/api/cron/refresh-playlists`
   - **Cron Expression**: `0 2 * * *` (2 AM daily)
   - **HTTP Auth**: Add `Authorization: Bearer YOUR_CRON_SECRET` header

## Cache Durations

Current cache settings (all playlists):
- **Server Cache**: 6 hours
- **Client Cache**: 30 minutes

This means:
- Playlists automatically refresh every 6 hours when accessed
- Users see cached data for up to 30 minutes
- Cron job ensures fresh data is available daily

## Monitoring

Check the cron endpoint response for refresh status:

```json
{
  "success": true,
  "timestamp": "2025-11-22T10:00:00.000Z",
  "summary": {
    "total": 8,
    "succeeded": 8,
    "failed": 0
  },
  "results": [
    { "playlist": "mmm", "success": true, "trackCount": 1561 },
    ...
  ]
}
```

## Troubleshooting

### Playlists not updating

1. Check if the cache has expired (6 hours)
2. Manually refresh: `/api/playlist/{name}?refresh=true`
3. Clear cache files in `.next/cache/playlists/`
4. Check cron job logs

### Slow loading

- First load after cache expiry takes longer (API resolution)
- Subsequent loads use cached data and are fast
- Cron job keeps cache warm so users rarely hit slow loads
