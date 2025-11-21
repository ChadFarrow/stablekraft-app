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
├── publisher/[id]/             # Publisher pages
└── admin/                      # Admin panel (Nostr auth required)

components/
├── AdminPanel.tsx              # Admin panel with feed management
├── NowPlayingBar.tsx           # Audio player controls
├── MusicTrackList.tsx          # Track listing component
├── PlaylistAlbum.tsx           # Album playlist view
├── BoostButton.tsx             # Lightning payment boost button
├── Toast.tsx                   # Toast notification system
├── Nostr/                      # Nostr authentication components
│   └── LoginModal.tsx          # Nostr login interface
├── favorites/                   # Favorites components
│   └── FavoriteButton.tsx      # Heart icon favorite button
└── [other components]
```

## Key Features

### Admin Panel
- **Nostr Authentication** - Secure admin access using Nostr identity
- **RSS Feed Management** - Add, refresh, and manage podcast RSS feeds
- **Publisher Auto-Import** - Automatically detects and imports artist publisher feeds
- **Import Results Modal** - Detailed feedback on feed imports with v4v info
- **Recently Added** - View last 5 imported feeds with metadata

### Music Track Extraction
- Parses podcast RSS feeds for music content
- Extracts from chapters, value time splits, and descriptions
- Supports multiple audio sources (direct URLs, Wavlake, etc.)
- Deduplicates tracks intelligently

### Value4Value (V4V) Integration
- Resolves Lightning Network payment information from feeds
- Integrates with Podcast Index API for publisher discovery
- Boost button for streaming sats to artists
- Displays payment splits and recipient Lightning addresses
- Auto-saves v4v data during feed import
- Helipad TLV protocol support for advanced V4V features

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

# Podcast Index API (for V4V resolution & publisher discovery)
PODCAST_INDEX_API_KEY="your_key"
PODCAST_INDEX_API_SECRET="your_secret"

# Lightning Network Configuration
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY="your_node_pubkey_here"

# Admin Access (Nostr npubs, comma-separated)
ADMIN_NPUBS="npub1...,npub2..."

# Base URL (for API calls)
NEXT_PUBLIC_BASE_URL="https://yourdomain.com"

# Optional: CDN & Storage
BUNNY_CDN_HOSTNAME="your_cdn_hostname"
BUNNY_CDN_ZONE="your_zone"
BUNNY_CDN_API_KEY="your_key"
NEXT_PUBLIC_CDN_URL="https://cdn.yourdomain.com"
NEXT_PUBLIC_IMAGE_DOMAIN="cdn.yourdomain.com"

# Optional: Nostr Features
NEXT_PUBLIC_NOSTR_ENABLED="true"
NEXT_PUBLIC_NOSTR_RELAYS="wss://relay1.com,wss://relay2.com"
NEXT_PUBLIC_NOSTR_ZAP_ENABLED="true"
NEXT_PUBLIC_NOSTR_NIP05_ENABLED="true"
NOSTR_PRIVATE_KEY="nsec..."
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

### Feed Management
- `GET /api/feeds` - List all feeds with filters (type, status, priority, sortBy)
- `POST /api/feeds` - Add new feed and auto-import publisher feeds
- `PUT /api/feeds` - Update feed metadata
- `DELETE /api/feeds` - Remove feed and associated tracks

### Admin Operations
- `POST /api/admin/verify` - Verify Nostr-based admin access
- Admin npubs configured via `ADMIN_NPUBS` environment variable

### Music Operations
- `GET /api/music-tracks` - Query music tracks with filters
- `POST /api/music-tracks` - Add tracks or bulk operations
- `GET /api/music-tracks/database` - Database operations for tracks

### Albums & Publishers
- `GET /api/albums-fast` - Fast album listing with caching
- `GET /api/albums/[slug]` - Album details by slug or ID
- `GET /api/publishers` - List publisher feeds

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

### Feed Management
- **Feed** - Podcast RSS feed metadata
  - Title, description, artist, image
  - Type (album, publisher, playlist, single)
  - Priority, status (active, error, sidebar-only)
  - v4vRecipient and v4vValue (Lightning payment info)
  - GUID for podcast:guid matching

### Music Tracks
- **Track** - Individual track metadata
  - Title, subtitle, description, artist
  - Audio URL, duration, explicit flag
  - Episode and feed relationships
  - Value4Value payment information (v4vRecipient, v4vValue)
  - iTunes metadata (author, summary, image, keywords)
  - Time segments (startTime, endTime) for value splits
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
- Auto-detection of publisher feeds via RSS tags

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

**Admin Panel & Feed Management (2025-11-20):**
- Added Nostr-based admin authentication system
- RSS feed management interface with add/refresh/view features
- Auto-import of publisher feeds via `podcast:publisher` RSS tags
- Import results modal with detailed feedback on v4v info and publisher imports
- Recently Added section showing last 5 imported feeds with metadata
- Refresh button with proper sorting by creation date
- v4v payment data automatically saved during feed import
- Boost buttons throughout app for Lightning payments to artists
- Enhanced album and track APIs to properly use feed-level v4v data

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

*Last Updated: November 2025*