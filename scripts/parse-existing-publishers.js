#!/usr/bin/env node
/**
 * One-time script to parse existing publisher feeds and link albums
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Extract all <podcast:remoteItem> tags from publisher feed XML
 */
function extractRemoteItemsFromXML(xml) {
  const items = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*>/gi;
  const matches = xml.match(remoteItemRegex) || [];

  for (const match of matches) {
    const feedGuidMatch = match.match(/feedGuid=["']([^"']+)["']/i);
    const feedUrlMatch = match.match(/feedUrl=["']([^"']+)["']/i);
    const mediumMatch = match.match(/medium=["']([^"']+)["']/i);

    const medium = mediumMatch?.[1] || '';
    if (medium === 'publisher') continue;

    if (feedGuidMatch || feedUrlMatch) {
      items.push({
        feedGuid: feedGuidMatch?.[1] || '',
        feedUrl: feedUrlMatch?.[1] || '',
        medium: medium || 'music'
      });
    }
  }

  return items;
}

async function linkAlbumsToPublisher(publisherId, remoteItems) {
  let linked = 0;

  for (const item of remoteItems) {
    const conditions = [];
    if (item.feedGuid) {
      conditions.push({ id: item.feedGuid });
    }
    if (item.feedUrl) {
      conditions.push({ originalUrl: item.feedUrl });
    }

    if (conditions.length === 0) continue;

    const result = await prisma.feed.updateMany({
      where: {
        OR: conditions,
        type: { in: ['album', 'music'] },
        publisherId: null
      },
      data: { publisherId }
    });

    linked += result.count;
  }

  return linked;
}

async function parseExistingPublishers() {
  console.log('🚀 Starting to parse existing publisher feeds...');

  const publishers = await prisma.feed.findMany({
    where: {
      type: 'publisher',
      status: 'active'
    },
    select: {
      id: true,
      title: true,
      originalUrl: true,
      lastFetched: true
    }
  });

  console.log(`📊 Found ${publishers.length} publisher feeds to process`);

  let parsed = 0;
  let totalLinked = 0;
  let failed = 0;

  for (const publisher of publishers) {
    if (!publisher.originalUrl) {
      failed++;
      continue;
    }

    try {
      process.stdout.write(`🔍 Parsing: ${publisher.title}... `);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(publisher.originalUrl, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.log(`⚠️ HTTP ${response.status}`);
        failed++;
        continue;
      }

      const xml = await response.text();
      const remoteItems = extractRemoteItemsFromXML(xml);

      if (remoteItems.length > 0) {
        const linked = await linkAlbumsToPublisher(publisher.id, remoteItems);
        totalLinked += linked;
        console.log(`🔗 ${linked}/${remoteItems.length} albums linked`);
      } else {
        console.log(`(no albums)`);
      }

      await prisma.feed.update({
        where: { id: publisher.id },
        data: { lastFetched: new Date() }
      });

      parsed++;

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.log(`❌ ${error.message || error}`);
      failed++;
    }
  }

  console.log(`\n📊 Publisher Parsing Complete:`);
  console.log(`   Total publishers: ${publishers.length}`);
  console.log(`   Successfully parsed: ${parsed}`);
  console.log(`   Albums linked: ${totalLinked}`);
  console.log(`   Failed: ${failed}`);

  await prisma.$disconnect();
}

parseExistingPublishers().catch(console.error);
