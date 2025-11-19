/**
 * Populate GUIDs for all feeds and tracks using Podcast Index API
 * Much faster than fetching RSS feeds directly - avoids rate limits
 */

import { prisma } from '../lib/prisma';
import crypto from 'crypto';

interface PodcastIndexFeed {
  id: number;
  title: string;
  url: string;
  originalUrl: string;
  podcastGuid?: string; // podcast:guid field
  // ... other fields
}

interface PodcastIndexEpisode {
  id: number;
  title: string;
  guid: string;
  // ... other fields
}

class PodcastIndexAPI {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.podcastindex.org/api/1.0';

  constructor() {
    this.apiKey = process.env.PODCAST_INDEX_API_KEY || '';
    this.apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Podcast Index API credentials not found in environment variables');
    }
  }

  private getAuthHeaders(): { [key: string]: string } {
    const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
    const hash = crypto
      .createHash('sha1')
      .update(this.apiKey + this.apiSecret + apiHeaderTime)
      .digest('hex');

    return {
      'X-Auth-Date': apiHeaderTime,
      'X-Auth-Key': this.apiKey,
      'Authorization': hash,
      'User-Agent': 'StableKraft/1.0'
    };
  }

  async getFeedByGuid(guid: string): Promise<PodcastIndexFeed | null> {
    try {
      const url = `${this.baseUrl}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (data.status === 'true' && data.feed) {
        return data.feed as PodcastIndexFeed;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getFeedByUrl(feedUrl: string): Promise<PodcastIndexFeed | null> {
    try {
      const url = `${this.baseUrl}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null; // Feed not found in index
        }
        console.error(`   ⚠️  API error (${response.status})`);
        return null;
      }

      const data = await response.json();

      if (data.status === 'true' && data.feed) {
        return data.feed as PodcastIndexFeed;
      }

      return null;
    } catch (error) {
      console.error(`   ❌ Error:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  async getEpisodesByFeedId(feedId: number): Promise<PodcastIndexEpisode[]> {
    try {
      const url = `${this.baseUrl}/episodes/byfeedid?id=${feedId}&max=1000`;
      const response = await fetch(url, {
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();

      if (data.status === 'true' && data.items) {
        return data.items as PodcastIndexEpisode[];
      }

      return [];
    } catch (error) {
      return [];
    }
  }
}

async function populateAllGuids() {
  console.log('🔍 Starting GUID population using Podcast Index API...\n');

  const api = new PodcastIndexAPI();

  // Get all feeds
  const feeds = await prisma.feed.findMany({
    where: {
      status: 'active'
    },
    select: {
      id: true,
      guid: true,
      title: true,
      originalUrl: true,
      Track: {
        select: {
          id: true,
          title: true,
          guid: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  console.log(`📊 Found ${feeds.length} feeds to process\n`);

  let feedsUpdated = 0;
  let feedsSkipped = 0;
  let feedsFailed = 0;
  let tracksUpdated = 0;
  let tracksSkipped = 0;
  let apiNotFound = 0;

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    console.log(`\n[${i + 1}/${feeds.length}] 📻 Processing: ${feed.title}`);
    console.log(`   Feed ID: ${feed.id}`);
    console.log(`   URL: ${feed.originalUrl}`);

    try {
      // Look up feed in Podcast Index by URL
      const indexFeed = await api.getFeedByUrl(feed.originalUrl);

      if (!indexFeed) {
        console.log(`   ℹ️  Not found in Podcast Index`);
        apiNotFound++;
        feedsSkipped++;
        continue;
      }

      // Check if feed has a podcast:guid
      const feedGuid = indexFeed.podcastGuid;

      if (feedGuid && feedGuid !== feed.guid) {
        await prisma.feed.update({
          where: { id: feed.id },
          data: { guid: feedGuid }
        });
        console.log(`   ✅ Updated feed GUID: ${feedGuid}`);
        feedsUpdated++;
      } else if (feedGuid && feedGuid === feed.guid) {
        console.log(`   ℹ️  Feed GUID already set: ${feedGuid}`);
        feedsSkipped++;
      } else {
        console.log(`   ⚠️  No podcast:guid in Podcast Index`);
        feedsSkipped++;

        // Still try to get episodes even without feed GUID
      }

      // Get episodes for track GUID matching
      if (feed.Track.length > 0) {
        const episodes = await api.getEpisodesByFeedId(indexFeed.id);
        console.log(`   Found ${episodes.length} episodes in index`);

        if (episodes.length > 0) {
          for (const track of feed.Track) {
            if (track.guid) {
              tracksSkipped++;
              continue;
            }

            // Find matching episode by title (case-insensitive)
            const matchingEpisode = episodes.find(
              ep => ep.title.toLowerCase().trim() === track.title.toLowerCase().trim()
            );

            if (matchingEpisode) {
              await prisma.track.update({
                where: { id: track.id },
                data: { guid: matchingEpisode.guid }
              });
              console.log(`   ✅ Updated track: "${track.title}"`);
              tracksUpdated++;
            } else {
              tracksSkipped++;
            }
          }
        }
      }

      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.log(`   ❌ Error:`, error instanceof Error ? error.message : error);
      feedsFailed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Feeds:`);
  console.log(`  ✅ Updated: ${feedsUpdated}`);
  console.log(`  ℹ️  Skipped: ${feedsSkipped}`);
  console.log(`  ❌ Failed: ${feedsFailed}`);
  console.log(`  🔍 Not in Podcast Index: ${apiNotFound}`);
  console.log(`\nTracks:`);
  console.log(`  ✅ Updated: ${tracksUpdated}`);
  console.log(`  ℹ️  Skipped: ${tracksSkipped}`);
  console.log('='.repeat(60));
}

// Run the script
populateAllGuids()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
