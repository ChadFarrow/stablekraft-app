#!/usr/bin/env node
/**
 * One-time script to discover all publishers from existing album feeds
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function discoverAllPublishers() {
  console.log('🚀 Starting publisher discovery for all album feeds...');

  const albumFeeds = await prisma.feed.findMany({
    where: {
      type: { in: ['album', 'music'] },
      status: 'active'
    },
    select: {
      id: true,
      title: true,
      originalUrl: true
    }
  });

  console.log(`📊 Found ${albumFeeds.length} album feeds to process`);

  let discovered = 0;
  let failed = 0;
  let alreadyExists = 0;

  for (const feed of albumFeeds) {
    if (!feed.originalUrl) continue;

    try {
      // Fetch album feed XML
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(feed.originalUrl, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        failed++;
        continue;
      }

      const xml = await response.text();

      // Extract publisher reference
      const remoteItemRegex = /<podcast:remoteItem[^>]*medium=["']publisher["'][^>]*>/gi;
      const matches = xml.match(remoteItemRegex);

      if (!matches || matches.length === 0) {
        continue;
      }

      const match = matches[0];
      const feedGuidMatch = match.match(/feedGuid=["']([^"']+)["']/i);
      const feedUrlMatch = match.match(/feedUrl=["']([^"']+)["']/i);

      if (!feedUrlMatch) {
        continue;
      }

      const publisherRef = {
        feedGuid: feedGuidMatch?.[1] || '',
        feedUrl: feedUrlMatch[1]
      };

      // Check if publisher already exists
      const existing = await prisma.feed.findFirst({
        where: {
          OR: [
            { id: publisherRef.feedGuid },
            { originalUrl: publisherRef.feedUrl }
          ],
          type: 'publisher'
        }
      });

      if (existing) {
        alreadyExists++;
        continue;
      }

      // Fetch publisher feed
      console.log(`🔍 Discovering: ${publisherRef.feedUrl}`);
      const pubController = new AbortController();
      const pubTimeoutId = setTimeout(() => pubController.abort(), 10000);

      const pubResponse = await fetch(publisherRef.feedUrl, {
        signal: pubController.signal
      });
      clearTimeout(pubTimeoutId);

      if (!pubResponse.ok) {
        failed++;
        continue;
      }

      const pubXml = await pubResponse.text();

      // Extract metadata
      let title = null;
      const titleMatch = pubXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ||
                         pubXml.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) title = titleMatch[1].trim();

      let description = null;
      const descMatch = pubXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) ||
                        pubXml.match(/<itunes:summary><!\[CDATA\[([\s\S]*?)\]\]><\/itunes:summary>/i) ||
                        pubXml.match(/<itunes:summary>([^<]+)<\/itunes:summary>/i);
      if (descMatch) description = descMatch[1].trim();

      let image = null;
      const imageMatch = pubXml.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
      if (imageMatch) image = imageMatch[1].trim();

      let guid = null;
      const guidMatch = pubXml.match(/<podcast:guid>([^<]+)<\/podcast:guid>/i);
      if (guidMatch) guid = guidMatch[1].trim();

      if (!title) {
        failed++;
        continue;
      }

      const publisherId = publisherRef.feedGuid || guid || `publisher-${Date.now()}`;

      // Store in database
      await prisma.feed.create({
        data: {
          id: publisherId,
          title: title,
          artist: title,
          description: description,
          image: image,
          originalUrl: publisherRef.feedUrl,
          type: 'publisher',
          status: 'active',
          updatedAt: new Date()
        }
      });

      console.log(`✅ Added: ${title} (${publisherId})`);
      if (image) console.log(`   🖼️ Image: ${image.substring(0, 60)}...`);

      discovered++;

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
    }
  }

  console.log('\n📊 Publisher Discovery Complete:');
  console.log(`   Total feeds processed: ${albumFeeds.length}`);
  console.log(`   New publishers discovered: ${discovered}`);
  console.log(`   Already existed: ${alreadyExists}`);
  console.log(`   Failed/Skipped: ${failed}`);

  await prisma.$disconnect();
}

discoverAllPublishers().catch(console.error);
