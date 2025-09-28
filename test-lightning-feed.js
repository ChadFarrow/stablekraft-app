// Quick test script to parse Chad's Lightning feed
const { XMLParser } = require('fast-xml-parser');

async function testChadsFeed() {
  try {
    console.log('🔍 Fetching Chad\'s Lightning test feed...');

    const response = await fetch('https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml');
    const xmlText = await response.text();

    console.log('✅ Feed fetched, size:', xmlText.length, 'characters');

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '_text',
    });

    const parsed = parser.parse(xmlText);
    const channel = parsed.rss.channel;

    // Check channel-level value tag
    const channelValue = channel['podcast:value'];
    if (channelValue) {
      console.log('\n📺 Channel-level value tag found:');
      console.log('  Type:', channelValue['@_type']);
      console.log('  Method:', channelValue['@_method']);

      const recipients = channelValue['podcast:valueRecipient'];
      if (Array.isArray(recipients)) {
        console.log(`  Recipients: ${recipients.length}`);
        recipients.forEach((r, i) => {
          console.log(`    ${i+1}. ${r['@_name']}: ${r['@_split']}% (${r['@_type']})`);
          if (r['@_type'] === 'lnaddress') {
            console.log(`       Lightning Address: ${r['@_address']}`);
          }
        });
      }
    }

    // Check first few items
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    console.log(`\n🎧 Found ${items.length} episodes`);

    items.slice(0, 3).forEach((item, i) => {
      console.log(`\nEpisode ${i+1}: ${item.title}`);
      const itemValue = item['podcast:value'];
      if (itemValue) {
        const recipients = itemValue['podcast:valueRecipient'];
        if (Array.isArray(recipients)) {
          console.log(`  Custom value splits: ${recipients.length} recipients`);
          recipients.forEach(r => {
            console.log(`    - ${r['@_name']}: ${r['@_split']}% (${r['@_type']})`);
          });
        }
      } else {
        console.log('  Uses channel-level value splits');
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run the test
testChadsFeed();