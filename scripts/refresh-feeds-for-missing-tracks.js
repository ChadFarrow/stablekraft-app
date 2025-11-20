const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

function getPodcastIndexHeaders() {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1');
  hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
  return {
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hash.digest('hex'),
    'User-Agent': 'StableKraft/1.0'
  };
}

async function fetchFeedByGuid(feedGuid) {
  const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
    headers: getPodcastIndexHeaders()
  });
  const data = await response.json();
  return data.feed || (data.feeds && data.feeds[0]);
}

(async () => {
  try {
    console.log('=== Refreshing Feeds for Missing Tracks ===\n');

    const unresolvedTracks = JSON.parse(fs.readFileSync('/tmp/unresolved-tracks.json', 'utf8'));

    // Get unique feed GUIDs
    const feedGuids = [...new Set(unresolvedTracks.map(t => t.feedGuid))];
    console.log(`Processing ${feedGuids.length} unique feeds...\n`);

    let refreshed = 0;
    let errors = 0;
    let addedTracks = 0;

    for (let i = 0; i < feedGuids.length; i++) {
      const feedGuid = feedGuids[i];
      console.log(`[${i+1}/${feedGuids.length}] Checking feed GUID: ${feedGuid.slice(0, 30)}...`);

      try {
        // Get feed data from PodcastIndex
        const piData = await fetchFeedByGuid(feedGuid);

        if (!piData || !piData.url) {
          console.log(`  ⚠️  Feed not found in PodcastIndex\n`);
          errors++;
          continue;
        }

        console.log(`  📡 Found: ${piData.title}`);

        // Check if feed exists in database by URL
        const dbFeed = await prisma.feed.findUnique({
          where: { originalUrl: piData.url },
          select: { id: true, title: true }
        });

        if (!dbFeed) {
          console.log(`  ⚠️  Feed not in database - calling refresh API...\n`);

          // Call the refresh API to add it
          const refreshResponse = await fetch(`http://localhost:3001/api/feeds/${feedGuid}/refresh`, {
            method: 'POST'
          });

          if (refreshResponse.ok) {
            const result = await refreshResponse.json();
            console.log(`  ✅ Added via API: ${result.newTracks || 0} tracks\n`);
            refreshed++;
            addedTracks += result.newTracks || 0;
          } else {
            console.log(`  ❌ API refresh failed\n`);
            errors++;
          }

        } else {
          console.log(`  📦 Exists in DB as: ${dbFeed.title} (${dbFeed.id})`);

          // Call refresh to ensure all tracks are added
          console.log(`  🔄 Refreshing to ensure all tracks exist...`);
          const refreshResponse = await fetch(`http://localhost:3001/api/feeds/${dbFeed.id}/refresh`, {
            method: 'POST'
          });

          if (refreshResponse.ok) {
            const result = await refreshResponse.json();
            const newTracks = result.newTracks || 0;
            console.log(`  ✅ Refreshed: ${newTracks} new tracks added\n`);
            refreshed++;
            addedTracks += newTracks;
          } else {
            console.log(`  ❌ Refresh failed\n`);
            errors++;
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`  ❌ Error: ${error.message}\n`);
        errors++;
      }
    }

    console.log('=== SUMMARY ===');
    console.log(`Feeds refreshed: ${refreshed}`);
    console.log(`Tracks added: ${addedTracks}`);
    console.log(`Errors: ${errors}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
