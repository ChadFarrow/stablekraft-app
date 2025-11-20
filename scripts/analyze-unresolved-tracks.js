const fs = require('fs');

// Load all playlist caches and find unresolved tracks
const playlists = [
  { name: 'HGH', file: '.next/cache/playlists/hgh-playlist.json' },
  { name: 'MMT', file: '.next/cache/playlists/mmt-playlist.json' },
  { name: 'SAS', file: '.next/cache/playlists/sas-playlist.json' },
  { name: 'MMM', file: '.next/cache/playlists/mmm-playlist.json' },
  { name: 'IAM', file: '.next/cache/playlists/iam-playlist.json' },
  { name: 'ITDV', file: '.next/cache/playlists/itdv-playlist.json' },
  { name: 'B4TS', file: '.next/cache/playlists/b4ts-playlist.json' },
  { name: 'UpBeats', file: '.next/cache/playlists/upbeats-playlist.json' }
];

const unresolvedTracks = [];
const feedGuidsNeeded = new Set();

playlists.forEach(p => {
  if (fs.existsSync(p.file)) {
    const data = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    const album = data.albums[0];

    // Find tracks without valid audioUrl
    album.tracks.forEach(track => {
      const hasNoAudio = !track.audioUrl || track.audioUrl.length === 0;
      const needsRes = track.needsResolution || track.source === 'placeholder';

      if (hasNoAudio || needsRes) {
        unresolvedTracks.push({
          playlist: p.name,
          feedGuid: track.feedGuid,
          itemGuid: track.itemGuid || track.guid,
          title: track.title,
          artist: track.artist
        });
        if (track.feedGuid) {
          feedGuidsNeeded.add(track.feedGuid);
        }
      }
    });
  }
});

console.log('=== UNRESOLVED TRACKS ANALYSIS ===\n');
console.log(`Total unresolved tracks: ${unresolvedTracks.length}`);
console.log(`Unique feed GUIDs needed: ${feedGuidsNeeded.size}\n`);

// Group by playlist
const byPlaylist = {};
unresolvedTracks.forEach(t => {
  if (!byPlaylist[t.playlist]) byPlaylist[t.playlist] = [];
  byPlaylist[t.playlist].push(t);
});

console.log('By Playlist:');
Object.entries(byPlaylist).forEach(([pl, tracks]) => {
  console.log(`  ${pl}: ${tracks.length} tracks`);
});

console.log('\nFirst 30 unresolved tracks:');
unresolvedTracks.slice(0, 30).forEach((t, i) => {
  console.log(`${i+1}. [${t.playlist}] ${t.title} - ${t.artist}`);
  console.log(`   Feed: ${t.feedGuid?.slice(0, 36)}`);
  console.log(`   Item: ${t.itemGuid?.slice(0, 36)}`);
});

// Save all unresolved tracks details
fs.writeFileSync('/tmp/unresolved-tracks.json', JSON.stringify(unresolvedTracks, null, 2));
fs.writeFileSync('/tmp/missing-feed-guids.json', JSON.stringify([...feedGuidsNeeded], null, 2));

console.log(`\n✅ Saved ${unresolvedTracks.length} track details to /tmp/unresolved-tracks.json`);
console.log(`✅ Saved ${feedGuidsNeeded.size} feed GUIDs to /tmp/missing-feed-guids.json`);
