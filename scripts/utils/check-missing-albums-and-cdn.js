const axios = require('axios');
const xml2js = require('xml2js');

// Extract titleToFeedMap from AlbumDetailClient.tsx (lines 263-320)
const titleToFeedMap = {
  'into the doerfel-verse': 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
  'into the doerfelverse': 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
  'music from the doerfel-verse': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'music-from-the-doerfel-verse': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'music from the doerfelverse': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'bloodshot lies': 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
  'bloodshot lies album': 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
  'wrath of banjo': 'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml',
  'beware of banjo': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/07/Beware-of-Banjo.xml',
  'ben doerfel': 'https://www.doerfelverse.com/feeds/ben-doerfel.xml',
  '18 sundays': 'https://www.doerfelverse.com/feeds/18sundays.xml',
  'alandace': 'https://www.doerfelverse.com/feeds/alandace.xml',
  'autumn': 'https://www.doerfelverse.com/feeds/autumn.xml',
  'christ exalted': 'https://www.doerfelverse.com/feeds/christ-exalted.xml',
  'come back to me': 'https://www.doerfelverse.com/feeds/come-back-to-me.xml',
  'dead time live 2016': 'https://www.doerfelverse.com/feeds/dead-time-live-2016.xml',
  'dfb v1': 'https://www.doerfelverse.com/feeds/dfbv1.xml',
  'dfb v2': 'https://www.doerfelverse.com/feeds/dfbv2.xml',
  'disco swag': 'https://www.doerfelverse.com/feeds/disco-swag.xml',
  'doerfels pubfeed': 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'first married christmas': 'https://www.doerfelverse.com/feeds/first-married-christmas.xml',
  'generation gap': 'https://www.doerfelverse.com/feeds/generation-gap.xml',
  'heartbreak': 'https://www.doerfelverse.com/feeds/heartbreak.xml',
  'merry christmix': 'https://www.doerfelverse.com/feeds/merry-christmix.xml',
  'middle season let go': 'https://www.doerfelverse.com/feeds/middle-season-let-go.xml',
  'phatty the grasshopper': 'https://www.doerfelverse.com/feeds/phatty-the-grasshopper.xml',
  'possible': 'https://www.doerfelverse.com/feeds/possible.xml',
  'pour over': 'https://www.doerfelverse.com/feeds/pour-over.xml',
  'psalm 54': 'https://www.doerfelverse.com/feeds/psalm-54.xml',
  'sensitive guy': 'https://www.doerfelverse.com/feeds/sensitive-guy.xml',
  'they dont know': 'https://www.doerfelverse.com/feeds/they-dont-know.xml',
  'think ep': 'https://www.doerfelverse.com/feeds/think-ep.xml',
  'underwater single': 'https://www.doerfelverse.com/feeds/underwater-single.xml',
  'unsound existence': 'https://www.doerfelverse.com/feeds/unsound-existence.xml',
  'you are my world': 'https://www.doerfelverse.com/feeds/you-are-my-world.xml',
  'you feel like home': 'https://www.doerfelverse.com/feeds/you-feel-like-home.xml',
  'your chance': 'https://www.doerfelverse.com/feeds/your-chance.xml',
  'nostalgic': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml',
  'citybeach': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/CityBeach.xml',
  'kurtisdrums v1': 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml',
  'ring that bell': 'https://www.thisisjdog.com/media/ring-that-bell.xml',
  'tinderbox': 'https://wavlake.com/feed/music/d677db67-0310-4813-970e-e65927c689f1',
  'nate johnivan': 'https://wavlake.com/feed/music/e678589b-5a9f-4918-9622-34119d2eed2c',
  'fountain artist takeover': 'https://wavlake.com/feed/music/6dc5c681-8beb-4193-93a3-d405c962d103',
  'fountain-artist-takeover': 'https://wavlake.com/feed/music/6dc5c681-8beb-4193-93a3-d405c962d103',
  'fountain artist takeover nate johnivan': 'https://wavlake.com/feed/music/6dc5c681-8beb-4193-93a3-d405c962d103',
  'fountain-artist-takeover-nate-johnivan': 'https://wavlake.com/feed/music/6dc5c681-8beb-4193-93a3-d405c962d103',
  'empty passenger seat': 'https://www.wavlake.com/feed/95ea253a-4058-402c-8503-204f6d3f1494',
  'joe martin': 'https://www.wavlake.com/feed/95ea253a-4058-402c-8503-204f6d3f1494',
  'stay awhile': 'https://ableandthewolf.com/static/media/feed.xml',
  'now i feel it': 'https://music.behindthesch3m3s.com/wp-content/uploads/c_kostra/now i feel it.xml',
  'they ride': 'https://wavlake.com/feed/music/997060e3-9dc1-4cd8-b3c1-3ae06d54bb03',
  'more': 'https://wavlake.com/feed/music/b54b9a19-b6ed-46c1-806c-7e82f7550edc',
  'opus': 'https://www.doerfelverse.com/artists/opus/opus/opus.xml'
};

