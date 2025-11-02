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
    
    // If still not found, try by title or artist match (handle URL slugs)
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
            { artist: { equals: possibleTitles[0], mode: 'insensitive' } },
            { artist: { equals: possibleTitles[1], mode: 'insensitive' } },
          ]
        }
      });
    }
    
    // Also try matching by slug if title doesn't match
    if (!publisherFeed) {
      const searchId = publisherId.toLowerCase();
      // Convert any publisher feed title or artist to slug format and compare
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
      
      console.log(`🔍 Found ${allPublishers.length} publisher feeds in database`);
      console.log(`🔍 Searching for publisher with slug: "${searchId}"`);
      
      // Log first few publishers for debugging
      if (allPublishers.length > 0) {
        console.log(`📋 Sample publishers (first 5):`);
        allPublishers.slice(0, 5).forEach((feed, idx) => {
          const titleSlug = feed.title?.toLowerCase().replace(/\s+/g, '-') || 'no-title';
          const artistSlug = feed.artist?.toLowerCase().replace(/\s+/g, '-') || 'no-artist';
          console.log(`  ${idx + 1}. id="${feed.id}", title="${feed.title}", artist="${feed.artist}"`);
          console.log(`     title-slug="${titleSlug}", artist-slug="${artistSlug}"`);
        });
      }
      
      publisherFeed = allPublishers.find((feed) => {
        // Try matching by title slug
        if (feed.title) {
          const titleToSlug = feed.title.toLowerCase().replace(/\s+/g, '-');
          if (titleToSlug === searchId) {
            console.log(`✅ Matched publisher by title slug: "${feed.title}" -> "${titleToSlug}"`);
            return true;
          }
        }
        // Try matching by artist slug
        if (feed.artist) {
          const artistToSlug = feed.artist.toLowerCase().replace(/\s+/g, '-');
          if (artistToSlug === searchId) {
            console.log(`✅ Matched publisher by artist slug: "${feed.artist}" -> "${artistToSlug}"`);
            return true;
          }
        }
        return false;
      });
      
      if (!publisherFeed) {
        console.log(`❌ No publisher feed matched slug "${searchId}"`);
      }
    }
    
    // If no publisher feed found, try to find albums by artist name and create publisher info from them
    let artistName: string | null = null;
    
    if (!publisherFeed) {
      console.log(`⚠️ No publisher feed found for "${publisherId}", trying to find albums by artist name...`);
      
      // Try to find albums/music feeds with matching artist name
      const searchId = publisherId.toLowerCase();
      const possibleArtistNames = [
        searchId, // "bennyjeans"
        searchId.replace(/-/g, ' '), // "benny jeans"
      ];
      
      // Find the first album feed to get the artist name
      const firstAlbumFeed = await prisma.feed.findFirst({
        where: {
          type: { in: ['album', 'music'] },
          status: 'active',
          OR: [
            { artist: { equals: possibleArtistNames[0], mode: 'insensitive' } },
            { artist: { equals: possibleArtistNames[1], mode: 'insensitive' } },
          ]
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
      
      if (firstAlbumFeed) {
        artistName = firstAlbumFeed.artist || firstAlbumFeed.title;
        console.log(`✅ Found albums by artist: "${artistName}"`);
        
        // Create a synthetic publisher feed from the first album
        publisherFeed = {
          id: `publisher-${publisherId}`,
          title: artistName || publisherId,
          artist: artistName || null,
          description: `Albums by ${artistName || publisherId}`,
          image: firstAlbumFeed.image || null,
          originalUrl: '',
          type: 'publisher' as any,
          status: 'active' as any,
          createdAt: new Date(),
          updatedAt: new Date()
        } as any;
        
        console.log(`📝 Created synthetic publisher feed for "${artistName}"`);
      } else {
        console.log(`❌ No albums found for artist matching "${publisherId}"`);
        return null;
      }
    } else {
      console.log(`✅ Publisher found: ${publisherFeed.title || publisherFeed.id}`);
      artistName = publisherFeed.artist || publisherFeed.title;
    }

    // Get related albums for this publisher (feeds with same artist) - optimized query
    // Match by artist field (case-insensitive)
    const relatedFeeds = await prisma.feed.findMany({
      where: {
        artist: { equals: artistName, mode: 'insensitive' },
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
        Track: {
          where: {
            audioUrl: { not: '' }
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' },
            { createdAt: 'asc' }
          ],
          select: {
            id: true,
            title: true,
            duration: true,
            audioUrl: true,
            trackOrder: true,
            publishedAt: true
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    // Transform related feeds to albums format with actual tracks
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
        tracks: feed.Track.map(track => ({
          id: track.id,
          title: track.title || 'Unknown Track',
          duration: track.duration || '0:00',
          url: track.audioUrl || '',
          trackNumber: track.trackOrder || 0
        })),
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