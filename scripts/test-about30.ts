import { parseStringPromise } from 'xml2js';

interface ValueRecipient {
  $: {
    name?: string;
    type?: string;
    address?: string;
    split?: string;
    customKey?: string;
    customValue?: string;
    fee?: string;
  };
}

interface PodcastValue {
  $?: {
    type?: string;
    method?: string;
    suggested?: string;
  };
  'podcast:valueRecipient'?: ValueRecipient[];
}

async function parseV4VFromRSS(rssUrl: string) {
  try {
    const response = await fetch(rssUrl);
    if (!response.ok) {
      console.log('Response not OK:', response.status);
      return null;
    }

    const rssText = await response.text();
    const parsedXml = await parseStringPromise(rssText);

    const channel = parsedXml.rss?.channel?.[0];
    let channelValue: PodcastValue | null = null;

    if (channel?.['podcast:value']?.[0]) {
      channelValue = channel['podcast:value'][0];
    }

    console.log('channelValue exists:', channelValue ? 'YES' : 'NO');
    console.log('has recipients:', channelValue?.['podcast:valueRecipient'] ? 'YES' : 'NO');
    console.log('recipients length:', channelValue?.['podcast:valueRecipient']?.length);

    if (channelValue && channelValue['podcast:valueRecipient']) {
      const result = {
        type: channelValue.$?.type || 'lightning',
        method: channelValue.$?.method || 'keysend',
        suggested: channelValue.$?.suggested,
        recipients: channelValue['podcast:valueRecipient'].map((r: ValueRecipient) => ({
          name: r.$.name,
          type: r.$.type,
          address: r.$.address,
          split: parseInt(r.$.split || '0'),
          customKey: r.$.customKey,
          customValue: r.$.customValue,
          fee: r.$.fee === 'true'
        }))
      };
      console.log('Returning V4V data with', result.recipients.length, 'recipients');
      return result;
    }

    console.log('Returning NULL');
    return null;
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function main() {
  const result = await parseV4VFromRSS('https://wavlake.com/feed/music/5e09d62b-26e2-4308-89fc-e148d306184e');
  console.log('\nFinal Result:', result ? JSON.stringify(result, null, 2) : 'NULL');
}

main();