// Extract all feed URLs from lines 340-430
const allFeedUrls = [
  // Main Doerfels feeds
  'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
  'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
  'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml',
  'https://www.doerfelverse.com/feeds/ben-doerfel.xml',
  
  // Additional Doerfels albums and projects
  'https://www.doerfelverse.com/feeds/18sundays.xml',
  'https://www.doerfelverse.com/feeds/alandace.xml',
  'https://www.doerfelverse.com/feeds/autumn.xml',
  'https://www.doerfelverse.com/feeds/christ-exalted.xml',
  'https://www.doerfelverse.com/feeds/come-back-to-me.xml',
  'https://www.doerfelverse.com/feeds/dead-time-live-2016.xml',
  'https://www.doerfelverse.com/feeds/dfbv1.xml',
  'https://www.doerfelverse.com/feeds/dfbv2.xml',
  'https://www.doerfelverse.com/feeds/disco-swag.xml',
  'https://re.podtards.com/api/feeds/doerfels-pubfeed',
  'https://www.doerfelverse.com/feeds/first-married-christmas.xml',
  'https://www.doerfelverse.com/feeds/generation-gap.xml',
  'https://www.doerfelverse.com/feeds/heartbreak.xml',
  'https://www.doerfelverse.com/feeds/merry-christmix.xml',
  'https://www.doerfelverse.com/feeds/middle-season-let-go.xml',
  'https://www.doerfelverse.com/feeds/phatty-the-grasshopper.xml',
  'https://www.doerfelverse.com/feeds/possible.xml',
  'https://www.doerfelverse.com/feeds/pour-over.xml',
  'https://www.doerfelverse.com/feeds/psalm-54.xml',
  'https://www.doerfelverse.com/feeds/sensitive-guy.xml',
  'https://www.doerfelverse.com/feeds/they-dont-know.xml',
  'https://www.doerfelverse.com/feeds/think-ep.xml',
  'https://www.doerfelverse.com/feeds/underwater-single.xml',
  'https://www.doerfelverse.com/feeds/unsound-existence.xml',
  'https://www.doerfelverse.com/feeds/you-are-my-world.xml',
  'https://www.doerfelverse.com/feeds/you-feel-like-home.xml',
  'https://www.doerfelverse.com/feeds/your-chance.xml',
  
  // Ed Doerfel (Shredward) projects
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/CityBeach.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/07/Beware-of-Banjo.xml',
  
  // TJ Doerfel projects
  'https://www.thisisjdog.com/media/ring-that-bell.xml',
  
  // External artists
  'https://ableandthewolf.com/static/media/feed.xml',
  'https://static.staticsave.com/mspfiles/deathdreams.xml',
  'https://static.staticsave.com/mspfiles/waytogo.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/c_kostra/now i feel it.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Pilot/pilot.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Radio_Brigade/radio_brigade.xml',
  
  // Wavlake feeds - Nate Johnivan collection
  'https://wavlake.com/feed/music/d677db67-0310-4813-970e-e65927c689f1',
  'https://wavlake.com/feed/artist/aa909244-7555-4b52-ad88-7233860c6fb4',
  'https://wavlake.com/feed/music/e678589b-5a9f-4918-9622-34119d2eed2c',
  'https://wavlake.com/feed/music/3a152941-c914-43da-aeca-5d7c58892a7f',
  'https://wavlake.com/feed/music/a97e0586-ecda-4b79-9c38-be9a9effe05a',
  'https://wavlake.com/feed/music/0ed13237-aca9-446f-9a03-de1a2d9331a3',
  'https://wavlake.com/feed/music/ce8c4910-51bf-4d5e-a0b3-338e58e5ee79',
  'https://wavlake.com/feed/music/acb43f23-cfec-4cc1-a418-4087a5378129',
  'https://wavlake.com/feed/music/d1a871a7-7e4c-4a91-b799-87dcbb6bc41d',
  'https://wavlake.com/feed/music/3294d8b5-f9f6-4241-a298-f04df818390c',
  'https://wavlake.com/feed/music/d3145292-bf71-415f-a841-7f5c9a9466e1',
  'https://wavlake.com/feed/music/91367816-33e6-4b6e-8eb7-44b2832708fd',
  'https://wavlake.com/feed/music/8c8f8133-7ef1-4b72-a641-4e1a6a44d626',
  'https://wavlake.com/feed/music/9720d58b-22a5-4047-81de-f1940fec41c7',
  'https://wavlake.com/feed/music/21536269-5192-49e7-a819-fab00f4a159e',
  'https://wavlake.com/feed/music/624b19ac-5d8b-4fd6-8589-0eef7bcb9c9e',
  
  // Joe Martin (Wavlake) - Complete collection
  'https://www.wavlake.com/feed/95ea253a-4058-402c-8503-204f6d3f1494',
  'https://wavlake.com/feed/artist/18bcbf10-6701-4ffb-b255-bc057390d738',
  
  // IROH (Wavlake) - Publisher feed
  'https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a',
  'https://wavlake.com/feed/music/1c7917cc-357c-4eaf-ab54-1a7cda504976',
  'https://wavlake.com/feed/music/e1f9dfcb-ee9b-4a6d-aee7-189043917fb5',
  'https://wavlake.com/feed/music/d4f791c3-4d0c-4fbd-a543-c136ee78a9de',
  'https://wavlake.com/feed/music/51606506-66f8-4394-b6c6-cc0c1b554375',
  'https://wavlake.com/feed/music/6b7793b8-fd9d-432b-af1a-184cd41aaf9d',
  'https://wavlake.com/feed/music/0bb8c9c7-1c55-4412-a517-572a98318921',
  'https://wavlake.com/feed/music/16e46ed0-b392-4419-a937-a7815f6ca43b',
  'https://wavlake.com/feed/music/2cd1b9ea-9ef3-4a54-aa25-55295689f442',
  'https://wavlake.com/feed/music/33eeda7e-8591-4ff5-83f8-f36a879b0a09',
  'https://wavlake.com/feed/music/32a79df8-ec3e-4a14-bfcb-7a074e1974b9',
  'https://wavlake.com/feed/music/06376ab5-efca-459c-9801-49ceba5fdab1',
  
  // Additional feeds not in the main list
  'https://www.doerfelverse.com/artists/opus/opus/opus.xml'
];

