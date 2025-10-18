const crypto = require('crypto');

// Use environment variables for API credentials
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || 'MV5XQPRMUX3SCTXMGNVG';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || 'eX9vbbV2SfgGctENDDjethfnKP2VAwMgYTDkQ9ce';

// Episode 54 feedGuids from valueTimeSplit elements
const ep54FeedGuids = [
  '3058af0c-1807-5732-9a08-9114675ef7d6', // Lost Summer
  '011c3a82-d716-54f7-9738-3d5fcacf65be', // Quiet Day
  '0ab5bc9d-c9fb-52f4-8b8c-64be5edf322f', // it can be erased
  '187f22db-79cb-5ac4-aa60-54e424e3915e'  // It's Christmastime Again! (lofi beats mix)
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
  console.log('🔍 Looking up Episode 54 feedGuids...\n');
  
  const results = [];
  for (const feedGuid of ep54FeedGuids) {
    const result = await lookupFeedGuid(feedGuid);
    if (result) results.push(result);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }
  
  console.log('\n📋 Summary for V4V resolver:');
  results.forEach(result => {
    console.log(`  '${result.feedGuid}': '${result.url}', // ${result.title} - ${result.author}`);
  });
}

main().catch(console.error);