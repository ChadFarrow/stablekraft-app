#!/usr/bin/env tsx

/**
 * Reparse Wavlake album feeds to extract publisher information
 */

// Load environment variables from .env.local (for PodcastIndex API keys)
import { config } from 'dotenv';
import { resolve } from 'path';

// Try to load .env.local first, then fall back to .env
config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

import { RSSParser } from '../lib/rss-parser';
import { prisma } from '../lib/prisma';

async function reparsePublisherFeeds() {
  console.log('🔄 Reparsing Wavlake Album Feeds for Publisher Information\n');
  console.log('═'.repeat(70));

  try {
    // Get all Wavlake album feeds
    const wavlakeFeeds = await prisma.feed.findMany({
      where: {
        originalUrl: {
          contains: 'wavlake.com/feed'
        },
        type: 'album',
        status: 'active'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`📊 Found ${wavlakeFeeds.length} Wavlake album feeds to reparse\n`);

    let successCount = 0;
    let errorCount = 0;
    let publisherFoundCount = 0;

    for (let i = 0; i < wavlakeFeeds.length; i++) {
      const feed = wavlakeFeeds[i];
      const progress = `[${i + 1}/${wavlakeFeeds.length}]`;

      console.log(`\n${progress} 🔍 Reparsing: ${feed.title || feed.id}`);
      console.log(`   Artist: ${feed.artist || 'Unknown'}`);
      console.log(`   URL: ${feed.originalUrl}`);

      try {
        // Reparse the feed with updated parser (includes publisher extraction)
        const album = await RSSParser.parseAlbumFeed(feed.originalUrl);

        if (!album) {
          console.log(`   ❌ Failed to parse album feed`);
          errorCount++;
          continue;
        }

        // Check if publisher information was extracted
        let publisherData = null;
        if (album.publisher) {
          publisherFoundCount++;
          publisherData = {
            feedGuid: album.publisher.feedGuid,
            feedUrl: album.publisher.feedUrl,
            medium: album.publisher.medium || 'publisher'
          };
          console.log(`   ✅ Publisher found: ${album.publisher.feedGuid}`);
          console.log(`      Publisher URL: ${album.publisher.feedUrl}`);
        } else {
          console.log(`   ⚠️  No publisher information found in feed`);
        }

        // Update feed metadata and store publisher info in v4vValue JSON field
        const updateData: any = {
          title: album.title,
          description: album.description || feed.description,
          artist: album.artist || feed.artist,
          image: album.coverArt || feed.image,
          lastFetched: new Date(),
          updatedAt: new Date(),
          language: album.language || feed.language,
          explicit: album.explicit || feed.explicit
        };

        // Store publisher info in v4vValue JSON field (repurposing for publisher data)
        if (publisherData) {
          updateData.v4vValue = {
            publisher: publisherData
          };
        }

        await prisma.feed.update({
          where: { id: feed.id },
          data: updateData
        });

        console.log(`   💾 Feed metadata updated`);
        successCount++;

        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        errorCount++;
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log('📊 Reparse Summary:');
    console.log(`   Total feeds: ${wavlakeFeeds.length}`);
    console.log(`   ✅ Successfully reparsed: ${successCount}`);
    console.log(`   ✅ Feeds with publisher info: ${publisherFoundCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('═'.repeat(70));

    console.log('\n✅ Reparse complete!');
    console.log(`\n💡 Note: Publisher information is now extracted from album feeds.`);
    console.log(`   The publisher data is available in the parsed album object.`);
    console.log(`   To use this data, you may need to update how publisher feeds are generated.`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the reparse
reparsePublisherFeeds();