// Feeds from upload-rss-to-cdn-direct.js that are synced to Bunny
const bunnySyncedFeeds = [
  'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
  'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
  'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
  'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml',
  'https://www.doerfelverse.com/feeds/ben-doerfel.xml',
  'https://www.doerfelverse.com/feeds/18sundays.xml',
  'https://www.doerfelverse.com/feeds/alandace.xml',
  'https://www.doerfelverse.com/feeds/autumn.xml',
  'https://www.doerfelverse.com/feeds/christ-exalted.xml',
  'https://www.doerfelverse.com/feeds/come-back-to-me.xml',
  'https://www.doerfelverse.com/feeds/dead-time-live-2016.xml',
  'https://www.doerfelverse.com/feeds/dfbv1.xml',
  'https://www.doerfelverse.com/feeds/dfbv2.xml',
  'https://www.doerfelverse.com/feeds/disco-swag.xml',
  'https://www.doerfelverse.com/feeds/doerfels-pubfeed.xml',
  'https://www.doerfelverse.com/feeds/first-married-christmas.xml',
  'https://www.doerfelverse.com/feeds/generation-gap.xml',
  'https://www.doerfelverse.com/feeds/heartbreak.xml',
  'https://www.doerfelverse.com/feeds/merry-christmix.xml',
  'https://www.doerfelverse.com/feeds/middle-season-let-go.xml',
  'https://www.doerfelverse.com/feeds/phatty-the-grasshopper.xml',
  'https://www.doerfelverse.com/feeds/possible.xml',
  'https://www.doerfelverse.com/feeds/pour-over.xml',
  'https://www.doerfelverse.com/feeds/psalm-54.xml',
  'https://www.doerfelverse.com/feeds/sensitive-guy.xml',
  'https://www.doerfelverse.com/feeds/they-dont-know.xml',
  'https://www.doerfelverse.com/feeds/think-ep.xml',
  'https://www.doerfelverse.com/feeds/underwater-single.xml',
  'https://www.doerfelverse.com/feeds/unsound-existence.xml',
  'https://www.doerfelverse.com/feeds/you-are-my-world.xml',
  'https://www.doerfelverse.com/feeds/you-feel-like-home.xml',
  'https://www.doerfelverse.com/feeds/your-chance.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/CityBeach.xml',
  'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml',
  'https://www.thisisjdog.com/media/ring-that-bell.xml',
  'https://ableandthewolf.com/static/media/feed.xml',
  'https://static.staticsave.com/mspfiles/deathdreams.xml',
  'https://static.staticsave.com/mspfiles/waytogo.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/c_kostra/now%20i%20feel%20it.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Pilot/pilot.xml',
  'https://music.behindthesch3m3s.com/wp-content/uploads/Mellow%20Cassette/Radio_Brigade/radio_brigade.xml'
];

