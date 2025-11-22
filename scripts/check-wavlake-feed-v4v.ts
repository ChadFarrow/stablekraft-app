import crypto from 'crypto';

async function generateHeaders(apiKey: string, apiSecret: string) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');

  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft-Test/1.0'
  };
}

async function checkWavlakeFeed() {
  const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

  // Test with one of the Wavlake feeds missing V4V data
  const testFeedGuid = '4a1418e3-ea5f-5cb1-ae67-ac6e4c581b05'; // 열쇠 feed

  const headers = await generateHeaders(apiKey, apiSecret);

  console.log('🔍 Checking Wavlake feed for V4V data...\n');

  // Get feed metadata from Podcast Index
  const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(testFeedGuid)}`, {
    headers
  });

  const data = await response.json();
  const feed = data.feed;

  if (feed) {
    console.log('📻 Feed Info:');
    console.log(`   Title: ${feed.title}`);
    console.log(`   URL: ${feed.url}`);
    console.log(`   Has feed-level value tag: ${!!feed.value}`);

    if (feed.value) {
      console.log('\n💰 Feed-level Value Tag:');
      console.log(JSON.stringify(feed.value, null, 2));
    }

    // Now fetch the actual RSS feed
    console.log('\n📡 Fetching RSS feed...');
    const rssResponse = await fetch(feed.url);
    const rssText = await rssResponse.text();

    // Check for podcast:value tags
    const hasChannelValue = rssText.includes('<podcast:value ');
    const hasItemValue = rssText.includes('<podcast:value ') && rssText.indexOf('<podcast:value ', rssText.indexOf('<item>')) > -1;

    console.log(`\n📊 RSS Feed Analysis:`);
    console.log(`   Feed size: ${rssText.length} bytes`);
    console.log(`   Has <podcast:value> at channel level: ${hasChannelValue}`);
    console.log(`   Has <podcast:value> at item level: ${hasItemValue}`);

    // Extract a sample podcast:value tag if it exists
    const valueTagMatch = rssText.match(/<podcast:value[^>]*>[\s\S]*?<\/podcast:value>/);
    if (valueTagMatch) {
      console.log('\n📝 Sample podcast:value tag:');
      console.log(valueTagMatch[0].substring(0, 500) + '...');
    } else {
      console.log('\n⚠️ No podcast:value tags found in RSS feed!');
    }

    // Get episodes from Podcast Index
    const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/bypodcastguid?guid=${encodeURIComponent(testFeedGuid)}`, {
      headers
    });
    const episodesData = await episodesResponse.json();

    if (episodesData.items && episodesData.items.length > 0) {
      const sampleEpisode = episodesData.items[0];
      console.log('\n🎵 Sample Episode from API:');
      console.log(`   Title: ${sampleEpisode.title}`);
      console.log(`   Has value data: ${!!sampleEpisode.value}`);

      if (sampleEpisode.value) {
        console.log('\n   Value data:');
        console.log(JSON.stringify(sampleEpisode.value, null, 2));
      }
    }
  }
}

checkWavlakeFeed();
