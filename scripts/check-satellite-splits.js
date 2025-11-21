const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // Find the Satellite Spotlight feed
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { title: { contains: 'Satellite Spotlight' } },
          { originalUrl: { contains: 'satspotlightsymphony' } }
        ]
      },
      select: {
        id: true,
        title: true,
        originalUrl: true,
        v4vValue: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (!feed) {
      console.log('Feed not found');
      return;
    }

    console.log('Feed:', feed.title);
    console.log('URL:', feed.originalUrl);
    console.log('Track count:', feed._count.Track);
    console.log('\nv4vValue structure:');

    if (feed.v4vValue) {
      const v4v = typeof feed.v4vValue === 'string' ? JSON.parse(feed.v4vValue) : feed.v4vValue;
      const recipients = v4v.recipients || v4v.destinations || [];

      console.log('Recipients count:', recipients.length);
      console.log('\nFirst 10 recipients:');
      recipients.slice(0, 10).forEach((r, i) => {
        console.log(`  ${i+1}. ${r.name} - ${r.split}% (type: ${r.type}, address: ${r.address?.substring(0, 30)}...)`);
      });

      if (recipients.length > 20) {
        console.log('\nRecipients 11-20:');
        recipients.slice(10, 20).forEach((r, i) => {
          console.log(`  ${i+11}. ${r.name} - ${r.split}% (type: ${r.type})`);
        });
      }

      console.log('\nLast 10 recipients:');
      recipients.slice(-10).forEach((r, i) => {
        const idx = recipients.length - 10 + i + 1;
        console.log(`  ${idx}. ${r.name} - ${r.split}% (type: ${r.type})`);
      });

      // Check for duplicates
      const nameCount = new Map();
      recipients.forEach(r => {
        const count = nameCount.get(r.name) || 0;
        nameCount.set(r.name, count + 1);
      });

      const duplicates = Array.from(nameCount.entries()).filter(([_, count]) => count > 1);
      if (duplicates.length > 0) {
        console.log('\n⚠️  DUPLICATES FOUND:');
        duplicates.forEach(([name, count]) => {
          console.log(`  ${name}: appears ${count} times`);
        });
      }

      // Check total split percentage
      const totalSplit = recipients.reduce((sum, r) => sum + (parseInt(r.split) || 0), 0);
      console.log(`\nTotal split percentage: ${totalSplit}%`);

    } else {
      console.log('No v4vValue found');
    }

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
})();
