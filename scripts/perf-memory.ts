#!/usr/bin/env tsx

/**
 * Memory Usage Profiler
 * Tracks memory consumption during common operations
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MemorySnapshot {
  label: string;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
}

const snapshots: MemorySnapshot[] = [];

function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function takeSnapshot(label: string): MemorySnapshot {
  const mem = process.memoryUsage();
  const snapshot = {
    label,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
  };
  snapshots.push(snapshot);
  return snapshot;
}

function compareSnapshots(before: MemorySnapshot, after: MemorySnapshot): void {
  const heapDiff = after.heapUsed - before.heapUsed;
  const rssDiff = after.rss - before.rss;

  const heapIcon = heapDiff > 10 * 1024 * 1024 ? '⚠️ ' : heapDiff > 0 ? '📈' : '📉';
  console.log(`  ${heapIcon} Heap change: ${heapDiff >= 0 ? '+' : ''}${formatMB(heapDiff)}`);
  console.log(`     RSS change:  ${rssDiff >= 0 ? '+' : ''}${formatMB(rssDiff)}`);
}

async function runProfiler() {
  console.log('\n🧠 Memory Usage Profiler\n');
  console.log('='.repeat(60));

  // Baseline
  if (global.gc) {
    global.gc();
  }
  const baseline = takeSnapshot('Baseline (after GC)');
  console.log(`\n📍 Baseline:`);
  console.log(`   Heap used:  ${formatMB(baseline.heapUsed)}`);
  console.log(`   Heap total: ${formatMB(baseline.heapTotal)}`);
  console.log(`   RSS:        ${formatMB(baseline.rss)}`);

  // Test 1: Load all feeds
  console.log('\n1️⃣  Loading all feeds...');
  const beforeFeeds = takeSnapshot('Before feeds');
  const feeds = await prisma.feed.findMany();
  const afterFeeds = takeSnapshot('After feeds');
  console.log(`   Loaded ${feeds.length} feeds`);
  compareSnapshots(beforeFeeds, afterFeeds);

  // Test 2: Load feeds with tracks
  console.log('\n2️⃣  Loading feeds with tracks...');
  const beforeTracks = takeSnapshot('Before tracks');
  const feedsWithTracks = await prisma.feed.findMany({
    include: { Track: { take: 50 } }
  });
  const afterTracks = takeSnapshot('After tracks');
  const trackCount = feedsWithTracks.reduce((sum, f) => sum + f.Track.length, 0);
  console.log(`   Loaded ${feedsWithTracks.length} feeds with ${trackCount} tracks`);
  compareSnapshots(beforeTracks, afterTracks);

  // Test 3: Large JSON serialization
  console.log('\n3️⃣  JSON serialization test...');
  const beforeJson = takeSnapshot('Before JSON');
  const jsonData = JSON.stringify(feedsWithTracks);
  const afterJson = takeSnapshot('After JSON');
  console.log(`   JSON size: ${formatMB(Buffer.byteLength(jsonData, 'utf8'))}`);
  compareSnapshots(beforeJson, afterJson);

  // Test 4: Simulate data accumulation
  console.log('\n4️⃣  Data accumulation test...');
  const beforeAccum = takeSnapshot('Before accumulation');
  const accumulated: any[] = [];
  for (let i = 0; i < 10; i++) {
    const batch = await prisma.feed.findMany({
      include: { Track: { take: 20 } }
    });
    accumulated.push(...batch);
  }
  const afterAccum = takeSnapshot('After accumulation');
  console.log(`   Accumulated ${accumulated.length} records over 10 iterations`);
  compareSnapshots(beforeAccum, afterAccum);

  // Cleanup and final snapshot
  console.log('\n5️⃣  Cleanup test...');
  accumulated.length = 0; // Clear array
  if (global.gc) {
    global.gc();
    console.log('   Ran garbage collection');
  } else {
    console.log('   GC not exposed (run with --expose-gc for accurate results)');
  }
  const final = takeSnapshot('Final');

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Memory Timeline\n');

  console.log('Snapshot                        | Heap Used  | Heap Total | RSS');
  console.log('-'.repeat(60));

  for (const s of snapshots) {
    const label = s.label.padEnd(30);
    const heapUsed = formatMB(s.heapUsed).padStart(10);
    const heapTotal = formatMB(s.heapTotal).padStart(10);
    const rss = formatMB(s.rss).padStart(10);
    console.log(`${label} | ${heapUsed} | ${heapTotal} | ${rss}`);
  }

  // Total growth
  const totalHeapGrowth = final.heapUsed - baseline.heapUsed;
  const totalRssGrowth = final.rss - baseline.rss;
  const peakHeap = Math.max(...snapshots.map(s => s.heapUsed));

  console.log('\n' + '='.repeat(60));
  console.log('📈 Summary\n');
  console.log(`  Peak heap:         ${formatMB(peakHeap)}`);
  console.log(`  Final heap:        ${formatMB(final.heapUsed)}`);
  console.log(`  Net heap growth:   ${totalHeapGrowth >= 0 ? '+' : ''}${formatMB(totalHeapGrowth)}`);
  console.log(`  Net RSS growth:    ${totalRssGrowth >= 0 ? '+' : ''}${formatMB(totalRssGrowth)}`);

  // Recommendations
  if (totalHeapGrowth > 50 * 1024 * 1024) {
    console.log('\n⚠️  Warning: Significant memory growth detected');
    console.log('   Consider implementing:');
    console.log('   - Pagination for large queries');
    console.log('   - Streaming responses for large datasets');
    console.log('   - Cache eviction policies');
  }

  await prisma.$disconnect();
  console.log('');
}

runProfiler().catch(console.error);
