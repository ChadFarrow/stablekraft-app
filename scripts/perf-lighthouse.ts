#!/usr/bin/env tsx

/**
 * Lighthouse Performance Tester
 * Runs Lighthouse audits on key pages and reports metrics
 *
 * Requires: npm install -D lighthouse
 * Usage: npm run perf:lighthouse
 *
 * Note: Dev server must be running at localhost:3000
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.env.LIGHTHOUSE_URL || 'http://localhost:3000';

const PAGES_TO_TEST = [
  '/',
  '/playlist/mmm',
  '/playlist/hgh',
];

interface LighthouseResult {
  page: string;
  performance: number;
  fcp: number;  // First Contentful Paint
  lcp: number;  // Largest Contentful Paint
  cls: number;  // Cumulative Layout Shift
  tti: number;  // Time to Interactive
  tbt: number;  // Total Blocking Time
  error?: string;
}

function runLighthouse(url: string): Promise<LighthouseResult> {
  return new Promise((resolve) => {
    const page = url.replace(BASE_URL, '') || '/';
    const outputPath = path.join(process.cwd(), 'reports', `lighthouse-${page.replace(/\//g, '_')}.json`);

    console.log(`  Testing ${page}...`);

    const args = [
      url,
      '--output=json',
      `--output-path=${outputPath}`,
      '--chrome-flags="--headless --no-sandbox"',
      '--only-categories=performance',
      '--quiet',
    ];

    const proc = spawn('npx', ['lighthouse', ...args], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data; });
    proc.stderr?.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        resolve({
          page,
          performance: 0,
          fcp: 0,
          lcp: 0,
          cls: 0,
          tti: 0,
          tbt: 0,
          error: stderr || 'Lighthouse failed to run',
        });
        return;
      }

      try {
        const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
        const audits = report.audits;

        resolve({
          page,
          performance: Math.round((report.categories.performance?.score || 0) * 100),
          fcp: audits['first-contentful-paint']?.numericValue || 0,
          lcp: audits['largest-contentful-paint']?.numericValue || 0,
          cls: audits['cumulative-layout-shift']?.numericValue || 0,
          tti: audits['interactive']?.numericValue || 0,
          tbt: audits['total-blocking-time']?.numericValue || 0,
        });
      } catch (e) {
        resolve({
          page,
          performance: 0,
          fcp: 0,
          lcp: 0,
          cls: 0,
          tti: 0,
          tbt: 0,
          error: 'Failed to parse Lighthouse report',
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        page,
        performance: 0,
        fcp: 0,
        lcp: 0,
        cls: 0,
        tti: 0,
        tbt: 0,
        error: `Spawn error: ${err.message}`,
      });
    });
  });
}

function formatMs(ms: number): string {
  if (ms === 0) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function scoreIcon(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 50) return '🟡';
  return '🔴';
}

async function runTests() {
  console.log('\n🔦 Lighthouse Performance Tester\n');
  console.log('='.repeat(70));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Pages: ${PAGES_TO_TEST.length}\n`);

  // Create reports directory
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Check if server is running
  try {
    await fetch(BASE_URL);
  } catch {
    console.error('❌ Server not reachable at', BASE_URL);
    console.error('   Start the dev server with: npm run dev\n');
    process.exit(1);
  }

  // Check if lighthouse is installed
  try {
    const { execSync } = require('child_process');
    execSync('npx lighthouse --version', { stdio: 'ignore' });
  } catch {
    console.error('❌ Lighthouse not found');
    console.error('   Install with: npm install -D lighthouse\n');
    process.exit(1);
  }

  console.log('Running Lighthouse audits (this may take a while)...\n');

  const results: LighthouseResult[] = [];

  for (const pagePath of PAGES_TO_TEST) {
    const url = `${BASE_URL}${pagePath}`;
    const result = await runLighthouse(url);
    results.push(result);

    if (result.error) {
      console.log(`    ❌ ${result.error}`);
    } else {
      console.log(`    ${scoreIcon(result.performance)} Score: ${result.performance}`);
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('📈 Results Summary\n');

  console.log('Page               | Score | FCP     | LCP     | CLS   | TTI     | TBT');
  console.log('-'.repeat(70));

  for (const r of results) {
    if (r.error) {
      console.log(`${r.page.padEnd(18)} | ERROR: ${r.error}`);
      continue;
    }

    const page = r.page.padEnd(18);
    const score = `${scoreIcon(r.performance)} ${String(r.performance).padStart(3)}`;
    const fcp = formatMs(r.fcp).padStart(7);
    const lcp = formatMs(r.lcp).padStart(7);
    const cls = r.cls.toFixed(3).padStart(5);
    const tti = formatMs(r.tti).padStart(7);
    const tbt = formatMs(r.tbt).padStart(5);

    console.log(`${page} | ${score} | ${fcp} | ${lcp} | ${cls} | ${tti} | ${tbt}`);
  }

  // Metrics explanation
  console.log('\n📚 Metrics Guide:');
  console.log('  FCP = First Contentful Paint (target: <1.8s)');
  console.log('  LCP = Largest Contentful Paint (target: <2.5s)');
  console.log('  CLS = Cumulative Layout Shift (target: <0.1)');
  console.log('  TTI = Time to Interactive (target: <3.8s)');
  console.log('  TBT = Total Blocking Time (target: <200ms)');

  // Overall score
  const validResults = results.filter(r => !r.error);
  if (validResults.length > 0) {
    const avgScore = Math.round(validResults.reduce((sum, r) => sum + r.performance, 0) / validResults.length);
    console.log(`\n📊 Average Performance Score: ${scoreIcon(avgScore)} ${avgScore}/100`);
  }

  console.log(`\n📁 Full reports saved to: ${reportsDir}/`);
  console.log('');
}

runTests().catch(console.error);
