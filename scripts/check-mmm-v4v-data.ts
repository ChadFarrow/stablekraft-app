import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkV4VData() {
  try {
    console.log('🔍 Checking V4V Payment Data for MMM Playlist\n');
    console.log('='.repeat(70));

    // Get a sample of tracks from feeds
    const tracks = await prisma.track.findMany({
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            originalUrl: true
          }
        }
      },
      take: 50,
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`\nChecking ${tracks.length} sample tracks...\n`);

    let hasV4VRecipient = 0;
    let hasV4VValue = 0;
    let missingBoth = 0;
    let wavlakeTracks = 0;
    let wavlakeMissingV4V = 0;

    for (const track of tracks) {
      const isWavlake = track.Feed.originalUrl?.includes('wavlake.com');

      if (isWavlake) {
        wavlakeTracks++;
      }

      const hasRecipient = !!track.v4vRecipient;
      const hasValue = !!track.v4vValue;

      if (hasRecipient) hasV4VRecipient++;
      if (hasValue) hasV4VValue++;
      if (!hasRecipient && !hasValue) {
        missingBoth++;

        if (isWavlake) {
          wavlakeMissingV4V++;
          console.log(`❌ ${track.title}`);
          console.log(`   Feed: ${track.Feed.title}`);
          console.log(`   Feed URL: ${track.Feed.originalUrl}`);
          console.log(`   Has v4vRecipient: ${hasRecipient}`);
          console.log(`   Has v4vValue: ${hasValue}`);
          console.log('');
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('\n📊 Summary:');
    console.log(`   Total tracks checked: ${tracks.length}`);
    console.log(`   Wavlake tracks: ${wavlakeTracks}`);
    console.log(`   Has v4vRecipient: ${hasV4VRecipient} (${Math.round(hasV4VRecipient/tracks.length*100)}%)`);
    console.log(`   Has v4vValue: ${hasV4VValue} (${Math.round(hasV4VValue/tracks.length*100)}%)`);
    console.log(`   Missing both: ${missingBoth} (${Math.round(missingBoth/tracks.length*100)}%)`);
    console.log(`   Wavlake missing V4V: ${wavlakeMissingV4V} / ${wavlakeTracks} (${Math.round(wavlakeMissingV4V/wavlakeTracks*100)}%)`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkV4VData();
