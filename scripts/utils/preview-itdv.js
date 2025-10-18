#!/usr/bin/env node
const fs = require('fs');

console.log('🎵 ITDV Tracks Preview');
console.log('='.repeat(50));

try {
  const db = JSON.parse(fs.readFileSync('data/music-tracks.json', 'utf8'));
  const itdvTracks = db.musicTracks.filter(t => t.source === 'itdv-playlist').slice(0, 10);
  
  console.log(`📊 Found ${db.musicTracks.filter(t => t.source === 'itdv-playlist').length} total ITDV tracks`);
  console.log(`📋 Showing first 10:\n`);
  
  itdvTracks.forEach((track, i) => {
    const hasAudio = track.audioUrl && track.audioUrl.length > 0;
    const hasCustomArt = track.artworkUrl !== 'https://www.doerfelverse.com/art/itdvchadf.png';
    
    console.log(`${i+1}. "${track.title}" by ${track.artist}`);
    console.log(`   🎧 Audio: ${hasAudio ? '✅' : '❌'}`);
    console.log(`   🎨 Custom Art: ${hasCustomArt ? '✅' : '❌'}`);
    console.log(`   🆔 ID: ${track.id}`);
    if (hasAudio) console.log(`   🔗 ${track.audioUrl.substring(0, 60)}...`);
    console.log('');
  });
  
  const stats = db.musicTracks.filter(t => t.source === 'itdv-playlist');
  const withAudio = stats.filter(t => t.audioUrl && t.audioUrl.length > 0).length;
  const withCustomArt = stats.filter(t => t.artworkUrl !== 'https://www.doerfelverse.com/art/itdvchadf.png').length;
  
  console.log(`📈 ITDV Track Statistics:`);
  console.log(`   Total: ${stats.length}`);
  console.log(`   With Audio: ${withAudio} (${((withAudio/stats.length)*100).toFixed(1)}%)`);
  console.log(`   With Custom Art: ${withCustomArt} (${((withCustomArt/stats.length)*100).toFixed(1)}%)`);
  
} catch (error) {
  console.error('❌ Error:', error.message);
}