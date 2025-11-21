import crypto from 'crypto';

const API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;

export interface PublisherFeedInfo {
  found: boolean;
  feedUrl?: string;
  title?: string;
  guid?: string;
  author?: string;
  episodeCount?: number;
  medium?: string;
  alreadyImported?: boolean;
  autoImported?: boolean;
  error?: string;
}

/**
 * Searches for a publisher/artist feed on Podcast Index based on artist name
 * Returns the most likely publisher feed that contains multiple albums
 */
export async function findPublisherFeed(artistName: string): Promise<PublisherFeedInfo> {
  try {
    if (!API_KEY || !API_SECRET) {
      console.warn('⚠️ Podcast Index API credentials not configured');
      return { found: false };
    }

    // Generate auth headers for Podcast Index API
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto
      .createHash('sha1')
      .update(API_KEY + API_SECRET + apiHeaderTime)
      .digest('hex');

    const headers = {
      'X-Auth-Date': apiHeaderTime.toString(),
      'X-Auth-Key': API_KEY,
      'Authorization': hash,
      'User-Agent': 'StableKraft/1.0'
    };

    // Search for feeds by author name
    console.log(`🔍 Searching for publisher feed for artist: ${artistName}`);

    const searchResponse = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(artistName)}`,
      { headers }
    );

    if (!searchResponse.ok) {
      console.error('❌ Podcast Index API error:', searchResponse.statusText);
      return { found: false };
    }

    const searchData = await searchResponse.json();

    if (!searchData.feeds || searchData.feeds.length === 0) {
      console.log('ℹ️ No feeds found for artist:', artistName);
      return { found: false };
    }

    // Look for feeds that:
    // 1. Have multiple episodes (episodeCount > 1)
    // 2. Match the artist name exactly or closely
    // 3. Are marked as medium="music" or have "music" in the title
    // 4. Don't have album-specific names (like "album name by artist")

    const potentialPublisherFeeds = searchData.feeds
      .filter((feed: any) => {
        const authorMatch = feed.author?.toLowerCase().includes(artistName.toLowerCase());
        const titleIsJustArtist = feed.title?.toLowerCase() === artistName.toLowerCase();
        const hasMultipleEpisodes = feed.episodeCount > 1;
        const isMusic = feed.medium === 'music' || feed.categories?.music;

        return (authorMatch || titleIsJustArtist) && hasMultipleEpisodes && isMusic;
      })
      .sort((a: any, b: any) => {
        // Prefer feeds with more episodes
        return b.episodeCount - a.episodeCount;
      });

    if (potentialPublisherFeeds.length > 0) {
      const publisherFeed = potentialPublisherFeeds[0];
      console.log('✅ Found potential publisher feed:', publisherFeed.title);

      return {
        found: true,
        feedUrl: publisherFeed.url,
        title: publisherFeed.title,
        guid: publisherFeed.podcastGuid,
        author: publisherFeed.author,
        episodeCount: publisherFeed.episodeCount,
        medium: publisherFeed.medium
      };
    }

    console.log('ℹ️ No publisher feed found (only single albums)');
    return { found: false };

  } catch (error) {
    console.error('❌ Error searching for publisher feed:', error);
    return { found: false };
  }
}
