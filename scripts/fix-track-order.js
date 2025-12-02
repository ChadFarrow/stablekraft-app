#!/usr/bin/env node
/**
 * Fix Track Order Script
 *
 * This script re-parses Wavlake feeds and updates trackOrder based on
 * the podcast:episode tag instead of RSS feed position.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function extractEpisodeNumbers(feedUrl) {
  try {
    const response = await fetch(feedUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'StableKraft-Feed-Parser/1.0' }
    });
    const xml = await response.text();

    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    const episodes = [];
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];

      // Extract GUID
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const guid = guidMatch ? guidMatch[1].trim() : null;

      // Extract title for logging
      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const title = titleMatch ? (titleMatch[1] || titleMatch[2] || '').trim() : '';

      // Extract episode number
      const episodeMatch = itemContent.match(/<podcast:episode>(\d+)<\/podcast:episode>|<itunes:episode>(\d+)<\/itunes:episode>/);
      const episode = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;

      if (guid) {
        episodes.push({ guid, title, episode });
      }
    }

    return episodes;
  } catch (e) {
    return null;
  }
}

async function fixFeedTrackOrder(feed) {
  if (!feed.originalUrl) return { skipped: true, reason: 'no URL' };

  // Get episode numbers from RSS
  const rssEpisodes = await extractEpisodeNumbers(feed.originalUrl);
  if (!rssEpisodes || rssEpisodes.length === 0) {
    return { skipped: true, reason: 'fetch failed' };
  }

  // Create a map of guid -> episode number
  const episodeMap = new Map();
  rssEpisodes.forEach(ep => {
    if (ep.guid && ep.episode !== null) {
      episodeMap.set(ep.guid, ep.episode);
    }
  });

  if (episodeMap.size === 0) {
    return { skipped: true, reason: 'no episode tags' };
  }

  // Update tracks in database
  let updated = 0;
  for (const track of feed.Track) {
    const newOrder = episodeMap.get(track.guid);
    if (newOrder !== null && newOrder !== undefined && newOrder !== track.trackOrder) {
      await prisma.track.update({
        where: { id: track.id },
        data: { trackOrder: newOrder }
      });
      updated++;
    }
  }

  return { updated, total: feed.Track.length };
}

async function main() {
  console.log('=== Track Order Fix Script ===\n');

  // Get all Wavlake feeds with tracks
  const feeds = await prisma.feed.findMany({
    where: {
      originalUrl: { contains: 'wavlake.com/feed' }
    },
    include: {
      Track: {
        select: { id: true, guid: true, title: true, trackOrder: true }
      }
    }
  });

  // Filter to albums with 3+ tracks
  const albumFeeds = feeds.filter(f => f.Track.length >= 3);

  console.log(`Found ${albumFeeds.length} Wavlake albums to check\n`);

  let processed = 0;
  let fixed = 0;
  let tracksUpdated = 0;
  let errors = 0;

  for (const feed of albumFeeds) {
    processed++;
    process.stdout.write(`\rProcessing: ${processed}/${albumFeeds.length} - ${feed.title.substring(0, 40)}...`);

    try {
      const result = await fixFeedTrackOrder(feed);

      if (result.updated > 0) {
        fixed++;
        tracksUpdated += result.updated;
        console.log(`\n  ✅ Fixed "${feed.title}" - ${result.updated}/${result.total} tracks reordered`);
      }
    } catch (e) {
      errors++;
      console.log(`\n  ❌ Error with "${feed.title}": ${e.message}`);
    }

    // Small delay to avoid overwhelming the server
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Albums processed: ${processed}`);
  console.log(`Albums fixed: ${fixed}`);
  console.log(`Tracks reordered: ${tracksUpdated}`);
  console.log(`Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
