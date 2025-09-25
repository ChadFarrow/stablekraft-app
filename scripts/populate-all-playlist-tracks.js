#!/usr/bin/env node

/**
 * Populate database with ALL tracks from playlists (not just missing ones)
 * This will make playlists load instantly from database instead of API calls
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey, apiSecret) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  // Generate SHA1 hash for authentication
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'FUCKIT-Database-Populator/1.0'
  };
}

// Resolve item using Podcast Index API
async function resolveItemGuid(feedGuid, itemGuid) {
  try {
    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    // Try feed-based lookup first
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      let feed = null;
      
      if (feedData.status === 'true') {
        feed = feedData.feed || (feedData.feeds && feedData.feeds[0]);
      }
      
      if (feed && feed.id) {
        // Get episodes from this feed
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feed.id}&max=1000`, {
          headers
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items && episodesData.items.length > 0) {
            
            const episode = episodesData.items.find((ep) => ep.guid === itemGuid);
            if (episode) {
              return {
                guid: episode.guid,
                title: episode.title,
                description: episode.description || '',
                audioUrl: episode.enclosureUrl || '',
                duration: episode.duration || 0,
                image: episode.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
                feedGuid: feedGuid,
                feedTitle: feed.title,
                feedImage: feed.image,
                feedUrl: feed.url,
                method: 'feed_lookup'
              };
            }
          }
        }
      }
    }
    
    // Try direct episode lookup as fallback
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        return {
          guid: episode.guid,
          title: episode.title,
          description: episode.description || '',
          audioUrl: episode.enclosureUrl || '',
          duration: episode.duration || 0,
          image: episode.image || '/placeholder-podcast.jpg',
          publishedAt: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),
          feedGuid: episode.feedGuid || feedGuid,
          feedTitle: episode.feedTitle || 'Unknown Feed',
          feedImage: episode.feedImage,
          feedUrl: episode.feedUrl,
          method: 'direct_lookup'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error(`❌ Error resolving ${itemGuid}:`, error.message);
    return null;
  }
}

async function fetchPlaylistXML(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }
  return await response.text();
}

function parseRemoteItems(xmlText) {
  const remoteItems = [];
  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;
  
  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    remoteItems.push({
      feedGuid: match[1],
      itemGuid: match[2]
    });
  }
  
  return remoteItems;
}

async function populatePlaylistTracks(playlistName, playlistUrl) {
  try {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Processing ${playlistName} playlist...`);
    console.log(`   URL: ${playlistUrl}`);
    
    // Fetch and parse playlist
    const xmlText = await fetchPlaylistXML(playlistUrl);
    const remoteItems = parseRemoteItems(xmlText);
    console.log(`   Found ${remoteItems.length} items in playlist XML`);
    
    // Check what's already in database
    const itemGuids = remoteItems.map(item => item.itemGuid);
    const existingTracks = await prisma.track.findMany({
      where: { guid: { in: itemGuids } },
      select: { guid: true }
    });
    
    const existingGuids = new Set(existingTracks.map(t => t.guid));
    const missingItems = remoteItems.filter(item => !existingGuids.has(item.itemGuid));
    
    console.log(`   Already in database: ${existingTracks.length}`);
    console.log(`   Need to add: ${missingItems.length}`);
    
    if (missingItems.length === 0) {
      console.log(`   ✅ All tracks already in database!`);
      return { added: 0, failed: 0, skipped: existingTracks.length };
    }
    
    // Process missing items in batches
    const batchSize = 5;
    const totalBatches = Math.ceil(missingItems.length / batchSize);
    let addedCount = 0;
    let failedCount = 0;
    
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, missingItems.length);
      const batch = missingItems.slice(start, end);
      
      console.log(`\n   Batch ${batchIndex + 1}/${totalBatches} (${batch.length} items)...`);
      
      for (const item of batch) {
        const resolvedData = await resolveItemGuid(item.feedGuid, item.itemGuid);
        
        if (resolvedData && resolvedData.audioUrl && resolvedData.audioUrl.length > 0) {
          try {
            // Create feed if it doesn't exist
            const feedUrl = resolvedData.feedUrl || `https://podcastindex.org/podcast/${resolvedData.feedGuid}`;
            
            const feed = await prisma.feed.upsert({
              where: { originalUrl: feedUrl },
              update: {
                title: resolvedData.feedTitle,
                image: resolvedData.feedImage,
                artist: resolvedData.feedTitle
              },
              create: {
                title: resolvedData.feedTitle,
                originalUrl: feedUrl,
                image: resolvedData.feedImage || '/placeholder-podcast.jpg',
                description: resolvedData.feedTitle,
                artist: resolvedData.feedTitle,
                category: 'Music',
                type: 'album',
                lastFetched: new Date()
              }
            });
            
            // Add track
            await prisma.track.create({
              data: {
                guid: resolvedData.guid,
                title: resolvedData.title,
                description: resolvedData.description || '',
                audioUrl: resolvedData.audioUrl,
                duration: resolvedData.duration || 0,
                image: resolvedData.image || feed.image || '/placeholder-podcast.jpg',
                publishedAt: resolvedData.publishedAt,
                feedId: feed.id,
                artist: resolvedData.feedTitle
              }
            });
            
            addedCount++;
            console.log(`      ✅ Added: "${resolvedData.title}" by ${resolvedData.feedTitle}`);
          } catch (error) {
            if (error.code === 'P2002') {
              console.log(`      ⏭️  Already exists: ${item.itemGuid}`);
            } else {
              console.error(`      ❌ Error adding track: ${error.message}`);
              failedCount++;
            }
          }
        } else {
          console.log(`      ⚠️  Could not resolve: ${item.itemGuid}`);
          failedCount++;
        }
        
        // Delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Longer delay between batches
      if (batchIndex < totalBatches - 1) {
        console.log(`   ⏳ Waiting 2s before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return { 
      added: addedCount, 
      failed: failedCount, 
      skipped: existingTracks.length 
    };
    
  } catch (error) {
    console.error(`❌ Error processing ${playlistName}:`, error.message);
    return { added: 0, failed: 0, skipped: 0 };
  }
}

async function main() {
  try {
    console.log('🚀 Populating database with all playlist tracks...');
    console.log('   This will make playlists load instantly from database!\n');
    
    // Check current database stats
    const initialTrackCount = await prisma.track.count();
    console.log(`📊 Initial database: ${initialTrackCount} tracks`);
    
    // Process each playlist
    const playlists = [
      {
        name: 'Upbeats',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml'
      },
      {
        name: 'MMM',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/MMMPlaylist.xml'
      }
    ];
    
    let totalAdded = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    
    for (const playlist of playlists) {
      const result = await populatePlaylistTracks(playlist.name, playlist.url);
      totalAdded += result.added;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
    }
    
    // Final stats
    const finalTrackCount = await prisma.track.count();
    
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 FINAL RESULTS:');
    console.log(`   Tracks added: ${totalAdded}`);
    console.log(`   Tracks failed: ${totalFailed}`);
    console.log(`   Tracks skipped (already existed): ${totalSkipped}`);
    console.log(`   Total tracks in database: ${finalTrackCount} (was ${initialTrackCount})`);
    console.log(`${'='.repeat(60)}`);
    
    if (totalAdded > 0) {
      console.log('\n🎉 SUCCESS! Playlists should now load instantly from database!');
      console.log('   Clear playlist caches to see the improvement:');
      console.log('   - Upbeats: curl "http://localhost:3000/api/playlist/upbeats?refresh=true"');
      console.log('   - MMM: curl "http://localhost:3000/api/playlist/mmm?refresh=true"');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { populatePlaylistTracks };