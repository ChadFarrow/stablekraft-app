const crypto = require('crypto');

// Use environment variables for API credentials
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || 'MV5XQPRMUX3SCTXMGNVG';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || 'eX9vbbV2SfgGctENDDjethfnKP2VAwMgYTDkQ9ce';

// Episode 56 feedGuids from valueTimeSplit elements
const ep56FeedGuids = [
  '3ae285ab-434c-59d8-aa2f-59c6129afb92', // Neon Hawk
  '6fc2ad98-d4a8-5d70-9c68-62e9efc1209c', // Grey's Birthday
  'dea01a9d-a024-5b13-84aa-b157304cd3bc', // Smokestacks
  '95e5f7a9-d88e-5e51-b2ae-f4b1865d19c4'  // Hit the Target [Live in Amsterdam]
];

async function lookupFeedGuid(feedGuid) {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1');
  hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
  const hashString = hash.digest('hex');

  const headers = {
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hashString,
    'User-Agent': 're.podtards.com'
  };

  const url = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`;
  
  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
    
    if (data.status === 'true' && data.feed) {
      console.log(`✅ ${feedGuid}:`);
      console.log(`   Title: ${data.feed.title}`);
      console.log(`   URL: ${data.feed.url}`);
      console.log(`   Author: ${data.feed.author}`);
      return {
        feedGuid,
        title: data.feed.title,
        url: data.feed.url,
        author: data.feed.author
      };
    } else {
      console.log(`❌ ${feedGuid}: Not found`);
      return null;
    }
  } catch (error) {
    console.error(`❌ ${feedGuid}: Error -`, error.message);
    return null;
  }
}

async function main() {
  console.log('🔍 Looking up Episode 56 feedGuids...\n');
  
  const results = [];
  for (const feedGuid of ep56FeedGuids) {
    const result = await lookupFeedGuid(feedGuid);
    if (result) results.push(result);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }
  
  console.log('\n📋 Summary for V4V resolver:');
  results.forEach(result => {
    console.log(`  '${result.feedGuid}': '${result.url}',`);
  });
}

main().catch(console.error);