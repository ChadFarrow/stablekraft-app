#!/usr/bin/env node
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const feedsNoTracks = await prisma.feed.findMany({
    where: { Track: { none: {} } },
    select: { id: true, title: true, originalUrl: true, type: true }
  });

  // Categorize by URL pattern
  const wavlakeArtist = feedsNoTracks.filter(f => f.originalUrl?.includes('wavlake.com/feed/') && f.originalUrl?.includes('/artist/'));
  const wavlakeMusic = feedsNoTracks.filter(f => f.originalUrl?.includes('wavlake.com/feed/') && !f.originalUrl?.includes('/artist/'));
  const fountain = feedsNoTracks.filter(f => f.originalUrl?.includes('feeds.fountain.fm'));
  const rssBlue = feedsNoTracks.filter(f => f.originalUrl?.includes('rssblue.com'));
  const guidOnly = feedsNoTracks.filter(f => !f.originalUrl || f.originalUrl === f.id);
  const other = feedsNoTracks.filter(f =>
    !f.originalUrl?.includes('wavlake.com') &&
    !f.originalUrl?.includes('feeds.fountain.fm') &&
    !f.originalUrl?.includes('rssblue.com') &&
    f.originalUrl && f.originalUrl !== f.id
  );

  console.log('=== 400 Feeds Without Tracks ===');
  console.log('Wavlake artist feeds (publisher):', wavlakeArtist.length);
  console.log('Wavlake music feeds:', wavlakeMusic.length);
  console.log('Fountain FM feeds:', fountain.length);
  console.log('RSS Blue feeds:', rssBlue.length);
  console.log('GUID-only (no URL):', guidOnly.length);
  console.log('Other:', other.length);

  console.log('\n--- Sample Wavlake music feeds without tracks ---');
  wavlakeMusic.slice(0, 5).forEach(f => console.log(' ', f.title, '-', f.originalUrl?.substring(0, 60)));

  console.log('\n--- Sample GUID-only feeds ---');
  guidOnly.slice(0, 5).forEach(f => console.log(' ', f.id, f.title));

  console.log('\n--- Sample other feeds ---');
  other.slice(0, 10).forEach(f => console.log(' ', f.title, '-', f.originalUrl?.substring(0, 70)));

  await prisma.$disconnect();
})();
