const crypto = require('crypto');

// Use environment variables for API credentials
const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || 'MV5XQPRMUX3SCTXMGNVG';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || 'eX9vbbV2SfgGctENDDjethfnKP2VAwMgYTDkQ9ce';

// Missing feedGuid from Episode 44
const missingFeedGuid = 'a2d2e313-9cbd-5169-b89c-ab07b33ecc33';

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
      console.log(`   V4V resolver entry: '${feedGuid}': '${data.feed.url}', // ${data.feed.title} - ${data.feed.author}`);
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
  console.log('🔍 Looking up missing feedGuid from Episode 44...\n');
  
  const result = await lookupFeedGuid(missingFeedGuid);
  if (result) {
    console.log('\n✅ Found the missing feed! Add this to V4V resolver.');
  } else {
    console.log('\n❌ Could not resolve the missing feedGuid.');
  }
}

main().catch(console.error);