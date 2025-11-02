#!/usr/bin/env node

/**
 * Test script to verify RSS parsing works with real feeds after the fix
 */

const https = require('https');

async function testRealFeedParsing() {
  console.log('🧪 Testing real RSS feed parsing after fix...\n');

  const feedsToTest = [
    'https://feeds.rssblue.com/3-way',
    'https://feeds.rssblue.com/age-of-reason'
  ];

  for (const feedUrl of feedsToTest) {
    console.log(`\n🔍 Testing: ${feedUrl}`);
    
    try {
      // Fetch the RSS feed
      const xmlContent = await new Promise((resolve, reject) => {
        https.get(feedUrl, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });

      // Test the parsing logic manually
      console.log('📋 Testing feed-level V4V parsing...');
      
      // Look for podcast:value tags
      const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
      const valueMatch = valueRegex.exec(xmlContent);
      
      if (!valueMatch) {
        console.log('❌ No podcast:value tags found');
        continue;
      }
      
      const valueContent = valueMatch[1];
      console.log('✅ Found podcast:value content');
      
      // Test the NEW regex for recipients
      const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
      const recipients = [];
      let match;
      
      while ((match = recipientRegex.exec(valueContent)) !== null) {
        const recipientTag = match[0];
        
        const nameMatch = recipientTag.match(/name="([^"]*)"/);
        const addressMatch = recipientTag.match(/address="([^"]*)"/);
        const typeMatch = recipientTag.match(/type="([^"]*)"/);
        const splitMatch = recipientTag.match(/split="([^"]*)"/);
        
        const recipient = {
          name: nameMatch ? nameMatch[1] : null,
          address: addressMatch ? addressMatch[1] : null,
          type: typeMatch ? typeMatch[1] : 'node',
          split: splitMatch ? splitMatch[1] : '100'
        };
        
        recipients.push(recipient);
      }
      
      console.log(`✅ Found ${recipients.length} recipients:`);
      recipients.forEach((recipient, index) => {
        console.log(`   ${index + 1}. ${recipient.name} (${recipient.type}) - ${recipient.address}`);
      });
      
      // Test item-level parsing
      console.log('\n📋 Testing item-level V4V parsing...');
      
      // Find the first item
      const itemRegex = /<item[^>]*>.*?<title>(.*?)<\/title>.*?<\/item>/gs;
      const itemMatch = itemRegex.exec(xmlContent);
      
      if (itemMatch) {
        const itemContent = itemMatch[0];
        const itemTitle = itemMatch[1];
        console.log(`✅ Found item: ${itemTitle}`);
        
        // Look for podcast:value within this item
        const itemValueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
        const itemValueMatch = itemValueRegex.exec(itemContent);
        
        if (itemValueMatch) {
          const itemValueContent = itemValueMatch[1];
          console.log('✅ Found podcast:value in item');
          
          const itemRecipients = [];
          let itemMatch;
          
          while ((itemMatch = recipientRegex.exec(itemValueContent)) !== null) {
            const recipientTag = itemMatch[0];
            
            const nameMatch = recipientTag.match(/name="([^"]*)"/);
            const addressMatch = recipientTag.match(/address="([^"]*)"/);
            const typeMatch = recipientTag.match(/type="([^"]*)"/);
            const splitMatch = recipientTag.match(/split="([^"]*)"/);
            
            const recipient = {
              name: nameMatch ? nameMatch[1] : null,
              address: addressMatch ? addressMatch[1] : null,
              type: typeMatch ? typeMatch[1] : 'node',
              split: splitMatch ? splitMatch[1] : '100'
            };
            
            itemRecipients.push(recipient);
          }
          
          console.log(`✅ Found ${itemRecipients.length} recipients in item:`);
          itemRecipients.forEach((recipient, index) => {
            console.log(`   ${index + 1}. ${recipient.name} (${recipient.type}) - ${recipient.address}`);
          });
        } else {
          console.log('❌ No podcast:value found in item');
        }
      } else {
        console.log('❌ No items found');
      }
      
    } catch (error) {
      console.error(`❌ Error testing ${feedUrl}:`, error.message);
    }
  }
  
  console.log('\n✅ Real feed parsing test completed!');
}

testRealFeedParsing().catch(console.error);
