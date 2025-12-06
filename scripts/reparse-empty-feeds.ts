#!/usr/bin/env npx tsx
import { prisma } from '../lib/prisma';
import { parseRSSFeedWithSegments } from '../lib/rss-parser-db';

async function main() {
  // Get feeds without tracks
  const feedsNoTracks = await prisma.feed.findMany({
    where: {
      Track: { none: {} }
    },
    select: { id: true, title: true, originalUrl: true, type: true }
  });

  // Filter out GUID-only feeds and publisher feeds
  const toParse = feedsNoTracks.filter(f =>
    f.originalUrl &&
    !f.originalUrl.startsWith('guid:') &&
    f.type !== 'publisher'
  );

  console.log('Feeds without tracks:', feedsNoTracks.length);
  console.log('Feeds to reparse (excluding publishers/GUIDs):', toParse.length);
  console.log('');

  let success = 0, failed = 0, noTracks = 0;

  for (let i = 0; i < toParse.length; i++) {
    const feed = toParse[i];
    try {
      const prefix = `[${i + 1}/${toParse.length}]`;
      process.stdout.write(`${prefix} ${feed.title?.substring(0, 40) || feed.id}... `);

      // Parse the RSS feed
      const parsedFeed = await parseRSSFeedWithSegments(feed.originalUrl!);

      if (!parsedFeed.items || parsedFeed.items.length === 0) {
        console.log('- 0 items in feed');
        noTracks++;
        continue;
      }

      // Create tracks from parsed items
      const tracksData = parsedFeed.items
        .filter(item => item.audioUrl) // Must have audio URL
        .map((item, index) => ({
          id: `${feed.id}-${item.guid || `track-${index}-${Date.now()}`}`,
          feedId: feed.id,
          guid: item.guid,
          title: item.title,
          subtitle: item.subtitle || null,
          description: item.description || null,
          artist: item.artist || parsedFeed.author || null,
          audioUrl: item.audioUrl!,
          duration: item.duration || null,
          explicit: item.explicit || false,
          image: item.image || parsedFeed.image || null,
          publishedAt: item.publishedAt || null,
          itunesAuthor: item.itunesAuthor || null,
          itunesSummary: item.itunesSummary || null,
          itunesImage: item.itunesImage || null,
          itunesDuration: item.itunesDuration || null,
          itunesKeywords: item.itunesKeywords || [],
          itunesCategories: item.itunesCategories || [],
          v4vRecipient: item.v4vRecipient || null,
          v4vValue: item.v4vValue || null,
          startTime: item.startTime || null,
          endTime: item.endTime || null,
          trackOrder: index + 1,
          updatedAt: new Date()
        }));

      if (tracksData.length === 0) {
        console.log('- 0 tracks with audio');
        noTracks++;
        continue;
      }

      // Insert tracks, skipping duplicates
      await prisma.track.createMany({
        data: tracksData,
        skipDuplicates: true
      });

      console.log(`✓ ${tracksData.length} tracks`);
      success++;
    } catch (e: any) {
      console.log(`✗ ${e.message?.substring(0, 60)}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== Summary ===');
  console.log('Successfully parsed with tracks:', success);
  console.log('Parsed but 0 tracks:', noTracks);
  console.log('Failed to parse:', failed);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
