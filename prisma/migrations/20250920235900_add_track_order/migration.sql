-- Add trackOrder column to Track table
ALTER TABLE "public"."Track" ADD COLUMN "trackOrder" INTEGER;

-- Create index on trackOrder column
CREATE INDEX "Track_trackOrder_idx" ON "public"."Track"("trackOrder");