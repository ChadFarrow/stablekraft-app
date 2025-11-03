#!/usr/bin/env node

const fetch = require('node-fetch');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function syncProductionData() {
  try {
    console.log('🚀 Starting production data sync...');
    
    // First, let's get all albums from production
    const prodResponse = await fetch('https://stablekraft-production.up.railway.app/api/albums?limit=200');
    const prodData = await prodResponse.json();
    
    console.log(`📊 Found ${prodData.albums.length} albums in production`);
    console.log(`📊 Total count: ${prodData.totalCount}`);
    
    // Clear existing data (optional - comment out if you want to keep existing)
    console.log('🗑️ Clearing existing local data...');
    await prisma.track.deleteMany();
    await prisma.feed.deleteMany();
    console.log('✅ Local data cleared');
    
    // Group albums by feed to recreate feeds
    const feedMap = new Map();
    
    for (const album of prodData.albums) {
      if (!feedMap.has(album.feedId)) {
        feedMap.set(album.feedId, {
          id: album.feedId,
          title: album.publisher?.title || album.artist,
          originalUrl: album.feedUrl,
          description: album.description,
          image: album.coverArt,
          artist: album.artist,
          type: 'album',
          status: 'active',
          priority: 'normal'
        });
      }
    }
    
    console.log(`📦 Creating ${feedMap.size} feeds...`);
    
    // Create feeds
    for (const [feedId, feedData] of feedMap) {
      try {
        await prisma.feed.create({
          data: feedData
        });
        console.log(`✅ Created feed: ${feedData.title}`);
      } catch (error) {
        console.warn(`⚠️ Error creating feed ${feedData.title}:`, error.message);
      }
    }
    
    console.log(`🎵 Creating tracks from ${prodData.albums.length} albums...`);
    
    // Create tracks from albums
    let trackCount = 0;
    for (const album of prodData.albums) {
      for (let i = 0; i < album.tracks.length; i++) {
        const track = album.tracks[i];
        try {
          await prisma.track.create({
            data: {
              id: `${album.feedId}-track-${i}-${Date.now()}`,
              feedId: album.feedId,
              guid: `${album.id}-${i}`,
              title: track.title,
              subtitle: track.subtitle || '',
              description: track.summary || album.description,
              artist: album.artist,
              album: album.title,
              audioUrl: track.url,
              duration: track.duration ? parseInt(track.duration.split(':').reduce((acc, time) => (60 * acc) + +time, 0)) : null,
              explicit: track.explicit || false,
              image: track.image || album.coverArt,
              publishedAt: new Date(album.releaseDate),
              itunesAuthor: album.artist,
              itunesSummary: track.summary || album.description,
              itunesImage: track.image || album.coverArt,
              itunesDuration: track.duration,
              itunesKeywords: track.keywords || [],
              itunesCategories: []
            }
          });
          trackCount++;
        } catch (error) {
          console.warn(`⚠️ Error creating track ${track.title}:`, error.message);
        }
      }
      
      if (trackCount % 50 === 0) {
        console.log(`📈 Progress: ${trackCount} tracks created...`);
      }
    }
    
    console.log(`✨ Sync completed!`);
    console.log(`📊 Created ${feedMap.size} feeds and ${trackCount} tracks`);
    
    // Verify the sync
    const localAlbumsResponse = await fetch('http://localhost:3000/api/albums?limit=1');
    const localData = await localAlbumsResponse.json();
    console.log(`🔍 Verification: Local database now has ${localData.totalCount} albums`);
    
  } catch (error) {
    console.error('❌ Sync failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

syncProductionData();