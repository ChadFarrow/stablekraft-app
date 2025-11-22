import crypto from 'crypto';

const API_KEY = process.env.PODCAST_INDEX_API_KEY || '';
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET || '';

async function searchPodcastIndex(query: string) {
  try {
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto
      .createHash('sha1')
      .update(API_KEY + API_SECRET + apiHeaderTime)
      .digest('hex');

    const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(query)}&max=20`;

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

    console.log(`\n🔍 Search results for "${query}":\n`);
    console.log(`Found ${data.count} results\n`);

    if (data.feeds && data.feeds.length > 0) {
      data.feeds.slice(0, 10).forEach((feed: any, index: number) => {
        console.log(`\n${index + 1}. ${feed.title}`);
        console.log(`   Feed ID: ${feed.id}`);
        console.log(`   Feed GUID: ${feed.podcastGuid || 'N/A'}`);
        console.log(`   Episodes: ${feed.episodeCount || 'N/A'}`);
        console.log(`   Medium: ${feed.medium || 'N/A'}`);
        console.log(`   Author: ${feed.author || 'N/A'}`);
        console.log(`   URL: ${feed.url || 'N/A'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Search for "I Can't Sleep!"
searchPodcastIndex("I Can't Sleep!");
