// Check if scoot album appears on the main page API
async function checkScootOnMainPage() {
  try {
    console.log('🔍 Checking if scoot album appears in main page API...\n');

    const response = await fetch('http://localhost:3000/api/albums-fast?limit=100&offset=0&filter=all');

    if (!response.ok) {
      console.log('❌ API request failed:', response.status, response.statusText);
      return;
    }

    const data = await response.json();

    console.log(`📊 Total albums returned: ${data.albums?.length || 0}`);
    console.log(`📊 Total count: ${data.totalCount || 0}\n`);

    // Find scoot album
    const scootAlbum = data.albums?.find((album: any) =>
      album.title.toLowerCase().includes('scoot')
    );

    if (scootAlbum) {
      console.log('✅ Scoot album FOUND on main page!');
      console.log('─'.repeat(80));
      console.log('Title:', scootAlbum.title);
      console.log('Artist:', scootAlbum.artist);
      console.log('Feed ID:', scootAlbum.id);
      console.log('Tracks:', scootAlbum.tracks?.length || 0);
      console.log('Cover Art:', scootAlbum.coverArt ? '✅ Present' : '❌ Missing');
      console.log('v4vRecipient:', scootAlbum.v4vRecipient || '❌ Missing');
      console.log('v4vValue:', scootAlbum.v4vValue ? '✅ Present' : '❌ Missing');

      if (scootAlbum.tracks && scootAlbum.tracks.length > 0) {
        console.log('\n📀 Track info:');
        scootAlbum.tracks.forEach((track: any, i: number) => {
          console.log(`  ${i + 1}. ${track.title}`);
          console.log(`     URL: ${track.url?.substring(0, 60)}...`);
          console.log(`     v4v: ${track.v4vRecipient || 'Not set'}`);
        });
      }
    } else {
      console.log('❌ Scoot album NOT FOUND on main page');
      console.log('\n💡 This could mean:');
      console.log('   1. The feed status is not "active"');
      console.log('   2. The cache needs to refresh (wait 2 minutes)');
      console.log('   3. The dev server needs to be restarted');

      // Show some albums that ARE showing up
      console.log('\n📋 Sample albums that ARE showing up:');
      data.albums?.slice(0, 5).forEach((album: any) => {
        console.log(`   - ${album.title} by ${album.artist}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkScootOnMainPage();
