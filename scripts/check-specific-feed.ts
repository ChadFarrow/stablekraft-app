import crypto from 'crypto';

const API_KEY = process.env.PODCAST_INDEX_API_KEY || '';
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET || '';

async function checkFeedEpisodes(feedId: number) {
  try {
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto
      .createHash('sha1')
      .update(API_KEY + API_SECRET + apiHeaderTime)
      .digest('hex');

    const url = `https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedId}&max=100`;

    const response = await fetch(url, {
      headers: {
        'X-Auth-Date': apiHeaderTime.toString(),
        'X-Auth-Key': API_KEY,
        'Authorization': hash,
        'User-Agent': 'StableKraft-App/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    console.log(`\n📻 Feed ID ${feedId} - Episodes:\n`);
    console.log(`Found ${data.count} episodes\n`);

    if (data.items && data.items.length > 0) {
      data.items.forEach((episode: any, index: number) => {
        console.log(`${index + 1}. ${episode.title}`);
        console.log(`   GUID: ${episode.guid || 'N/A'}`);
        console.log(`   Audio: ${episode.enclosureUrl ? 'YES' : 'NO'}`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

const TARGET_GUID = '604f333b-d131-5ac2-8dc8-64129140bba5';

console.log('🔍 Checking "I Can\'t Sleep! (EP)" feeds for missing episode...');
console.log(`Looking for episode GUID: ${TARGET_GUID}\n`);

async function checkBothFeeds() {
  console.log('========================================');
  console.log('Feed ID: 7530846 (Newer - podhome.fm)');
  console.log('========================================');
  await checkFeedEpisodes(7530846);

  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('\n========================================');
  console.log('Feed ID: 7192640 (Older - rssblue.com)');
  console.log('========================================');
  await checkFeedEpisodes(7192640);
}

checkBothFeeds();
