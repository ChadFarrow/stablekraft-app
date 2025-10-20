---
name: database-operations
description: Manage music track database operations including CRUD operations, queries, and analytics
---

# Database Operations Skill

This skill provides comprehensive database operations for music tracks, episodes, feeds, and related metadata using Prisma ORM and PostgreSQL.

## Inputs

- **operation_type** (string, required): Type of database operation
  - `create`: Create new records
  - `read`: Query existing records
  - `update`: Update existing records
  - `delete`: Delete records
  - `bulk_operations`: Perform bulk operations
  - `analytics`: Generate analytics queries

- **operation_data** (object, required): Operation-specific data
  - `table`: Target database table ('music_tracks', 'episodes', 'feeds', 'playlists')
  - `filters`: Query filters and conditions
  - `data`: Data for create/update operations
  - `options`: Operation-specific options

## Outputs

- **operation_result** (object): Result of the database operation
  - `success`: Boolean indicating operation success
  - `data`: Returned data (for read operations)
  - `affected_rows`: Number of affected rows
  - `execution_time`: Operation execution time in milliseconds
  - `errors`: Array of error messages (if any)

## Usage Examples

### Create Music Track
```typescript
import { executeDatabaseOperation } from './database-operations';

const result = await executeDatabaseOperation({
  operation_type: 'create',
  operation_data: {
    table: 'music_tracks',
    data: {
      title: 'Song Title',
      artist: 'Artist Name',
      duration: 180,
      audio_url: 'https://example.com/track.mp3',
      episode_id: 'episode-123',
      v4v_info: {
        lightning_address: 'artist@example.com',
        custom_key: 'custom_key',
        custom_value: 'custom_value'
      }
    }
  }
});
```

### Query Music Tracks
```typescript
const tracks = await executeDatabaseOperation({
  operation_type: 'read',
  operation_data: {
    table: 'music_tracks',
    filters: {
      artist: 'Artist Name',
      duration: { gte: 60, lte: 300 },
      created_at: { gte: '2024-01-01' }
    },
    options: {
      limit: 50,
      order_by: 'created_at',
      order_direction: 'desc',
      include: ['episode', 'feed']
    }
  }
});
```

### Bulk Operations
```typescript
const bulkResult = await executeDatabaseOperation({
  operation_type: 'bulk_operations',
  operation_data: {
    table: 'music_tracks',
    operations: [
      { type: 'create', data: track1 },
      { type: 'create', data: track2 },
      { type: 'update', id: 'track-123', data: { title: 'New Title' } }
    ]
  }
});
```

## Database Schema

### Music Tracks Table
- `id`: Unique identifier
- `title`: Track title
- `artist`: Artist name
- `album`: Album name
- `duration`: Duration in seconds
- `audio_url`: Audio file URL
- `artwork_url`: Album artwork URL
- `episode_id`: Associated episode ID
- `feed_id`: Associated feed ID
- `v4v_info`: Value4Value payment information (JSON)
- `metadata`: Additional metadata (JSON)
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

### Episodes Table
- `id`: Unique identifier
- `guid`: Episode GUID
- `title`: Episode title
- `description`: Episode description
- `pub_date`: Publication date
- `duration`: Episode duration
- `audio_url`: Episode audio URL
- `feed_id`: Associated feed ID
- `chapters`: Chapter information (JSON)
- `value_splits`: Value time splits (JSON)
- `created_at`: Creation timestamp

### Feeds Table
- `id`: Unique identifier
- `url`: Feed URL
- `title`: Feed title
- `description`: Feed description
- `author`: Feed author
- `language`: Feed language
- `category`: Feed category
- `image_url`: Feed image URL
- `last_build_date`: Last build date
- `last_checked`: Last check timestamp
- `status`: Feed status ('active', 'inactive', 'error')
- `created_at`: Creation timestamp

## Analytics Operations

### Track Statistics
- Total tracks by artist
- Duration distribution
- Popular tracks by play count
- V4V payment statistics

### Feed Analytics
- Feed processing statistics
- Episode count trends
- Music extraction success rates
- Cache hit rates

### Performance Metrics
- Database query performance
- Operation execution times
- Error rates and types
- Resource utilization

## Error Handling

- **Connection Errors**: Handles database connection failures
- **Query Errors**: Manages SQL syntax and constraint errors
- **Data Validation**: Validates input data before operations
- **Transaction Failures**: Handles rollback scenarios
- **Timeout Handling**: Manages long-running operations

## Dependencies

- `prisma`: Database ORM
- `@prisma/client`: Prisma client
- `lib/music-track-database.ts`: Database service layer
- `lib/enhanced-music-service.ts`: Enhanced operations

## Performance Optimizations

- **Connection Pooling**: Efficient database connections
- **Query Optimization**: Optimized SQL queries
- **Indexing**: Proper database indexes
- **Caching**: Query result caching
- **Batch Operations**: Bulk operation support

## Security Considerations

- **SQL Injection Prevention**: Parameterized queries
- **Data Validation**: Input sanitization
- **Access Control**: Operation permissions
- **Audit Logging**: Operation tracking
