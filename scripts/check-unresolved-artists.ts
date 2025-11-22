import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkUnresolvedArtists() {
  try {
    console.log('🔍 Checking tracks displayed with "Unresolved GUID" artist...\n');

    // Find tracks where the Feed has artist = "Unresolved GUID"
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
            artist: true,
            originalUrl: true
          }
        }
      },
      take: 10,
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`Found ${tracks.length} sample tracks (out of 697 total)\n`);

    tracks.forEach((track, i) => {
      console.log(`\n${i + 1}. 🎵 ${track.title}`);
      console.log(`   Track artist field: ${track.artist || 'NULL'}`);
      console.log(`   Feed: ${track.Feed.title}`);
      console.log(`   Feed artist: ${track.Feed.artist}`);
      console.log(`   Audio URL: ${track.audioUrl ? track.audioUrl.substring(0, 60) + '...' : 'NONE'}`);
      console.log(`   Duration: ${track.duration}s`);
      console.log(`   Image: ${track.image ? 'YES' : 'NO'}`);
      console.log(`   Track GUID: ${track.guid}`);
      console.log(`   Feed GUID: ${track.Feed.id}`);
    });

    await prisma.$disconnect();

  } catch (error) {
    console.error('❌ Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

checkUnresolvedArtists();
