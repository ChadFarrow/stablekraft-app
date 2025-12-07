#!/usr/bin/env node

/**
 * Analyze which MMM playlist tracks are missing from the database
 */

const { PrismaClient } = require('@prisma/client');
const https = require('https');

const prisma = new PrismaClient();

async function fetchMMMGuids() {
  return new Promise((resolve, reject) => {
    https.get('https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const guidMatches = data.match(/itemGuid="([^"]*)"/g) || [];
        const guids = guidMatches.map(m => m.replace('itemGuid="', '').replace('"', ''));
        resolve(guids);
      });
    }).on('error', reject);
  });
}

async function analyzeMissingTracks() {
  try {
    console.log('📊 Analyzing MMM Playlist Track Coverage\n');
    console.log('═'.repeat(60));

    // Fetch MMM playlist GUIDs
    console.log('📥 Fetching MMM playlist GUIDs...');
    const mmmGuids = await fetchMMMGuids();
    console.log(`   Found ${mmmGuids.length} items in MMM playlist\n`);

    // Get all tracks from database
    console.log('🔍 Checking database...');
    const dbTracks = await prisma.track.findMany({
      where: { guid: { not: null } },
      select: { guid: true }
    });
    const dbGuids = new Set(dbTracks.map(t => t.guid));
    console.log(`   Found ${dbGuids.size} tracks with GUIDs in database\n`);

    // Find matches and missing
    const matchedGuids = mmmGuids.filter(guid => dbGuids.has(guid));
    const missingGuids = mmmGuids.filter(guid => !dbGuids.has(guid));

    // Get feed information for matched tracks
    const matchedTracks = await prisma.track.findMany({
      where: { guid: { in: matchedGuids } },
      include: {
        Feed: {
          select: {
            id: true,
            title: true,
            artist: true,
            type: true
          }
        }
      }
    });

    // Group by feed
    const feedGroups = new Map();
    matchedTracks.forEach(track => {
      const feedId = track.Feed.id;
      if (!feedGroups.has(feedId)) {
        feedGroups.set(feedId, {
          feed: track.Feed,
          tracks: []
        });
      }
      feedGroups.get(feedId).tracks.push(track);
    });

    // Display results
    console.log('═'.repeat(60));
    console.log('📈 Summary:');
    console.log(`   MMM Playlist Items: ${mmmGuids.length.toLocaleString()}`);
    console.log(`   Matched in Database: ${matchedGuids.length.toLocaleString()} (${((matchedGuids.length / mmmGuids.length) * 100).toFixed(1)}%)`);
    console.log(`   Missing from Database: ${missingGuids.length.toLocaleString()} (${((missingGuids.length / mmmGuids.length) * 100).toFixed(1)}%)`);
    console.log('═'.repeat(60));

    console.log(`\n📀 Matched Tracks by Feed (${feedGroups.size} feeds):\n`);
    const sortedFeeds = Array.from(feedGroups.values())
      .sort((a, b) => b.tracks.length - a.tracks.length)
      .slice(0, 20);

    sortedFeeds.forEach((group, index) => {
      console.log(`${index + 1}. ${group.feed.title}`);
      console.log(`   Artist: ${group.feed.artist || 'Unknown'}`);
      console.log(`   Type: ${group.feed.type}`);
      console.log(`   Matched Tracks: ${group.tracks.length}`);
      console.log('');
    });

    if (feedGroups.size > 20) {
      console.log(`   ... and ${feedGroups.size - 20} more feeds\n`);
    }

    // Show some missing GUIDs
    console.log('═'.repeat(60));
    console.log(`\n❌ Sample Missing GUIDs (first 20):\n`);
    missingGuids.slice(0, 20).forEach((guid, index) => {
      console.log(`${index + 1}. ${guid}`);
    });

    if (missingGuids.length > 20) {
      console.log(`\n   ... and ${missingGuids.length - 20} more missing tracks`);
    }

    console.log('\n═'.repeat(60));
    console.log('\n💡 Recommendation:');
    console.log(`   ${missingGuids.length.toLocaleString()} tracks from the MMM playlist need to be resolved and added to the database.`);
    console.log(`   These tracks are referenced in the playlist but haven't been parsed from their source feeds yet.`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeMissingTracks();

