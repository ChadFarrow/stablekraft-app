# Nostr Architecture

## Overview

This application uses **Nostr relays for social features only** (sharing, follows, profile). The Railway PostgreSQL database stores all non-social data (favorites, tracks, albums, etc.) as it does now.

## Core Principle

**Nostr is for social features. Database is for app data.**

- **Nostr Relays**: Social features (shares, follows, profile metadata)
- **Railway Database**: App data (favorites, tracks, albums, listening history)

This ensures:
- ✅ Social features are decentralized and portable
- ✅ App data remains fast and reliable in the database
- ✅ Users can share their listening activity on Nostr
- ✅ Favorites and other app data stay in the database for performance

## Data Flow

### Social Features (Nostr)
```
User Action (Share/Follow/Profile)
    ↓
Publish to Nostr Relays (kind events)
    ↓
Cache in Database (for performance)
    ↓
Return Success
```

### App Data (Database)
```
User Action (Favorite/Playlist)
    ↓
Store in Railway Database
    ↓
Return Success
```

## Event Types

### Social Features (Nostr Relays)

#### Profile Updates (Kind 0)
- **Event**: `kind: 0` (Metadata)
- **Stored in**: Nostr relays + `User` table (cache)
- **API**: `POST /api/nostr/profile/update`
- **Flow**: Publish kind 0 → Update database cache

#### Follows (Kind 3)
- **Event**: `kind: 3` (Contact List)
- **Stored in**: Nostr relays + `Follow` table (cache)
- **API**: `POST /api/nostr/follow`
- **Flow**: Update database → Rebuild contact list → Publish kind 3 → Cache in database

#### Shares (Kind 1)
- **Event**: `kind: 1` (Text Note)
- **Stored in**: Nostr relays + `NostrPost` table (cache)
- **API**: `POST /api/nostr/share`
- **Flow**: Publish kind 1 → Cache in database
- **Purpose**: Share what you're listening to on Nostr

#### Boosts (Kind 9735/9736)
- **Events**: 
  - `kind: 9735` (Zap Request)
  - `kind: 9736` (Zap Receipt)
- **Stored in**: Nostr relays + `BoostEvent` table (cache)
- **API**: `POST /api/nostr/boost`
- **Flow**: Publish kind 9735 → Cache in database
- **Purpose**: Share Lightning boosts on Nostr

### App Data (Railway Database + Nostr)

#### Favorites
- **Stored in**: 
  - Nostr relays (kind 30001 for tracks, kind 30002 for albums)
  - `FavoriteTrack` and `FavoriteAlbum` tables (database for fast queries)
- **API**: `POST /api/favorites/tracks` or `/api/favorites/albums`
- **Flow**: Store in database → Publish to Nostr → Return success
- **Note**: Stored on both Nostr relays (decentralized) and database (fast queries)

#### Tracks & Albums
- **Stored in**: `Track` and `Feed` tables (database only)
- **Note**: Core app data, not social features

## Database Schema

### Social Features (Cached from Nostr)
- `User` - Caches kind 0 metadata events
- `Follow` - Caches kind 3 contact list events
- `NostrPost` - Caches kind 1 note events
- `BoostEvent` - Caches kind 9735/9736 zap events

### App Data (Database + Nostr)
- `FavoriteTrack` - User favorites (stored in database + published to Nostr)
- `FavoriteAlbum` - User favorites (stored in database + published to Nostr)
- `Track` - Music tracks (database only)
- `Feed` - Music albums/feeds (database only)

## Implementation Details

### Publishing to Nostr (Social Features Only)

Social feature endpoints (profile, follows, shares, boosts):
1. **Require private key** (for signing events)
2. **Publish to Nostr relays first** (source of truth)
3. **Cache in database second** (performance optimization)
4. **Return event ID** (for reference)

### App Data (Database + Nostr)

Favorites endpoints:
1. **Store in Railway database first** (fast queries)
2. **Publish to Nostr relays** (decentralized storage)
3. **Hybrid approach** - database for speed, Nostr for portability

Other app data endpoints (tracks, albums):
1. **Store directly in Railway database**
2. **No Nostr publishing** (not user-generated data)
3. **Fast and reliable** (no relay dependency)

### Error Handling

- If Nostr publish fails, the operation still succeeds (database cache is updated)
- Warnings are logged but don't block user actions
- Database cache ensures app continues working even if relays are down
- App data (favorites) always works regardless of Nostr relay status

## Benefits

### Social Features (Nostr)
1. **User Ownership**: Users control their social data through their Nostr keys
2. **Portability**: Social data can be accessed from any Nostr client
3. **Resilience**: Social data distributed across multiple relays
4. **Interoperability**: Works with the broader Nostr ecosystem
5. **Sharing**: Users can share what they're listening to on Nostr

### App Data (Database + Nostr)
1. **Performance**: Fast queries from database
2. **Portability**: Favorites stored on Nostr relays (accessible from any client)
3. **Reliability**: Database ensures favorites always work even if relays are down
4. **Decentralization**: Favorites are user-owned and portable via Nostr

## Future Enhancements

- [ ] Sync from Nostr on login (pull latest social events)
- [ ] Background sync job to keep social cache fresh
- [ ] Conflict resolution (Nostr events take precedence for social data)
- [ ] Event ID storage for deletion tracking
- [ ] Relay health monitoring

