/**
 * Script to fix missing track metadata by populating from Feed data
 *
 * Fixes:
 * 1. Missing album field - populated from Feed.title
 * 2. Missing artist field - populated from Feed.artist
 *
 * Run with: npx tsx scripts/fix-missing-track-metadata.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixMissingMetadata() {
  console.log('🔍 Analyzing missing track metadata...\n');

  // Get statistics before fix
  const beforeStats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int as total_tracks,
      SUM(CASE WHEN album IS NULL OR album = '' THEN 1 ELSE 0 END)::int as missing_album,
      SUM(CASE WHEN artist IS NULL OR artist = '' THEN 1 ELSE 0 END)::int as missing_artist
    FROM "Track"
  `;

  const stats = beforeStats[0];
  console.log('📊 Current Statistics:');
  console.log(`   Total Tracks: ${stats.total_tracks.toLocaleString()}`);
  console.log(`   Missing Album: ${stats.missing_album.toLocaleString()} (${((stats.missing_album / stats.total_tracks) * 100).toFixed(2)}%)`);
  console.log(`   Missing Artist: ${stats.missing_artist.toLocaleString()} (${((stats.missing_artist / stats.total_tracks) * 100).toFixed(2)}%)\n`);

  // Fix 1: Populate album field from Feed.title
  console.log('🔧 Fixing missing album fields...');
  const albumUpdateResult = await prisma.$executeRaw`
    UPDATE "Track" t
    SET
      album = f.title,
      "updatedAt" = NOW()
    FROM "Feed" f
    WHERE
      t."feedId" = f.id
      AND (t.album IS NULL OR t.album = '')
  `;
  console.log(`   ✅ Updated ${albumUpdateResult} tracks with album info from Feed.title\n`);

  // Fix 2: Populate artist field from Feed.artist
  console.log('🔧 Fixing missing artist fields...');
  const artistUpdateResult = await prisma.$executeRaw`
    UPDATE "Track" t
    SET
      artist = f.artist,
      "updatedAt" = NOW()
    FROM "Feed" f
    WHERE
      t."feedId" = f.id
      AND (t.artist IS NULL OR t.artist = '')
      AND f.artist IS NOT NULL
      AND f.artist != ''
  `;
  console.log(`   ✅ Updated ${artistUpdateResult} tracks with artist info from Feed.artist\n`);

  // Get statistics after fix
  const afterStats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int as total_tracks,
      SUM(CASE WHEN album IS NULL OR album = '' THEN 1 ELSE 0 END)::int as missing_album,
      SUM(CASE WHEN artist IS NULL OR artist = '' THEN 1 ELSE 0 END)::int as missing_artist
    FROM "Track"
  `;

  const statsAfter = afterStats[0];
  console.log('📊 Updated Statistics:');
  console.log(`   Total Tracks: ${statsAfter.total_tracks.toLocaleString()}`);
  console.log(`   Missing Album: ${statsAfter.missing_album.toLocaleString()} (${((statsAfter.missing_album / statsAfter.total_tracks) * 100).toFixed(2)}%)`);
  console.log(`   Missing Artist: ${statsAfter.missing_artist.toLocaleString()} (${((statsAfter.missing_artist / statsAfter.total_tracks) * 100).toFixed(2)}%)\n`);

  // Summary
  console.log('📈 Summary:');
  console.log(`   Album fields fixed: ${stats.missing_album - statsAfter.missing_album}`);
  console.log(`   Artist fields fixed: ${stats.missing_artist - statsAfter.missing_artist}`);

  // Show sample of updated tracks
  const sampleUpdated = await prisma.$queryRaw<any[]>`
    SELECT
      t.title as track_title,
      t.artist as track_artist,
      t.album as track_album,
      f.title as feed_title,
      f.artist as feed_artist
    FROM "Track" t
    JOIN "Feed" f ON t."feedId" = f.id
    WHERE t.album = f.title
    LIMIT 5
  `;

  console.log('\n📝 Sample Updated Tracks:');
  sampleUpdated.forEach((track, idx) => {
    console.log(`   ${idx + 1}. "${track.track_title}"`);
    console.log(`      Album: "${track.track_album}" (from feed: "${track.feed_title}")`);
    console.log(`      Artist: "${track.track_artist || 'N/A'}"`);
  });
}

async function main() {
  try {
    console.log('🚀 Starting Track Metadata Fix Script\n');
    console.log('='.repeat(60) + '\n');

    await fixMissingMetadata();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
