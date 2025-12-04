#!/usr/bin/env node
/**
 * Directly parse feeds that have no tracks via RSS (bypass Podcast Index API)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function parseFeedXML(feedUrl) {
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'StableKraft-Direct-Parser/1.0' }
    });

    if (!response.ok) {
      return { success: false, reason: `HTTP ${response.status}` };
    }

    const xmlText = await response.text();
    const episodes = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemContent = match[1];

      const titleMatch = itemContent.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const audioMatch = itemContent.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="audio[^"]*"/);
      const pubDateMatch = itemContent.match(/<pubDate>([^<]*)<\/pubDate>/);

      if (audioMatch && audioMatch[1]) {
        episodes.push({
          title: titleMatch ? (titleMatch[1] || titleMatch[2]) : 'Unknown',
          guid: guidMatch ? guidMatch[1] : null,
          audioUrl: audioMatch[1],
          pubDate: pubDateMatch ? pubDateMatch[1] : null
        });
      }
    }

    return { success: true, episodes };
  } catch (e) {
    return { success: false, reason: e.message };
  }
}

async function importTracksForFeed(feed, episodes, debug = false) {
  let imported = 0;

  for (const ep of episodes) {
    if (!ep.audioUrl) {
      if (debug) console.log(`    Skip: no audioUrl for "${ep.title}"`);
      continue;
    }
    if (!ep.guid) {
      if (debug) console.log(`    Skip: no guid for "${ep.title}"`);
      continue;
    }

    try {
      await prisma.track.upsert({
        where: { id: ep.guid },
        update: {
          title: ep.title,
          audioUrl: ep.audioUrl,
          updatedAt: new Date()
        },
        create: {
          id: ep.guid,
          title: ep.title,
          audioUrl: ep.audioUrl,
          feedId: feed.id,
          description: '',
          image: feed.image || null,
          duration: null,
          publishedAt: ep.pubDate ? new Date(ep.pubDate) : null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      imported++;
    } catch (e) {
      if (debug) console.log(`    Error: ${e.message.substring(0, 200)}`);
    }
  }

  return imported;
}

(async () => {
  console.log('=== Direct RSS Feed Parser ===\n');

  // Get feeds without tracks that should have content
  const feedsNoTracks = await prisma.feed.findMany({
    where: {
      Track: { none: {} },
      originalUrl: { not: '' }
    },
    take: 500
  });

  console.log(`Found ${feedsNoTracks.length} feeds without tracks\n`);

  let totalParsed = 0;
  let totalTracks = 0;
  let skipped = 0;
  let failed = 0;

  for (const feed of feedsNoTracks) {
    if (!feed.originalUrl) continue;

    // Skip publisher/artist feeds
    if (feed.originalUrl.includes('/artist/')) {
      skipped++;
      continue;
    }
    // Skip guid-only URLs
    if (feed.originalUrl.startsWith('guid:')) {
      skipped++;
      continue;
    }

    const result = await parseFeedXML(feed.originalUrl);

    if (result.success && result.episodes && result.episodes.length > 0) {
      // Debug: show first episode details if import fails
      const imported = await importTracksForFeed(feed, result.episodes, totalParsed < 2);
      if (imported > 0) {
        console.log(`✅ ${feed.title}: ${imported} tracks imported`);
        totalParsed++;
        totalTracks += imported;
      } else {
        console.log(`⚠️ ${feed.title}: ${result.episodes.length} episodes but 0 imported`);
        // Show first episode details
        const ep = result.episodes[0];
        console.log(`    Episode: "${ep.title}" guid=${ep.guid ? 'yes' : 'NO'} audio=${ep.audioUrl ? 'yes' : 'NO'}`);
      }
    } else if (result.success) {
      console.log(`❌ ${feed.title}: RSS OK but no episodes (${feed.originalUrl.substring(0, 50)}...)`);
      failed++;
    } else {
      console.log(`❌ ${feed.title}: ${result.reason}`);
      failed++;
    }

    // Small delay
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\n=== Summary ===`);
  console.log(`Feeds parsed: ${totalParsed}`);
  console.log(`Tracks imported: ${totalTracks}`);
  console.log(`Skipped (artist/guid-only): ${skipped}`);
  console.log(`Failed: ${failed}`);

  await prisma.$disconnect();
})();
