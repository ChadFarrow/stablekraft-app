const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  // Check the feeds we just touched
  const feedsToCheck = [
    'cmfznsepc032pgsidfz10ajbz', // The Leaves, Shimmering Gold
    'insomniak-i-can-t-sleep-ep-', // I Can't Sleep! (EP)
    'the-satellite-skirmish-polar-embrace', // Polar Embrace
    'bryan-duncan-bryan-s-christmas', // Bryan's Christmas
    'ed-doerfel-kurtisdrums-v1', // Kurtisdrums
    '47a27ba4-5351-5896-9bb1-10e606937070' // Once Upon A Time (this one added 1 track)
  ];

  console.log('=== Checking Feeds for Completeness ===\n');

  let totalAdded = 0;

  for (const feedId of feedsToCheck) {
    const feed = await prisma.feed.findUnique({
      where: { id: feedId },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        _count: { select: { Track: true } }
      }
    });

    if (!feed) {
      console.log(`⚠️  Feed ${feedId} not found\n`);
      continue;
    }

    console.log(`📦 ${feed.title}`);
    console.log(`   Database tracks: ${feed._count.Track}`);

    // Call refresh API to ensure all tracks are present
    try {
      const refreshResponse = await fetch(`http://localhost:3001/api/feeds/${feedId}/refresh`, {
        method: 'POST'
      });

      if (refreshResponse.ok) {
        const result = await refreshResponse.json();
        if (result.newTracks && result.newTracks > 0) {
          console.log(`   ✅ Added ${result.newTracks} more tracks from this feed!`);
          totalAdded += result.newTracks;
        } else {
          console.log(`   ✓ All tracks already in database`);
        }
      } else {
        console.log(`   ⚠️  Refresh failed: ${refreshResponse.status}`);
      }
    } catch (err) {
      console.log(`   ❌ Error: ${err.message}`);
    }

    console.log();
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('=== SUMMARY ===');
  console.log(`Total new tracks added: ${totalAdded}`);

  await prisma.$disconnect();
})();
