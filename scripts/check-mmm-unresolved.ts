import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMMMUnresolved() {
  try {
    console.log('🔍 Checking MMM playlist for tracks with "Unresolved GUID" feeds...\n');

    // Get all tracks in MMM playlist with Unresolved GUID feeds
    const tracks = await prisma.track.findMany({
      where: {
        Feed: {
          artist: 'Unresolved GUID'
        }
      },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true
          }
        }
      },
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`Found ${tracks.length} tracks with "Unresolved GUID" feeds\n`);

    // Group by feed to see which feeds are affected
    const feedGroups = new Map<string, any[]>();
    tracks.forEach(track => {
      const feedId = track.Feed.id;
      if (!feedGroups.has(feedId)) {
        feedGroups.set(feedId, []);
      }
      feedGroups.get(feedId)!.push(track);
    });

    console.log(`\n📊 Affected Feeds (${feedGroups.size} total):\n`);

    for (const [feedId, feedTracks] of feedGroups.entries()) {
      const feed = feedTracks[0].Feed;
      console.log(`\n📻 ${feed.title}`);
      console.log(`   Feed ID: ${feedId}`);
      console.log(`   Track count: ${feedTracks.length}`);
      console.log(`   Sample tracks:`);
      feedTracks.slice(0, 3).forEach(track => {
        console.log(`      - ${track.title} (artist: ${track.artist || 'NULL'})`);
      });
      if (feedTracks.length > 3) {
        console.log(`      ... and ${feedTracks.length - 3} more`);
      }
    }

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkMMMUnresolved();
