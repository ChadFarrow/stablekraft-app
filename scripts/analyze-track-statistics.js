#!/usr/bin/env node

/**
 * Comprehensive Track Database Statistics Analysis
 * 
 * This script queries the database to get all track-related statistics
 * including total counts, MMM playlist coverage, album distributions, and system playlist data.
 */

const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Database connection string (from .env or default)
const DB_URL = process.env.DATABASE_URL || 'postgresql://chad-mini@localhost:5432/fuckit_music';
const MMM_PLAYLIST_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml';

// Helper to run SQL queries
function runQuery(query) {
  try {
    const result = execSync(`psql "${DB_URL}" -t -A -F'|' -c "${query.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    return result.trim().split('\n').filter(line => line.trim());
  } catch (error) {
    console.error(`Query failed: ${error.message}`);
    return [];
  }
}

// Helper to check if table exists
function tableExists(tableName) {
  const query = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = '${tableName}'
    );
  `;
  const result = runQuery(query);
  return result[0] === 't';
}

// Fetch MMM playlist XML and extract GUIDs
function fetchMMMGuids() {
  return new Promise((resolve, reject) => {
    https.get(MMM_PLAYLIST_URL, (res) => {
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

// Format number with commas
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Format percentage
function formatPercent(num, total) {
  if (total === 0) return '0.0%';
  return ((num / total) * 100).toFixed(1) + '%';
}

async function analyzeStatistics() {
  console.log('📊 Track Database Statistics Analysis\n');
  console.log('═'.repeat(70));
  console.log('');

  // ============================================
  // 1. CORE STATISTICS
  // ============================================
  console.log('📈 CORE STATISTICS');
  console.log('─'.repeat(70));

  const totalTracks = parseInt(runQuery('SELECT COUNT(*) FROM "Track"')[0] || '0');
  const activeTracks = parseInt(runQuery('SELECT COUNT(*) FROM "Track" WHERE status = \'active\'')[0] || '0');
  const inactiveTracks = totalTracks - activeTracks;
  
  const tracksWithGuid = parseInt(runQuery('SELECT COUNT(*) FROM "Track" WHERE guid IS NOT NULL AND guid != \'\'')[0] || '0');
  const tracksWithoutGuid = totalTracks - tracksWithGuid;
  
  const tracksWithAudio = parseInt(runQuery('SELECT COUNT(*) FROM "Track" WHERE "audioUrl" IS NOT NULL AND "audioUrl" != \'\'')[0] || '0');
  const tracksWithoutAudio = totalTracks - tracksWithAudio;
  
  const totalAlbums = parseInt(runQuery('SELECT COUNT(*) FROM "Feed" WHERE type = \'album\'')[0] || '0');
  const activeAlbums = parseInt(runQuery('SELECT COUNT(*) FROM "Feed" WHERE type = \'album\' AND status = \'active\'')[0] || '0');
  const inactiveAlbums = totalAlbums - activeAlbums;

  console.log(`Total Tracks:              ${formatNumber(totalTracks)}`);
  console.log(`  - Active:                ${formatNumber(activeTracks)} (${formatPercent(activeTracks, totalTracks)})`);
  console.log(`  - Inactive:              ${formatNumber(inactiveTracks)} (${formatPercent(inactiveTracks, totalTracks)})`);
  console.log(`  - With GUID:             ${formatNumber(tracksWithGuid)} (${formatPercent(tracksWithGuid, totalTracks)})`);
  console.log(`  - Without GUID:          ${formatNumber(tracksWithoutGuid)} (${formatPercent(tracksWithoutGuid, totalTracks)})`);
  console.log(`  - With Audio URL:         ${formatNumber(tracksWithAudio)} (${formatPercent(tracksWithAudio, totalTracks)})`);
  console.log(`  - Without Audio URL:      ${formatNumber(tracksWithoutAudio)} (${formatPercent(tracksWithoutAudio, totalTracks)})`);
  console.log('');
  console.log(`Total Albums:              ${formatNumber(totalAlbums)}`);
  console.log(`  - Active:                ${formatNumber(activeAlbums)} (${formatPercent(activeAlbums, totalAlbums)})`);
  console.log(`  - Inactive:              ${formatNumber(inactiveAlbums)} (${formatPercent(inactiveAlbums, totalAlbums)})`);
  
  if (totalAlbums > 0) {
    const avgTracksPerAlbum = (totalTracks / totalAlbums).toFixed(2);
    console.log(`  - Avg Tracks/Album:       ${avgTracksPerAlbum}`);
  }
  console.log('');

  // ============================================
  // 2. MMM PLAYLIST COVERAGE
  // ============================================
  console.log('🎵 MMM PLAYLIST COVERAGE');
  console.log('─'.repeat(70));

  let matchedCount = 0;
  let mmmGuids = [];
  
  try {
    console.log('📥 Fetching MMM playlist XML...');
    mmmGuids = await fetchMMMGuids();
    console.log(`   Found ${formatNumber(mmmGuids.length)} items in MMM playlist\n`);

    // Create temporary file with GUIDs for SQL query
    const tempFile = path.join('/tmp', `mmm_guids_${Date.now()}.txt`);
    fs.writeFileSync(tempFile, mmmGuids.join('\n'));

    // Count matches in database
    matchedCount = parseInt(runQuery(`
      SELECT COUNT(*) 
      FROM "Track" 
      WHERE guid IN (
        SELECT unnest(string_to_array('${mmmGuids.join(',')}', ','))
      )
    `)[0] || '0');

    const missingCount = mmmGuids.length - matchedCount;

    console.log(`MMM Playlist Items:       ${formatNumber(mmmGuids.length)}`);
    console.log(`Matched in Database:      ${formatNumber(matchedCount)} (${formatPercent(matchedCount, mmmGuids.length)})`);
    console.log(`Missing from Database:    ${formatNumber(missingCount)} (${formatPercent(missingCount, mmmGuids.length)})`);
    console.log('');

    // Get which database tracks are in MMM playlist
    const dbTracksInMMM = parseInt(runQuery(`
      SELECT COUNT(DISTINCT guid) 
      FROM "Track" 
      WHERE guid IS NOT NULL 
        AND guid IN (
          SELECT unnest(string_to_array('${mmmGuids.join(',')}', ','))
        )
    `)[0] || '0');

    const dbTracksNotInMMM = tracksWithGuid - dbTracksInMMM;

    console.log(`Database Tracks:          ${formatNumber(tracksWithGuid)}`);
    console.log(`  - In MMM Playlist:      ${formatNumber(dbTracksInMMM)} (${formatPercent(dbTracksInMMM, tracksWithGuid)})`);
    console.log(`  - Not in MMM Playlist:  ${formatNumber(dbTracksNotInMMM)} (${formatPercent(dbTracksNotInMMM, tracksWithGuid)})`);
    console.log('');

    // Clean up temp file
    fs.unlinkSync(tempFile);
  } catch (error) {
    console.log(`❌ Error analyzing MMM playlist: ${error.message}\n`);
  }

  // ============================================
  // 3. SYSTEM PLAYLIST DATA
  // ============================================
  console.log('📋 SYSTEM PLAYLIST DATA');
  console.log('─'.repeat(70));

  const systemPlaylistExists = tableExists('SystemPlaylist');
  const systemPlaylistTrackExists = tableExists('SystemPlaylistTrack');

  if (systemPlaylistExists && systemPlaylistTrackExists) {
    console.log('✅ SystemPlaylist tables exist\n');

    // Get all system playlists
    const playlists = runQuery('SELECT id, title FROM "SystemPlaylist" ORDER BY id');
    
    for (const playlistLine of playlists) {
      if (!playlistLine) continue;
      const [id, title] = playlistLine.split('|');
      const trackCount = parseInt(runQuery(`SELECT COUNT(*) FROM "SystemPlaylistTrack" WHERE "playlistId" = '${id}'`)[0] || '0');
      console.log(`  ${id.padEnd(10)} ${title.padEnd(40)} ${formatNumber(trackCount).padStart(8)} tracks`);
    }
    console.log('');
  } else {
    console.log('⚠️  SystemPlaylist tables do not exist (migration may be needed)\n');
  }

  // ============================================
  // 4. TRACK DISTRIBUTION
  // ============================================
  console.log('📊 TRACK DISTRIBUTION');
  console.log('─'.repeat(70));

  // Albums by track count
  const distributionQuery = `
    SELECT 
      CASE 
        WHEN track_count = 1 THEN 'Singles (1 track)'
        WHEN track_count BETWEEN 2 AND 5 THEN 'EPs/Small (2-5 tracks)'
        WHEN track_count BETWEEN 6 AND 9 THEN 'Medium (6-9 tracks)'
        WHEN track_count >= 10 THEN 'Full Albums (10+ tracks)'
      END as category,
      COUNT(*) as album_count,
      SUM(track_count) as total_tracks
    FROM (
      SELECT 
        f.id,
        COUNT(t.id) as track_count
      FROM "Feed" f
      LEFT JOIN "Track" t ON t."feedId" = f.id
      WHERE f.type = 'album'
      GROUP BY f.id
    ) album_track_counts
    GROUP BY 
      CASE 
        WHEN track_count = 1 THEN 'Singles (1 track)'
        WHEN track_count BETWEEN 2 AND 5 THEN 'EPs/Small (2-5 tracks)'
        WHEN track_count BETWEEN 6 AND 9 THEN 'Medium (6-9 tracks)'
        WHEN track_count >= 10 THEN 'Full Albums (10+ tracks)'
      END
    ORDER BY MIN(track_count);
  `;

  const distribution = runQuery(distributionQuery);
  for (const line of distribution) {
    if (!line) continue;
    const [category, albumCount, totalTracks] = line.split('|');
    console.log(`  ${category.padEnd(25)} ${formatNumber(parseInt(albumCount)).padStart(4)} albums, ${formatNumber(parseInt(totalTracks)).padStart(6)} tracks`);
  }
  console.log('');

  // Top albums by track count
  console.log('Top 10 Albums by Track Count:');
  const topAlbumsQuery = `
    SELECT 
      f.title,
      f.artist,
      COUNT(t.id) as track_count
    FROM "Feed" f
    LEFT JOIN "Track" t ON t."feedId" = f.id
    WHERE f.type = 'album'
    GROUP BY f.id, f.title, f.artist
    ORDER BY track_count DESC
    LIMIT 10;
  `;

  const topAlbums = runQuery(topAlbumsQuery);
  topAlbums.forEach((line, index) => {
    if (!line) return;
    const [title, artist, count] = line.split('|');
    const displayTitle = (title || 'Unknown').substring(0, 40);
    const displayArtist = (artist || 'Unknown').substring(0, 25);
    console.log(`  ${(index + 1).toString().padStart(2)}. ${displayTitle.padEnd(42)} ${displayArtist.padEnd(27)} ${formatNumber(parseInt(count)).padStart(5)} tracks`);
  });
  console.log('');

  // ============================================
  // 5. ADDITIONAL METRICS
  // ============================================
  console.log('🔍 ADDITIONAL METRICS');
  console.log('─'.repeat(70));

  const tracksWithV4V = parseInt(runQuery('SELECT COUNT(*) FROM "Track" WHERE "v4vValue" IS NOT NULL AND "v4vValue"::text != \'null\'')[0] || '0');
  const tracksWithImage = parseInt(runQuery('SELECT COUNT(*) FROM "Track" WHERE image IS NOT NULL AND image != \'\'')[0] || '0');
  const uniqueArtists = parseInt(runQuery('SELECT COUNT(DISTINCT artist) FROM "Track" WHERE artist IS NOT NULL AND artist != \'\'')[0] || '0');
  const uniqueAlbums = parseInt(runQuery('SELECT COUNT(DISTINCT album) FROM "Track" WHERE album IS NOT NULL AND album != \'\'')[0] || '0');

  console.log(`Tracks with v4vValue:       ${formatNumber(tracksWithV4V)} (${formatPercent(tracksWithV4V, totalTracks)})`);
  console.log(`Tracks with Images:         ${formatNumber(tracksWithImage)} (${formatPercent(tracksWithImage, totalTracks)})`);
  console.log(`Unique Artists:             ${formatNumber(uniqueArtists)}`);
  console.log(`Unique Album Names:         ${formatNumber(uniqueAlbums)}`);
  console.log('');

  // ============================================
  // SUMMARY
  // ============================================
  console.log('═'.repeat(70));
  console.log('📋 SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total Tracks in Database:   ${formatNumber(totalTracks)}`);
  console.log(`Total Albums:               ${formatNumber(totalAlbums)}`);
  if (mmmGuids.length > 0) {
    console.log(`MMM Playlist Items:        ${formatNumber(mmmGuids.length)}`);
    console.log(`MMM Items in Database:     ${formatNumber(matchedCount)} (${formatPercent(matchedCount, mmmGuids.length)})`);
  } else {
    console.log(`MMM Playlist Items:        N/A (could not fetch)`);
    console.log(`MMM Items in Database:     N/A`);
  }
  console.log('═'.repeat(70));
  console.log('');
}

// Run the analysis
analyzeStatistics().catch(error => {
  console.error('❌ Error running analysis:', error);
  process.exit(1);
});

