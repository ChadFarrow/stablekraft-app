import { Metadata } from 'next';
import PublisherDetailClient from './PublisherDetailClient';
import { getPublisherInfo } from '@/lib/url-utils';
import { prisma } from '@/lib/prisma';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const publisherId = decodeURIComponent(id);
  
  // Get publisher info to show proper name in title
  const publisherInfo = getPublisherInfo(publisherId);
  const publisherName = publisherInfo?.name || publisherId;
  
  return {
    title: `${publisherName} | re.podtards.com`,
    description: `View all albums from ${publisherName}`,
  };
}

async function loadPublisherData(publisherId: string) {
  // First, try to resolve human-readable slug to actual feedGuid
  const publisherInfo = getPublisherInfo(publisherId);
  const actualFeedGuid = publisherInfo?.feedGuid || publisherId;
  
  try {
    console.log(`🏢 Server-side: Looking for publisher: ${publisherId}`);
    console.log(`🏢 Server-side: publisherInfo.feedGuid:`, publisherInfo?.feedGuid);

    // Search for publisher feeds in the database
    const publisherFeeds = await prisma.feed.findMany({
      where: { 
        type: 'publisher',
        status: 'active'
      },
      include: {
        Track: {
          where: {
            audioUrl: { not: '' }
          },
          take: 10 // Limit tracks for performance
        }
      }
    });

    console.log(`🏢 Server-side: Found ${publisherFeeds.length} publisher feeds to search`);

    // Try to find matching publisher feed
    let publisherFeed = publisherFeeds.find((feed) => {
      // First try matching by feedGuid from url-utils
      if (publisherInfo?.feedGuid && feed.id) {
        const feedGuidParts = publisherInfo.feedGuid.split('-');
        if (feed.id.includes(feedGuidParts[0])) {
          console.log(`🏢 Server-side: Matched by feedGuid prefix: ${feed.id}`);
          return true;
        }
      }

      // Then try title match (case-insensitive, handle URL slugs)
      const cleanTitle = feed.title?.toLowerCase() || '';
      const searchId = publisherId.toLowerCase();

      // Direct match
      if (cleanTitle === searchId) return true;

      // Convert hyphens to spaces and compare (e.g., "the-doerfels" -> "the doerfels")
      const slugToTitle = searchId.replace(/-/g, ' ');
      if (cleanTitle === slugToTitle) return true;

      // Convert spaces to hyphens and compare (e.g., "the doerfels" -> "the-doerfels")
      const titleToSlug = cleanTitle.replace(/\s+/g, '-');
      if (titleToSlug === searchId) return true;

      return false;
    });
    
    if (!publisherFeed) {
      console.log(`❌ Publisher not found in database: ${publisherId}`);
      console.log(`🔍 Available publishers:`, publisherFeeds.map((f) => f.title || 'Unknown'));
      return null;
    }
    
    console.log(`✅ Publisher found: ${publisherFeed.title}`);

    // Get related albums for this publisher (feeds with same artist)
    const relatedFeeds = await prisma.feed.findMany({
      where: {
        artist: publisherFeed.artist,
        type: { in: ['album', 'music'] },
        status: 'active'
      },
      include: {
        Track: {
          where: {
            audioUrl: { not: '' }
          },
          take: 1 // Just check if has tracks
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    // Transform related feeds to albums format
    const albums = relatedFeeds
      .filter(feed => feed.Track.length > 0) // Only include feeds with tracks
      .map(feed => ({
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        description: feed.description,
        coverArt: feed.image,
        releaseDate: feed.lastFetched || feed.createdAt,
        trackCount: feed.Track.length,
        feedUrl: feed.originalUrl
      }));

    console.log(`🏢 Server-side: Found ${albums.length} related albums`);

    // Create publisher items (this might be empty for some publishers)
    const publisherItems: any[] = []; // TODO: Extract from publisher feed if needed

    // Convert to expected format
    const data = {
      publisherInfo: {
        name: publisherInfo?.name || publisherFeed.title || publisherId,
        description: publisherFeed.description || `${albums.length} releases`,
        image: publisherFeed.image,
        feedUrl: publisherFeed.originalUrl,
        feedGuid: publisherFeed.id
      },
      publisherItems,
      albums,
      feedId: publisherFeed.id
    };
    
    console.log(`🏢 Server-side: Found publisher data for ${publisherId}:`, {
      name: data.publisherInfo.name,
      feedGuid: data.publisherInfo.feedGuid,
      image: data.publisherInfo.image,
      albumCount: albums.length
    });
    
    return data;
  } catch (error) {
    console.error('Error loading publisher data:', error);
    return null;
  }
}

export default async function PublisherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const publisherId = decodeURIComponent(id);
  
  // Load publisher data server-side
  const publisherData = await loadPublisherData(publisherId);
  
  return <PublisherDetailClient publisherId={publisherId} initialData={publisherData} />;
}