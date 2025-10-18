#!/usr/bin/env node

// Simple RSS parsing test
const testUrl = 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml';

async function testRSSFetch() {
  console.log('🔍 Testing RSS fetch...');
  
  try {
    // Test direct fetch
    console.log('📡 Testing direct fetch...');
    const directResponse = await fetch(testUrl);
    console.log('Direct fetch status:', directResponse.status);
    
    if (directResponse.ok) {
      const directText = await directResponse.text();
      console.log('Direct fetch content length:', directText.length);
      console.log('Direct fetch first 200 chars:', directText.substring(0, 200));
    }
    
    // Test proxy fetch
    console.log('\n📡 Testing proxy fetch...');
    const proxyResponse = await fetch(`http://localhost:3000/api/fetch-rss?url=${encodeURIComponent(testUrl)}`);
    console.log('Proxy fetch status:', proxyResponse.status);
    
    if (proxyResponse.ok) {
      const proxyText = await proxyResponse.text();
      console.log('Proxy fetch content length:', proxyText.length);
      console.log('Proxy fetch first 200 chars:', proxyText.substring(0, 200));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testRSSFetch(); 