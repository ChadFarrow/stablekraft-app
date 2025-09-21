import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateAlbumSlug } from '@/lib/url-utils';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    console.log('🔍 Publishers API: Loading actual publisher feeds from publisher-stats.json');
    
    // Load the correct publisher data from our pre-built file
    const publisherStatsPath = path.join(process.cwd(), 'public', 'publisher-stats.json');
    let publishers: any[] = [];
    
    try {
      if (fs.existsSync(publisherStatsPath)) {
        const publisherData = JSON.parse(fs.readFileSync(publisherStatsPath, 'utf8'));
        publishers = publisherData.publishers || [];
        
        // Transform to match the expected format for the publishers API
        // We need to fetch the actual artwork from each publisher feed
        const publishersWithArtwork = await Promise.all(
          publishers.map(async (publisher: any) => {
            let image = '/placeholder-artist.png'; // Default fallback
            
            try {
              // Fetch the RSS feed to get the actual artwork
              const response = await fetch(publisher.feedUrl, { 
                headers: { 'User-Agent': 'Project StableKraft Music App/1.0' },
                signal: AbortSignal.timeout(5000) // 5 second timeout
              });
              
              if (response.ok) {
                const xmlText = await response.text();
                
                // Extract highest quality image from the RSS feed
                let foundImage = null;
                
                // Method 1: Look for high-res iTunes image
                const itunesImageMatch = xmlText.match(/<itunes:image[^>]+href="([^"]+)"/i);
                if (itunesImageMatch && itunesImageMatch[1]) {
                  foundImage = itunesImageMatch[1];
                }
                
                // Method 2: Look for standard RSS image
                if (!foundImage) {
                  const standardImageMatch = xmlText.match(/<image[^>]*>\s*<url>([^<]+)<\/url>/i);
                  if (standardImageMatch && standardImageMatch[1]) {
                    foundImage = standardImageMatch[1];
                  }
                }
                
                // Method 3: Look for media thumbnail
                if (!foundImage) {
                  const thumbnailMatch = xmlText.match(/<media:thumbnail[^>]+url="([^"]+)"/i);
                  if (thumbnailMatch && thumbnailMatch[1]) {
                    foundImage = thumbnailMatch[1];
                  }
                }
                
                if (foundImage) {
                  // For Wavlake feeds, try to get higher resolution
                  if (foundImage.includes('wavlake.com') && foundImage.includes('300x300')) {
                    // Try 600x600 first, then 1200x1200
                    const highResUrl = foundImage.replace('300x300', '1200x1200');
                    try {
                      const testResponse = await fetch(highResUrl, { method: 'HEAD' });
                      if (testResponse.ok) {
                        foundImage = highResUrl;
                      } else {
                        // Try 600x600 if 1200x1200 doesn't exist
                        const midResUrl = foundImage.replace('300x300', '600x600');
                        const testResponse2 = await fetch(midResUrl, { method: 'HEAD' });
                        if (testResponse2.ok) {
                          foundImage = midResUrl;
                        }
                      }
                    } catch (e) {
                      // Keep original if higher res check fails
                    }
                  }
                  
                  // For other feeds, check if we can upgrade resolution
                  if (foundImage.includes('_150x150') || foundImage.includes('_300x300')) {
                    const highResUrl = foundImage.replace(/_150x150|_300x300/g, '_1200x1200');
                    try {
                      const testResponse = await fetch(highResUrl, { method: 'HEAD' });
                      if (testResponse.ok) {
                        foundImage = highResUrl;
                      }
                    } catch (e) {
                      // Keep original if higher res check fails
                    }
                  }
                  
                  image = foundImage;
                  console.log(`🎨 Found high-res artwork for ${publisher.name}: ${image}`);
                }
              }
            } catch (error) {
              console.log(`⚠️ Could not fetch artwork for ${publisher.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
            
            return {
              id: publisher.feedGuid,
              title: publisher.name,
              feedGuid: publisher.feedGuid,
              originalUrl: publisher.feedUrl,
              image: image,
              description: `Publisher feed with ${publisher.albumCount} releases`,
              albums: [], // Individual albums not needed for publisher list
              itemCount: publisher.albumCount,
              totalTracks: publisher.albumCount, // Approximate
              isPublisherCard: true,
              publisherUrl: `/publisher/${generateAlbumSlug(publisher.name)}`
            };
          })
        );
        
        publishers = publishersWithArtwork;
        
        console.log(`📊 Loaded ${publishers.length} publisher feeds from publisher-stats.json`);
      } else {
        console.log('⚠️ No publisher-stats.json found, returning empty publishers list');
        publishers = [];
      }
    } catch (error) {
      console.error('Error loading publisher stats:', error);
      publishers = [];
    }

    console.log(`✅ Publishers API: Returning ${publishers.length} actual publisher feeds`);

    const response = {
      publishers,
      total: publishers.length,
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=600',
        'ETag': `"${Date.now()}"`,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      },
    });
  } catch (error) {
    console.error('Unexpected error in database publishers API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'An unexpected error occurred',
        timestamp: new Date().toISOString()
      },
      { 
        status: 500,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 