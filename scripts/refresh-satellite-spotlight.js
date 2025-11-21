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

async function fetchEpisodesByFeedUrl(feedUrl) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/episodes/byfeedurl?url=${encodeURIComponent(feedUrl)}&max=1000`;

  const response = await fetch(apiUrl, {
    headers: getPodcastIndexHeaders()
  });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  const data = await response.json();
  return data.items;
}

(async () => {
  try {
    console.log('=== Refreshing The Satellite Spotlight Feed ===\n');

    // 1. Find the feed
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (!feed) {
      console.error('❌ Feed not found');
      return;
    }

    console.log(`Feed ID: ${feed.id}`);
    console.log(`Feed Title: ${feed.title}`);
    console.log(`Current tracks: ${feed._count.Track}\n`);

    // 2. Delete all existing tracks
    console.log('Deleting existing tracks...');
    const deleteResult = await prisma.track.deleteMany({
      where: { feedId: feed.id }
    });
    console.log(`✅ Deleted ${deleteResult.count} tracks\n`);

    // 3. Call the refresh API endpoint
    console.log('Calling refresh API...');
    const response = await fetch(`http://localhost:3001/api/feeds/${feed.id}/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Refresh API failed:', error);
      return;
    }

    const result = await response.json();
    console.log(`✅ Feed refreshed: ${result.newTracks} tracks added\n`);

    // 4. Get episodes from PodcastIndex to set trackOrder
    console.log('Fetching episode order from PodcastIndex...');
    const episodes = await fetchEpisodesByFeedUrl(feed.originalUrl);
    console.log(`Found ${episodes.length} episodes\n`);

    // 5. Get all tracks from database
    const dbTracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { id: true, guid: true, title: true, audioUrl: true, trackOrder: true }
    });

    console.log(`Database has ${dbTracks.length} tracks\n`);

    // 6. Create maps for matching
    const tracksByGuid = new Map();
    const tracksByEnclosureUrl = new Map();

    dbTracks.forEach(track => {
      if (track.guid) {
        tracksByGuid.set(track.guid, track);
      }
      if (track.audioUrl) {
        tracksByEnclosureUrl.set(track.audioUrl.toLowerCase(), track);
      }
    });

    // 7. Set trackOrder
    console.log('Setting trackOrder...');
    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      const order = i + 1;

      // Try to find matching track
      let dbTrack = null;

      if (episode.guid) {
        dbTrack = tracksByGuid.get(episode.guid);
      }

      if (!dbTrack && episode.enclosureUrl) {
        dbTrack = tracksByEnclosureUrl.get(episode.enclosureUrl.toLowerCase());
      }

      if (dbTrack) {
        await prisma.track.update({
          where: { id: dbTrack.id },
          data: { trackOrder: order }
        });
        updated++;
      } else {
        notFound++;
      }
    }

    console.log(`✅ Track order set: ${updated} updated, ${notFound} not found\n`);

    // 8. Verify results
    const finalCount = await prisma.track.count({
      where: { feedId: feed.id }
    });

    const withOrder = await prisma.track.count({
      where: {
        feedId: feed.id,
        trackOrder: { not: null }
      }
    });

    console.log('=== FINAL RESULTS ===');
    console.log(`Total tracks: ${finalCount}`);
    console.log(`Tracks with trackOrder: ${withOrder}`);
    console.log(`Tracks with NULL trackOrder: ${finalCount - withOrder}`);

    // Check one track's v4vValue
    const sampleTrack = await prisma.track.findFirst({
      where: {
        feedId: feed.id,
        title: { contains: 'Sprouting Symphonies' }
      },
      select: {
        title: true,
        v4vValue: true
      }
    });

    if (sampleTrack && sampleTrack.v4vValue) {
      const v4v = typeof sampleTrack.v4vValue === 'string'
        ? JSON.parse(sampleTrack.v4vValue)
        : sampleTrack.v4vValue;
      const recipients = v4v.recipients || v4v.destinations || [];
      console.log(`\nSample track "${sampleTrack.title}": ${recipients.length} recipients`);
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
})();
