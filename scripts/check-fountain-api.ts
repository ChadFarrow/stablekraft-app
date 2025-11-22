import crypto from 'crypto';

async function checkPodcastIndexAPI() {
  const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');

  const headers = {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'StableKraft-Check/1.0'
  };

  const feedGuid = '699fdb4b-7ceb-5687-ac19-940e4613aae0';

  console.log('🔍 Checking Podcast Index API response...\n');

  // Get feed info
  const feedResponse = await fetch(
    `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`,
    { headers }
  );

  const feedData = await feedResponse.json();
  console.log('📡 Feed Response:');
  console.log('  Status:', feedData.status);
  console.log('  Has feed:', feedData.feed ? 'yes' : 'no');

  if (feedData.feed) {
    console.log('  Feed title:', feedData.feed.title);
    console.log('  Feed has value field:', feedData.feed.value ? 'yes' : 'no');

    if (feedData.feed.value) {
      console.log('  Feed value:', JSON.stringify(feedData.feed.value, null, 2));
    }
  }

  // Get episodes
  const episodesResponse = await fetch(
    `https://api.podcastindex.org/api/1.0/episodes/bypodcastguid?guid=${feedGuid}`,
    { headers }
  );

  const episodesData = await episodesResponse.json();
  console.log('\n📊 Episodes Response:');
  console.log('  Status:', episodesData.status);
  console.log('  Count:', episodesData.count);
  console.log('  Has items:', episodesData.items?.length || 0);

  if (episodesData.items && episodesData.items.length > 0) {
    const ep = episodesData.items[0];
    console.log('  Sample episode title:', ep.title);
    console.log('  Episode has value field:', ep.value ? 'yes' : 'no');

    if (ep.value) {
      console.log('  Episode value:', JSON.stringify(ep.value, null, 2));
    }
  }
}

checkPodcastIndexAPI();
