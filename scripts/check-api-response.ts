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

async function checkApiResponse() {
  const apiKey = process.env.PODCAST_INDEX_API_KEY || '';
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET || '';

  // Test with one GUID that resolved
  const testGuid = '0886a19f-0c58-5a79-b65f-063ad28331f7';

  const headers = await generateHeaders(apiKey, apiSecret);
  const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(testGuid)}`, {
    headers
  });

  const data = await response.json();

  console.log('📡 Full API Response:');
  console.log(JSON.stringify(data, null, 2));
}

checkApiResponse();
