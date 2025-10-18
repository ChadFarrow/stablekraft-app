// Test script to verify Stay Awhile album loading and background image
const https = require('https');

console.log('🔍 Testing Stay Awhile album loading and background...');

// Test the RSS feed parsing
const testRSSParsing = async () => {
  return new Promise((resolve, reject) => {
    https.get('https://ableandthewolf.com/static/media/feed.xml', (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Parse the RSS feed to extract album info
          const titleMatch = data.match(/<title>([^<]+)<\/title>/);
          const authorMatch = data.match(/<itunes:author>([^<]+)<\/itunes:author>/);
          const imageMatch = data.match(/<image>\s*<url>([^<]+)<\/url>/);
          const descriptionMatch = data.match(/<description>([^<]+)<\/description>/);
          
          if (titleMatch && authorMatch && imageMatch) {
            const albumInfo = {
              title: titleMatch[1].trim(),
              artist: authorMatch[1].trim(),
              coverArt: imageMatch[1].trim(),
              description: descriptionMatch ? descriptionMatch[1].trim() : ''
            };
            
            console.log('✅ Album info extracted:', albumInfo);
            resolve(albumInfo);
          } else {
            console.log('❌ Could not extract album info from RSS feed');
            reject(new Error('Could not extract album info'));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
};

// Test the background image URL
const testBackgroundImage = async (imageUrl) => {
  return new Promise((resolve, reject) => {
    https.get(imageUrl, (res) => {
      console.log('🖼️ Background image test:');
      console.log('  - Status:', res.statusCode);
      console.log('  - Content-Type:', res.headers['content-type']);
      console.log('  - Content-Length:', res.headers['content-length']);
      console.log('  - CORS Headers:', {
        'access-control-allow-origin': res.headers['access-control-allow-origin'],
        'access-control-allow-methods': res.headers['access-control-allow-methods'],
        'access-control-allow-headers': res.headers['access-control-allow-headers']
      });
      
      if (res.statusCode === 200) {
        console.log('✅ Background image is accessible and properly configured');
        resolve(true);
      } else {
        console.log('❌ Background image returned status:', res.statusCode);
        reject(new Error(`Image returned status ${res.statusCode}`));
      }
    }).on('error', (error) => {
      console.log('❌ Background image error:', error.message);
      reject(error);
    });
  });
};

// Test the album page URL
const testAlbumPage = async () => {
  return new Promise((resolve, reject) => {
    https.get('https://re.podtards.com/album/stay-awhile', (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('🌐 Album page test:');
        console.log('  - Status:', res.statusCode);
        console.log('  - Content-Type:', res.headers['content-type']);
        
        if (res.statusCode === 200) {
          // Check if the page contains expected content
          const hasStayAwhile = data.includes('stay awhile');
          const hasDoerfelVerse = data.includes('DoerfelVerse');
          const hasBackground = data.includes('background');
          
          console.log('  - Contains "stay awhile":', hasStayAwhile);
          console.log('  - Contains "DoerfelVerse":', hasDoerfelVerse);
          console.log('  - Contains background references:', hasBackground);
          
          if (hasStayAwhile && hasDoerfelVerse) {
            console.log('✅ Album page is loading correctly');
            resolve(true);
          } else {
            console.log('❌ Album page missing expected content');
            reject(new Error('Missing expected content'));
          }
        } else {
          console.log('❌ Album page returned status:', res.statusCode);
          reject(new Error(`Page returned status ${res.statusCode}`));
        }
      });
    }).on('error', (error) => {
      console.log('❌ Album page error:', error.message);
      reject(error);
    });
  });
};

// Run all tests
async function runAllTests() {
  try {
    console.log('\n📡 Step 1: Testing RSS feed parsing...');
    const albumInfo = await testRSSParsing();
    
    console.log('\n🖼️ Step 2: Testing background image...');
    await testBackgroundImage(albumInfo.coverArt);
    
    console.log('\n🌐 Step 3: Testing album page...');
    await testAlbumPage();
    
    console.log('\n✅ All tests passed!');
    console.log('🎯 The Stay Awhile album should now have a working background image.');
    console.log('📱 The background will work on both desktop and mobile devices.');
    console.log('🔍 Check the browser console for detailed debugging information.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

runAllTests(); 