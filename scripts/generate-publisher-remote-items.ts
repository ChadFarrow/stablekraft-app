#!/usr/bin/env ts-node

/**
 * Generate static publisher-remote-items.json
 *
 * This script fetches all publisher feeds and extracts their remoteItem GUIDs
 * to create a static mapping file that the albums API can use without fetching XML
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

// Helper function to normalize Wavlake URLs for comparison
function normalizeWavlakeUrl(url: string): string {
  if (!url) return '';

  // Extract the GUID from the URL (the last part after the last slash)
  const guidMatch = url.match(/([a-f0-9-]{36})/i);
  if (guidMatch) {
    return guidMatch[1].toLowerCase();
  }

  return url.toLowerCase();
}

async function fetchPublisherRemoteItems(publisherId: string, feedUrl: string): Promise<string[]> {
  console.log(`\n📡 Fetching: ${publisherId}`);
  console.log(`   URL: ${feedUrl}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(feedUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`   ⚠️  HTTP ${response.status} - skipping`);
      return [];
    }

    const xml = await response.text();

    // Extract remoteItem feedUrls using regex
    const remoteItemRegex = /<podcast:remoteItem[^>]*feedUrl="([^"]+)"/g;
    const guids: string[] = [];
    let match;

    while ((match = remoteItemRegex.exec(xml)) !== null) {
      const normalizedGuid = normalizeWavlakeUrl(match[1]);
      if (normalizedGuid) {
        guids.push(normalizedGuid);
      }
    }

    console.log(`   ✅ Found ${guids.length} remoteItems`);
    return guids;

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`   ⚠️  Timeout - skipping`);
    } else {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    return [];
  }
}

async function main() {
  console.log('🎵 Generating Publisher Remote Items Mapping');
  console.log('═'.repeat(70));

  const publisherFeedsPath = path.join(process.cwd(), 'data', 'publisher-feed-results.json');

  if (!fs.existsSync(publisherFeedsPath)) {
    console.error('❌ publisher-feed-results.json not found!');
    process.exit(1);
  }

  const publisherFeeds = JSON.parse(fs.readFileSync(publisherFeedsPath, 'utf-8'));
  console.log(`\n📋 Found ${publisherFeeds.length} publishers\n`);

  const remoteItemsMapping: Record<string, string[]> = {};
  let processed = 0;
  let successful = 0;
  let failed = 0;

  for (const publisherFeed of publisherFeeds) {
    const publisherId = publisherFeed.feed.id;
    const feedUrl = publisherFeed.feed.originalUrl;
    const publisherTitle = publisherFeed.title?.replace(/<!\[CDATA\[|\]\]>/g, '') || publisherId;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📻 [${processed + 1}/${publisherFeeds.length}] ${publisherTitle}`);

    processed++;

    const remoteItems = await fetchPublisherRemoteItems(publisherId, feedUrl);

    if (remoteItems.length > 0) {
      remoteItemsMapping[publisherId] = remoteItems;
      successful++;
    } else {
      console.log(`   ⚠️  No remoteItems found`);
      failed++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Write the mapping to file
  const outputPath = path.join(process.cwd(), 'data', 'publisher-remote-items.json');
  fs.writeFileSync(outputPath, JSON.stringify(remoteItemsMapping, null, 2));

  console.log(`\n${'═'.repeat(70)}`);
  console.log('\n✅ Complete!');
  console.log(`\n📊 Statistics:`);
  console.log(`   Total publishers: ${processed}`);
  console.log(`   Successful: ${successful}`);
  console.log(`   Failed/Empty: ${failed}`);
  console.log(`\n📁 Output: ${outputPath}`);
  console.log(`\n${'═'.repeat(70)}\n`);
}

main().catch(console.error);