// Get unique feeds
const uniqueFeeds = [...new Set(allFeedUrls)];

// Function to fetch and parse RSS feed
async function fetchFeed(url) {
  try {
    console.log(`Fetching: ${url}`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(response.data);
    
    // Extract album title from different feed formats
    let title = null;
    let artist = null;
    
    if (result.rss && result.rss.channel) {
      title = result.rss.channel.title;
      
      // Try to get artist from various fields
      if (result.rss.channel['itunes:author']) {
        artist = result.rss.channel['itunes:author'];
      } else if (result.rss.channel.author) {
        artist = result.rss.channel.author;
      } else if (result.rss.channel['podcast:person']) {
        artist = result.rss.channel['podcast:person']._ || result.rss.channel['podcast:person'];
      }
    }
    
    return { url, title, artist, success: true };
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return { url, title: null, artist: null, success: false, error: error.message };
  }
}

// Convert title to various slug formats
function generateSlugs(title) {
  if (!title) return [];
  
  const lower = title.toLowerCase();
  const slugs = [
    lower,
    lower.replace(/\s+/g, '-'),
    lower.replace(/\s+/g, ''),
    lower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-'),
    lower.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  ];
  
  // Add variations without "the" prefix
  if (lower.startsWith('the ')) {
    const withoutThe = lower.substring(4);
    slugs.push(withoutThe);
    slugs.push(withoutThe.replace(/\s+/g, '-'));
  }
  
  return [...new Set(slugs)];
}

// Check if album is mapped
function isAlbumMapped(title) {
  if (!title) return false;
  
  const slugs = generateSlugs(title);
  const mappedTitles = Object.keys(titleToFeedMap);
  
  return slugs.some(slug => mappedTitles.includes(slug));
}

// Check if feed is synced to Bunny
function isFeedSyncedToBunny(url) {
  return bunnySyncedFeeds.includes(url);
}

// Main function
async function checkMissingAlbumsAndCdn() {
  console.log('Checking RSS feeds for missing albums and CDN sync status...\n');
  
  const results = [];
  const missingAlbums = [];
  const unsyncedFeeds = [];
  
  // Process feeds in batches to avoid overwhelming the servers
  const batchSize = 5;
  for (let i = 0; i < uniqueFeeds.length; i += batchSize) {
    const batch = uniqueFeeds.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFeed));
    results.push(...batchResults);
    
    // Small delay between batches
    if (i + batchSize < uniqueFeeds.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Check for missing albums and unsynced feeds
  for (const result of results) {
    if (result.success && result.title) {
      const isMapped = isAlbumMapped(result.title);
      const isSynced = isFeedSyncedToBunny(result.url);
      
      if (!isMapped) {
        missingAlbums.push({
          title: result.title,
          artist: result.artist || 'Unknown',
          feedUrl: result.url,
          suggestedSlug: result.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          isSyncedToBunny: isSynced
        });
      }
      
      if (!isSynced) {
        unsyncedFeeds.push({
          title: result.title,
          feedUrl: result.url,
          isMapped: isMapped
        });
      }
    }
  }
  
  // Output results
  console.log('\n=== MISSING ALBUMS FROM titleToFeedMap ===\n');
  
  if (missingAlbums.length === 0) {
    console.log('✅ All albums are mapped!');
  } else {
    console.log(`Found ${missingAlbums.length} unmapped albums:\n`);
    
    missingAlbums.forEach((album, index) => {
      console.log(`${index + 1}. "${album.title}" by ${album.artist}`);
      console.log(`   Feed URL: ${album.feedUrl}`);
      console.log(`   Suggested slug: '${album.suggestedSlug}'`);
      console.log(`   Bunny CDN: ${album.isSyncedToBunny ? '✅ Synced' : '❌ Not synced'}`);
      console.log(`   Add to titleToFeedMap:`);
      console.log(`   '${album.suggestedSlug}': '${album.feedUrl}',\n`);
    });
  }
  
  // Output unsynced feeds
  console.log('\n=== FEEDS NOT SYNCED TO BUNNY CDN ===\n');
  
  if (unsyncedFeeds.length === 0) {
    console.log('✅ All feeds are synced to Bunny CDN!');
  } else {
    console.log(`Found ${unsyncedFeeds.length} unsynced feeds:\n`);
    
    unsyncedFeeds.forEach((feed, index) => {
      console.log(`${index + 1}. "${feed.title}"`);
      console.log(`   Feed URL: ${feed.feedUrl}`);
      console.log(`   Mapped: ${feed.isMapped ? '✅ Yes' : '❌ No'}\n`);
    });
    
    // Generate code snippet to add to upload-rss-to-cdn-direct.js
    console.log('\n=== ADD THESE TO upload-rss-to-cdn-direct.js RSS_FEEDS array ===\n');
    unsyncedFeeds.forEach(feed => {
      console.log(`  '${feed.feedUrl}',`);
    });
  }
  
  // Summary statistics
  console.log('\n=== SUMMARY ===');
  console.log(`Total feeds checked: ${uniqueFeeds.length}`);
  console.log(`Successful fetches: ${results.filter(r => r.success).length}`);
  console.log(`Failed fetches: ${results.filter(r => !r.success).length}`);
  console.log(`Albums found: ${results.filter(r => r.success && r.title).length}`);
  console.log(`Missing from titleToFeedMap: ${missingAlbums.length}`);
  console.log(`Not synced to Bunny CDN: ${unsyncedFeeds.length}`);
  
  // List failed feeds
  const failedFeeds = results.filter(r => !r.success);
  if (failedFeeds.length > 0) {
    console.log('\n=== FAILED FEEDS ===');
    failedFeeds.forEach(feed => {
      console.log(`❌ ${feed.url}`);
      console.log(`   Error: ${feed.error}\n`);
    });
  }
}

// Run the check
checkMissingAlbumsAndCdn().catch(console.error);