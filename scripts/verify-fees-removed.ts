import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

async function verifyFeesRemoved() {
  console.log('🔍 Checking for remaining fee recipients...\n');

  // Check feeds
  const feeds = await prisma.feed.findMany({
    where: { v4vValue: { not: Prisma.JsonNull } },
    select: { id: true, title: true, v4vValue: true }
  });

  let feedsWithFees = 0;
  let totalFeeRecipients = 0;

  feeds.forEach(feed => {
    const v4v = feed.v4vValue as any;
    const recipients = v4v?.recipients || v4v?.destinations || [];
    const feeRecipients = recipients.filter((r: any) => r.fee === 'true' || r.fee === true);

    if (feeRecipients.length > 0) {
      feedsWithFees++;
      totalFeeRecipients += feeRecipients.length;
      console.log(`❌ Feed "${feed.title}" still has ${feeRecipients.length} fee recipient(s)`);
    }
  });

  console.log(`\n📊 Feeds Summary:`);
  console.log(`   Total feeds with v4vValue: ${feeds.length}`);
  console.log(`   Feeds with fee recipients: ${feedsWithFees}`);
  console.log(`   Total fee recipients in feeds: ${totalFeeRecipients}`);

  // Check tracks
  const tracks = await prisma.track.findMany({
    where: { v4vValue: { not: Prisma.JsonNull } },
    select: { id: true, title: true, v4vValue: true }
  });

  let tracksWithFees = 0;
  let totalTrackFeeRecipients = 0;

  tracks.forEach(track => {
    const v4v = track.v4vValue as any;
    const recipients = v4v?.recipients || v4v?.destinations || [];
    const feeRecipients = recipients.filter((r: any) => r.fee === 'true' || r.fee === true);

    if (feeRecipients.length > 0) {
      tracksWithFees++;
      totalTrackFeeRecipients += feeRecipients.length;
    }
  });

  console.log(`\n📊 Tracks Summary:`);
  console.log(`   Total tracks with v4vValue: ${tracks.length}`);
  console.log(`   Tracks with fee recipients: ${tracksWithFees}`);
  console.log(`   Total fee recipients in tracks: ${totalTrackFeeRecipients}`);

  if (feedsWithFees === 0 && tracksWithFees === 0) {
    console.log('\n✅ ALL CLEAN! No fee recipients found in database.');
  } else {
    console.log('\n⚠️ WARNING: Some fee recipients still remain in database.');
  }

  await prisma.$disconnect();
}

verifyFeesRemoved();
