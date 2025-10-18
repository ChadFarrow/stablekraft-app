// Quick fix script for Wavlake Album titles
// Run with: node fix-titles-now.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const fixes = [
  { old: 'Wavlake Album 1', new: 'Tinderbox', artist: 'Nate Johnivan' },
  { old: 'Wavlake Album 2', new: 'Singles', artist: 'Nate Johnivan' },
  { old: 'Wavlake Album 5', new: 'Fight!', artist: 'Nate Johnivan' },
  { old: 'Wavlake Album 16', new: 'THEY RIDE', artist: 'IROH' }
];

async function fixTitles() {
  console.log('🔧 Fixing Wavlake Album titles...');
  
  for (const fix of fixes) {
    try {
      const result = await prisma.feed.updateMany({
        where: { title: fix.old },
        data: { 
          title: fix.new,
          artist: fix.artist,
          lastFetched: new Date()
        }
      });
      
      console.log(`✅ "${fix.old}" → "${fix.new}" (${result.count} updated)`);
    } catch (error) {
      console.error(`❌ Error fixing "${fix.old}":`, error.message);
    }
  }
  
  await prisma.$disconnect();
  console.log('🎉 Done!');
}

fixTitles();