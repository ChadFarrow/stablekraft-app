import { prisma } from '../lib/prisma';

async function checkLatestFeedSplits() {
  try {
    // Get the most recently added feed
    const feed = await prisma.feed.findFirst({
      orderBy: { createdAt: 'desc' },
      include: {
        Track: {
          take: 1
        }
      }
    });

    if (!feed) {
      console.log('❌ No feeds found');
      return;
    }

    console.log('📋 Latest Feed:');
    console.log('─'.repeat(80));
    console.log('Title:', feed.title);
    console.log('Artist:', feed.artist);
    console.log('URL:', feed.originalUrl);
    console.log('Added:', new Date(feed.createdAt).toLocaleString());
    console.log();

    console.log('💰 Feed-level V4V Info:');
    console.log('v4vRecipient:', feed.v4vRecipient || 'Not set');

    if (feed.v4vValue) {
      console.log('\nv4vValue structure:');
      console.log(JSON.stringify(feed.v4vValue, null, 2));

      const value = feed.v4vValue as any;
      if (value.recipients) {
        console.log('\n📊 Split Recipients:');
        value.recipients.forEach((r: any, i: number) => {
          console.log(`${i + 1}. ${r.name}`);
          console.log(`   Address: ${r.address}`);
          console.log(`   Split: ${r.split}%`);
          console.log(`   Type: ${r.type}`);
          console.log(`   Fee: ${r.fee || 'false'}`);

          if (r.name?.toLowerCase().includes('stablekraft') ||
              r.name?.toLowerCase().includes('platform')) {
            console.log('   ⚠️  This looks like a platform fee');
          }
          console.log();
        });
      }
    } else {
      console.log('❌ No v4vValue data');
    }

    // Check track-level v4v too
    if (feed.Track && feed.Track.length > 0) {
      console.log('\n📀 First Track V4V:');
      const track = feed.Track[0];
      console.log('Track:', track.title);
      console.log('v4vRecipient:', track.v4vRecipient || 'Not set');

      if (track.v4vValue) {
        console.log('\nTrack v4vValue:');
        console.log(JSON.stringify(track.v4vValue, null, 2));
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkLatestFeedSplits();
