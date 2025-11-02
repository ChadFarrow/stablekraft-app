# Local Development Setup

## Environment Configuration

### Database Connection
The local development server is configured to connect to the Railway production database for consistency.

**Environment Variables in `.env.local`:**
```env
# Database (PostgreSQL) - Railway Production Database
DATABASE_URL="postgresql://postgres:RZebAIqzMjvrqWVBzkcpsOpvKHrIYGVc@shuttle.proxy.rlwy.net:14633/railway"

# API Keys
PODCAST_INDEX_API_KEY=CM9M48BRFRTRMUCAWV82
PODCAST_INDEX_API_SECRET=WbB4Yx7zFLWbUvCYccb8YsKVeN5Zd2SgS4tEQjet

# Site Configuration
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NODE_ENV=development
NEXT_PUBLIC_IMAGE_DOMAIN=localhost
```

### Service Worker Configuration
- **Development**: PWA and Service Worker are disabled to prevent conflicts
- **Production**: PWA enabled for offline functionality

### Key Configuration Files

#### `next.config.js`
```javascript
disable: process.env.NODE_ENV === 'development', // PWA disabled in dev
```

#### `components/ServiceWorkerRegistration.tsx`
```javascript
if (process.env.NODE_ENV === 'development') {
  console.log('🔧 Service Worker disabled in development mode');
  return;
}
```

#### `app/layout.tsx`
```javascript
import './globals.css' // CSS properly imported (was commented out)
```

## Fixed Issues

### 1. Albums Not Loading
**Problem**: Albums state was never set, causing "No Albums Found" display
**Solution**: Added `setAlbums(pageAlbums)` call in `loadCriticalAlbums()` function

### 2. Service Worker Conflicts
**Problem**: Service worker registration causing errors in development
**Solution**: Properly disabled PWA and service worker registration in development mode

### 3. CSS Not Loading
**Problem**: CSS import was commented out in layout.tsx
**Solution**: Re-enabled CSS import to load Tailwind styles

### 4. Playlist Functionality Removal
**Problem**: Type mismatch between ControlsBar and page component
**Solution**: Removed 'playlist' from FilterType and removed playlist handling code

## Development Commands

```bash
# Start development server
npm run dev

# Connect to Railway database
# (Already configured in .env.local)

# Clean build cache (if needed)
rm -rf .next public/sw.js public/workbox-*.js

# Restart clean dev server
npm run dev
```

## Production Deployment
- **Live Site**: https://music.podtards.com/
- **Platform**: Railway
- **Auto-deploy**: Connected to main branch
- **Database**: Railway PostgreSQL

## Important Notes
- Local dev uses same database as production for consistency
- Service worker only active in production
- PWA features disabled in development for better debugging
- CSS and Tailwind properly configured
- All playlist functionality removed as requested