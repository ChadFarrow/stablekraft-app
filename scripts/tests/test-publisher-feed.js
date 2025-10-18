#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Simple XML parser for testing
function parsePublisherFeed(xmlContent) {
  const results = {
    title: '',
    medium: '',
    guid: '',
    remoteItems: []
  };

  // Extract basic channel info
  const titleMatch = xmlContent.match(/<title>(.*?)<\/title>/);
  if (titleMatch) results.title = titleMatch[1];

  const mediumMatch = xmlContent.match(/<podcast:medium>(.*?)<\/podcast:medium>/);
  if (mediumMatch) results.medium = mediumMatch[1];

  const guidMatch = xmlContent.match(/<podcast:guid>(.*?)<\/podcast:guid>/);
  if (guidMatch) results.guid = guidMatch[1];

  // Extract remote items
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*feedUrl="([^"]*)"[^>]*(?:feedImg="([^"]*)")?[^>]*\/?>/g;
  let match;
  
  while ((match = remoteItemRegex.exec(xmlContent)) !== null) {
    results.remoteItems.push({
      feedGuid: match[1],
      feedUrl: match[2],
      feedImg: match[3] || null
    });
  }

  return results;
}

async function testPublisherFeed() {
  console.log('🧪 Testing Doerfels Publisher Feed...\n');

  try {
    // Read the test feed
    const feedPath = path.join(__dirname, 'doerfels-test-publisher-feed.xml');
    const xmlContent = fs.readFileSync(feedPath, 'utf8');

    console.log('✅ Feed file loaded successfully');
    console.log(`📄 File size: ${Math.round(xmlContent.length / 1024)}KB\n`);

    // Parse the feed
    const parsed = parsePublisherFeed(xmlContent);

    console.log('📊 Feed Parsing Results:');
    console.log(`   Title: ${parsed.title}`);
    console.log(`   Medium: ${parsed.medium}`);
    console.log(`   GUID: ${parsed.guid}`);
    console.log(`   Remote Items: ${parsed.remoteItems.length}\n`);

    // Validate structure
    console.log('🔍 Feed Validation:');
    
    if (parsed.medium === 'publisher') {
      console.log('   ✅ Medium is correctly set to "publisher"');
    } else {
      console.log('   ❌ Medium should be "publisher", got:', parsed.medium);
    }

    if (parsed.guid && parsed.guid.length > 0) {
      console.log('   ✅ GUID is present');
    } else {
      console.log('   ❌ GUID is missing');
    }

    if (parsed.remoteItems.length > 0) {
      console.log(`   ✅ Found ${parsed.remoteItems.length} remote items`);
    } else {
      console.log('   ❌ No remote items found');
    }

    console.log('\n📋 Remote Items List:');
    parsed.remoteItems.forEach((item, index) => {
      console.log(`   ${index + 1}. GUID: ${item.feedGuid.substring(0, 8)}...`);
      console.log(`      URL: ${item.feedUrl}`);
      if (item.feedImg) {
        console.log(`      Image: ${item.feedImg}`);
      }
      console.log('');
    });

    // Test XML validity
    const hasValidXMLStructure = xmlContent.includes('<?xml') && 
                                xmlContent.includes('<rss') && 
                                xmlContent.includes('</rss>');
    
    if (hasValidXMLStructure) {
      console.log('✅ XML structure appears valid');
    } else {
      console.log('❌ XML structure may be invalid');
    }

    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testPublisherFeed();