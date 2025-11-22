import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkMissingV4V() {
  const tracksWithoutV4V = await prisma.track.findMany({
    where: {
      v4vRecipient: null
    },
    include: {
      Feed: {
        select: {
          id: true,
          title: true,
          originalUrl: true
        }
      }
    }
  });

  // Group by feed source
  const bySource = new Map<string, typeof tracksWithoutV4V>();
  tracksWithoutV4V.forEach(track => {
    const url = track.Feed.originalUrl || 'unknown';
    let source = 'unknown';

    if (url.includes('wavlake.com')) source = 'Wavlake';
    else if (url.includes('fountain.fm')) source = 'Fountain';
    else if (url.includes('rssblue.com')) source = 'RSS Blue';
    else if (url.includes('doerfelverse.com')) source = 'Doerfelverse';
    else if (url.includes('music.behindthesch3m3s.com')) source = 'Behind The Schemes';
    else if (url.includes('feeds.simplecast.com')) source = 'Simplecast';
    else source = 'Other';

    if (!bySource.has(source)) {
      bySource.set(source, []);
    }
    bySource.get(source)!.push(track);
  });

  console.log('\n📊 Tracks without V4V data by source:\n');
  console.log(`Total tracks without V4V: ${tracksWithoutV4V.length}\n`);

  for (const [source, tracks] of bySource.entries()) {
    console.log(`${source}: ${tracks.length} tracks`);
    console.log(`   Sample track: ${tracks[0].title}`);
    console.log(`   Feed: ${tracks[0].Feed.title}`);
    console.log(`   Feed GUID: ${tracks[0].feedId}`);
    console.log(`   Feed URL: ${tracks[0].Feed.originalUrl}`);
    console.log('');
  }

  // Check some specific tracks in the Podcast Index API
  console.log('\n🔍 Checking a few samples in Podcast Index API...\n');

  await prisma.$disconnect();
}

checkMissingV4V();
