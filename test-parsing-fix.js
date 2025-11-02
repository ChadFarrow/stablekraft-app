#!/usr/bin/env node

/**
 * Test script to verify the RSS parsing fix
 */

const { parseV4VFromXML, parseItemV4VFromXML } = require('./lib/rss-parser-db');

async function testParsingFix() {
  console.log('🧪 Testing RSS parsing fix...\n');

  // Test XML with opening/closing tags (like RSS Blue feeds)
  const testXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <podcast:value type="lightning" method="keysend">
      <podcast:valueRecipient name="Emily Ronna" customKey="906608" customValue="01KZ2f13T5kZjfmuKzILsl" type="node" address="03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79" split="4508"></podcast:valueRecipient>
      <podcast:valueRecipient name="Phantom Power Music" customKey="696969" customValue="aBpWlXR7oKOAYjr21Elk" type="node" address="030a58b8653d32b99200a2334cfe913e51dc7d155aa0116c176657a4f1722677a3" split="245"></podcast:valueRecipient>
      <podcast:valueRecipient name="RSS Blue" type="node" address="02d256a6f93e3d4f95db0d9b3e85bc49f8c61a15b6e9c59e946d1b2806a87f6eb7" split="97"></podcast:valueRecipient>
    </podcast:value>
    <item>
      <title>3 Way</title>
      <podcast:value type="lightning" method="keysend">
        <podcast:valueRecipient name="Emily Ronna" customKey="906608" customValue="01KZ2f13T5kZjfmuKzILsl" type="node" address="03b6f613e88bd874177c28c6ad83b3baba43c4c656f56be1f8df84669556054b79" split="4508"></podcast:valueRecipient>
        <podcast:valueRecipient name="Phantom Power Music" customKey="696969" customValue="aBpWlXR7oKOAYjr21Elk" type="node" address="030a58b8653d32b99200a2334cfe913e51dc7d155aa0116c176657a4f1722677a3" split="245"></podcast:valueRecipient>
        <podcast:valueRecipient name="RSS Blue" type="node" address="02d256a6f93e3d4f95db0d9b3e85bc49f8c61a15b6e9c59e946d1b2806a87f6eb7" split="97"></podcast:valueRecipient>
      </podcast:value>
    </item>
  </channel>
</rss>`;

  console.log('🔍 Testing feed-level V4V parsing...');
  const feedV4V = parseV4VFromXML(testXML);
  console.log('Feed V4V Result:', JSON.stringify(feedV4V, null, 2));

  console.log('\n🔍 Testing item-level V4V parsing...');
  const itemV4V = parseItemV4VFromXML(testXML, '3 Way');
  console.log('Item V4V Result:', JSON.stringify(itemV4V, null, 2));

  // Test with actual RSS feed
  console.log('\n🔍 Testing with actual RSS feed...');
  const https = require('https');
  
  const actualXML = await new Promise((resolve, reject) => {
    https.get('https://feeds.rssblue.com/3-way', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  console.log('🔍 Testing actual feed-level V4V parsing...');
  const actualFeedV4V = parseV4VFromXML(actualXML);
  console.log('Actual Feed V4V Result:', JSON.stringify(actualFeedV4V, null, 2));

  console.log('\n🔍 Testing actual item-level V4V parsing...');
  const actualItemV4V = parseItemV4VFromXML(actualXML, '3 Way');
  console.log('Actual Item V4V Result:', JSON.stringify(actualItemV4V, null, 2));
}

testParsingFix().catch(console.error);
