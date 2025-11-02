# Podcast Music Site

A Next.js application for discovering, organizing, and streaming music tracks extracted from podcast feeds with Value4Value (V4V) integration.

## Architecture Overview

This application extracts music tracks from podcast RSS feeds, manages them in a database, and provides playlist functionality with Bitcoin Lightning Network Value4Value support.

### Core Components

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety throughout
- **Prisma** - Database ORM with PostgreSQL
- **PWA Support** - Service worker for offline functionality
- **V4V Integration** - Bitcoin Lightning payments via Podcast Index API

## Recent Refactoring (Completed)

The codebase recently underwent a comprehensive 5-phase refactoring:

1. **Dead Code Removal** - Cleaned up unused components and legacy code
2. **Custom Hooks Extraction** - Centralized reusable logic
3. **Parser Modularization** - Split 3000+ line parser files into focused modules
4. **API Route Consolidation** - Unified scattered API endpoints into centralized handlers
5. **Build Verification** - Ensured TypeScript compilation and functionality

## Project Structure

### Core Libraries

```
lib/
├── api/                          # Consolidated API handlers
│   ├── playlist-handler.ts      # Playlist management
│   └── cache-handler.ts         # Cache operations
├── music-track-parser/          # Modular music parsing
│   ├── types.ts                 # Type definitions
│   ├── utils.ts                 # Utility functions
│   ├── deduplication.ts         # Track deduplication
│   └── index.ts                 # Main parser
├── rss-parser/                  # Modular RSS parsing
├── track-adapter.ts             # Track type adapter for Prisma
├── v4v-resolver.ts             # Value4Value resolution
└── feed-cache.ts               # Feed caching
```

### API Routes

```
app/api/
├── music/                       # Consolidated music operations
├── playlist/                    # Consolidated playlist operations
├── cache/                       # Consolidated cache operations
├── favorites/                   # Favorites API (tracks/albums CRUD)
│   ├── tracks/                  # Track favorites
│   ├── albums/                  # Album favorites
│   └── check/                   # Check favorite status
├── admin/                       # Admin functionality
└── [legacy routes]             # Maintained for compatibility
```

### Pages & Components

```
app/
├── page.tsx                     # Homepage with album discovery
├── music-tracks/               # Track browsing and details
├── playlist/                   # Various playlist views
├── album/[id]/                 # Album detail pages
├── favorites/                   # Favorites page (albums/tracks tabs)
└── publisher/[id]/             # Publisher pages

components/
├── NowPlayingBar.tsx           # Audio player controls
├── MusicTrackList.tsx          # Track listing component
├── PlaylistAlbum.tsx           # Album playlist view
├── favorites/                   # Favorites components
│   └── FavoriteButton.tsx      # Heart icon favorite button
└── [other components]
```

## Key Features

### Music Track Extraction
- Parses podcast RSS feeds for music content
- Extracts from chapters, value time splits, and descriptions
- Supports multiple audio sources (direct URLs, Wavlake, etc.)
- Deduplicates tracks intelligently

### Value4Value Integration
- Resolves Lightning Network payment information
- Integrates with Podcast Index API
- Supports streaming payments to artists
- Handles boostagrams and value time splits

### Favorites System
- Anonymous session-based favorites (no account required)
- Favorite tracks and albums with heart icon
- Persistent favorites stored in database
- Dedicated favorites page with albums/tracks tabs
- Favorite buttons integrated throughout the app
  - Album cards
  - Individual track displays
  - Playlist views
  - Album detail pages

### Database Management
- JSON-based music track database
- Prisma ORM for relational data
- Cached feed processing
- Analytics and statistics tracking

### Playlist System
- Multiple curated playlists (HGH, ITDV, Lightning Thrashes, etc.)
- RSS feed generation for playlists
- Dynamic track filtering and sorting
- Album-based organization

## Environment Setup

### Required Environment Variables

Create `.env.local`:

```bash
# Database
DATABASE_URL="postgresql://..."

# Podcast Index API (for V4V resolution)
PODCAST_INDEX_API_KEY="your_key"
PODCAST_INDEX_API_SECRET="your_secret"

# Lightning Network Configuration
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY="your_node_pubkey_here"

# Optional: Additional service keys
```

### Development Commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Database operations
npx prisma generate
npx prisma db push
```

## API Endpoints

### Music Operations
- `GET /api/music-tracks` - Query music tracks with filters
- `POST /api/music-tracks` - Add tracks or bulk operations
- `GET /api/music-tracks/database` - Database operations for tracks

### Favorites Operations
- `GET /api/favorites/tracks` - Get favorite tracks for session
- `POST /api/favorites/tracks` - Add track to favorites
- `DELETE /api/favorites/tracks/[trackId]` - Remove track from favorites
- `GET /api/favorites/albums` - Get favorite albums for session
- `POST /api/favorites/albums` - Add album to favorites
- `DELETE /api/favorites/albums/[feedId]` - Remove album from favorites
- `POST /api/favorites/check` - Check if tracks/albums are favorited

### Playlist Operations
- `GET /api/playlist` - Get playlist data
- `POST /api/playlist` - Create/update playlists

### Cache Operations
- `GET /api/cache` - Cache statistics and management
- `POST /api/cache` - Cache control operations

### Legacy Endpoints
Many specific endpoints are maintained for backward compatibility.

## Database Schema

### Music Tracks
- Track metadata (title, artist, duration)
- Episode and feed relationships
- Value4Value payment information
- Source attribution and timestamps

### Favorites
- **FavoriteTrack** - User's favorite tracks (session-based)
- **FavoriteAlbum** - User's favorite albums (session-based)
- Anonymous session IDs stored in localStorage
- Indexed for efficient querying

### Enhanced Features
- Track enhancement with additional metadata
- Publisher information and statistics
- Audio URL resolution and caching
- Artwork optimization and CDN

## Feed Processing

The application processes various podcast feeds:
- **HGH (Hell's Going Hardcore)** - Electronic music
- **ITDV (In the Dark Valley)** - Various genres
- **Lightning Thrashes** - Metal and rock
- **Doerfels Publisher Feed** - Curated content

## Performance Optimizations

- **Caching**: Multi-layer caching for feeds, tracks, and API responses
- **CDN Integration**: Optimized image delivery
- **Progressive Loading**: Lazy loading and virtualization
- **Service Worker**: Offline functionality and background sync

## Deployment

The application is configured for Railway deployment with:
- Automatic database migrations
- Environment variable management
- Production build optimization
- PWA manifest generation

## Contributing

The codebase follows these conventions:
- TypeScript for type safety
- ESLint and Prettier for code formatting
- Modular architecture with clear separation of concerns
- Comprehensive error handling and logging

## Recent Updates

**Favorites Feature (2025-01-31):**
- Added anonymous session-based favorites system
- Users can favorite tracks and albums with heart icon
- Persistent favorites stored in database (FavoriteTrack, FavoriteAlbum models)
- Favorites page with albums/tracks tabs
- Favorite buttons integrated throughout the app
- Red heart button in navigation bar for quick access

**Latest Refactoring (2025-01-21):**
- Modularized parser files (reduced from 3000+ to focused modules)
- Consolidated API routes for better maintainability
- Enhanced TypeScript type safety
- Improved caching and performance
- Maintained backward compatibility throughout

---

*Last Updated: January 2025*