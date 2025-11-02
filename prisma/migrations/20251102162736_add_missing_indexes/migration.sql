-- CreateIndex
CREATE INDEX IF NOT EXISTS "Feed_status_idx" ON "Feed"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Feed_status_type_idx" ON "Feed"("status", "type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Track_feedId_publishedAt_idx" ON "Track"("feedId", "publishedAt");

-- Note: GIN index for JSONB v4vValue would be created with:
-- CREATE INDEX IF NOT EXISTS "Track_v4vValue_idx" ON "Track" USING GIN ("v4vValue");
-- However, Prisma doesn't directly support GIN indexes, so this would need to be added manually
-- via raw SQL if needed for JSON queries.

