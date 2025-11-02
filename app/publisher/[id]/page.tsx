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

    // Build a more targeted query instead of loading all publisher feeds
    let publisherFeed = null;
    
    // First try to find by feedGuid if we have it
    if (publisherInfo?.feedGuid) {
      const feedGuidParts = publisherInfo.feedGuid.split('-');
      const feedGuidPrefix = feedGuidParts[0];
      
      // Try direct match first
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: 'publisher',
          status: 'active',
          id: publisherInfo.feedGuid
        }
      });
      
      // If not found, try prefix match (for IDs like wavlake-publisher-93fbacab)
      if (!publisherFeed && feedGuidPrefix) {
        publisherFeed = await prisma.feed.findFirst({
          where: {
            type: 'publisher',
            status: 'active',
            id: { contains: feedGuidPrefix }
          }
        });
      }
    }
    
    // If still not found, try by title match (handle URL slugs)
    if (!publisherFeed) {
      const searchId = publisherId.toLowerCase();
      const possibleTitles = [
        searchId, // Direct match
        searchId.replace(/-/g, ' '), // Convert hyphens to spaces
      ];
      
      publisherFeed = await prisma.feed.findFirst({
        where: {
          type: 'publisher',
          status: 'active',
          OR: [
            { title: { equals: possibleTitles[0], mode: 'insensitive' } },
            { title: { equals: possibleTitles[1], mode: 'insensitive' } },
          ]
        }
      });
    }
    
    // Also try matching by slug if title doesn't match
    if (!publisherFeed) {
      const searchId = publisherId.toLowerCase();
      // Convert any publisher feed title to slug format and compare
      const allPublishers = await prisma.feed.findMany({
        where: {
          type: 'publisher',
          status: 'active'
        },
        select: {
          id: true,
          title: true,
          artist: true,
          description: true,
          image: true,
          originalUrl: true
        }
      });
      
      publisherFeed = allPublishers.find((feed) => {
        if (!feed.title) return false;
        const titleToSlug = feed.title.toLowerCase().replace(/\s+/g, '-');
        return titleToSlug === searchId;
      });
    }
    
    if (!publisherFeed) {
      console.log(`❌ Publisher not found in database: ${publisherId}`);
      return null;
    }
    
    console.log(`✅ Publisher found: ${publisherFeed.title || publisherFeed.id}`);

    // Get related albums for this publisher (feeds with same artist) - optimized query
    // Only fetch essential fields and use a count query instead of including tracks
    const relatedFeeds = await prisma.feed.findMany({
      where: {
        artist: publisherFeed.artist,
        type: { in: ['album', 'music'] },
        status: 'active'
      },
      select: {
        id: true,
        title: true,
        artist: true,
        description: true,
        image: true,
        lastFetched: true,
        createdAt: true,
        originalUrl: true,
        _count: {
          select: {
            Track: {
              where: {
                audioUrl: { not: '' }
              }
            }
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    // Transform related feeds to albums format
    const albums = relatedFeeds
      .filter(feed => (feed._count?.Track || 0) > 0) // Only include feeds with tracks
      .map(feed => ({
        id: feed.id,
        title: feed.title,
        artist: feed.artist,
        description: feed.description,
        coverArt: feed.image,
        releaseDate: feed.lastFetched || feed.createdAt,
        trackCount: feed._count?.Track || 0,
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