#!/usr/bin/env tsx

import { resolveItemGuid } from '../lib/feed-discovery';

async function testSpecificResolution() {
  console.log('🔍 Testing specific GUID resolution...');
  
  // Test a few specific GUIDs from the playlist
  const testItems = [
    { feedGuid: "dbad52b9-6253-4a9b-bfab-246b9e839815", itemGuid: "fabc3e64-e470-4f97-bf4a-3957e481e23b" },
    { feedGuid: "99d74aa0-2f55-5b2c-9c7a-47a3f31357f3", itemGuid: "283eb308-d103-4419-9131-4d603fdd800f" },
    { feedGuid: "a84a2e0f-faba-488b-a0a2-43c4745878ac", itemGuid: "1b15d9fa-92be-4f0a-b503-602580181735" }
  ];
  
  for (const item of testItems) {
    console.log(`\n🧪 Testing: ${item.feedGuid} / ${item.itemGuid}`);
    
    try {
      const result = await resolveItemGuid(item.feedGuid, item.itemGuid);
      
      if (result) {
        console.log(`✅ Successfully resolved: ${result.title} by ${result.feedTitle}`);
        console.log(`   Audio URL: ${result.audioUrl}`);
        console.log(`   Duration: ${result.duration} seconds`);
      } else {
        console.log(`❌ Could not resolve this item`);
      }
    } catch (error) {
      console.error(`❌ Error resolving: ${error}`);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

testSpecificResolution();