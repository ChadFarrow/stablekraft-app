import crypto from 'crypto';

const API_KEY = process.env.PODCAST_INDEX_API_KEY!;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET!;

async function searchPodcastIndex() {
  try {
    // Generate auth headers for Podcast Index API
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto
      .createHash('sha1')
      .update(API_KEY + API_SECRET + apiHeaderTime)
      .digest('hex');

    const headers = {
      'X-Auth-Date': apiHeaderTime.toString(),
      'X-Auth-Key': API_KEY,
      'Authorization': hash,
      'User-Agent': 'StableKraft/1.0'
    };

    // Search by podcast GUID first
    const guid = 'b2c1f762-1f54-5a71-aeb0-b3a041a85f8d';
    console.log('🔍 Searching Podcast Index for GUID:', guid, '\n');

    const guidResponse = await fetch(
      `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${guid}`,
      { headers }
    );

    if (guidResponse.ok) {
      const guidData = await guidResponse.json();
      console.log('📋 Podcast found by GUID:');
      console.log(JSON.stringify(guidData.feed, null, 2));
    }

    // Also search by title
    console.log('\n🔍 Searching for "Kathryn" on Podcast Index...\n');

    const searchResponse = await fetch(
      `https://api.podcastindex.org/api/1.0/search/byterm?q=Kathryn+music`,
      { headers }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      console.log(`\n📋 Found ${searchData.count} results:\n`);

      // Filter for feeds that look like publisher/artist feeds
      const results = searchData.feeds.slice(0, 10);
      for (const feed of results) {
        console.log('─'.repeat(80));
        console.log('Title:', feed.title);
        console.log('Author:', feed.author);
        console.log('GUID:', feed.podcastGuid);
        console.log('URL:', feed.url);
        console.log('Type:', feed.medium || 'podcast');
        console.log();
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

searchPodcastIndex();
