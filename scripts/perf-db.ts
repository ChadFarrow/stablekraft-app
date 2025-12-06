#!/usr/bin/env tsx

/**
 * Database Performance Profiler
 * Measures query performance across common database operations
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { PrismaClient, Prisma } from '@prisma/client';

interface QueryMetric {
  name: string;
  duration: number;
  rowCount: number;
}

const SLOW_QUERY_THRESHOLD = 100; // ms

// Create client with query logging
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
  ],
});

const queryMetrics: QueryMetric[] = [];

// Track query timing via Prisma events
prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
  if (e.duration > SLOW_QUERY_THRESHOLD) {
    console.log(`  ⚠️  Slow query (${e.duration}ms): ${e.query.substring(0, 100)}...`);
  }
});

async function measureQuery<T>(name: string, query: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await query();
  const duration = Date.now() - start;

  const rowCount = Array.isArray(result) ? result.length : 1;
  queryMetrics.push({ name, duration, rowCount });

  return result;
}

async function runProfiler() {
  console.log('\n📊 Database Performance Profiler\n');
  console.log('='.repeat(60));
  console.log(`Slow query threshold: ${SLOW_QUERY_THRESHOLD}ms\n`);

  // 1. Feed count (simple aggregation)
  console.log('1️⃣  Testing feed count...');
  await measureQuery('Feed count (all)', () =>
    prisma.feed.count()
  );

  await measureQuery('Feed count (active)', () =>
    prisma.feed.count({ where: { status: 'active' } })
  );

  // 2. Track count
  console.log('2️⃣  Testing track count...');
  await measureQuery('Track count (all)', () =>
    prisma.track.count()
  );

  // 3. Feed list (pagination test)
  console.log('3️⃣  Testing feed pagination...');
  await measureQuery('Feeds (limit 10)', () =>
    prisma.feed.findMany({ take: 10 })
  );

  await measureQuery('Feeds (limit 50)', () =>
    prisma.feed.findMany({ take: 50 })
  );

  await measureQuery('Feeds (limit 100)', () =>
    prisma.feed.findMany({ take: 100 })
  );

  // 4. Feeds with tracks (join)
  console.log('4️⃣  Testing feed + tracks join...');
  await measureQuery('Feeds with tracks (10 feeds, 20 tracks each)', () =>
    prisma.feed.findMany({
      take: 10,
      include: {
        Track: { take: 20 }
      }
    })
  );

  await measureQuery('Feeds with tracks (50 feeds, 50 tracks each)', () =>
    prisma.feed.findMany({
      take: 50,
      include: {
        Track: { take: 50 }
      }
    })
  );

  // 5. Complex query (similar to albums-fast) - OPTIMIZED version with select
  console.log('5️⃣  Testing complex query (albums-fast pattern - OPTIMIZED)...');
  await measureQuery('Active feeds with tracks + ordering (OPTIMIZED)', () =>
    prisma.feed.findMany({
      where: { status: 'active' },
      take: 500, // Match the limit used in albums-fast
      select: {
        id: true,
        guid: true,
        title: true,
        description: true,
        originalUrl: true,
        artist: true,
        image: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        v4vRecipient: true,
        v4vValue: true,
        Track: {
          where: { audioUrl: { not: '' } },
          select: {
            id: true,
            guid: true,
            title: true,
            duration: true,
            audioUrl: true,
            image: true,
            publishedAt: true,
            v4vRecipient: true,
            v4vValue: true,
            startTime: true,
            endTime: true,
          },
          orderBy: [
            { trackOrder: 'asc' },
            { publishedAt: 'asc' }
          ],
          take: 20 // Reduced from 50
        },
        _count: { select: { Track: true } }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    })
  );

  // 6. Text search (if applicable)
  console.log('6️⃣  Testing search queries...');
  await measureQuery('Search feeds by title (contains)', () =>
    prisma.feed.findMany({
      where: {
        title: { contains: 'a', mode: 'insensitive' }
      },
      take: 20
    })
  );

  // 7. Index effectiveness - by guid
  console.log('7️⃣  Testing indexed lookups...');
  const sampleFeed = await prisma.feed.findFirst();
  if (sampleFeed) {
    await measureQuery('Feed by ID (primary key)', () =>
      prisma.feed.findUnique({ where: { id: sampleFeed.id } })
    );

    if (sampleFeed.guid) {
      await measureQuery('Feed by GUID (indexed)', () =>
        prisma.feed.findFirst({ where: { guid: sampleFeed.guid } })
      );
    }
  }

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('📈 Results Summary\n');

  console.log('Query                                          | Time   | Rows');
  console.log('-'.repeat(60));

  for (const metric of queryMetrics) {
    const name = metric.name.padEnd(45);
    const time = `${metric.duration}ms`.padStart(6);
    const rows = String(metric.rowCount).padStart(5);
    const icon = metric.duration > SLOW_QUERY_THRESHOLD ? '⚠️ ' : '   ';
    console.log(`${icon}${name} | ${time} | ${rows}`);
  }

  // Statistics
  const totalTime = queryMetrics.reduce((sum, m) => sum + m.duration, 0);
  const avgTime = totalTime / queryMetrics.length;
  const slowQueries = queryMetrics.filter(m => m.duration > SLOW_QUERY_THRESHOLD);
  const maxQuery = queryMetrics.reduce((max, m) => m.duration > max.duration ? m : max);

  console.log('\n' + '='.repeat(60));
  console.log('📊 Statistics\n');
  console.log(`  Total queries:     ${queryMetrics.length}`);
  console.log(`  Total time:        ${totalTime}ms`);
  console.log(`  Average time:      ${avgTime.toFixed(1)}ms`);
  console.log(`  Slow queries:      ${slowQueries.length} (>${SLOW_QUERY_THRESHOLD}ms)`);
  console.log(`  Slowest query:     ${maxQuery.name} (${maxQuery.duration}ms)`);

  // Recommendations
  if (slowQueries.length > 0) {
    console.log('\n💡 Recommendations:');
    for (const sq of slowQueries) {
      console.log(`  - Optimize "${sq.name}" (${sq.duration}ms)`);
    }
  }

  await prisma.$disconnect();
}

runProfiler().catch(console.error);
