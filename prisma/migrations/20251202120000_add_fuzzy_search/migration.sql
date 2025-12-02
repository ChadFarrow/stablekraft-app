-- Enable pg_trgm extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN indexes for trigram similarity search on Track table
CREATE INDEX IF NOT EXISTS "Track_title_trgm_idx" ON "Track" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Track_artist_trgm_idx" ON "Track" USING GIN ("artist" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Track_album_trgm_idx" ON "Track" USING GIN ("album" gin_trgm_ops);

-- Create GIN indexes for trigram similarity search on Feed table
CREATE INDEX IF NOT EXISTS "Feed_title_trgm_idx" ON "Feed" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Feed_artist_trgm_idx" ON "Feed" USING GIN ("artist" gin_trgm_ops);
