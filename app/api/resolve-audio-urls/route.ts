import { NextRequest, NextResponse } from 'next/server';

interface ResolvedAudioTrack {
  feedGuid: string;
  itemGuid: string;
  title: string;
  artist: string;
  audioUrl: string | null;
  artworkUrl: string | null;
  duration: number | null;
  feedTitle: string;
  feedUrl: string;
}

// Cache for resolved audio URLs (in production, consider using Redis)
const audioUrlCache = new Map<string, { url: string | null; artworkUrl?: string | null; timestamp: number; duration?: number }>();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { songs } = body;

    if (!Array.isArray(songs)) {
      return NextResponse.json({ error: 'Invalid songs array' }, { status: 400 });
    }

    console.log(`🔄 Resolving audio URLs for ${songs.length} tracks`);
    
    const resolvedTracks: ResolvedAudioTrack[] = [];
    const failedTracks: any[] = [];

    // Process tracks in smaller batches to avoid overwhelming servers
    const batchSize = 5;
    for (let i = 0; i < songs.length; i += batchSize) {
      const batch = songs.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (song: any) => {
        try {
          const cacheKey = `${song.feedGuid}-${song.itemGuid}`;
          
          // Check cache first
          const cached = audioUrlCache.get(cacheKey);
          if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
            console.log(`💾 Using cached audio URL for: ${song.title}`);
            return {
              ...song,
              audioUrl: cached.url,
              artworkUrl: cached.artworkUrl || null,
              duration: cached.duration || null
            };
          }

          console.log(`🔍 Fetching RSS feed for: ${song.title} from ${song.feedUrl}`);
          
          // Fetch the RSS feed with timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);
          
          const response = await fetch(song.feedUrl, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'StableKraft-Music-Resolver/1.0',
              'Accept': 'application/rss+xml, application/xml, text/xml',
            },
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const xmlText = await response.text();
          
          // Parse XML to find the specific item by GUID
          const mediaData = extractMediaDataFromXML(xmlText, song.itemGuid);
          
          if (mediaData.audioUrl) {
            console.log(`✅ Found audio URL for: ${song.title} - ${mediaData.audioUrl}`);
            if (mediaData.artworkUrl) {
              console.log(`🎨 Found artwork for: ${song.title} - ${mediaData.artworkUrl}`);
            }
            
            // Cache the result
            audioUrlCache.set(cacheKey, {
              url: mediaData.audioUrl,
              artworkUrl: mediaData.artworkUrl,
              duration: mediaData.duration || undefined,
              timestamp: Date.now()
            });
            
            return {
              ...song,
              audioUrl: mediaData.audioUrl,
              artworkUrl: mediaData.artworkUrl,
              duration: mediaData.duration
            };
          } else {
            console.warn(`⚠️ No audio URL found for: ${song.title}`);
            return {
              ...song,
              audioUrl: null,
              artworkUrl: null,
              duration: null
            };
          }
          
        } catch (error) {
          console.error(`❌ Failed to resolve audio for "${song.title}":`, error);
          return {
            ...song,
            audioUrl: null,
            artworkUrl: null,
            duration: null,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Separate successful and failed tracks
      batchResults.forEach(result => {
        if (result.audioUrl) {
          resolvedTracks.push(result);
        } else {
          failedTracks.push(result);
        }
      });

      // Add delay between batches to be respectful to servers
      if (i + batchSize < songs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`✅ Resolved ${resolvedTracks.length} audio URLs, ${failedTracks.length} failed`);

    return NextResponse.json({
      success: true,
      resolved: resolvedTracks.length,
      failed: failedTracks.length,
      tracks: resolvedTracks,
      failedTracks: failedTracks.map(t => ({ title: t.title, artist: t.artist, error: t.error }))
    });

  } catch (error) {
    console.error('Error in resolve-audio-urls:', error);
    return NextResponse.json(
      { error: 'Failed to resolve audio URLs', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper function to extract audio URL, artwork URL, and duration from RSS XML
function extractMediaDataFromXML(xmlText: string, targetItemGuid: string): { audioUrl: string | null; artworkUrl: string | null; duration: number | null } {
  try {
    // Simple regex-based XML parsing (for production, consider using a proper XML parser)
    
    // Find all <item> blocks
    const itemMatches = xmlText.match(/<item[^>]*>[\s\S]*?<\/item>/gi);
    if (!itemMatches) {
      return { audioUrl: null, artworkUrl: null, duration: null };
    }

    for (const itemBlock of itemMatches) {
      // Check if this item has the target GUID
      const guidMatch = itemBlock.match(/<guid[^>]*>([^<]+)<\/guid>/i);
      if (!guidMatch || guidMatch[1] !== targetItemGuid) {
        continue;
      }

      // Found the target item, extract enclosure URL
      const enclosureMatch = itemBlock.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
      if (!enclosureMatch) {
        continue;
      }

      const audioUrl = enclosureMatch[1];
      
      // Try to extract artwork URL from various sources
      let artworkUrl: string | null = null;
      
      // Try iTunes image first
      const itunesImageMatch = itemBlock.match(/<itunes:image[^>]+href=["']([^"']+)["'][^>]*>/i);
      if (itunesImageMatch) {
        artworkUrl = itunesImageMatch[1];
      }
      
      // Try media:thumbnail or media:content with image type
      if (!artworkUrl) {
        const mediaThumbnailMatch = itemBlock.match(/<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/i);
        if (mediaThumbnailMatch) {
          artworkUrl = mediaThumbnailMatch[1];
        }
      }
      
      // Try podcast:images
      if (!artworkUrl) {
        const podcastImageMatch = itemBlock.match(/<podcast:images[^>]+srcset=["']([^"']+)["'][^>]*>/i);
        if (podcastImageMatch) {
          // Take the first URL from srcset
          const firstUrl = podcastImageMatch[1].split(',')[0].trim().split(' ')[0];
          artworkUrl = firstUrl;
        }
      }
      
      // Try to extract duration from iTunes tags
      let duration: number | null = null;
      const durationMatch = itemBlock.match(/<itunes:duration>([^<]+)<\/itunes:duration>/i);
      if (durationMatch) {
        duration = parseDuration(durationMatch[1]);
      }

      return { audioUrl, artworkUrl, duration };
    }

    return { audioUrl: null, artworkUrl: null, duration: null };
    
  } catch (error) {
    console.error('Error parsing XML:', error);
    return { audioUrl: null, artworkUrl: null, duration: null };
  }
}

// Helper to parse iTunes duration format (HH:MM:SS or MM:SS or seconds)
function parseDuration(durationStr: string): number | null {
  try {
    const trimmed = durationStr.trim();
    
    // If it's just a number, assume seconds
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
    
    // If it contains colons, parse as time format
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      // MM:SS format
      const minutes = parseInt(parts[0], 10);
      const seconds = parseInt(parts[1], 10);
      return (minutes * 60) + seconds;
    } else if (parts.length === 3) {
      // HH:MM:SS format
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseInt(parts[2], 10);
      return (hours * 3600) + (minutes * 60) + seconds;
    }
    
    return null;
  } catch {
    return null;
  }
}