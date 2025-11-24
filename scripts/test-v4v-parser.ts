/**
 * Test script to verify parseItemV4VFromXML correctly extracts v4v splits
 */

import { parseItemV4VFromXML } from '../lib/rss-parser-db';
import fs from 'fs';

async function main() {
  console.log('🧪 Testing V4V parser for "Like Wine"...\n');

  // Read the Stay Awhile XML feed
  const xmlPath = '/tmp/stay-awhile.xml';

  if (!fs.existsSync(xmlPath)) {
    console.error('❌ XML file not found at', xmlPath);
    console.log('Fetching feed from Wavlake...');

    const response = await fetch('https://mp3.wavlake.com/feed/9ce6aa11-c315-46ef-9eae-4d0ba1e5f97e.xml');
    const xml = await response.text();
    fs.writeFileSync(xmlPath, xml);
    console.log('✅ Feed saved to', xmlPath);
  }

  const xmlText = fs.readFileSync(xmlPath, 'utf-8');

  // Test parsing "Like Wine"
  const result = parseItemV4VFromXML(xmlText, 'Like Wine');

  console.log('\n' + '='.repeat(60));
  console.log('📊 Parser Result for "Like Wine":');
  console.log('='.repeat(60));
  console.log('Recipient:', result.recipient);
  console.log('\nValue:', JSON.stringify(result.value, null, 2));
  console.log('='.repeat(60));

  // Verify the expected result
  if (result.value && result.value.recipients) {
    console.log('\n✅ Recipients found:', result.value.recipients.length);

    result.value.recipients.forEach((r: any) => {
      console.log(`  - ${r.name}: ${r.split}% (${r.address?.substring(0, 20)}...)`);
    });

    // Check if we have the expected 3 recipients with 45/45/10 splits
    const ableKirby = result.value.recipients.find((r: any) => r.name === 'AbleKirby');
    const sirSpencer = result.value.recipients.find((r: any) => r.name === 'SirSpencer');
    const booBury = result.value.recipients.find((r: any) => r.name === 'Boo-bury');

    console.log('\n🔍 Verification:');
    console.log(`  AbleKirby: ${ableKirby ? ableKirby.split + '%' : 'NOT FOUND'} (expected 45%)`);
    console.log(`  SirSpencer: ${sirSpencer ? sirSpencer.split + '%' : 'NOT FOUND'} (expected 45%)`);
    console.log(`  Boo-bury: ${booBury ? booBury.split + '%' : 'NOT FOUND'} (expected 10%)`);

    if (ableKirby?.split === '45' && sirSpencer?.split === '45' && booBury?.split === '10') {
      console.log('\n🎉 SUCCESS! Parser correctly extracted 45/45/10 splits with Boo-bury!');
    } else {
      console.log('\n❌ FAILURE! Parser did not extract the correct splits.');
    }
  } else {
    console.log('\n❌ No recipients found in parsed result.');
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
