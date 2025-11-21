const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // Find a track with 317 recipients
    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: { contains: 'satspotlightsymphony' }
      },
      select: {
        Track: {
          where: {
            title: 'Trailer'
          },
          select: {
            id: true,
            title: true,
            v4vValue: true
          },
          take: 1
        }
      }
    });

    const track = feed?.Track[0];

    if (!track || !track.v4vValue) {
      console.log('Track not found or has no v4vValue');
      return;
    }

    const v4v = typeof track.v4vValue === 'string' ? JSON.parse(track.v4vValue) : track.v4vValue;
    const recipients = v4v.recipients || v4v.destinations || [];

    console.log(`Track: "${track.title}"`);
    console.log(`Total recipients: ${recipients.length}\n`);

    // Check for duplicates by name
    const nameCount = new Map();
    recipients.forEach(r => {
      const count = nameCount.get(r.name) || 0;
      nameCount.set(r.name, count + 1);
    });

    const duplicates = Array.from(nameCount.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]); // Sort by count descending

    console.log(`Unique recipient names: ${nameCount.size}`);
    console.log(`Recipients with duplicates: ${duplicates.length}\n`);

    if (duplicates.length > 0) {
      console.log('=== TOP 20 DUPLICATES ===');
      duplicates.slice(0, 20).forEach(([name, count]) => {
        console.log(`${name}: ${count} times`);
      });

      // Check if they have different addresses or just duplicate entries
      console.log('\n=== CHECKING FIRST DUPLICATE ===');
      const [firstName, _] = duplicates[0];
      const instances = recipients.filter(r => r.name === firstName);
      console.log(`Name: ${firstName}`);
      console.log(`Appears ${instances.length} times`);
      console.log('\nFirst 3 instances:');
      instances.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i+1}. split: ${r.split}%, type: ${r.type}, address: ${r.address?.substring(0, 40)}...`);
      });

      // Check if addresses are all the same
      const uniqueAddresses = new Set(instances.map(r => r.address));
      console.log(`\nUnique addresses for this recipient: ${uniqueAddresses.size}`);
    }

    // Calculate total split
    const totalSplit = recipients.reduce((sum, r) => sum + (parseInt(r.split) || 0), 0);
    console.log(`\n=== SPLIT TOTALS ===`);
    console.log(`Total split percentage: ${totalSplit}%`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
