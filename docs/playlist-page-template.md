# Playlist Page Template

This document describes the standard template for creating new playlist pages in the application.

## Overview

All playlist pages should use the `PlaylistTemplateCompact` component to ensure consistent UI/UX across all playlists. This template matches the structure used in the IAM playlist page.

## Template Structure

```tsx
'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const PLAYLIST_CONFIG: PlaylistConfig = {
  cacheKey: 'playlist_name_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/playlist-name',
  title: 'Playlist Title',
  description: 'Playlist description',
  useAudioContext: true
};

export default function PlaylistPage() {
  return <PlaylistTemplateCompact config={PLAYLIST_CONFIG} />;
}
```

## Implementation Steps

1. **Create the page file**
   - Location: `app/playlist/[playlist-name]/page.tsx`
   - Example: `app/playlist/new-playlist/page.tsx`

2. **Configure the PlaylistConfig**
   - `cacheKey`: Unique cache key (format: `[name]_playlist_cache_v2`)
   - `cacheDuration`: Cache duration in milliseconds (default: 30 minutes = `1000 * 60 * 30`)
   - `apiEndpoint`: API route that returns playlist data
   - `title`: Display title for the playlist
   - `description`: Display description for the playlist
   - `useAudioContext`: Whether to use the AudioContext (default: `true`)

3. **Ensure API endpoint exists**
   - Location: `app/api/playlist/[playlist-name]/route.ts`
   - Must return JSON in one of these formats:
     - `{ tracks: Track[] }`
     - `{ albums: [{ tracks: Track[], coverArt?: string, image?: string }] }`

## Example: IAM Playlist

Reference implementation: `app/playlist/iam/page.tsx`

```tsx
'use client';

import PlaylistTemplateCompact from '@/components/PlaylistTemplateCompact';
import type { PlaylistConfig } from '@/types/playlist';

const IAM_CONFIG: PlaylistConfig = {
  cacheKey: 'iam_playlist_cache_v2',
  cacheDuration: 1000 * 60 * 30, // 30 minutes
  apiEndpoint: '/api/playlist/iam',
  title: 'It\'s A Mood Music Playlist',
  description: 'Every music reference from It\'s A Mood podcast',
  useAudioContext: true
};

export default function IAMPlaylistPage() {
  return <PlaylistTemplateCompact config={IAM_CONFIG} />;
}
```

## API Endpoint Requirements

The API endpoint must return JSON in one of these formats:

### Format 1: Direct Tracks
```json
{
  "success": true,
  "tracks": [
    {
      "id": "track-id",
      "title": "Track Title",
      "artist": "Artist Name",
      "audioUrl": "https://...",
      "duration": 180,
      ...
    }
  ]
}
```

### Format 2: Album Format
```json
{
  "success": true,
  "albums": [
    {
      "title": "Playlist Title",
      "tracks": [...],
      "coverArt": "https://...",
      "image": "https://...",
      "link": "https://..."
    }
  ]
}
```

## PlaylistConfig Type Reference

```typescript
export interface PlaylistConfig {
  cacheKey: string;              // Unique cache key
  cacheDuration: number;          // Cache duration in milliseconds
  feedUrl?: string;               // Optional RSS feed URL
  apiEndpoint: string;            // API endpoint path
  title: string;                  // Display title
  description: string;             // Display description
  useAudioContext?: boolean;      // Use AudioContext (default: true)
}
```

## Checklist for New Playlist

- [ ] Create page file at `app/playlist/[name]/page.tsx`
- [ ] Create API endpoint at `app/api/playlist/[name]/route.ts`
- [ ] Configure PlaylistConfig with unique cache key
- [ ] Set appropriate cache duration
- [ ] Provide descriptive title and description
- [ ] Ensure API returns correct JSON format
- [ ] Test playlist page loads correctly
- [ ] Verify caching works as expected

## Notes

- All playlist pages should follow this exact structure
- Do not create custom playlist components unless absolutely necessary
- The `PlaylistTemplateCompact` component handles all UI, caching, and playback functionality
- Cache keys should follow the pattern: `[playlist-name]_playlist_cache_v2`
- Cache duration of 30 minutes is recommended for most playlists

