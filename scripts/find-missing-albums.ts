/**
 * Find Missing Publisher Albums
 * Identifies which albums listed in publisher-remote-items.json are not yet in the database
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

async function findMissingAlbums() {
  console.log('🔍 Finding missing publisher albums...\n');

  // Load the static mapping
  const publisherMapping = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'data', 'publisher-remote-items.json'), 'utf-8')
  );

  // Get all GUIDs from the mapping
  const allMappedGuids = new Set<string>();
  for (const [publisherId, guids] of Object.entries(publisherMapping)) {
    (guids as string[]).forEach(guid => allMappedGuids.add(guid));
  }

  console.log(`📊 Total GUIDs in publisher mapping: ${allMappedGuids.size}`);

  // Get all existing album feeds
  const feeds = await prisma.feed.findMany({
    where: {
      type: 'album',
      status: 'active'
    },
    select: {
      originalUrl: true
    }
  });

  // Extract GUIDs from feed URLs
  const existingGuids = new Set<string>();
  for (const feed of feeds) {
    if (feed.originalUrl?.includes('wavlake.com/feed/music/')) {
      const guid = feed.originalUrl.split('wavlake.com/feed/music/')[1];
      if (guid && guid.length === 36) {
        existingGuids.add(guid);
      }
    }
  }

  console.log(`📊 Total GUIDs in database: ${existingGuids.size}`);

  // Find missing GUIDs
  const missingGuids = Array.from(allMappedGuids).filter(
    guid => !existingGuids.has(guid)
  );

  console.log(`📊 Total missing GUIDs: ${missingGuids.length}\n`);

  if (missingGuids.length > 0) {
    console.log('Missing GUIDs (formatted for sync script):');
    console.log('[');
    missingGuids.sort().forEach((guid, index) => {
      const comma = index < missingGuids.length - 1 ? ',' : '';
      console.log(`  '${guid}'${comma}`);
    });
    console.log(']');
  }

  await prisma.$disconnect();
}

findMissingAlbums().catch(error => {
  console.error('💥 Error:', error);
  prisma.$disconnect();
  process.exit(1);
});
