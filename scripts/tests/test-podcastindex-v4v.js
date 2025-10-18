#!/usr/bin/env node

/**
 * Test Podcast Index API V4V Integration
 * Tests the enhanced Podcast Index API route with V4V data support
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

async function testPodcastIndexV4V() {
  console.log('🧪 Testing Podcast Index API V4V Integration...\n');

  // Test 1: Fetch feed with V4V data
  console.log('📡 Test 1: Fetch Doerfel-Verse feed with V4V data');
  try {
    const response = await fetch(`${BASE_URL}/api/podcastindex?feedUrl=https://www.doerfelverse.com/feeds/intothedoerfelverse.xml`);
    console.log('Status:', response.status);
    
    if (response.ok) {
      const xml = await response.text();
      console.log('✅ Successfully fetched RSS with V4V support');
      
      // Check for V4V elements
      const hasValueElements = xml.includes('<podcast:value');
      const hasValueTimeSplits = xml.includes('<podcast:valueTimeSplit');
      const hasValueRecipients = xml.includes('<podcast:valueRecipient');
      
      console.log('V4V Elements Found:');
      console.log('  - podcast:value:', hasValueElements ? '✅' : '❌');
      console.log('  - podcast:valueTimeSplit:', hasValueTimeSplits ? '✅' : '❌');
      console.log('  - podcast:valueRecipient:', hasValueRecipients ? '✅' : '❌');
      
      // Show first 500 chars of XML
      console.log('\nFirst 500 characters of response:');
      console.log(xml.substring(0, 500) + '...');
    } else {
      console.log('❌ Failed to fetch feed');
      const error = await response.text();
      console.log('Error:', error);
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Fetch specific episode by GUID (if we have one)
  console.log('📡 Test 2: Fetch specific episode by GUID');
  try {
    // Use a GUID from the Doerfel-Verse feed
    const testGuid = 'c51ecaa4-f237-4707-9c62-2de611820e4b';
    const response = await fetch(`${BASE_URL}/api/podcastindex?guid=${testGuid}`);
    console.log('Status:', response.status);
    
    if (response.ok) {
      const xml = await response.text();
      console.log('✅ Successfully fetched episode by GUID');
      
      // Check for V4V elements
      const hasValueElements = xml.includes('<podcast:value');
      const hasValueTimeSplits = xml.includes('<podcast:valueTimeSplit');
      const hasValueRecipients = xml.includes('<podcast:valueRecipient');
      
      console.log('V4V Elements Found:');
      console.log('  - podcast:value:', hasValueElements ? '✅' : '❌');
      console.log('  - podcast:valueTimeSplit:', hasValueTimeSplits ? '✅' : '❌');
      console.log('  - podcast:valueRecipient:', hasValueRecipients ? '✅' : '❌');
      
      // Show first 500 chars of XML
      console.log('\nFirst 500 characters of response:');
      console.log(xml.substring(0, 500) + '...');
    } else {
      console.log('❌ Failed to fetch episode by GUID');
      const error = await response.text();
      console.log('Error:', error);
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Test error handling
  console.log('📡 Test 3: Test error handling with invalid GUID');
  try {
    const response = await fetch(`${BASE_URL}/api/podcastindex?guid=invalid-guid`);
    console.log('Status:', response.status);
    
    if (response.ok) {
      console.log('✅ Unexpected success with invalid GUID');
    } else {
      console.log('✅ Correctly handled invalid GUID');
      const error = await response.text();
      console.log('Error response:', error);
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }

  console.log('\n🎉 Podcast Index API V4V Integration Test Complete!');
}

// Run the test
testPodcastIndexV4V().catch(console.error); 