import { Metadata } from 'next';
import PublisherDetailClient from './PublisherDetailClient';
import { getPublisherInfo } from '@/lib/url-utils';
import fs from 'fs';
import path from 'path';

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
    // Load from parsed-feeds.json which contains publisher items
    const parsedFeedsPath = path.join(process.cwd(), 'data', 'parsed-feeds.json');

    if (!fs.existsSync(parsedFeedsPath)) {
      console.error('Parsed feeds file not found at:', parsedFeedsPath);
      return null;
    }

    const fileContent = fs.readFileSync(parsedFeedsPath, 'utf-8');
    const parsedData = JSON.parse(fileContent);
    const publisherFeeds = parsedData.feeds || [];
    
    console.log(`🏢 Server-side: Looking for publisher: ${publisherId}`);
    console.log(`🏢 Server-side: publisherInfo.feedGuid:`, publisherInfo?.feedGuid);

    // Filter to only publisher type feeds first
    const publisherTypeFeeds = publisherFeeds.filter((feed: any) => feed.type === 'publisher');

    console.log(`🏢 Server-side: Found ${publisherTypeFeeds.length} publisher feeds to search`);
    console.log(`🏢 Server-side: Publisher feed IDs:`, publisherTypeFeeds.map((f: any) => f.id));

    // Try to find publisher feed - prioritize publisher type feeds
    let publisherFeed = publisherTypeFeeds.find((feed: any) => {
      console.log(`🏢 Server-side: Checking feed ${feed.id} against feedGuid ${publisherInfo?.feedGuid}`);
      // First try matching by feedGuid from url-utils
      // The feedGuid might be partial in the ID (e.g., "aa909244" instead of "aa909244-7555-4b52-ad88-7233860c6fb4")
      if (publisherInfo?.feedGuid && feed.id) {
        const feedGuidParts = publisherInfo.feedGuid.split('-');
        if (feed.id.includes(feedGuidParts[0])) {
          console.log(`🏢 Server-side: Matched by feedGuid prefix: ${feed.id}`);
          return true;
        }
      }

      // Then try title match (case-insensitive, handle URL slugs)
      const cleanTitle = feed.title?.replace('<![CDATA[', '').replace(']]>', '').toLowerCase() || '';
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
      console.log(`❌ Publisher not found in static file: ${publisherId}`);
      console.log(`🔍 Available publishers in static file:`, publisherFeeds.map((f: any) => 
        f.title?.replace('<![CDATA[', '').replace(']]>', '') || 'Unknown'
      ));
      
      // Fallback: Try to find publisher in the database via /api/publishers
      console.log(`🔄 Falling back to /api/publishers for: ${publisherId}`);
      try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
                       (process.env.NODE_ENV === 'production' ? 'https://fuckit-production.up.railway.app' : 'http://localhost:3002');
        
        const publishersResponse = await fetch(`${baseUrl}/api/publishers`);
        if (publishersResponse.ok) {
          const publishersData = await publishersResponse.json();
          const publishers = publishersData.publishers || [];
          
          // Find matching publisher using same logic
          const matchingPublisher = publishers.find((pub: any) => {
            const cleanTitle = pub.title?.toLowerCase() || '';
            const searchId = publisherId.toLowerCase();
            
            // Direct match
            if (cleanTitle === searchId) return true;
            if (pub.id === publisherId) return true;
            
            // Convert hyphens to spaces and compare
            const slugToTitle = searchId.replace(/-/g, ' ');
            if (cleanTitle === slugToTitle) return true;
            
            // Convert spaces to hyphens and compare
            const titleToSlug = cleanTitle.replace(/\s+/g, '-');
            if (titleToSlug === searchId) return true;
            
            return false;
          });
          
          if (matchingPublisher) {
            console.log(`✅ Publisher found in database: ${matchingPublisher.title}`);
            
            // Convert database publisher to expected format
            return {
              publisherInfo: {
                name: matchingPublisher.title,
                description: matchingPublisher.description || `${matchingPublisher.itemCount} releases`,
                image: matchingPublisher.image,
                feedUrl: matchingPublisher.originalUrl,
                feedGuid: matchingPublisher.id
              },
              publisherItems: matchingPublisher.albums || [],
              feedId: matchingPublisher.id
            };
          }
        }
      } catch (fallbackError) {
        console.error('Fallback API call failed:', fallbackError);
      }
      
      return null;
    }
    
    console.log(`✅ Publisher found: ${publisherFeed.title}`);
    console.log(`📸 Publisher parsedData:`, JSON.stringify(publisherFeed.parsedData?.publisherInfo, null, 2));

    // Extract publisher items from parsedData
    const publisherItems = publisherFeed.parsedData?.publisherItems || [];

    console.log(`🏢 Server-side: Found ${publisherItems.length} publisher items`);

    // TODO: Pre-fetch albums from the database to avoid client-side timeout issues
    // Currently disabled due to API performance issues (60+ second response times)
    // The albums API needs optimization before we can enable server-side pre-fetching
    let albums: any[] = [];
    console.log(`🏢 Server-side: Skipping album pre-fetch (API performance issue) - client will fetch`);

    // Uncomment this when the albums API is optimized:
    // try {
    //   const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
    //                  (process.env.NODE_ENV === 'production' ? 'https://fuckit-production.up.railway.app' : 'http://localhost:3002');
    //   const albumsResponse = await fetch(`${baseUrl}/api/albums?publisher=${encodeURIComponent(publisherId)}&limit=100`, {
    //     signal: AbortSignal.timeout(60000)
    //   });
    //   if (albumsResponse.ok) {
    //     const albumsData = await albumsResponse.json();
    //     albums = albumsData.albums || [];
    //   }
    // } catch (error) {
    //   console.error(`🏢 Server-side: Error pre-fetching albums:`, error);
    // }

    // Convert to expected format
    const data = {
      publisherInfo: {
        // Use the name from url-utils (e.g., "Nate Johnivan") instead of generic feed title ("Wavlake Publisher")
        name: publisherInfo?.name || publisherFeed.title?.replace('<![CDATA[', '').replace(']]>', '') || publisherId,
        description: publisherFeed.parsedData?.publisherInfo?.description || '',
        image: publisherFeed.parsedData?.publisherInfo?.coverArt || null,
        feedUrl: publisherFeed.originalUrl,
        feedGuid: publisherId // Use the publisherId which matches what the API uses
      },
      publisherItems, // Use actual publisher items from parsed data
      albums, // Include pre-fetched albums
      feedId: publisherFeed.id
    };
    
    console.log(`🏢 Server-side: Found publisher data for ${publisherId}:`, {
      name: data.publisherInfo.name,
      feedGuid: data.publisherInfo.feedGuid,
      image: data.publisherInfo.image
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