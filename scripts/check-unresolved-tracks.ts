import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUnresolvedTracks() {
  try {
    console.log('🔍 Checking tracks with "Unresolved GUID" feeds...\n');

    // Find feeds with "Unresolved GUID" as artist
    const unresolvedFeeds = await prisma.feed.findMany({
      where: {
        artist: 'Unresolved GUID'
      },
      include: {
        Track: {
          take: 5,
          select: {
            title: true,
            artist: true,
            audioUrl: true,
            duration: true,
            image: true,
            guid: true
          }
        }
      },
      take: 5
    });

    console.log(`Found ${unresolvedFeeds.length} feeds with "Unresolved GUID" artist\n`);

    for (const feed of unresolvedFeeds) {
      console.log(`\n📻 Feed: ${feed.title}`);
      console.log(`   Feed ID: ${feed.id}`);
      console.log(`   Original URL: ${feed.originalUrl}`);
      console.log(`   Tracks: ${feed.Track.length} (showing sample)`);

      feed.Track.forEach(track => {
        console.log(`\n   🎵 ${track.title}`);
        console.log(`      Artist: ${track.artist || 'NULL'}`);
        console.log(`      Duration: ${track.duration}s`);
        console.log(`      Audio URL: ${track.audioUrl ? 'YES' : 'NO'}`);
        console.log(`      Image: ${track.image ? 'YES' : 'NO'}`);
        console.log(`      GUID: ${track.guid}`);
      });
    }

    // Count total tracks affected
    const totalAffected = await prisma.track.count({
      where: {
        Feed: {
          artist: 'Unresolved GUID'
        }
      }
    });

    console.log(`\n\n📊 Total tracks with "Unresolved GUID" feeds: ${totalAffected}`);

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkUnresolvedTracks();
