import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

const LARA_J_GUIDS = [
  'ccb1931a-cc7e-4d5e-8a7a-fc53c2b4459c',
  '043cd1f4-5ce2-4dc6-9a3a-8138bc271793',
  '64e50091-3301-4878-b38d-9cb1dfa895fe',
  '79f5f4f0-a774-40ed-abdf-90ada1980a71',
];

async function checkLaraJ() {
  console.log('🔍 Checking Lara J albums...\n');

  for (const guid of LARA_J_GUIDS) {
    const feedUrl = `https://wavlake.com/feed/music/${guid}`;

    const feed = await prisma.feed.findFirst({
      where: {
        originalUrl: feedUrl,
        type: 'album',
        status: 'active'
      },
      select: {
        title: true,
        artist: true,
        _count: {
          select: { Track: true }
        }
      }
    });

    if (feed) {
      console.log(`✅ ${guid}`);
      console.log(`   Title: ${feed.title}`);
      console.log(`   Artist: ${feed.artist}`);
      console.log(`   Tracks: ${feed._count.Track}`);
    } else {
      console.log(`❌ ${guid} - NOT IN DATABASE`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

checkLaraJ();
