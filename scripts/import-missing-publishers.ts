import { prisma } from '../lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  // Load publisher feed results
  const publisherFeedResultsPath = path.join(process.cwd(), 'data/publisher-feed-results.json');
  const publisherFeedResults = JSON.parse(fs.readFileSync(publisherFeedResultsPath, 'utf-8'));

  console.log(`📁 Found ${publisherFeedResults.length} publishers in file`);
  console.log('');

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const result of publisherFeedResults) {
    const feedId = result.feed?.id;
    const feedUrl = result.feed?.originalUrl;
    const title = result.title?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const description = result.description?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const image = result.itunesImage;

    if (!feedId || !feedUrl || !title) {
      console.log(`⚠️  Skipping incomplete entry: ${feedId || 'unknown'}`);
      skipped++;
      continue;
    }

    // Check if it already exists
    const existing = await prisma.feed.findUnique({
      where: { id: feedId }
    });

    if (existing) {
      console.log(`✓ Already exists: ${title} (${feedId})`);
      skipped++;
      continue;
    }

    // Create the publisher feed
    try {
      await prisma.feed.create({
        data: {
          id: feedId,
          title: title,
          artist: title, // Use title as artist for publishers
          originalUrl: feedUrl,
          type: 'publisher',
          status: 'active',
          description: description || null,
          image: image || null,
          updatedAt: new Date()
        }
      });

      console.log(`✅ Imported: ${title} (${feedId})`);
      imported++;
    } catch (error) {
      console.error(`❌ Error importing ${title}:`, error);
      errors++;
    }
  }

  console.log('');
  console.log('📊 Summary:');
  console.log(`  ✅ Imported: ${imported}`);
  console.log(`  ✓ Skipped (already exists): ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);

  await prisma.$disconnect();
}

main().catch(console.error);
