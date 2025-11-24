/**
 * Script to re-parse all feeds and update track v4v data using Podcast Index API
 *
 * This script:
 * 1. Finds all active feeds with RSS URLs
 * 2. Fetches feed metadata and episodes from Podcast Index API
 * 3. Updates track v4v data with structured JSON data (no XML parsing!)
 * 4. Avoids rate limiting by using Podcast Index API instead of direct feed fetches
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// Load environment variables from .env.local
function loadEnvFile() {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0 && !process.env[key.trim()]) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '').trim();
            process.env[key.trim()] = value;
          }
        }
      });
      console.log('📁 Loaded environment variables from .env.local');
    }
  } catch (error) {
    console.warn('Failed to load .env.local file:', error);
  }
}

loadEnvFile();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || '';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || '';
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
  throw new Error('PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET must be set');
}

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  originalUrl: string;
  description: string;
  author: string;
  image: string;
  artwork: string;
  language: string;
  explicit: boolean;
  medium: string;
  episodeCount: number;
  value?: any;
}

interface PodcastIndexEpisode {
  id: number;
  title: string;
  description: string;
  guid: string;
  datePublished: number;
  enclosureUrl: string;
  enclosureType: string;
  enclosureLength: number;
  duration: number;
  explicit: number;
  image: string;
  feedId: number;
  feedTitle: string;
  value?: any;
}

function getPodcastIndexHeaders(): { [key: string]: string } {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash('sha1')
    .update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime)
    .digest('hex');

  return {
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash,
    'User-Agent': 'StableKraft/1.0'
  };
}

async function getFeedFromPodcastIndex(feedUrl: string): Promise<PodcastIndexFeed | null> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`,
      {
        headers,
        signal: AbortSignal.timeout(15000) // 15 second timeout
      }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.status === 'true' && data.feed ? data.feed : null;
  } catch (error) {
    console.error(`Error fetching feed from Podcast Index:`, error);
    return null;
  }
}

async function getEpisodesFromPodcastIndex(feedId: number): Promise<PodcastIndexEpisode[]> {
  try {
    const headers = getPodcastIndexHeaders();
    const response = await fetch(
      `${PODCAST_INDEX_BASE_URL}/episodes/byfeedid?id=${feedId}`,
      {
        headers,
        signal: AbortSignal.timeout(15000) // 15 second timeout
      }
    );

    if (!response.ok) return [];
    const data = await response.json();
    return data.items || [];
  } catch (error) {
    console.error(`Error fetching episodes from Podcast Index:`, error);
    return [];
  }
}

function extractV4VFromPodcastIndex(value: any): { recipient: string | null; v4vValue: any } {
  if (!value || !value.destinations || !Array.isArray(value.destinations)) {
    return { recipient: null, v4vValue: null };
  }

  // Filter out fee recipients
  const nonFeeRecipients = value.destinations.filter((d: any) => !d.fee);

  if (nonFeeRecipients.length === 0) {
    return { recipient: null, v4vValue: null };
  }

  // Use the first non-fee recipient as primary
  const primaryRecipient = nonFeeRecipients[0];

  // Format v4v data to match our database schema
  const v4vValue = {
    type: value.type || 'lightning',
    method: value.method || 'keysend',
    suggested: value.suggested,
    recipients: nonFeeRecipients.map((d: any) => ({
      name: d.name,
      type: d.type || 'node',
      address: d.address,
      split: d.split,
      customKey: d.customKey,
      customValue: d.customValue,
      fee: d.fee || false
    }))
  };

  return {
    recipient: primaryRecipient.address,
    v4vValue
  };
}

async function main() {
  console.log('🔄 Starting full feed v4v refresh using Podcast Index API...\n');

  try {
    // Find all active feeds with RSS URLs
    const feeds = await prisma.feed.findMany({
      where: {
        status: 'active'
      },
      include: {
        Track: true
      }
    });

    console.log(`📊 Found ${feeds.length} active feeds to refresh\n`);

    let feedsProcessed = 0;
    let feedsWithErrors = 0;
    let feedsNotInPodcastIndex = 0;
    let tracksUpdated = 0;
    let tracksWithItemLevelData = 0;

    for (const feed of feeds) {
      if (!feed.originalUrl) {
        console.log(`⏭️ Skipping feed "${feed.title}" (no originalUrl)`);
        continue;
      }

      try {
        console.log(`\n📦 Processing feed: "${feed.title}" (${feed.Track.length} tracks)`);
        console.log(`   URL: ${feed.originalUrl}`);

        // Get feed metadata from Podcast Index
        const podcastIndexFeed = await getFeedFromPodcastIndex(feed.originalUrl);

        if (!podcastIndexFeed) {
          console.log(`   ⚠️  Not found in Podcast Index`);
          feedsNotInPodcastIndex++;
          continue;
        }

        console.log(`   ✅ Found in Podcast Index (${podcastIndexFeed.episodeCount} episodes)`);

        // Small delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get episodes from Podcast Index
        const episodes = await getEpisodesFromPodcastIndex(podcastIndexFeed.id);

        if (episodes.length === 0) {
          console.log(`   ⚠️  No episodes found`);
          feedsWithErrors++;
          continue;
        }

        // Update feed-level v4v data
        if (podcastIndexFeed.value) {
          const feedV4V = extractV4VFromPodcastIndex(podcastIndexFeed.value);

          if (feedV4V.v4vValue) {
            await prisma.feed.update({
              where: { id: feed.id },
              data: {
                v4vValue: feedV4V.v4vValue,
                v4vRecipient: feedV4V.recipient
              }
            });
            console.log(`✅ Updated feed-level v4v data`);
          }
        }

        // Update each track's v4v data
        for (const track of feed.Track) {
          // Find matching episode in Podcast Index data
          const episode = episodes.find(ep =>
            ep.title === track.title || ep.guid === track.guid
          );

          if (!episode) {
            console.log(`⏭️ Skipping track "${track.title}" (not found in episodes)`);
            continue;
          }

          // Extract v4v data from episode
          if (episode.value) {
            const itemV4V = extractV4VFromPodcastIndex(episode.value);

            if (itemV4V.v4vValue) {
              // Update track with item-level v4v data
              await prisma.track.update({
                where: { id: track.id },
                data: {
                  v4vValue: itemV4V.v4vValue,
                  v4vRecipient: itemV4V.recipient
                }
              });

              console.log(`✅ Updated "${track.title}" with item-level v4v (${itemV4V.v4vValue.recipients.length} recipients)`);
              tracksUpdated++;
              tracksWithItemLevelData++;
            } else {
              // Clear track v4v data (will fall back to channel-level)
              await prisma.track.update({
                where: { id: track.id },
                data: {
                  v4vValue: null,
                  v4vRecipient: null
                }
              });

              console.log(`🧹 Cleared "${track.title}" (no item-level v4v, will use feed-level)`);
              tracksUpdated++;
            }
          } else {
            // No v4v data at item level, clear it
            await prisma.track.update({
              where: { id: track.id },
              data: {
                v4vValue: null,
                v4vRecipient: null
              }
            });

            console.log(`🧹 Cleared "${track.title}" (no item-level v4v, will use feed-level)`);
            tracksUpdated++;
          }
        }

        feedsProcessed++;
        console.log(`✅ Completed feed "${feed.title}"`);

        // Small delay between feeds
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing feed "${feed.title}":`, error);
        feedsWithErrors++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Refresh Summary:');
    console.log('='.repeat(60));
    console.log(`Feeds processed: ${feedsProcessed}/${feeds.length}`);
    console.log(`Feeds not in Podcast Index: ${feedsNotInPodcastIndex}`);
    console.log(`Feeds with errors: ${feedsWithErrors}`);
    console.log(`Tracks updated: ${tracksUpdated}`);
    console.log(`Tracks with item-level v4v: ${tracksWithItemLevelData}`);
    console.log('='.repeat(60));
    console.log('\n✅ Refresh complete!');

  } catch (error) {
    console.error('❌ Error during refresh:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
