import { PrismaClient, Prisma } from '@prisma/client';
import { parseV4VFromXML, parseItemV4VFromXML } from '../lib/rss-parser-db';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const prisma = new PrismaClient();

async function refreshAllV4VData() {
  try {
    console.log('🚀 Starting comprehensive V4V data refresh for all feeds...');

    // Get all feeds from the database
    const feeds = await prisma.feed.findMany({
      select: {
        id: true,
        originalUrl: true,
        title: true,
      },
    });

    console.log(`📊 Found ${feeds.length} feeds to process\n`);

    let updatedFeeds = 0;
    let updatedTracks = 0;
    let errors = 0;
    let skipped = 0;

    for (const feed of feeds) {
      try {
        console.log(`🔍 Processing feed: ${feed.title} (${feed.id})`);

        // Fetch the RSS feed
        const response = await fetch(feed.originalUrl);
        if (!response.ok) {
          console.log(`⚠️  Failed to fetch feed ${feed.id}: ${response.status}`);
          errors++;
          continue;
        }

        const xmlText = await response.text();
        console.log(`📄 Fetched XML for ${feed.id}, length: ${xmlText.length}`);

        // Parse V4V data from XML
        const feedV4V = parseV4VFromXML(xmlText);

        if (feedV4V.recipient || feedV4V.value) {
          console.log(`✅ Found V4V data for feed ${feed.id}`);

          // Get all tracks for this feed
          const tracks = await prisma.track.findMany({
            where: { feedId: feed.id },
            select: { id: true, title: true },
          });

          console.log(`🎵 Found ${tracks.length} tracks for feed ${feed.id}`);

          // Update each track with V4V data
          for (const track of tracks) {
            try {
              // Try to get item-specific V4V data
              const itemV4V = parseItemV4VFromXML(xmlText, track.title);
              const v4vRecipient = itemV4V.recipient || feedV4V.recipient;
              const v4vValue = itemV4V.value || feedV4V.value;

              await prisma.track.update({
                where: { id: track.id },
                data: {
                  v4vRecipient: v4vRecipient,
                  v4vValue: v4vValue ? JSON.stringify(v4vValue) : Prisma.JsonNull,
                },
              });

              updatedTracks++;
            } catch (trackError) {
              console.log(`⚠️  Error updating track ${track.id}: ${trackError}`);
              errors++;
            }
          }

          // Update feed-level V4V data
          if (feedV4V.value) {
            await prisma.feed.update({
              where: { id: feed.id },
              data: {
                v4vRecipient: feedV4V.recipient,
                v4vValue: JSON.stringify(feedV4V.value),
              },
            });
          } else if (feedV4V.recipient) {
            // Update recipient even if no value object
            await prisma.feed.update({
              where: { id: feed.id },
              data: {
                v4vRecipient: feedV4V.recipient,
              },
            });
          }

          updatedFeeds++;
          console.log(`✅ Updated feed ${feed.title}: ${tracks.length} tracks\n`);
        } else {
          console.log(`ℹ️  No V4V data found for feed ${feed.id}\n`);
          skipped++;
        }
      } catch (feedError) {
        console.log(`❌ Error processing feed ${feed.id}: ${feedError}\n`);
        errors++;
      }
    }

    console.log('\n✅ Comprehensive V4V refresh completed!');
    console.log(`📊 Results:`);
    console.log(`   • ${updatedFeeds} feeds updated`);
    console.log(`   • ${updatedTracks} tracks updated`);
    console.log(`   • ${skipped} feeds skipped (no V4V data)`);
    console.log(`   • ${errors} errors`);

  } catch (error: any) {
    console.error('❌ Comprehensive V4V refresh failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
refreshAllV4VData()
  .then(() => {
    console.log('\n🎉 Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });

