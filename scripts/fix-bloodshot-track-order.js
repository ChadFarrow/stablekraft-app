const { PrismaClient } = require('@prisma/client');
const Parser = require('rss-parser');

const prisma = new PrismaClient();
const parser = new Parser();

(async () => {
  try {
    const feedUrl = 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml';
    console.log('Fetching feed:', feedUrl);

    // Parse the RSS feed
    const feed = await parser.parseURL(feedUrl);
    console.log(`Found ${feed.items.length} items in feed\n`);

    // Get the feed from database
    const dbFeed = await prisma.feed.findFirst({
      where: { originalUrl: { contains: 'bloodshot-lies' } },
      include: {
        Track: {
          select: { id: true, guid: true, title: true, audioUrl: true }
        }
      }
    });

    if (!dbFeed) {
      console.log('Feed not found in database');
      return;
    }

    console.log(`Feed: ${dbFeed.title}`);
    console.log(`Database has ${dbFeed.Track.length} tracks\n`);

    // Create a map of tracks by GUID and title for matching
    const tracksByGuid = new Map();
    const tracksByTitle = new Map();

    dbFeed.Track.forEach(track => {
      if (track.guid) {
        tracksByGuid.set(track.guid, track);
      }
      tracksByTitle.set(track.title.toLowerCase().trim(), track);
    });

    // Update trackOrder for each item in the feed
    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < feed.items.length; i++) {
      const item = feed.items[i];
      const order = i + 1; // 1-based index

      // Try to find matching track by GUID first, then by title
      let dbTrack = null;

      if (item.guid) {
        dbTrack = tracksByGuid.get(item.guid);
      }

      if (!dbTrack && item.title) {
        dbTrack = tracksByTitle.get(item.title.toLowerCase().trim());
      }

      if (dbTrack) {
        await prisma.track.update({
          where: { id: dbTrack.id },
          data: { trackOrder: order }
        });
        console.log(`✅ ${order}. ${item.title || 'Untitled'}`);
        updated++;
      } else {
        console.log(`❌ ${order}. ${item.title || 'Untitled'} - NOT FOUND IN DB`);
        notFound++;
      }
    }

    console.log(`\n✅ Updated ${updated} tracks`);
    if (notFound > 0) {
      console.log(`⚠️  ${notFound} tracks from feed not found in database`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
