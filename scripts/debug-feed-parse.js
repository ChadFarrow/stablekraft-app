#!/usr/bin/env node
/**
 * Debug why specific feeds aren't parsing
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

const API_KEY = process.env.PODCAST_INDEX_API_KEY;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
  const authTime = Math.floor(Date.now() / 1000);
  const authString = API_KEY + API_SECRET + authTime;
  const authHeader = crypto.createHash('sha1').update(authString).digest('hex');
  return {
    'X-Auth-Key': API_KEY,
    'X-Auth-Date': authTime.toString(),
    'Authorization': authHeader,
    'User-Agent': 'StableKraft-Debug/1.0'
  };
}

async function debugFeed(feedId) {
  console.log(`\n=== Debugging Feed: ${feedId} ===\n`);

  // Get feed from database
  const feed = await prisma.feed.findUnique({
    where: { id: feedId },
    include: { Track: { take: 5 } }
  });

  if (!feed) {
    console.log('Feed not found in database');
    return;
  }

  console.log('Database feed:');
  console.log('  Title:', feed.title);
  console.log('  URL:', feed.originalUrl);
  console.log('  Tracks:', feed.Track.length);

  // Try to look up in Podcast Index by GUID
  console.log('\n--- Podcast Index Lookup ---');
  const headers = generateAuthHeaders();

  try {
    const guidResponse = await fetch(`${API_BASE}/podcasts/byguid?guid=${feedId}`, { headers });
    const guidData = await guidResponse.json();

    if (guidData.status === 'true' && guidData.feed) {
      console.log('Found in Podcast Index:');
      console.log('  PI ID:', guidData.feed.id);
      console.log('  Title:', guidData.feed.title);
      console.log('  URL:', guidData.feed.url);

      // Get episodes
      const episodesResponse = await fetch(`${API_BASE}/episodes/byfeedid?id=${guidData.feed.id}&max=10`, { headers });
      const episodesData = await episodesResponse.json();

      if (episodesData.items && episodesData.items.length > 0) {
        console.log('  Episodes:', episodesData.items.length);
        console.log('  Sample episodes:');
        episodesData.items.slice(0, 3).forEach(ep => {
          console.log('    -', ep.title, '| Audio:', ep.enclosureUrl ? 'Yes' : 'No');
        });
      } else {
        console.log('  NO EPISODES FOUND in Podcast Index API');
      }
    } else {
      console.log('NOT found in Podcast Index by GUID');
    }
  } catch (e) {
    console.log('Error looking up in Podcast Index:', e.message);
  }

  // Try direct RSS fetch
  if (feed.originalUrl) {
    console.log('\n--- Direct RSS Fetch ---');
    try {
      const rssResponse = await fetch(feed.originalUrl, {
        headers: { 'User-Agent': 'StableKraft-Debug/1.0' }
      });

      if (rssResponse.ok) {
        const xml = await rssResponse.text();
        console.log('RSS fetched successfully, length:', xml.length);

        // Count items
        const itemMatches = xml.match(/<item[^>]*>/g);
        console.log('Number of <item> tags:', itemMatches?.length || 0);

        // Check for enclosures
        const enclosures = xml.match(/<enclosure[^>]*url="[^"]*"[^>]*type="audio[^"]*"/g);
        console.log('Audio enclosures found:', enclosures?.length || 0);

        if (enclosures && enclosures.length > 0) {
          console.log('Sample enclosure:', enclosures[0].substring(0, 100));
        }
      } else {
        console.log('Failed to fetch RSS:', rssResponse.status, rssResponse.statusText);
      }
    } catch (e) {
      console.log('Error fetching RSS:', e.message);
    }
  }
}

(async () => {
  // Test with a few feeds that have no tracks
  const feedsNoTracks = await prisma.feed.findMany({
    where: {
      Track: { none: {} },
      originalUrl: {
        contains: 'wavlake.com/feed/',
        not: { contains: '/artist/' }
      }
    },
    take: 3
  });

  for (const feed of feedsNoTracks) {
    await debugFeed(feed.id);
  }

  await prisma.$disconnect();
})();
