// Test script to check background loading for multiple albums from different RSS feeds
const https = require('https');

console.log('🔍 Testing background loading for multiple albums from different feeds...\n');

// Test albums from different feed sources
const testAlbums = [
  {
    name: 'Stay Awhile',
    artist: 'Able and The Wolf',
    feedUrl: 'https://ableandthewolf.com/static/media/feed.xml',
    expectedSlug: 'stay-awhile'
  },
  {
    name: 'Bloodshot Lies',
    artist: 'Doerfels',
    feedUrl: 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml',
    expectedSlug: 'bloodshot-lies'
  },
  {
    name: 'Music From The Doerfel-Verse',
    artist: 'Doerfels',
    feedUrl: 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml',
    expectedSlug: 'music-from-the-doerfel-verse'
  },
  {
    name: 'Into The Doerfel-Verse',
    artist: 'Doerfels',
    feedUrl: 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    expectedSlug: 'into-the-doerfel-verse'
  },
  {
    name: 'Wrath of Banjo',
    artist: 'Doerfels',
    feedUrl: 'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml',
    expectedSlug: 'wrath-of-banjo'
  },
  {
    name: 'Nostalgic',
    artist: 'Shredward',
    feedUrl: 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml',
    expectedSlug: 'nostalgic'
  },
  {
    name: 'Ring That Bell',
    artist: 'J Dog',
    feedUrl: 'https://www.thisisjdog.com/media/ring-that-bell.xml',
    expectedSlug: 'ring-that-bell'
  },
  {
    name: 'Tinderbox',
    artist: 'Nate Johnivan',
    feedUrl: 'https://wavlake.com/feed/music/d677db67-0310-4813-970e-e65927c689f1',
    expectedSlug: 'tinderbox'
  },
  {
    name: 'Empty Passenger Seat',
    artist: 'Joe Martin',
    feedUrl: 'https://www.wavlake.com/feed/95ea253a-4058-402c-8503-204f6d3f1494',
    expectedSlug: 'empty-passenger-seat'
  },
  {
    name: 'They Ride',
    artist: 'IROH',
    feedUrl: 'https://wavlake.com/feed/music/997060e3-9dc1-4cd8-b3c1-3ae06d54bb03',
    expectedSlug: 'they-ride'
  }
];

// Test RSS feed parsing
const testRSSFeed = (feedUrl, albumName) => {
  return new Promise((resolve, reject) => {
    https.get(feedUrl, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Extract album info from RSS feed
          const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
          const authorMatch = data.match(/<itunes:author[^>]*>([^<]+)<\/itunes:author>/i) ||
                             data.match(/<author[^>]*>([^<]+)<\/author>/i);
          const imageMatch = data.match(/<itunes:image[^>]*href="([^"]+)"/i) ||
                            data.match(/<image[^>]*>.*?<url[^>]*>([^<]+)<\/url>/is);
          
          if (titleMatch && authorMatch) {
            const albumInfo = {
              title: titleMatch[1].trim(),
              artist: authorMatch[1].trim(),
              coverArt: imageMatch ? imageMatch[1].trim() : null
            };
            
            console.log(`✅ ${albumName}: Found album info:`, albumInfo);
            resolve(albumInfo);
          } else {
            console.log(`❌ ${albumName}: Could not extract album info from RSS feed`);
            reject(new Error('Could not extract album info'));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      console.log(`❌ ${albumName}: RSS feed error:`, error.message);
      reject(error);
    });
  });
};

// Test background image URL
const testBackgroundImage = (imageUrl, albumName) => {
  return new Promise((resolve, reject) => {
    if (!imageUrl) {
      console.log(`⚠️ ${albumName}: No background image URL found`);
      resolve(false);
      return;
    }
    
    https.get(imageUrl, (res) => {
      console.log(`🖼️ ${albumName}: Background image test:`);
      console.log(`  - Status: ${res.statusCode}`);
      console.log(`  - Content-Type: ${res.headers['content-type']}`);
      console.log(`  - CORS: ${res.headers['access-control-allow-origin'] || 'Not set'}`);
      
      if (res.statusCode === 200) {
        console.log(`✅ ${albumName}: Background image is accessible`);
        resolve(true);
      } else {
        console.log(`❌ ${albumName}: Background image returned status: ${res.statusCode}`);
        reject(new Error(`Image returned status ${res.statusCode}`));
      }
    }).on('error', (error) => {
      console.log(`❌ ${albumName}: Background image error: ${error.message}`);
      reject(error);
    });
  });
};

// Test album page URL
const testAlbumPage = (albumSlug, albumName) => {
  return new Promise((resolve, reject) => {
    const pageUrl = `https://re.podtards.com/album/${albumSlug}`;
    
    https.get(pageUrl, (res) => {
      console.log(`🌐 ${albumName}: Album page test:`);
      console.log(`  - URL: ${pageUrl}`);
      console.log(`  - Status: ${res.statusCode}`);
      
      if (res.statusCode === 200) {
        console.log(`✅ ${albumName}: Album page is accessible`);
        resolve(true);
      } else {
        console.log(`❌ ${albumName}: Album page returned status: ${res.statusCode}`);
        reject(new Error(`Page returned status ${res.statusCode}`));
      }
    }).on('error', (error) => {
      console.log(`❌ ${albumName}: Album page error: ${error.message}`);
      reject(error);
    });
  });
};

// Run tests for all albums
async function runAllTests() {
  console.log(`🎯 Testing ${testAlbums.length} albums from different feed sources...\n`);
  
  const results = {
    total: testAlbums.length,
    successful: 0,
    failed: 0,
    details: []
  };
  
  for (const album of testAlbums) {
    try {
      console.log(`\n📡 Testing: ${album.name} by ${album.artist}`);
      console.log('=' .repeat(50));
      
      // Test 1: RSS feed parsing
      const albumInfo = await testRSSFeed(album.feedUrl, album.name);
      
      // Test 2: Background image
      const hasBackground = await testBackgroundImage(albumInfo.coverArt, album.name);
      
      // Test 3: Album page
      await testAlbumPage(album.expectedSlug, album.name);
      
      results.successful++;
      results.details.push({
        album: album.name,
        artist: album.artist,
        status: 'success',
        hasBackground: hasBackground,
        coverArt: albumInfo.coverArt
      });
      
      console.log(`✅ ${album.name}: All tests passed!`);
      
    } catch (error) {
      results.failed++;
      results.details.push({
        album: album.name,
        artist: album.artist,
        status: 'failed',
        error: error.message
      });
      
      console.log(`❌ ${album.name}: Test failed - ${error.message}`);
    }
    
    // Add delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Print summary
  console.log('\n📊 Test Summary:');
  console.log('================');
  console.log(`✅ Successful: ${results.successful}/${results.total}`);
  console.log(`❌ Failed: ${results.failed}/${results.total}`);
  
  if (results.successful > 0) {
    console.log('\n🎨 Albums with background images:');
    results.details
      .filter(d => d.status === 'success' && d.hasBackground)
      .forEach(d => {
        console.log(`  - ${d.album} by ${d.artist}`);
      });
  }
  
  if (results.failed > 0) {
    console.log('\n❌ Failed albums:');
    results.details
      .filter(d => d.status === 'failed')
      .forEach(d => {
        console.log(`  - ${d.album} by ${d.artist}: ${d.error}`);
      });
  }
  
  console.log('\n🎯 Background loading fix status:');
  if (results.successful === results.total) {
    console.log('✅ All albums should have working background images!');
  } else {
    console.log('⚠️ Some albums may have background loading issues.');
  }
}

runAllTests(); 