/**
 * Script to resync feeds that have tracks with missing audio URLs
 * This will re-parse the RSS feeds with the updated parser that supports podcast:liveItem tags
 *
 * Run with: npx tsx scripts/resync-feeds-missing-audio.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resyncFeedsWithMissingAudio() {
  console.log('🔍 Finding feeds with missing audio URLs...\n');

  // Get feeds that have tracks with missing audio URLs
  const feedsWithMissingAudio = await prisma.$queryRaw<any[]>`
    SELECT DISTINCT
      f.id,
      f.title,
      f.artist,
      f."originalUrl",
      COUNT(t.id)::int as tracks_missing_audio
    FROM "Feed" f
    JOIN "Track" t ON t."feedId" = f.id
    WHERE t."audioUrl" = ''
    GROUP BY f.id, f.title, f.artist, f."originalUrl"
    ORDER BY tracks_missing_audio DESC
  `;

  if (feedsWithMissingAudio.length === 0) {
    console.log('✅ No feeds found with missing audio URLs!');
    return;
  }

  console.log(`📊 Found ${feedsWithMissingAudio.length} feeds with missing audio URLs:\n`);
  feedsWithMissingAudio.forEach((feed, idx) => {
    console.log(`   ${idx + 1}. "${feed.title}" by ${feed.artist || 'Unknown'}`);
    console.log(`      Missing Audio: ${feed.tracks_missing_audio} tracks`);
    console.log(`      Feed URL: ${feed.originalUrl}`);
    console.log('');
  });

  console.log('\n🔄 To resync these feeds, run the following command:');
  console.log('   npm run resync-feeds\n');

  console.log('Or mark them for immediate resync by updating lastFetched:');

  const feedIds = feedsWithMissingAudio.map(f => f.id);
  const updateResult = await prisma.feed.updateMany({
    where: {
      id: {
        in: feedIds
      }
    },
    data: {
      lastFetched: null, // This will force them to be re-synced
      updatedAt: new Date()
    }
  });

  console.log(`   ✅ Marked ${updateResult.count} feeds for immediate resync\n`);
  console.log('📌 These feeds will be re-parsed on the next sync cycle');
  console.log('   The updated RSS parser will now pick up podcast:liveItem tags');
}

async function main() {
  try {
    console.log('🚀 Starting Feed Resync Script for Missing Audio URLs\n');
    console.log('='.repeat(60) + '\n');

    await resyncFeedsWithMissingAudio();

    console.log('\n' + '='.repeat(60));
    console.log('✅ Script completed successfully!');
  } catch (error) {
    console.error('❌ Error during script execution:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
