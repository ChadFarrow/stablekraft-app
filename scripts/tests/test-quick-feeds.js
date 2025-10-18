// Quick test to check a few key feeds for background loading issues
const https = require('https');

console.log('🔍 Quick test of key feeds for background loading...\n');

// Test just a few key feeds
const testFeeds = [
  {
    name: 'Bloodshot Lies',
    feedUrl: 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml'
  },
  {
    name: 'Music From The Doerfel-Verse',
    feedUrl: 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml'
  },
  {
    name: 'Nostalgic',
    feedUrl: 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml'
  },
  {
    name: 'Ring That Bell',
    feedUrl: 'https://www.thisisjdog.com/media/ring-that-bell.xml'
  }
];

// Quick RSS feed test
const testRSSFeed = (feedUrl, albumName) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 10000); // 10 second timeout
    
    https.get(feedUrl, (res) => {
      clearTimeout(timeout);
      
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Quick extraction of key info
          const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
          const imageMatch = data.match(/<itunes:image[^>]*href="([^"]+)"/i) ||
                            data.match(/<image[^>]*>.*?<url[^>]*>([^<]+)<\/url>/is);
          
          const result = {
            title: titleMatch ? titleMatch[1].trim() : 'Unknown',
            coverArt: imageMatch ? imageMatch[1].trim() : null,
            hasImage: !!imageMatch
          };
          
          console.log(`✅ ${albumName}: ${result.title} - Has image: ${result.hasImage}`);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
};

// Quick image test
const testImage = (imageUrl, albumName) => {
  return new Promise((resolve) => {
    if (!imageUrl) {
      console.log(`⚠️ ${albumName}: No image URL`);
      resolve(false);
      return;
    }
    
    const timeout = setTimeout(() => {
      console.log(`⏰ ${albumName}: Image test timeout`);
      resolve(false);
    }, 5000);
    
    https.get(imageUrl, (res) => {
      clearTimeout(timeout);
      if (res.statusCode === 200) {
        console.log(`✅ ${albumName}: Image accessible (${res.headers['content-type']})`);
        resolve(true);
      } else {
        console.log(`❌ ${albumName}: Image failed (${res.statusCode})`);
        resolve(false);
      }
    }).on('error', (error) => {
      clearTimeout(timeout);
      console.log(`❌ ${albumName}: Image error - ${error.message}`);
      resolve(false);
    });
  });
};

// Run quick tests
async function runQuickTests() {
  console.log('🚀 Running quick tests...\n');
  
  for (const feed of testFeeds) {
    try {
      console.log(`📡 Testing: ${feed.name}`);
      const result = await testRSSFeed(feed.feedUrl, feed.name);
      
      if (result.hasImage) {
        await testImage(result.coverArt, feed.name);
      }
      
      console.log('---');
    } catch (error) {
      console.log(`❌ ${feed.name}: Failed - ${error.message}`);
      console.log('---');
    }
  }
  
  console.log('✅ Quick tests completed!');
}

runQuickTests(); 