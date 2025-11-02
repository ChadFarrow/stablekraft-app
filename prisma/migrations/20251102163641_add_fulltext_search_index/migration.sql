-- CreateIndex: Add GIN index for full-text search on searchVector
-- This enables fast full-text search using PostgreSQL's tsvector

-- Create GIN index on searchVector for fast full-text search
-- Note: This index only helps when searchVector is populated
CREATE INDEX IF NOT EXISTS "Track_searchVector_gin_idx" ON "Track" USING GIN (to_tsvector('english', "searchVector"))
WHERE "searchVector" IS NOT NULL AND "searchVector" != '';

-- Add index on subtitle and description for improved search performance
CREATE INDEX IF NOT EXISTS "Track_subtitle_idx" ON "Track"("subtitle") WHERE "subtitle" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Track_description_idx" ON "Track"("description") WHERE "description" IS NOT NULL;

-- Create composite index for common search patterns (title + artist)
CREATE INDEX IF NOT EXISTS "Track_title_artist_idx" ON "Track"("title", "artist") 
WHERE "title" IS NOT NULL AND "artist" IS NOT NULL;
