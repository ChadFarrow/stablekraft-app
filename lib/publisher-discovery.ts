/**
 * Publisher Auto-Discovery Module
 *
 * Discovers and stores publisher feeds referenced in album feeds via
 * <podcast:remoteItem medium="publisher"> tags.
 */

import { prisma } from '@/lib/prisma';
import { parsePublisherFeedFromXML, parsePodcastMediumFromXML } from '@/lib/rss-parser-db';
import { isListMedium } from '@/lib/playlist/musicl-feed';
import { USER_AGENT } from './user-agent';

export interface PublisherReference {
  feedGuid: string;
  feedUrl: string;
  medium?: string;
}

export interface RemoteItem {
  feedGuid: string;
  feedUrl: string;
  medium: string;
}

/**
 * Extract all <podcast:remoteItem> tags from publisher feed XML
 * These point to albums belonging to this publisher.
 * Items inside <podcast:podroll> are excluded (related feeds, not official releases).
 */
function extractRemoteItemsFromXML(xml: string): RemoteItem[] {
  const items: RemoteItem[] = [];

  // Remove podroll section so we only get official remoteItem entries
  const xmlWithoutPodroll = xml.replace(/<podcast:podroll>[\s\S]*?<\/podcast:podroll>/gi, '');

  // Match all remoteItem tags (self-closing)
  const remoteItemRegex = /<podcast:remoteItem[^>]*>/gi;
  const matches = xmlWithoutPodroll.match(remoteItemRegex) || [];

  for (const match of matches) {
    const feedGuidMatch = match.match(/feedGuid=["']([^"']+)["']/i);
    const feedUrlMatch = match.match(/feedUrl=["']([^"']+)["']/i);
    const mediumMatch = match.match(/medium=["']([^"']+)["']/i);

    // Only include music/album references (not publisher references)
    const medium = mediumMatch?.[1] || '';
    if (medium === 'publisher') continue;
    // A musicL (or other list-medium) child is a playlist, not an album: it
    // has no tracks of its own and would be an empty, unloadable tile (#309).
    if (isListMedium(medium)) continue;

    if (feedGuidMatch || feedUrlMatch) {
      items.push({
        feedGuid: feedGuidMatch?.[1] || '',
        feedUrl: feedUrlMatch?.[1] || '',
        medium: medium || 'music'
      });
    }
  }

  return items;
}

/**
 * Link albums to their publisher by updating the publisherId field
 */
async function linkAlbumsToPublisher(publisherId: string, remoteItems: RemoteItem[]): Promise<number> {
  let linked = 0;

  for (const item of remoteItems) {
    // Build query conditions
    const conditions: any[] = [];
    if (item.feedGuid) {
      conditions.push({ id: item.feedGuid });
    }
    if (item.feedUrl) {
      conditions.push({ originalUrl: item.feedUrl });
    }

    if (conditions.length === 0) continue;

    // Update matching album feeds
    const result = await prisma.feed.updateMany({
      where: {
        OR: conditions,
        type: { in: ['album', 'music', 'podcast'] },
        publisherId: null // Only update if not already linked
      },
      data: { publisherId }
    });

    linked += result.count;
  }

  return linked;
}

/**
 * Extract publisher metadata from XML
 */
function extractPublisherMetadata(xml: string): {
  title: string | null;
  description: string | null;
  image: string | null;
  guid: string | null;
} {
  // Extract title
  let title: string | null = null;
  const titleMatch = xml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                     xml.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Extract description
  let description: string | null = null;
  const descMatch = xml.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/is) ||
                    xml.match(/<description>([^<]+)<\/description>/i) ||
                    xml.match(/<itunes:summary><!\[CDATA\[(.*?)\]\]><\/itunes:summary>/is) ||
                    xml.match(/<itunes:summary>([^<]+)<\/itunes:summary>/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Extract iTunes image (preferred for publisher artwork)
  let image: string | null = null;
  const itunesImageMatch = xml.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
  if (itunesImageMatch) {
    image = itunesImageMatch[1].trim();
  } else {
    // Fallback to standard image tag
    const imageMatch = xml.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
    if (imageMatch) {
      image = imageMatch[1].trim();
    }
  }

  // Extract podcast:guid
  let guid: string | null = null;
  const guidMatch = xml.match(/<podcast:guid>([^<]+)<\/podcast:guid>/i);
  if (guidMatch) {
    guid = guidMatch[1].trim();
  }

  return { title, description, image, guid };
}

/**
 * Discover and store a publisher feed in the database
 *
 * @param publisherRef - The publisher reference extracted from an album feed
 * @returns true if a new publisher was added, false if it already existed or failed
 */
