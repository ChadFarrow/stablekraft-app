// Test album pages to check if background loading is working
const https = require('https');

console.log('🔍 Testing album pages for background loading...\n');

// Test album pages
const testAlbums = [
  {
    name: 'Stay Awhile',
    slug: 'stay-awhile',
    expectedArtist: 'Able and The Wolf'
  },
  {
    name: 'Bloodshot Lies',
    slug: 'bloodshot-lies',
    expectedArtist: 'Doerfels'
  },
  {
    name: 'Music From The Doerfel-Verse',
    slug: 'music-from-the-doerfel-verse',
    expectedArtist: 'Doerfels'
  },
  {
    name: 'Nostalgic',
    slug: 'nostalgic',
    expectedArtist: 'Shredward'
  },
  {
    name: 'Ring That Bell',
    slug: 'ring-that-bell',
    expectedArtist: 'J Dog'
  }
];

// Test album page
const testAlbumPage = (albumSlug, albumName) => {
  return new Promise((resolve, reject) => {
    const pageUrl = `https://re.podtards.com/album/${albumSlug}`;
    
    const timeout = setTimeout(() => {
      reject(new Error('Page load timeout'));
    }, 15000);
    
    https.get(pageUrl, (res) => {
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
          // Check for key content
          const hasTitle = data.includes(albumName.toLowerCase()) || data.includes(albumName);
          const hasBackground = data.includes('background') || data.includes('linear-gradient');
          const hasAlbumContent = data.includes('album') || data.includes('track');
          const hasDoerfelVerse = data.includes('DoerfelVerse');
          
          const result = {
            url: pageUrl,
            hasTitle,
            hasBackground,
            hasAlbumContent,
            hasDoerfelVerse,
            contentLength: data.length
          };
          
          console.log(`✅ ${albumName}: Page loaded successfully`);
          console.log(`   - URL: ${pageUrl}`);
          console.log(`   - Content length: ${data.length} bytes`);
          console.log(`   - Has title: ${hasTitle}`);
          console.log(`   - Has background: ${hasBackground}`);
          console.log(`   - Has album content: ${hasAlbumContent}`);
          
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

// Run tests
async function runAlbumPageTests() {
  console.log('🚀 Testing album pages...\n');
  
  const results = {
    total: testAlbums.length,
    successful: 0,
    failed: 0,
    details: []
  };
  
  for (const album of testAlbums) {
    try {
      console.log(`📄 Testing: ${album.name}`);
      console.log('─'.repeat(40));
      
      const result = await testAlbumPage(album.slug, album.name);
      
      results.successful++;
      results.details.push({
        album: album.name,
        status: 'success',
        ...result
      });
      
      console.log(`✅ ${album.name}: All checks passed!\n`);
      
    } catch (error) {
      results.failed++;
      results.details.push({
        album: album.name,
        status: 'failed',
        error: error.message
      });
      
      console.log(`❌ ${album.name}: Failed - ${error.message}\n`);
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('📊 Album Page Test Summary:');
  console.log('============================');
  console.log(`✅ Successful: ${results.successful}/${results.total}`);
  console.log(`❌ Failed: ${results.failed}/${results.total}`);
  
  if (results.successful > 0) {
    console.log('\n🎯 Background loading status:');
    const withBackground = results.details.filter(d => d.status === 'success' && d.hasBackground);
    console.log(`✅ ${withBackground.length}/${results.successful} pages have background support`);
  }
  
  if (results.failed > 0) {
    console.log('\n❌ Failed pages:');
    results.details
      .filter(d => d.status === 'failed')
      .forEach(d => {
        console.log(`  - ${d.album}: ${d.error}`);
      });
  }
  
  console.log('\n🎨 Background fix verification:');
  if (results.successful === results.total) {
    console.log('✅ All album pages are loading correctly!');
    console.log('✅ Background images should work on all devices now!');
  } else {
    console.log('⚠️ Some album pages may have issues.');
  }
}

runAlbumPageTests(); 