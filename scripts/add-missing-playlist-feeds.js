const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function getPodcastIndexHeaders() {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1');
  hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
  const hashString = hash.digest('hex');

  return {
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hashString,
    'User-Agent': 'StableKraft/1.0'
  };
}

async function fetchFeedByGuid(feedGuid) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`;
  const response = await fetch(apiUrl, { headers: getPodcastIndexHeaders() });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  const data = await response.json();
  return data.feed || (data.feeds && data.feeds[0]);
}

async function fetchEpisodesByFeedId(feedId) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/episodes/byfeedid?id=${feedId}&max=1000`;
  const response = await fetch(apiUrl, { headers: getPodcastIndexHeaders() });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items || [];
}

(async () => {
  try {
    console.log('=== Adding Missing Playlist Feeds ===\n');

    const feedGuids = JSON.parse(fs.readFileSync('/tmp/feeds-to-add.json', 'utf8'));

    console.log(`Processing ${feedGuids.length} missing feeds...\n`);

    let addedFeeds = 0;
    let addedTracks = 0;
    let errors = 0;

    for (let i = 0; i < feedGuids.length; i++) {
      const feedGuid = feedGuids[i];
      console.log(`[${i+1}/${feedGuids.length}] Processing feed: ${feedGuid.slice(0, 20)}...`);

      try {
        // Check if already exists (might have been added by another process)
        const existing = await prisma.feed.findUnique({
          where: { id: feedGuid },
          select: { id: true, title: true }
        });

        if (existing) {
          console.log(`  ⚡ Feed already exists: ${existing.title}`);
          continue;
        }

        // Fetch feed metadata from PodcastIndex
        const feedData = await fetchFeedByGuid(feedGuid);

        if (!feedData) {
          console.log(`  ❌ Feed not found in PodcastIndex`);
          errors++;
          continue;
        }

        console.log(`  📡 Found: ${feedData.title}`);

        // Create feed in database
        await prisma.feed.create({
          data: {
            id: feedGuid,
            guid: feedGuid,
            title: feedData.title || 'Unknown Feed',
            description: feedData.description || null,
            originalUrl: feedData.url || '',
            artist: feedData.author || null,
            image: feedData.image || null,
            language: feedData.language || null,
            explicit: feedData.explicit === true,
            updatedAt: new Date(),
            type: 'album'
          }
        });

        addedFeeds++;
        console.log(`  ✅ Feed added to database`);

        // Fetch and add all episodes
        console.log(`  📥 Fetching episodes...`);
        const episodes = await fetchEpisodesByFeedId(feedData.id);
        console.log(`  Found ${episodes.length} episodes`);

        let episodeCount = 0;
        for (let j = 0; j < episodes.length; j++) {
          const episode = episodes[j];

          // Skip if no audio URL
          if (!episode.enclosureUrl) continue;

          try {
            await prisma.track.create({
              data: {
                id: episode.guid || `${feedGuid}-${j}`,
                guid: episode.guid || null,
                title: episode.title || 'Untitled',
                description: episode.description || null,
                audioUrl: episode.enclosureUrl,
                duration: episode.duration || null,
                image: episode.image || feedData.image || null,
                publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : null,
                feedId: feedGuid,
                trackOrder: j + 1,
                updatedAt: new Date(),
                createdAt: new Date()
              }
            });
            episodeCount++;
          } catch (trackError) {
            // Skip duplicate tracks
            if (trackError.code !== 'P2002') {
              console.log(`  ⚠️  Failed to add track: ${episode.title}`);
            }
          }
        }

        addedTracks += episodeCount;
        console.log(`  ✅ Added ${episodeCount} tracks\n`);

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`  ❌ Error: ${error.message}\n`);
        errors++;
      }
    }

    console.log('=== SUMMARY ===');
    console.log(`Feeds added: ${addedFeeds}`);
    console.log(`Tracks added: ${addedTracks}`);
    console.log(`Errors: ${errors}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
