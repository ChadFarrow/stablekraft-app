import { PrismaClient } from '@prisma/client';
import { parseStringPromise } from 'xml2js';

const prisma = new PrismaClient();

interface ValueRecipient {
  $: {
    name?: string;
    type?: string;
    address?: string;
    split?: string;
    customKey?: string;
    customValue?: string;
    fee?: string;
  };
}

interface PodcastValue {
  $?: {
    type?: string;
    method?: string;
    suggested?: string;
  };
  'podcast:valueRecipient'?: ValueRecipient[];
}

async function parseV4VFromRSS(rssUrl: string, debug = false) {
  try {
    const response = await fetch(rssUrl);
    if (!response.ok) {
      if (debug) console.log(`   DEBUG: Response not OK: ${response.status}`);
      return null;
    }

    const rssText = await response.text();
    const parsedXml = await parseStringPromise(rssText);

    // Check for channel-level value
    const channel = parsedXml.rss?.channel?.[0];
    let channelValue: PodcastValue | null = null;

    if (channel?.['podcast:value']?.[0]) {
      channelValue = channel['podcast:value'][0];
    }

    if (debug) {
      console.log(`   DEBUG: channelValue exists:`, channelValue ? 'YES' : 'NO');
      console.log(`   DEBUG: has recipients:`, channelValue?.['podcast:valueRecipient'] ? 'YES' : 'NO');
    }

    // Return channel-level V4V data (will apply to all items in this feed)
    if (channelValue && channelValue['podcast:valueRecipient']) {
      return {
        type: channelValue.$?.type || 'lightning',
        method: channelValue.$?.method || 'keysend',
        suggested: channelValue.$?.suggested,
        recipients: channelValue['podcast:valueRecipient'].map((r: ValueRecipient) => ({
          name: r.$.name,
          type: r.$.type,
          address: r.$.address,
          split: parseInt(r.$.split || '0'),
          customKey: r.$.customKey,
          customValue: r.$.customValue,
          fee: r.$.fee === 'true'
        }))
      };
    }

    if (debug) console.log(`   DEBUG: Returning null (no V4V found)`);
    return null;
  } catch (error) {
    console.error(`   Error parsing RSS:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function main() {
  try {
    console.log('🔧 Backfilling V4V Data from Direct RSS Parsing\n');
    console.log('='.repeat(70));

    // Get tracks missing V4V data, grouped by feed
    const tracksWithoutV4V = await prisma.track.findMany({
      where: {
        v4vRecipient: null
      },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            originalUrl: true
          }
        }
      },
      orderBy: {
        feedId: 'asc'
      }
    });

    console.log(`\nFound ${tracksWithoutV4V.length} tracks without V4V data\n`);

    let updatedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    // Group tracks by feed
    const tracksByFeed = new Map<string, typeof tracksWithoutV4V>();
    tracksWithoutV4V.forEach(track => {
      if (!tracksByFeed.has(track.feedId)) {
        tracksByFeed.set(track.feedId, []);
      }
      tracksByFeed.get(track.feedId)!.push(track);
    });

    console.log(`Processing ${tracksByFeed.size} feeds...\n`);

    let feedIndex = 0;
    for (const [feedId, tracks] of tracksByFeed.entries()) {
      feedIndex++;
      const feed = tracks[0].Feed;
      const progress = `[${feedIndex}/${tracksByFeed.size}]`;

      console.log(`${progress} ${feed.title} (${tracks.length} tracks)`);

      if (!feed.originalUrl) {
        console.log(`   ⚠️ No RSS URL available`);
        skippedCount += tracks.length;
        continue;
      }

      try {
        // Parse RSS feed directly (enable debug for specific feeds)
        const enableDebug = feed.title === 'ABOUT 30' || feed.title === 'Cowboy Songs';
        const v4vData = await parseV4VFromRSS(feed.originalUrl, enableDebug);

        if (!v4vData) {
          console.log(`   ⚠️ No V4V data found in RSS (parseV4VFromRSS returned null)`);
          skippedCount += tracks.length;
          // Still rate limit even on failures to avoid hammering the server
          if (feed.originalUrl?.includes('wavlake.com')) {
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          continue;
        }

        if (!v4vData.recipients || v4vData.recipients.length === 0) {
          console.log(`   ⚠️ No V4V data found in RSS (no recipients)`);
          skippedCount += tracks.length;
          continue;
        }

        // Update all tracks in this feed with the V4V data
        const v4vRecipient = v4vData.recipients[0]?.address || null;

        for (const track of tracks) {
          await prisma.track.update({
            where: { id: track.id },
            data: {
              v4vValue: v4vData as any,
              v4vRecipient: v4vRecipient,
              updatedAt: new Date()
            }
          });
          updatedCount++;
        }

        console.log(`   ✅ Updated ${tracks.length} tracks`);

        // Rate limiting - aggressive delay for Wavlake to avoid 429 errors
        if (feed.originalUrl?.includes('wavlake.com')) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3s delay for Wavlake
        } else {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms for others
        }

      } catch (error) {
        console.error(`   ❌ Error:`, error instanceof Error ? error.message : error);
        failedCount += tracks.length;
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`\n📊 Results:`);
    console.log(`   ✅ Tracks updated: ${updatedCount}`);
    console.log(`   ⚠️ Tracks skipped: ${skippedCount}`);
    console.log(`   ❌ Tracks failed: ${failedCount}`);
    console.log(`   📦 Total processed: ${tracksWithoutV4V.length}`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
