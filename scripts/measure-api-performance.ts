#!/usr/bin/env ts-node

/**
 * Performance measurement script for albums-fast API
 * Measures database query time, file I/O time, and total response time
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function measurePerformance() {
  console.log('🔍 Performance Measurement for albums-fast API\n');
  console.log('='.repeat(60));

  // 1. Count active feeds
  const startCount = Date.now();
  const activeFeedCount = await prisma.feed.count({
    where: { status: 'active' }
  });
  const countTime = Date.now() - startCount;
  console.log(`📊 Active feeds count: ${activeFeedCount}`);
  console.log(`⏱️  Count query time: ${countTime}ms\n`);

  // 2. Measure database query performance
  console.log('🔄 Measuring database query performance...');
  const startDb = Date.now();
  
  const feeds = await prisma.feed.findMany({
    where: { status: 'active' },
    include: {
      Track: {
        where: {
          audioUrl: { not: '' }
        },
        orderBy: [
          { trackOrder: 'asc' },
          { publishedAt: 'asc' },
          { createdAt: 'asc' }
        ],
        take: 50
      },
      _count: {
        select: { Track: true }
      }
    },
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'desc' }
    ]
  });
  
  const dbTime = Date.now() - startDb;
  const totalTracks = feeds.reduce((sum, feed) => sum + feed.Track.length, 0);
  const avgTracksPerFeed = totalTracks / feeds.length;
  
  console.log(`✅ Loaded ${feeds.length} feeds with ${totalTracks} tracks`);
  console.log(`📈 Average tracks per feed: ${avgTracksPerFeed.toFixed(2)}`);
  console.log(`⏱️  Database query time: ${dbTime}ms`);
  console.log(`   - Time per feed: ${(dbTime / feeds.length).toFixed(2)}ms`);
  console.log(`   - Time per track: ${(dbTime / totalTracks).toFixed(2)}ms\n`);

  // 3. Measure file I/O performance
  console.log('📁 Measuring file I/O performance...');
  const publisherDataPath = path.join(process.cwd(), 'public', 'publisher-stats.json');
  
  const startFile = Date.now();
  let publisherStats = [];
  if (fs.existsSync(publisherDataPath)) {
    const fileContent = fs.readFileSync(publisherDataPath, 'utf8');
    const publisherData = JSON.parse(fileContent);
    publisherStats = publisherData.publishers || [];
  }
  const fileTime = Date.now() - startFile;
  
  const fileStats = fs.statSync(publisherDataPath);
  console.log(`✅ Loaded ${publisherStats.length} publisher stats`);
  console.log(`📦 File size: ${(fileStats.size / 1024).toFixed(2)} KB`);
  console.log(`⏱️  File read & parse time: ${fileTime}ms\n`);

  // 4. Measure data transformation
  console.log('🔄 Measuring data transformation...');
  const startTransform = Date.now();
  
  const albums = feeds.map((feed) => ({
    id: feed.id,
    title: feed.title,
    artist: feed.artist || feed.title,
    description: feed.description || '',
    coverArt: feed.image || '',
    releaseDate: feed.updatedAt || feed.createdAt,
    tracks: feed.Track.map((track) => ({
      id: track.id,
      title: track.title,
      duration: track.duration || 180,
      url: track.audioUrl,
      image: track.image,
      publishedAt: track.publishedAt,
      guid: track.guid
    }))
  }));
  
  const transformTime = Date.now() - startTransform;
  console.log(`✅ Transformed ${albums.length} feeds into albums`);
  console.log(`⏱️  Transformation time: ${transformTime}ms`);
  console.log(`   - Time per album: ${(transformTime / albums.length).toFixed(2)}ms\n`);

  // 5. Estimate JSON serialization
  const startJson = Date.now();
  const jsonString = JSON.stringify({
    success: true,
    albums: albums.slice(0, 50), // Sample size
    totalCount: albums.length,
    publisherStats
  });
  const jsonTime = Date.now() - startJson;
  const jsonSize = Buffer.byteLength(jsonString, 'utf8');
  console.log(`📤 JSON serialization (sample): ${(jsonSize / 1024).toFixed(2)} KB`);
  console.log(`⏱️  Serialization time (sample): ${jsonTime}ms\n`);

  // 6. Total estimated time
  const totalTime = dbTime + fileTime + transformTime;
  console.log('='.repeat(60));
  console.log('📊 Performance Summary:');
  console.log(`   Database Query:  ${dbTime}ms (${((dbTime / totalTime) * 100).toFixed(1)}%)`);
  console.log(`   File I/O:        ${fileTime}ms (${((fileTime / totalTime) * 100).toFixed(1)}%)`);
  console.log(`   Transformation:  ${transformTime}ms (${((transformTime / totalTime) * 100).toFixed(1)}%)`);
  console.log(`   ─────────────────────────`);
  console.log(`   Total:            ${totalTime}ms\n`);

  // 7. Recommendations
  console.log('💡 Recommendations:');
  if (dbTime > 500) {
    console.log(`   ⚠️  Database query is slow (${dbTime}ms). Consider:`);
    console.log(`      - Adding limits to initial load`);
    console.log(`      - Using database-level pagination`);
    console.log(`      - Implementing incremental loading`);
  }
  if (feeds.length > 100) {
    console.log(`   ⚠️  Loading ${feeds.length} feeds at once. Consider:`);
    console.log(`      - Pagination (limit to 50-100 feeds initially)`);
    console.log(`      - Lazy loading for less important feeds`);
  }
  if (avgTracksPerFeed > 30) {
    console.log(`   ⚠️  High track count per feed (${avgTracksPerFeed.toFixed(1)}). Consider:`);
    console.log(`      - Reducing tracks per feed limit (currently 50)`);
    console.log(`      - Loading tracks on-demand`);
  }

  await prisma.$disconnect();
}

measurePerformance().catch(console.error);

