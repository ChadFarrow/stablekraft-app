-- <podcast:funding> links (PayPal, Patreon, …): channel-level on Feed, item-level on Track.
-- Nullable and without a default, so adding them rewrites no rows and the code
-- deployed before this migration keeps working.

-- AlterTable
ALTER TABLE "Feed" ADD COLUMN "funding" JSONB;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN "funding" JSONB;
