#!/usr/bin/env tsx

/**
 * API Performance Tester
 * Measures response times for all major API endpoints
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface EndpointResult {
  endpoint: string;
  status: number;
  time: number;
  size: number;
  error?: string;
}

const PLAYLISTS = ['mmm', 'hgh', 'iam', 'itdv', 'b4ts', 'upbeats', 'mmt', 'sas'];

const ENDPOINTS = [
  // Core API endpoints
  '/api/albums-fast',
  '/api/feeds?limit=50',
  '/api/music-tracks?limit=50',
  '/api/playlists-fast',

  // Individual playlists
  ...PLAYLISTS.map(p => `/api/playlist/${p}`),
];

async function testEndpoint(path: string): Promise<EndpointResult> {
  const url = `${BASE_URL}${path}`;
  const start = Date.now();

  try {
    const response = await fetch(url);
    const time = Date.now() - start;
    const text = await response.text();

    return {
      endpoint: path,
      status: response.status,
      time,
      size: Buffer.byteLength(text, 'utf8'),
    };
  } catch (error) {
    return {
      endpoint: path,
      status: 0,
      time: Date.now() - start,
      size: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runTests() {
  console.log('\n🚀 API Performance Tester\n');
  console.log('='.repeat(70));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Endpoints: ${ENDPOINTS.length}\n`);

  // Check if server is running
  try {
    await fetch(`${BASE_URL}/api/feeds?limit=1`);
  } catch {
    console.error('❌ Server not reachable at', BASE_URL);
    console.error('   Start the dev server with: npm run dev\n');
    process.exit(1);
  }

  const results: EndpointResult[] = [];

  // Test each endpoint
  for (const endpoint of ENDPOINTS) {
    process.stdout.write(`  Testing ${endpoint}... `);
    const result = await testEndpoint(endpoint);
    results.push(result);

    if (result.error) {
      console.log(`❌ ${result.error}`);
    } else {
      const icon = result.time > 1000 ? '⚠️ ' : result.time > 500 ? '🟡' : '✅';
      console.log(`${icon} ${result.time}ms (${formatSize(result.size)})`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📈 Results Summary\n');

  console.log('Endpoint                                  | Status | Time    | Size');
  console.log('-'.repeat(70));

  for (const r of results) {
    const endpoint = r.endpoint.padEnd(40);
    const status = r.error ? 'ERR'.padStart(6) : String(r.status).padStart(6);
    const time = `${r.time}ms`.padStart(7);
    const size = formatSize(r.size).padStart(8);
    const icon = r.error ? '❌' : r.time > 1000 ? '⚠️ ' : '  ';
    console.log(`${icon}${endpoint} | ${status} | ${time} | ${size}`);
  }

  // Statistics
  const times = results.filter(r => !r.error).map(r => r.time);
  const totalSize = results.reduce((sum, r) => sum + r.size, 0);
  const errors = results.filter(r => r.error);

  console.log('\n' + '='.repeat(70));
  console.log('📊 Statistics\n');
  console.log(`  Endpoints tested:  ${results.length}`);
  console.log(`  Successful:        ${results.length - errors.length}`);
  console.log(`  Failed:            ${errors.length}`);
  console.log(`  Total payload:     ${formatSize(totalSize)}`);

  if (times.length > 0) {
    console.log(`\n  Response times:`);
    console.log(`    Min:             ${Math.min(...times)}ms`);
    console.log(`    Max:             ${Math.max(...times)}ms`);
    console.log(`    Average:         ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms`);
    console.log(`    P50 (median):    ${percentile(times, 50)}ms`);
    console.log(`    P95:             ${percentile(times, 95)}ms`);
    console.log(`    P99:             ${percentile(times, 99)}ms`);
  }

  // Recommendations
  const slowEndpoints = results.filter(r => r.time > 1000);
  if (slowEndpoints.length > 0) {
    console.log('\n💡 Slow Endpoints (>1s):');
    for (const r of slowEndpoints) {
      console.log(`  - ${r.endpoint}: ${r.time}ms`);
    }
  }

  console.log('');
}

runTests().catch(console.error);
