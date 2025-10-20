---
name: rss-parsing
description: Parse podcast RSS feeds and extract metadata including episodes, chapters, and music track information
---

# RSS Parsing Skill

This skill parses podcast RSS feeds to extract structured metadata including episodes, chapters, value time splits, and music track information.

## Inputs

- **feed_url** (string, required): URL of the RSS feed to parse
- **parse_options** (object, optional): Configuration options
  - `include_chapters`: Include chapter information (default: true)
  - `include_value_splits`: Include Value4Value time splits (default: true)
  - `extract_music`: Extract music track information (default: true)
  - `cache_duration`: Cache duration in seconds (default: 3600)

## Outputs

- **feed_metadata** (object): Basic feed information
  - `title`: Feed title
  - `description`: Feed description
  - `author`: Feed author
  - `language`: Feed language
  - `category`: Feed category
  - `image_url`: Feed image URL
  - `last_build_date`: Last build date
  - `generator`: Feed generator

- **episodes** (array): Array of episode objects
  - `guid`: Episode GUID
  - `title`: Episode title
  - `description`: Episode description
  - `pub_date`: Publication date
  - `duration`: Episode duration in seconds
  - `audio_url`: Audio file URL
  - `chapters`: Array of chapter objects
  - `value_splits`: Array of Value4Value time splits
  - `music_tracks`: Array of extracted music tracks

## Usage Example

```typescript
import { parseRSSFeed } from './rss-parser';

const result = await parseRSSFeed({
  feed_url: 'https://example.com/podcast.xml',
  parse_options: {
    include_chapters: true,
    include_value_splits: true,
    extract_music: true
  }
});

console.log(`Parsed ${result.episodes.length} episodes`);
```

## Error Handling

- **Invalid URL**: Returns error for malformed feed URLs
- **Network Error**: Handles network timeouts and connection issues
- **Parse Error**: Handles malformed XML and RSS structure issues
- **Rate Limiting**: Implements exponential backoff for rate-limited requests

## Dependencies

- `fast-xml-parser`: XML parsing
- `node-fetch`: HTTP requests
- `lib/rss-parser/`: Custom RSS parsing modules
- `lib/music-track-parser/`: Music track extraction

## Performance Notes

- Implements caching to avoid re-parsing unchanged feeds
- Uses streaming XML parsing for large feeds
- Supports concurrent parsing of multiple feeds
- Memory-efficient processing for feeds with many episodes
