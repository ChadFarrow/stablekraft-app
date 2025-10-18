const { MusicTrackParser } = require('./lib/music-track-parser');

async function testMusicParser() {
  console.log('🎵 Testing Music Track Parser...\n');
  
  const testUrl = 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml';
  
  try {
    console.log('📡 Testing with:', testUrl);
    const result = await MusicTrackParser.extractMusicTracks(testUrl);
    
    console.log('✅ Success!');
    console.log('📊 Extraction Stats:');
    console.log(`   Total Tracks: ${result.extractionStats.totalTracks}`);
    console.log(`   From Chapters: ${result.extractionStats.tracksFromChapters}`);
    console.log(`   From Value Splits: ${result.extractionStats.tracksFromValueSplits}`);
    console.log(`   From Description: ${result.extractionStats.tracksFromDescription}`);
    console.log(`   Related Feeds: ${result.extractionStats.relatedFeedsFound}`);
    console.log(`   Extraction Time: ${result.extractionStats.extractionTime}ms`);
    
    console.log('\n🎵 Discovered Tracks:');
    result.tracks.forEach((track, index) => {
      console.log(`   ${index + 1}. ${track.title} (${track.source})`);
      console.log(`      Artist: ${track.artist}`);
      console.log(`      Episode: ${track.episodeTitle}`);
      if (track.startTime > 0) {
        console.log(`      Time: ${track.startTime}s - ${track.endTime}s`);
      }
      console.log('');
    });
    
    if (result.relatedFeeds.length > 0) {
      console.log('🔗 Related Feeds:');
      result.relatedFeeds.forEach((feed, index) => {
        console.log(`   ${index + 1}. ${feed.title}`);
        console.log(`      URL: ${feed.feedUrl}`);
        console.log(`      Relationship: ${feed.relationship}`);
        console.log('');
      });
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    console.log('Stack:', error.stack);
  }
}

testMusicParser(); 