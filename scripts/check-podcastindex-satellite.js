const crypto = require('crypto');

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function getPodcastIndexHeaders() {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1');
  hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
  const hashString = hash.digest('hex');

  return {
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'X-Auth-Date': apiHeaderTime.toString(),
    'Authorization': hashString,
    'User-Agent': 'StableKraft/1.0'
  };
}

async function fetchPodcastById(podcastId) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/podcasts/byfeedid?id=${podcastId}`;

  const response = await fetch(apiUrl, {
    headers: getPodcastIndexHeaders()
  });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  return await response.json();
}

async function fetchEpisodesByFeedId(feedId) {
  const apiUrl = `${PODCAST_INDEX_BASE_URL}/episodes/byfeedid?id=${feedId}&max=1000`;

  const response = await fetch(apiUrl, {
    headers: getPodcastIndexHeaders()
  });

  if (!response.ok) {
    throw new Error(`PodcastIndex API error: ${response.status}`);
  }

  return await response.json();
}

(async () => {
  try {
    const podcastId = 7235124;

    console.log(`Fetching podcast ${podcastId} from PodcastIndex...\n`);

    const podcastData = await fetchPodcastById(podcastId);
    console.log(`Podcast: ${podcastData.feed.title}`);
    console.log(`Feed URL: ${podcastData.feed.url}\n`);

    console.log('Fetching episodes...\n');
    const episodesData = await fetchEpisodesByFeedId(podcastId);

    console.log(`Total episodes found: ${episodesData.count}`);
    console.log(`Episodes returned: ${episodesData.items.length}\n`);

    console.log('=== First 20 Episodes (in feed order) ===');
    episodesData.items.slice(0, 20).forEach((ep, i) => {
      const title = ep.title || 'Untitled';
      const guid = ep.guid ? ep.guid.substring(0, 36) : 'no guid';
      console.log(`${i + 1}. ${title}`);
      console.log(`   GUID: ${guid}`);
      console.log(`   Enclosure: ${ep.enclosureUrl ? ep.enclosureUrl.substring(0, 60) + '...' : 'none'}`);
    });

    if (episodesData.items.length > 20) {
      console.log(`\n... and ${episodesData.items.length - 20} more episodes`);
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
})();
