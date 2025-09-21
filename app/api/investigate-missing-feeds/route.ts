import { NextResponse } from 'next/server';
import crypto from 'crypto';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': 'FUCKIT-Feed-Investigator/1.0',
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;
    
    console.log(`🔍 Looking up feed GUID: ${guid}`);
    
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      console.log(`❌ API error for ${guid}: ${response.status}`);
      return {
        guid,
        found: false,
        error: `HTTP ${response.status}`,
        details: null
      };
    }
    
    const data = await response.json();
    
    if (data.status === 'true' && data.feed) {
      console.log(`✅ Found feed: ${data.feed.title} - ${data.feed.url}`);
      return {
        guid,
        found: true,
        error: null,
        details: {
          id: data.feed.id,
          title: data.feed.title,
          description: data.feed.description,
          url: data.feed.url,
          link: data.feed.link,
          image: data.feed.image,
          author: data.feed.author,
          ownerName: data.feed.ownerName,
          type: data.feed.type,
          dead: data.feed.dead,
          episodeCount: data.feed.episodeCount,
          crawlErrors: data.feed.crawlErrors,
          parseErrors: data.feed.parseErrors,
          lastUpdateTime: data.feed.lastUpdateTime,
          lastCrawlTime: data.feed.lastCrawlTime,
          lastParseTime: data.feed.lastParseTime,
          lastGoodHttpStatusTime: data.feed.lastGoodHttpStatusTime,
          lastHttpStatus: data.feed.lastHttpStatus,
          contentType: data.feed.contentType,
          language: data.feed.language
        }
      };
    } else {
      console.log(`⚠️ No feed found for GUID: ${guid}`);
      return {
        guid,
        found: false,
        error: 'Not found in Podcast Index',
        details: null
      };
    }
  } catch (error) {
    console.error(`❌ Error looking up ${guid}:`, error);
    return {
      guid,
      found: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: null
    };
  }
}

async function testFeedUrl(url: string) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'FUCKIT-Feed-Tester/1.0'
      }
    });
    
    return {
      accessible: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      lastModified: response.headers.get('last-modified')
    };
  } catch (error) {
    return {
      accessible: false,
      status: 0,
      contentType: null,
      lastModified: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function POST(request: Request) {
  try {
    const { guids } = await request.json();
    
    if (!guids || !Array.isArray(guids)) {
      return NextResponse.json(
        { error: 'Please provide an array of GUIDs to investigate' },
        { status: 400 }
      );
    }

    console.log(`🔍 Investigating ${guids.length} missing feed GUIDs...`);
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }
    
    const results = [];
    
    for (let i = 0; i < guids.length; i++) {
      const guid = guids[i];
      
      console.log(`📊 Progress: ${i + 1}/${guids.length} - ${guid}`);
      
      // Look up the feed in Podcast Index
      const lookupResult = await lookupFeedByGuid(guid);
      
      // If found, test if the feed URL is accessible
      let urlTest = null;
      if (lookupResult.found && lookupResult.details?.url) {
        urlTest = await testFeedUrl(lookupResult.details.url);
      }
      
      results.push({
        ...lookupResult,
        urlTest
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Categorize results
    const found = results.filter(r => r.found);
    const notFound = results.filter(r => !r.found);
    const deadFeeds = found.filter(r => r.details?.dead === 1);
    const accessibleFeeds = found.filter(r => r.urlTest?.accessible === true);
    const inaccessibleFeeds = found.filter(r => r.urlTest?.accessible === false);
    
    console.log(`✅ Investigation complete:`);
    console.log(`  - Found in Index: ${found.length}`);
    console.log(`  - Not found: ${notFound.length}`);
    console.log(`  - Dead feeds: ${deadFeeds.length}`);
    console.log(`  - Accessible: ${accessibleFeeds.length}`);
    console.log(`  - Inaccessible: ${inaccessibleFeeds.length}`);
    
    return NextResponse.json({
      success: true,
      summary: {
        total: guids.length,
        found: found.length,
        notFound: notFound.length,
        deadFeeds: deadFeeds.length,
        accessible: accessibleFeeds.length,
        inaccessible: inaccessibleFeeds.length
      },
      results,
      categories: {
        found,
        notFound,
        deadFeeds,
        accessibleFeeds,
        inaccessibleFeeds
      }
    });
    
  } catch (error) {
    console.error('❌ Error investigating feeds:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}