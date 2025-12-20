-- Archive table for Track records
-- Stores tracks that have been removed (duplicates, empty audioUrl, etc.)
CREATE TABLE IF NOT EXISTS "_ArchivedTrack" (
    "id" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "guid" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subtitle" TEXT,
    "audioUrl" TEXT NOT NULL,
    "image" TEXT,
    "duration" INTEGER,
    "itunesDuration" TEXT,
    "publishedAt" TIMESTAMP(3),
    "itunesKeywords" TEXT[],
    "itunesCategories" TEXT[],
    "artist" TEXT,
    "album" TEXT,
    "trackOrder" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "v4vRecipient" TEXT,
    "v4vValue" JSONB,
    "searchVector" TEXT,
    -- Archive metadata
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archiveReason" TEXT NOT NULL,
    "replacedById" TEXT,

    CONSTRAINT "_ArchivedTrack_pkey" PRIMARY KEY ("id")
);

-- Index for querying archived tracks by reason
CREATE INDEX IF NOT EXISTS "_ArchivedTrack_archiveReason_idx" ON "_ArchivedTrack"("archiveReason");
CREATE INDEX IF NOT EXISTS "_ArchivedTrack_archivedAt_idx" ON "_ArchivedTrack"("archivedAt");

-- Add GIN index for v4vValue JSONB queries on Track and Feed tables
-- This improves query performance for v4v-related lookups
CREATE INDEX IF NOT EXISTS "Track_v4vValue_gin_idx" ON "Track" USING GIN ("v4vValue");
CREATE INDEX IF NOT EXISTS "Feed_v4vValue_gin_idx" ON "Feed" USING GIN ("v4vValue");
