---
name: music-extraction
description: Extract music tracks from podcast episodes using chapters, value splits, and content analysis
---

# Music Track Extraction Skill

This skill extracts music tracks from podcast episodes by analyzing chapters, Value4Value time splits, episode descriptions, and audio content.

## Inputs

- **episode_data** (object, required): Episode information
  - `guid`: Episode GUID
  - `title`: Episode title
  - `description`: Episode description/transcript
  - `chapters`: Array of chapter objects
  - `value_splits`: Array of Value4Value time splits
  - `audio_url`: Audio file URL (optional)

- **extraction_options** (object, optional): Configuration options
  - `source_types`: Array of sources to extract from ['chapters', 'value_splits', 'description', 'audio']
  - `min_duration`: Minimum track duration in seconds (default: 30)
  - `max_duration`: Maximum track duration in seconds (default: 600)
  - `deduplicate`: Enable deduplication (default: true)
  - `enhance_metadata`: Fetch additional metadata (default: true)

## Outputs

- **music_tracks** (array): Array of extracted music track objects
  - `id`: Unique track identifier
  - `title`: Track title
  - `artist`: Artist name
  - `album`: Album name
  - `duration`: Track duration in seconds
  - `start_time`: Start time in episode (seconds)
  - `end_time`: End time in episode (seconds)
  - `audio_url`: Direct audio URL
  - `source`: Source of extraction ('chapter', 'value_split', 'description', 'audio')
  - `metadata`: Additional metadata
    - `genre`: Music genre
    - `year`: Release year
    - `artwork_url`: Album artwork URL
    - `isrc`: International Standard Recording Code
  - `v4v_info`: Value4Value payment information
    - `lightning_address`: Lightning payment address
    - `custom_key`: Custom key for payments
    - `custom_value`: Custom value for payments

## Usage Example

```typescript
import { extractMusicTracks } from './music-extractor';

const tracks = await extractMusicTracks({
  episode_data: {
    guid: 'episode-123',
    title: 'Music Show Episode 1',
    description: 'Featuring tracks by Artist A and Artist B...',
    chapters: [
      { title: 'Intro', start_time: 0, end_time: 30 },
      { title: 'Track: Song Title - Artist', start_time: 30, end_time: 180 }
    ],
    value_splits: [
      { name: 'Artist A', start_time: 30, end_time: 90, lightning_address: 'artist@example.com' }
    ]
  },
  extraction_options: {
    source_types: ['chapters', 'value_splits'],
    min_duration: 30,
    deduplicate: true
  }
});

console.log(`Extracted ${tracks.length} music tracks`);
```

## Extraction Methods

### 1. Chapter Analysis
- Parses chapter titles for track information
- Extracts artist and song titles from chapter names
- Uses time ranges for track boundaries

### 2. Value4Value Splits
- Analyzes V4V time splits for artist payments
- Extracts artist names and payment information
- Maps time ranges to track boundaries

### 3. Description Parsing
- Uses NLP to identify music track mentions
- Extracts track information from episode descriptions
- Identifies artist and song title patterns

### 4. Audio Analysis
- Analyzes audio content for music segments
- Uses audio fingerprinting for track identification
- Extracts metadata from audio files

## Deduplication

- Compares tracks by title, artist, and time overlap
- Merges duplicate tracks with different sources
- Preserves highest quality metadata

## Error Handling

- **Invalid Episode Data**: Handles missing or malformed episode information
- **Extraction Failure**: Graceful handling of failed extractions
- **Network Errors**: Handles metadata fetching failures
- **Audio Processing Errors**: Handles audio analysis failures

## Dependencies

- `lib/music-track-parser/`: Core music parsing logic
- `lib/rss-parser/`: RSS and chapter parsing
- `lib/v4v-resolver.ts`: Value4Value resolution
- `lib/track-adapter.ts`: Track type adapter for Prisma

## Performance Notes

- Implements caching for repeated extractions
- Uses streaming for large episode descriptions
- Supports parallel processing of multiple episodes
- Memory-efficient for episodes with many tracks
