# Claude Code Skills for StableKraft

This directory contains custom skills integrated with Claude Code for the StableKraft music streaming platform.

## Available Skills

### 1. database-operations
**Category:** Data, Database, Analytics

Manage music track database operations including CRUD operations, queries, and analytics using Prisma ORM.

**Use when you need to:**
- Query the database for tracks, feeds, or playlists
- Create, update, or delete records
- Generate analytics and reports
- Perform bulk operations
- Check database health and integrity

**Example invocations:**
- "Use the database-operations skill to find all tracks missing audio URLs"
- "Check database for orphaned records"
- "Generate a report of tracks by publisher"

### 2. rss-parsing
**Category:** Parsing, RSS, Metadata

Parse podcast RSS feeds and extract structured metadata including episodes, chapters, and music track information.

**Use when you need to:**
- Parse a new RSS feed
- Extract episode and track metadata
- Handle podcast namespace extensions
- Parse podcast:liveItem tags
- Extract Value4Value payment information

**Example invocations:**
- "Parse this RSS feed and extract all tracks"
- "Use rss-parsing to check if a feed has V4V data"
- "Extract chapters from this podcast feed"

### 3. music-extraction
**Category:** Music, Extraction, Metadata

Extract individual music tracks from podcast episodes using chapters, value splits, and content analysis.

**Use when you need to:**
- Extract music tracks from podcast chapters
- Parse chapter titles for artist/song information
- Match V4V splits to music tracks
- Deduplicate extracted tracks
- Create track boundaries from time-based data

**Example invocations:**
- "Extract music tracks from this episode's chapters"
- "Use music-extraction to find all songs in this feed"
- "Parse chapter data and create track listings"

### 4. v4v-resolution
**Category:** Payments, Lightning, V4V

Resolve Value4Value Lightning Network payment information for music tracks and artists.

**Use when you need to:**
- Extract Lightning addresses from RSS feeds
- Parse payment splits and percentages
- Resolve custom payment routing keys
- Validate Lightning addresses
- Fetch boostagram data

**Example invocations:**
- "Resolve V4V payment info for this feed"
- "Check Lightning addresses for all tracks"
- "Extract value splits from this episode"

## How to Use Skills

Skills are invoked automatically by Claude Code when relevant to your request. You can also explicitly request a skill:

```
"Use the [skill-name] skill to [task description]"
```

## Skill Development

The actual skill implementations are in `/skills/` directory with full TypeScript code. The `.claude/skills/` YAML files provide the interface for Claude Code to understand and invoke these skills.

### Skill File Structure

Each skill YAML file contains:
- `name`: Unique skill identifier
- `description`: Brief description of skill capabilities
- `instructions`: Detailed instructions for Claude on how to use the skill
- `categories`: Tags for skill organization

### Adding New Skills

1. Implement the skill in `/skills/[skill-name]/`
2. Create a YAML file in `.claude/skills/[skill-name].yaml`
3. Add clear instructions for Claude on how to invoke it
4. Update this README with the new skill
5. Test the skill integration

## Integration with Project

These skills leverage the project's existing infrastructure:
- **Database:** Prisma Client with PostgreSQL
- **RSS Parsing:** Custom RSS parser with podcast namespace support
- **V4V Resolution:** Podcast Index API integration
- **Lightning Payments:** Bitcoin Connect and WebLN

## Environment Variables Required

Skills may require these environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `PODCAST_INDEX_API_KEY`: Podcast Index API key
- `PODCAST_INDEX_API_SECRET`: Podcast Index API secret

Load with: `set -a && source .env.local && set +a`
