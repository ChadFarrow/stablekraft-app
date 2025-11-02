# Database Migration Guide

This guide covers the complete transformation of FUCKIT music app from hardcoded RSS feeds to a PostgreSQL database-driven system.

## Overview

The migration includes:
- ✅ PostgreSQL database with Prisma ORM
- ✅ Feed and Track models with iTunes tag support
- ✅ RSS parser with music segment extraction
- ✅ CRUD API routes for feeds and tracks
- ✅ Advanced search functionality
- ✅ React music player components
- ✅ Feed management UI
- ✅ Migration scripts for existing data
- ✅ Railway deployment configuration

## Database Schema

### Feed Model
- Stores RSS feed metadata (title, URL, type, priority)
- Supports album, playlist, and podcast types
- Tracks parsing status and errors
- Maintains CDN URLs for performance

### Track Model
- Complete iTunes tag support
- V4V (Value for Value) payment integration
- Time segment support for podcast music
- Full-text search capabilities
- Relationship to parent feed

## API Endpoints

### Feeds Management
- `GET /api/feeds` - List feeds with filters
- `POST /api/feeds` - Add new feed and parse tracks
- `PUT /api/feeds` - Update feed metadata
- `DELETE /api/feeds` - Remove feed and tracks
- `POST /api/feeds/[id]/refresh` - Refresh feed content

### Tracks Management
- `GET /api/tracks` - List tracks with search and filters
- `POST /api/tracks` - Create individual track
- `PUT /api/tracks` - Update track metadata
- `DELETE /api/tracks` - Remove track
- `GET /api/tracks/search` - Advanced search with facets

## Migration Process

1. **Setup Database**
   ```bash
   # Install dependencies
   npm install

   # Set up environment variables
   cp .env.example .env
   # Edit .env with your DATABASE_URL

   # Generate Prisma client
   npm run db:generate

   # Run migrations
   npm run db:migrate:dev
   ```

2. **Migrate Existing Data**
   ```bash
   # Run migration script
   npm run migrate-to-db
   ```

3. **Verify Migration**
   - Check `/api/health` endpoint
   - Visit `/admin/feeds` for feed management
   - Visit `/library` for database music player

## New Features

### Feed Management UI (`/admin/feeds`)
- Add/remove RSS feeds dynamically
- Refresh feeds to fetch new content
- Filter by type, status, and priority
- Real-time error handling and status updates

### Database Music Player (`/library`)
- Stream directly from database
- Advanced search across all metadata
- Filter by artist, album, type, V4V support
- Persistent player state
- Pagination for large collections

### Enhanced RSS Parser
- iTunes podcast tag support
- Music segment extraction from podcasts
- V4V payment information parsing
- Time-based track segments
- Automatic duplicate detection

## Deployment

### Railway Setup

1. **Create Railway Project**
   ```bash
   railway login
   railway init
   ```

2. **Add PostgreSQL**
   ```bash
   railway add postgresql
   ```

3. **Deploy**
   ```bash
   railway deploy
   ```

4. **Run Migrations**
   ```bash
   railway run npm run db:migrate
   railway run npm run migrate-to-db
   ```

### Environment Variables
Required for Railway deployment:
- `DATABASE_URL` - PostgreSQL connection string
- `PODCAST_INDEX_API_KEY` - For V4V resolution
- `PODCAST_INDEX_API_SECRET` - For V4V resolution
- `NEXT_PUBLIC_BASE_URL` - Your Railway app URL

## Performance Optimizations

### Database Indexes
- Feed URLs for uniqueness
- Track metadata for search
- Publishing dates for sorting
- Artist/album for filtering

### CDN Integration
- Preserves existing Bunny CDN setup
- Audio proxy for CORS handling
- Image optimization maintained

### Caching Strategy
- RSS feed parsing results cached
- Database queries optimized with Prisma
- Search results with pagination

## Features Preserved

✅ **Bunny CDN Integration** - All existing CDN functionality maintained  
✅ **PWA Functionality** - Service worker and offline capabilities  
✅ **Audio Context** - Advanced audio player with HLS support  
✅ **Existing Styling** - TailwindCSS and component designs  
✅ **V4V Support** - Lightning payment integration  
✅ **Mobile Optimization** - Responsive design and touch controls  

## API Migration Examples

### Before (Hardcoded)
```javascript
const feedUrls = [
  'https://example.com/feed1.xml',
  'https://example.com/feed2.xml'
];
```

### After (Database-Driven)
```javascript
const response = await fetch('/api/feeds');
const { feeds } = await response.json();
```

### Before (Static Track Lists)
```javascript
const tracks = await Promise.all(
  feedUrls.map(url => parseRSSFeed(url))
);
```

### After (Database Queries)
```javascript
const response = await fetch('/api/tracks?search=artist');
const { tracks } = await response.json();
```

## Testing

1. **Health Check**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Feed Management**
   ```bash
   # Add new feed
   curl -X POST http://localhost:3000/api/feeds \
     -H "Content-Type: application/json" \
     -d '{"originalUrl": "https://example.com/feed.xml"}'
   ```

3. **Search Tracks**
   ```bash
   curl "http://localhost:3000/api/tracks?search=music&type=album"
   ```

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` in environment
- Check PostgreSQL service status
- Run `npm run db:push` to sync schema

### Migration Failures
- Check RSS feed accessibility
- Verify existing JSON data format
- Review migration logs for specific errors

### Performance Issues
- Monitor database query performance
- Check CDN configuration
- Verify search index usage

## Next Steps

1. **Monitor Performance** - Use `/api/health` for system monitoring
2. **Scale Database** - Configure connection pooling for production
3. **Add Features** - Implement playlists, favorites, and user accounts
4. **Optimize Search** - Add full-text search indexes
5. **Analytics** - Track popular tracks and feeds

This migration provides a solid foundation for scaling your music platform while preserving all existing functionality and performance optimizations.