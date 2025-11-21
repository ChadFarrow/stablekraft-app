const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

// PodcastIndex API credentials
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

// Delay helper
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Generate PodcastIndex auth headers
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

  if (!data.items || !data.items.length) {
    throw new Error('No items found in PodcastIndex response');
  }

  return data.items;
}

async function fixFeedTrackOrderViaPodcastIndex(feed, index, total) {
  const prefix = `[${index}/${total}]`;

  try {
    console.log(`\n${prefix} Processing: ${feed.title}`);
    console.log(`${prefix} URL: ${feed.originalUrl}`);

    // Fetch episodes from PodcastIndex API
    const episodes = await fetchEpisodesByFeedUrl(feed.originalUrl);
    console.log(`${prefix} Found ${episodes.length} items from PodcastIndex API`);

    // Get existing tracks from database
    const dbTracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      select: { id: true, guid: true, title: true, audioUrl: true, trackOrder: true }
    });

    console.log(`${prefix} Database has ${dbTracks.length} tracks`);

    // Create maps for matching
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

    // Update trackOrder for each episode
    let updated = 0;
    let notFound = 0;
    let alreadySet = 0;

    for (let i = 0; i < episodes.length; i++) {
      const episode = episodes[i];
      const order = i + 1;

      // Try to find matching track
      let dbTrack = null;

      // Try GUID first
      if (episode.guid) {
        dbTrack = tracksByGuid.get(episode.guid);
      }

      // Try enclosure URL
      if (!dbTrack && episode.enclosureUrl) {
        dbTrack = tracksByEnclosureUrl.get(episode.enclosureUrl.toLowerCase());
      }

      if (dbTrack) {
        // Only update if trackOrder is null
        if (dbTrack.trackOrder === null) {
          await prisma.track.update({
            where: { id: dbTrack.id },
            data: { trackOrder: order }
          });
          updated++;
        } else {
          alreadySet++;
        }
      } else {
        notFound++;
      }
    }

    const summary = `✅ Updated: ${updated}, Already set: ${alreadySet}, Not found: ${notFound}`;
    console.log(`${prefix} ${summary}`);

    return {
      success: true,
      updated,
      alreadySet,
      notFound
    };

  } catch (error) {
    console.error(`${prefix} ❌ Error: ${error.message}`);
    return { success: false, reason: error.message, updated: 0 };
  }
}

async function main() {
  try {
    console.log('=== Retrying Failed Feeds via PodcastIndex API ===\n');

    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      console.error('❌ PodcastIndex API credentials not found in environment!');
      console.error('Please set PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET');
      return;
    }

    console.log('✅ PodcastIndex API credentials loaded\n');

    // Get feeds with null trackOrder that we haven't processed yet
    // These are likely the ones that failed with 429 errors
    const feeds = await prisma.feed.findMany({
      where: {
        Track: {
          some: {
            trackOrder: null
          }
        },
        type: { notIn: ['podcast', 'test'] },
        // Focus on Wavlake feeds (most likely to have failed)
        originalUrl: { contains: 'wavlake.com' }
      },
      select: {
        id: true,
        title: true,
        originalUrl: true
      },
      orderBy: {
        title: 'asc'
      }
    });

    console.log(`Found ${feeds.length} Wavlake feeds with NULL trackOrder to retry\n`);

    const stats = {
      total: feeds.length,
      success: 0,
      failed: 0,
      totalTracksUpdated: 0,
      totalTracksAlreadySet: 0,
      totalTracksNotFound: 0
    };

    const errors = [];

    // Process each feed
    for (let i = 0; i < feeds.length; i++) {
      const feed = feeds[i];
      const result = await fixFeedTrackOrderViaPodcastIndex(feed, i + 1, feeds.length);

      if (result.success) {
        stats.success++;
        stats.totalTracksUpdated += result.updated;
        stats.totalTracksAlreadySet += result.alreadySet || 0;
        stats.totalTracksNotFound += result.notFound || 0;
      } else {
        stats.failed++;
        errors.push({
          feed: feed.title,
          url: feed.originalUrl,
          reason: result.reason
        });
      }

      // Delay to respect API rate limits
      await delay(200);

      // Progress update every 25 feeds
      if ((i + 1) % 25 === 0) {
        console.log(`\n📊 Progress: ${i + 1}/${feeds.length} feeds processed`);
        console.log(`   Success: ${stats.success}, Failed: ${stats.failed}`);
        console.log(`   Tracks updated: ${stats.totalTracksUpdated}\n`);
      }
    }

    // Final summary
    console.log('\n=== FINAL SUMMARY ===');
    console.log(`Total feeds processed: ${stats.total}`);
    console.log(`Successful: ${stats.success} (${(stats.success/stats.total*100).toFixed(1)}%)`);
    console.log(`Failed: ${stats.failed} (${(stats.failed/stats.total*100).toFixed(1)}%)`);
    console.log(`\nTracks updated: ${stats.totalTracksUpdated}`);
    console.log(`Tracks already set: ${stats.totalTracksAlreadySet}`);
    console.log(`Tracks not found: ${stats.totalTracksNotFound}`);

    if (errors.length > 0) {
      console.log(`\n=== ERRORS (${errors.length}) ===`);
      errors.slice(0, 20).forEach((err, i) => {
        console.log(`${i + 1}. ${err.feed}`);
        console.log(`   Reason: ${err.reason}`);
      });
      if (errors.length > 20) {
        console.log(`... and ${errors.length - 20} more errors`);
      }
    }

    console.log('\n✅ Done!');

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
