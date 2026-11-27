import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { USER_AGENT } from '@/lib/user-agent';

// This endpoint resolves V4V remoteItem references to actual music tracks
// by looking up the feedGuid and itemGuid from the Podcast Index API

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const feedGuid = searchParams.get('feedGuid');
    const itemGuid = searchParams.get('itemGuid');

    if (!feedGuid || !itemGuid) {
      return NextResponse.json(
        { error: 'Missing feedGuid or itemGuid parameter' },
        { status: 400 }
      );
    }

    console.log('Resolving track with feedGuid:', feedGuid, 'itemGuid:', itemGuid);

    // Check if this is a known Doerfel-Verse feed that we can resolve directly
    const knownFeeds: { [key: string]: string } = {
      '2b62ef49-fcff-523c-b81a-0a7dde2b0609': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
      '69c634ad-afea-5826-ad9a-8e1f06d6470b': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml',
      '08604071-83cc-5810-bec2-bea0f0cd0033': 'https://www.doerfelverse.com/feeds/ben-doerfel.xml',
      '1e7ed1fa-0456-5860-9b34-825d1335d8f8': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml'
    };

    if (knownFeeds[feedGuid]) {
      console.log('✅ Found known Doerfel-Verse feed:', knownFeeds[feedGuid]);
      
      try {
        // Fetch the known feed directly
        const feedResponse = await fetch(knownFeeds[feedGuid], { headers: { 'User-Agent': USER_AGENT } });
        if (feedResponse.ok) {
          const feedXml = await feedResponse.text();
          
          // Parse the feed to find the specific episode by itemGuid
          // Look for the GUID in the XML
          const guidPattern = new RegExp(`<guid[^>]*>${itemGuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</guid>`, 'i');
          const itemMatch = feedXml.match(new RegExp(`<item>([\\s\\S]*?${itemGuid}[\\s\\S]*?)</item>`, 'i'));
          
          if (itemMatch) {
            const itemXml = itemMatch[1];
            
            // Extract track info from the matched item
            const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || itemXml.match(/<title>(.*?)<\/title>/i);
            const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/i);
            const durationMatch = itemXml.match(/<itunes:duration>(\d+)<\/itunes:duration>/i);
            const imageMatch = itemXml.match(/<itunes:image[^>]+href="([^"]+)"/i);
            
            // Get feed info for artist name
            const feedTitleMatch = feedXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || feedXml.match(/<title>(.*?)<\/title>/i);
            const feedImageMatch = feedXml.match(/<itunes:image[^>]+href="([^"]+)"/i);
            
            if (titleMatch && enclosureMatch) {
              console.log('🎵 Successfully resolved V4V track:', titleMatch[1]);
              
              return NextResponse.json({
                success: true,
                track: {
                  title: titleMatch[1],
                  artist: feedTitleMatch ? feedTitleMatch[1] : 'The Doerfels',
                  audioUrl: enclosureMatch[1],
                  duration: durationMatch ? parseInt(durationMatch[1]) : 0,
                  image: imageMatch ? imageMatch[1] : feedImageMatch ? feedImageMatch[1] : null,
                  feedTitle: feedTitleMatch ? feedTitleMatch[1] : 'Music from the Doerfel-Verse',
                  episodeGuid: itemGuid,
                  feedGuid,
                  resolved: true
                }
              });
            }
          }
        }
      } catch (directError) {
        console.error('Error fetching known feed directly:', directError);
      }
    }

    // If not a known feed or direct fetch failed, try Podcast Index
    try {
      // First try to get feed info by feedGuid 
      const feedResponse = await fetch(
        `${request.nextUrl.origin}/api/podcastindex?guid=${encodeURIComponent(feedGuid)}`
      );
      
      if (feedResponse.ok) {
        const feedXml = await feedResponse.text();
        console.log('Feed XML length:', feedXml.length);
        
        // Parse feed title from XML (simple extraction)
        const titleMatch = feedXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
        const feedTitle = titleMatch ? titleMatch[1] : 'Unknown Feed';
        
        // Now try to get episode by itemGuid
        const episodeResponse = await fetch(
          `${request.nextUrl.origin}/api/podcastindex?guid=${encodeURIComponent(itemGuid)}`
        );
        
        if (episodeResponse.ok) {
          const episodeXml = await episodeResponse.text();
          console.log('Episode XML length:', episodeXml.length);
          
          // Parse episode info from XML
          const episodeTitleMatch = episodeXml.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const enclosureMatch = episodeXml.match(/<enclosure url="([^"]+)"/);
          const durationMatch = episodeXml.match(/<itunes:duration>(\d+)<\/itunes:duration>/);
          const imageMatch = episodeXml.match(/<itunes:image href="([^"]+)"/);
          
          if (episodeTitleMatch && enclosureMatch) {
            return NextResponse.json({
              success: true,
              track: {
                title: episodeTitleMatch[1],
                artist: feedTitle,
                audioUrl: enclosureMatch[1],
                duration: durationMatch ? parseInt(durationMatch[1]) : 0,
                image: imageMatch ? imageMatch[1] : null,
                feedTitle,
                episodeGuid: itemGuid,
                feedGuid
              }
            });
          }
        }
      }
      
      // If we get here, the GUIDs weren't found in Podcast Index
      return NextResponse.json({
        success: false,
        message: 'Track not found in Podcast Index. This might be a V4V remoteItem reference to a feed that is not in the Podcast Index database.',
        feedGuid,
        itemGuid
      });
      
    } catch (proxyError) {
      console.error('Error using podcastindex proxy:', proxyError);
      
      // Return a more helpful error message
      return NextResponse.json({
        success: false,
        message: 'Unable to resolve track. This V4V remoteItem may reference a feed not in the Podcast Index database.',
        feedGuid,
        itemGuid,
        error: proxyError instanceof Error ? proxyError.message : String(proxyError)
      });
    }

  } catch (error) {
    console.error('Error resolving music track:', error);
    return NextResponse.json(
      {
        error: 'Failed to resolve music track'
      },
      { status: 500 }
    );
  }
}