export async function discoverAndStorePublisher(publisherRef: PublisherReference): Promise<boolean> {
  if (!publisherRef.feedUrl) {
    console.log('⚠️ Publisher reference has no feedUrl, skipping');
    return false;
  }

  try {
    // Check if publisher already exists by GUID or URL
    const existing = await prisma.feed.findFirst({
      where: {
        OR: [
          { id: publisherRef.feedGuid },
          { originalUrl: publisherRef.feedUrl }
        ],
        type: 'publisher'
      }
    });

    if (existing) {
      console.log(`📋 Publisher already exists: ${existing.title} (${existing.id})`);
      return false;
    }

    // Fetch the publisher feed XML
    console.log(`🔍 Discovering publisher from: ${publisherRef.feedUrl}`);
    const response = await fetch(publisherRef.feedUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`⚠️ Failed to fetch publisher feed: ${response.status}`);
      return false;
    }

    const xml = await response.text();
    const metadata = extractPublisherMetadata(xml);

    if (!metadata.title) {
      console.warn('⚠️ Could not extract publisher title from feed');
      return false;
    }

    // Extract album references from publisher feed
    const remoteItems = extractRemoteItemsFromXML(xml);

    // Generate a stable ID for the publisher
    const publisherId = publisherRef.feedGuid ||
                        metadata.guid ||
                        `publisher-${Date.now()}`;

    // Store in database with lastFetched to mark as parsed
    await prisma.feed.create({
      data: {
        id: publisherId,
        title: metadata.title,
        artist: metadata.title,
        description: metadata.description,
        image: metadata.image,
        originalUrl: publisherRef.feedUrl,
        type: 'publisher',
        // From the publisher feed's own XML rather than assumed from `type` —
        // publisher feeds declare <podcast:medium>publisher</podcast:medium>,
        // but one that doesn't must not be recorded as if it had.
        medium: parsePodcastMediumFromXML(xml),
        status: 'active',
        lastFetched: new Date(),
        updatedAt: new Date()
      }
    });

    console.log(`✅ Added publisher: ${metadata.title} (${publisherId})`);
    if (metadata.image) {
      console.log(`   🖼️ Image: ${metadata.image}`);
    }

    // Link albums to this publisher
    if (remoteItems.length > 0) {
      const linked = await linkAlbumsToPublisher(publisherId, remoteItems);
      console.log(`   🔗 Linked ${linked} albums (found ${remoteItems.length} references)`);
    }

    return true;
  } catch (error) {
    console.error('❌ Error discovering publisher:', error);
    return false;
  }
}

/**
 * Discover publishers from all album feeds in the database
 * This is a one-time migration function
 */
export async function discoverAllPublishers(): Promise<{
  total: number;
  discovered: number;
  failed: number;
}> {
  console.log('🚀 Starting publisher discovery for all album feeds...');

  const albumFeeds = await prisma.feed.findMany({
    where: {
      type: { in: ['album', 'music', 'podcast'] },
      status: 'active'
    },
    select: {
      id: true,
      title: true,
      originalUrl: true
    }
  });

  console.log(`📊 Found ${albumFeeds.length} album feeds to process`);

  let discovered = 0;
  let failed = 0;

  for (const feed of albumFeeds) {
    if (!feed.originalUrl) continue;

    try {
      // Fetch album feed XML
      const response = await fetch(feed.originalUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        failed++;
        continue;
      }

      const xml = await response.text();
      const publisherRef = parsePublisherFeedFromXML(xml);

      if (publisherRef) {
        const added = await discoverAndStorePublisher(publisherRef);
        if (added) {
          discovered++;
        }
      }

      // Rate limit to avoid hammering servers
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`❌ Error processing ${feed.title}:`, error);
      failed++;
    }
  }

  console.log(`\n📊 Publisher Discovery Complete:`);
  console.log(`   Total feeds processed: ${albumFeeds.length}`);
  console.log(`   New publishers discovered: ${discovered}`);
  console.log(`   Failed/Skipped: ${failed}`);

  return {
    total: albumFeeds.length,
    discovered,
    failed
  };
}

/**
 * Parse existing publisher feeds to extract album relationships
 * This is a one-time migration for publishers that were discovered but not fully parsed
 */
export async function parseExistingPublishers(): Promise<{
  total: number;
  parsed: number;
  linked: number;
  failed: number;
}> {
  console.log('🚀 Starting to parse existing publisher feeds...');

  // Find all publisher feeds that haven't been fully parsed
  const publishers = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      status: 'active'
    },
    select: {
      id: true,
      title: true,
      originalUrl: true,
      lastFetched: true
    }
  });

  console.log(`📊 Found ${publishers.length} publisher feeds to process`);

  let parsed = 0;
  let totalLinked = 0;
  let failed = 0;

  for (const publisher of publishers) {
    if (!publisher.originalUrl) {
      failed++;
      continue;
    }

    try {
      console.log(`🔍 Parsing: ${publisher.title}`);

      // Fetch publisher feed XML
      const response = await fetch(publisher.originalUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        console.warn(`   ⚠️ Failed to fetch: ${response.status}`);
        failed++;
        continue;
      }

      const xml = await response.text();

      // Extract album references
      const remoteItems = extractRemoteItemsFromXML(xml);

      // Link albums to this publisher
      if (remoteItems.length > 0) {
        const linked = await linkAlbumsToPublisher(publisher.id, remoteItems);
        totalLinked += linked;
        console.log(`   🔗 Linked ${linked} albums (found ${remoteItems.length} references)`);
      }

      // Update lastFetched to mark as parsed
      await prisma.feed.update({
        where: { id: publisher.id },
        data: { lastFetched: new Date() }
      });

      parsed++;

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`   ❌ Error: ${error}`);
      failed++;
    }
  }

  console.log(`\n📊 Publisher Parsing Complete:`);
  console.log(`   Total publishers: ${publishers.length}`);
  console.log(`   Successfully parsed: ${parsed}`);
  console.log(`   Albums linked: ${totalLinked}`);
  console.log(`   Failed: ${failed}`);

  return {
    total: publishers.length,
    parsed,
    linked: totalLinked,
    failed
  };
}
