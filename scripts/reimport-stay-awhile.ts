/**
 * Script to update "Like Wine" track with corrected v4v splits
 */

import { PrismaClient } from '@prisma/client';
import { parseItemV4VFromXML } from '../lib/rss-parser-db';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Updating "Like Wine" track with corrected v4v splits...\n');

  try {
    // Read the Stay Awhile XML feed
    const xmlPath = '/tmp/stay-awhile.xml';

    if (!fs.existsSync(xmlPath)) {
      console.log('📡 Fetching feed from Wavlake...');
      const response = await fetch('https://mp3.wavlake.com/feed/9ce6aa11-c315-46ef-9eae-4d0ba1e5f97e.xml');
      const xml = await response.text();
      fs.writeFileSync(xmlPath, xml);
      console.log('✅ Feed saved to', xmlPath);
    }

    const xmlText = fs.readFileSync(xmlPath, 'utf-8');

    // Parse "Like Wine" v4v data
    console.log('🔍 Parsing v4v data for "Like Wine"...');
    const result = parseItemV4VFromXML(xmlText, 'Like Wine');

    if (!result.value || !result.value.recipients) {
      throw new Error('Failed to parse v4v data for "Like Wine"');
    }

    console.log('✅ Parsed v4v data:');
    result.value.recipients.forEach((r: any) => {
      console.log(`  - ${r.name}: ${r.split}%`);
    });

    // Find the "Like Wine" track
    console.log('\n🔍 Finding "Like Wine" track in database...');

    const likeWineTrack = await prisma.track.findFirst({
      where: {
        title: 'Like Wine',
        Feed: {
          title: 'Stay Awhile'
        }
      },
      include: {
        Feed: true
      }
    });

    if (!likeWineTrack) {
      throw new Error('Could not find "Like Wine" track in database');
    }

    console.log('✅ Found track:', likeWineTrack.title);
    console.log('   Feed:', likeWineTrack.Feed?.title);

    // Update the track with corrected v4v data
    console.log('\n📝 Updating track with corrected v4v splits...');

    const v4vData = {
      type: result.value.type,
      method: result.value.method,
      suggested: result.value.suggested,
      recipients: result.value.recipients.map((r: any) => ({
        name: r.name,
        type: r.type,
        address: r.address,
        split: parseInt(r.split, 10), // Convert string to number
        customKey: r.customKey,
        customValue: r.customValue,
        fee: r.fee || false
      }))
    };

    await prisma.track.update({
      where: { id: likeWineTrack.id },
      data: {
        v4vValue: v4vData,
        v4vRecipient: result.recipient
      }
    });

    console.log('✅ Track updated successfully!');

    // Verify the update
    console.log('\n🔍 Verifying update...');
    const updatedTrack = await prisma.track.findUnique({
      where: { id: likeWineTrack.id }
    });

    if (updatedTrack?.v4vValue) {
      const v4vValue = typeof updatedTrack.v4vValue === 'string'
        ? JSON.parse(updatedTrack.v4vValue)
        : updatedTrack.v4vValue;

      console.log('\n📊 Updated recipients:');
      v4vValue.recipients?.forEach((r: any) => {
        console.log(`  - ${r.name}: ${r.split}%`);
      });

      // Verify the expected splits
      const ableKirby = v4vValue.recipients?.find((r: any) => r.name === 'AbleKirby');
      const sirSpencer = v4vValue.recipients?.find((r: any) => r.name === 'SirSpencer');
      const booBury = v4vValue.recipients?.find((r: any) => r.name === 'Boo-bury');

      if (ableKirby?.split === 45 && sirSpencer?.split === 45 && booBury?.split === 10) {
        console.log('\n🎉 SUCCESS! Track now has correct 45/45/10 splits with Boo-bury!');
      } else {
        console.log('\n⚠️ WARNING: Track splits do not match expected 45/45/10 with Boo-bury');
      }
    }

  } catch (error) {
    console.error('❌ Error during re-import:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
