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
    'User-Agent': 'StableKraft-V4V-Check/1.0'
  };
}

async function checkWavlakeFeed() {
  const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

  // Sample Wavlake feed GUID from our missing list
  const feedGuid = '6831666';

  console.log('🔍 Checking Wavlake feed in Podcast Index API...\n');
  console.log(`Feed GUID: ${feedGuid}`);
  console.log('Feed: "Just In Case"\n');

  const headers = await generateHeaders(apiKey, apiSecret);

  // Check feed-level data
  const feedResponse = await fetch(
    `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`,
    { headers }
  );

  const feedData = await feedResponse.json();
  console.log('📡 Feed Response:');
  console.log('  Status:', feedData.status);
  console.log('  Has feed:', feedData.feed ? 'YES' : 'NO');

  if (feedData.feed) {
    console.log('  Feed title:', feedData.feed.title);
    console.log('  Feed has value field:', feedData.feed.value ? 'YES ✅' : 'NO ❌');

    if (feedData.feed.value) {
      console.log('\n  Feed-level V4V data:');
      console.log('  ', JSON.stringify(feedData.feed.value, null, 2));
    }
  }

  // Check episodes
  console.log('\n📊 Episodes Response:');
  const episodesResponse = await fetch(
    `https://api.podcastindex.org/api/1.0/episodes/bypodcastguid?guid=${feedGuid}`,
    { headers }
  );

  const episodesData = await episodesResponse.json();
  console.log('  Status:', episodesData.status);
  console.log('  Count:', episodesData.count);
  console.log('  Has items:', episodesData.items?.length || 0);

  if (episodesData.items && episodesData.items.length > 0) {
    const ep = episodesData.items[0];
    console.log('\n  Sample episode:', ep.title);
    console.log('  Episode has value field:', ep.value ? 'YES ✅' : 'NO ❌');

    if (ep.value) {
      console.log('\n  Episode V4V data:');
      console.log('  ', JSON.stringify(ep.value, null, 2));
    }
  } else {
    console.log('\n  ⚠️ No episodes found in Podcast Index API');
    console.log('  This is why the backfill script skipped these tracks.');
  }

  // Now check the actual RSS feed URL
  console.log('\n\n🌐 Checking actual Wavlake RSS feed...\n');
  const rssUrl = 'https://wavlake.com/feed/music/93d81d2a-4b63-4427-8072-f6dbd042f8dc';
  console.log(`  Fetching: ${rssUrl}`);

  try {
    const rssResponse = await fetch(rssUrl);
    const rssText = await rssResponse.text();

    // Check for podcast:value tags
    const hasChannelValue = rssText.includes('<podcast:value');
    const hasItemValue = rssText.match(/<item>[\s\S]*?<podcast:value/);

    console.log('  Feed has <podcast:value> in <channel>:', hasChannelValue ? 'YES ✅' : 'NO ❌');
    console.log('  Feed has <podcast:value> in <item>:', hasItemValue ? 'YES ✅' : 'NO ❌');

    if (hasChannelValue || hasItemValue) {
      // Extract a sample
      const valueMatch = rssText.match(/<podcast:value[^>]*>[\s\S]*?<\/podcast:value>/);
      if (valueMatch) {
        console.log('\n  Sample V4V tag from RSS:');
        console.log('  ', valueMatch[0].substring(0, 500) + '...');
      }
    }
  } catch (error) {
    console.error('  ❌ Error fetching RSS feed:', error);
  }
}

checkWavlakeFeed();
