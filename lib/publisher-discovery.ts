/**
 * Publisher Auto-Discovery Module
 *
 * Discovers and stores publisher feeds referenced in album feeds via
 * <podcast:remoteItem medium="publisher"> tags.
 */

import { prisma } from '@/lib/prisma';

export interface PublisherReference {
  feedGuid: string;
  feedUrl: string;
  medium?: string;
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

    // Generate a stable ID for the publisher
    const publisherId = publisherRef.feedGuid ||
                        metadata.guid ||
                        `publisher-${Date.now()}`;

    // Store in database
    await prisma.feed.create({
      data: {
        id: publisherId,
        title: metadata.title,
        artist: metadata.title,
        description: metadata.description,
        image: metadata.image,
        originalUrl: publisherRef.feedUrl,
        type: 'publisher',
        status: 'active',
        updatedAt: new Date()
      }
    });

    console.log(`✅ Added publisher: ${metadata.title} (${publisherId})`);
    if (metadata.image) {
      console.log(`   🖼️ Image: ${metadata.image}`);
    }

    return true;
  } catch (error) {
    console.error('❌ Error discovering publisher:', error);
    return false;
  }
}

/**
 * Extract publisher reference from album feed XML
 */
export function extractPublisherFromXML(xml: string): PublisherReference | null {
  // Look for <podcast:remoteItem medium="publisher">
  const remoteItemRegex = /<podcast:remoteItem[^>]*medium=["']publisher["'][^>]*>/gi;
  const matches = xml.match(remoteItemRegex);

  if (!matches || matches.length === 0) {
    return null;
  }

  // Parse the first publisher reference
  const match = matches[0];

  const feedGuidMatch = match.match(/feedGuid=["']([^"']+)["']/i);
  const feedUrlMatch = match.match(/feedUrl=["']([^"']+)["']/i);

  if (!feedUrlMatch) {
    return null;
  }

  return {
    feedGuid: feedGuidMatch?.[1] || '',
    feedUrl: feedUrlMatch[1],
    medium: 'publisher'
  };
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
      type: { in: ['album', 'music'] },
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
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        failed++;
        continue;
      }

      const xml = await response.text();
      const publisherRef = extractPublisherFromXML(xml);

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
