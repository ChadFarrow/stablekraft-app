#!/usr/bin/env node

/**
 * Test re-parsing a single Wavlake feed to verify V4V extraction works
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testReparse() {
  try {
    const feedUrl = 'https://wavlake.com/feed/ec8ce316-9461-48e1-8fd2-17d46f5ebe3d';

    console.log('🔍 Finding feed in database...');
    const feed = await prisma.feed.findFirst({
      where: { originalUrl: feedUrl },
      include: { tracks: { take: 3 } }
    });

    if (!feed) {
      console.log('❌ Feed not found in database!');
      console.log('   URL:', feedUrl);
      return;
    }

    console.log('✅ Found feed:', feed.title);
    console.log('   ID:', feed.id);
    console.log('   Current V4V Recipient:', feed.v4vRecipient || 'NONE');
    console.log('   Tracks:', feed.tracks.length);

    if (feed.tracks.length > 0) {
      console.log('   Sample track V4V:', feed.tracks[0].v4vRecipient || 'NONE');
    }

    console.log();
    console.log('🔄 Now check the actual RSS feed...');

    const response = await fetch(feedUrl);
    const xmlText = await response.text();

    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const matches = [...xmlText.matchAll(valueRegex)];

    console.log(`📊 RSS feed has ${matches.length} podcast:value tags`);

    if (matches.length > 0) {
      console.log('✅ V4V data IS present in RSS feed');
      console.log('❌ BUT NOT in database - parser or save logic failed!');
    } else {
      console.log('❌ No V4V data in RSS feed');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testReparse().catch(console.error);
