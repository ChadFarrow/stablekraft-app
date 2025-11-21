import { prisma } from '../lib/prisma';

async function checkFees() {
  // Get non-Wavlake feeds with v4v data
  const feeds = await prisma.feed.findMany({
    where: {
      v4vValue: { not: null },
      artist: { not: { contains: 'wavlake', mode: 'insensitive' } },
      title: { not: { contains: 'wavlake', mode: 'insensitive' } }
    },
    select: {
      title: true,
      artist: true,
      v4vValue: true
    },
    take: 5
  });

  console.log('Non-Wavlake feeds with v4v data:');
  feeds.forEach(feed => {
    const v4v = feed.v4vValue as any;
    const recipients = v4v?.recipients || v4v?.destinations || [];
    const hasFee = recipients.some((r: any) => r.fee === 'true' || r.fee === true);
    console.log(`\n📻 ${feed.title} by ${feed.artist}`);
    console.log(`   Recipients: ${recipients.length}, Has fee: ${hasFee}`);
    recipients.forEach((r: any) => {
      console.log(`   - ${r.name}: ${r.split}% (fee: ${r.fee || 'false'})`);
    });
  });

  await prisma.$disconnect();
}

checkFees();
