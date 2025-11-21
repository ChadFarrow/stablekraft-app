const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

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

async function fetchEpisodesByFeedId(feedId) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/episodes/byfeedid?id=${feedId}&max=1000`;

  const response = await fetch(apiUrl, {
    headers: getPodcastIndexHeaders()
  });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  return await response.json();
}

(async () => {
  try {
    // Get database tracks
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        Track: {
          select: {
            guid: true,
            title: true,
            trackOrder: true,
            audioUrl: true
          }
        }
      }
    });

    const dbGuids = new Set(feed.Track.map(t => t.guid));
    console.log(`Database tracks: ${feed.Track.length}`);

    // Get PodcastIndex episodes
    const episodesData = await fetchEpisodesByFeedId(7235124);
    console.log(`PodcastIndex episodes: ${episodesData.items.length}\n`);

    // Find missing tracks
    const missingTracks = episodesData.items.filter(ep => !dbGuids.has(ep.guid));

    console.log(`=== MISSING TRACKS (${missingTracks.length}) ===`);
    missingTracks.forEach((ep, i) => {
      const idx = episodesData.items.findIndex(e => e.guid === ep.guid) + 1;
      console.log(`${i + 1}. Position #${idx}: ${ep.title}`);
      console.log(`   GUID: ${ep.guid}`);
      console.log(`   Enclosure: ${ep.enclosureUrl ? ep.enclosureUrl.substring(0, 80) : 'none'}`);
      console.log(`   Type: ${ep.enclosureType || 'unknown'}`);
      console.log();
    });

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
