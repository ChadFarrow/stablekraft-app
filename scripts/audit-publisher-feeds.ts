import { prisma } from '../lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  // Get all publisher feeds from database
  const dbPublishers = await prisma.feed.findMany({
    where: {
      type: 'publisher'
    },
    select: {
      id: true,
      title: true,
      artist: true,
      originalUrl: true,
      status: true
    },
    orderBy: {
      title: 'asc'
    }
  });

  console.log('📊 Database Publishers:', dbPublishers.length);
  console.log('');

  // Load publisher mappings from url-utils.ts
  const urlUtilsPath = path.join(process.cwd(), 'lib/url-utils.ts');
  const urlUtilsContent = fs.readFileSync(urlUtilsPath, 'utf-8');

  // Extract publisher info mappings
  const publisherInfoMatch = urlUtilsContent.match(/const\s+publisherInfo:\s*Record<string,\s*\{[^}]+\}>\s*=\s*\{([^}]+\})\s*\}/s);

  console.log('📋 Database Publisher Feeds:');
  console.log('');

  for (const pub of dbPublishers) {
    console.log(`ID: ${pub.id}`);
    console.log(`  Title: ${pub.title}`);
    console.log(`  Artist: ${pub.artist || 'N/A'}`);
    console.log(`  URL: ${pub.originalUrl}`);
    console.log(`  Status: ${pub.status}`);
    console.log('');
  }

  // Load static publisher mappings from publisher-feed-results.json
  const publisherFeedResultsPath = path.join(process.cwd(), 'data/publisher-feed-results.json');
  if (fs.existsSync(publisherFeedResultsPath)) {
    const publisherFeedResults = JSON.parse(fs.readFileSync(publisherFeedResultsPath, 'utf-8'));

    console.log('📁 Publisher Feed Results from file:', publisherFeedResults.length);
    console.log('');

    // Check which ones are missing from database
    const missingFromDb = publisherFeedResults.filter((result: any) => {
      const feedId = result.feed?.id;
      return !dbPublishers.find(pub => pub.id === feedId);
    });

    if (missingFromDb.length > 0) {
      console.log('⚠️  Publishers in file but MISSING from database:');
      console.log('');
      for (const result of missingFromDb) {
        console.log(`ID: ${result.feed?.id}`);
        console.log(`  Title: ${result.title}`);
        console.log(`  URL: ${result.feed?.originalUrl}`);
        console.log('');
      }
    } else {
      console.log('✅ All publishers from file exist in database');
    }

    // Check which database publishers are NOT in the file
    const notInFile = dbPublishers.filter(pub => {
      return !publisherFeedResults.find((result: any) => result.feed?.id === pub.id);
    });

    if (notInFile.length > 0) {
      console.log('');
      console.log('⚠️  Publishers in database but NOT in file:');
      console.log('');
      for (const pub of notInFile) {
        console.log(`ID: ${pub.id}`);
        console.log(`  Title: ${pub.title}`);
        console.log(`  URL: ${pub.originalUrl}`);
        console.log('');
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
