const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // Find the Satellite Spotlight feed
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        id: true,
        title: true,
        Track: {
          select: {
            id: true,
            title: true,
            v4vValue: true
          },
          take: 10 // Just check first 10 tracks
        }
      }
    });

    if (!feed) {
      console.log('Feed not found');
      return;
    }

    console.log(`Feed: ${feed.title}`);
    console.log(`Checking first ${feed.Track.length} tracks:\n`);

    let totalRecipients = 0;
    const allRecipientNames = new Set();

    feed.Track.forEach((track, i) => {
      console.log(`${i+1}. "${track.title}"`);

      if (track.v4vValue) {
        const v4v = typeof track.v4vValue === 'string' ? JSON.parse(track.v4vValue) : track.v4vValue;
        const recipients = v4v.recipients || v4v.destinations || [];

        console.log(`   Recipients: ${recipients.length}`);

        recipients.forEach(r => allRecipientNames.add(r.name));
        totalRecipients += recipients.length;

        if (recipients.length > 0) {
          console.log(`   First 3: ${recipients.slice(0, 3).map(r => `${r.name} (${r.split}%)`).join(', ')}`);
        }
      } else {
        console.log('   No v4vValue (will inherit from feed)');
      }
      console.log();
    });

    console.log('=== SUMMARY ===');
    console.log(`Total recipients across ${feed.Track.length} tracks: ${totalRecipients}`);
    console.log(`Unique recipient names: ${allRecipientNames.size}`);
    console.log(`\nIf all 81 tracks have similar patterns, estimated total: ${Math.round(totalRecipients / feed.Track.length * 81)}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
