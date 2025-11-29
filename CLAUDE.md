# Stablekraft App - Architecture Guide

## Two-Repo Architecture

This app follows a **separation of concerns** architecture with two repositories:

### 1. Playlist Generator Repo (musicL-playlist-updater)
- **Repo**: https://github.com/ChadFarrow/musicL-playlist-updater
- **Purpose**: Generates and updates playlist XML feeds
- **Output**: https://github.com/ChadFarrow/chadf-musicl-playlists
- **Schedule**: Runs daily via GitHub Actions
- **Playlists Generated**: MMM, SAS, HGH, IAM, ITDV, MMT, B4TS, Upbeats, and more

### 2. This Repo (FUCKIT / Stablekraft App)
- **Purpose**: Consumes playlist feeds and displays them in the app
- **Does NOT generate playlists** - only fetches and caches them
- **Feed Sync**: Daily at 2 AM UTC via `.github/workflows/refresh-playlists.yml`
- **Endpoints**: `/api/playlist/{playlist-id}` (e.g., `/api/playlist/mmm`)

## Feed Consumption Workflow

1. **GitHub Actions** (`.github/workflows/refresh-playlists.yml`) runs daily at 2 AM UTC
2. Calls `/api/playlist-cache?refresh=all` to clear cache
3. Calls each playlist endpoint with `?refresh=true` parameter
4. Calls `/api/playlist/parse-feeds` to import new tracks to database
5. Tracks are stored in PostgreSQL database with v4v payment data

## Podcast Index API

- **Always use the Podcast Index API** to look up and parse RSS feeds
- API keys are in `.env` file (check there for `PODCASTINDEX_API_KEY` and `PODCASTINDEX_API_SECRET`)
- **Always use Podcast Index API** instead of Wavlake website to get feed info
- All items in music playlists came from the Podcast Index
- API Documentation: https://podcastindex-org.github.io/docs-api/#overview

## Feed Parsing

When working with playlists:
- Playlists use `<podcast:remoteItem>` tags with `feedGuid` and `itemGuid` attributes
- Tracks are resolved in two phases:
  1. Database lookup (fast)
  2. Podcast Index API resolution (slower, for missing tracks)
- Tracks without valid `audioUrl` are filtered out (unavailable content)
- **Expected behavior**: Some tracks from XML feeds may not resolve (API doesn't have them)
- https://podcastindex-org.github.io/docs-api/#overview--example-code
- any time we fix an issue make sure the change is added to the main code base
- all feeds that get added to the site need to be parsed including publisher feeds. This site cant display anything if the feed isnt parsed.