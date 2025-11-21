// Check what the album API returns
async function testAlbumAPI() {
  try {
    // Check the specific album endpoint
    const response = await fetch('http://localhost:3000/api/albums/relevance');

    if (!response.ok) {
      console.log('❌ API error:', response.status);
      return;
    }

    const data = await response.json();

    console.log('📋 Album API Response:');
    console.log('Success:', data.success);

    if (data.album) {
      console.log('\n🎵 Album Data:');
      console.log('Title:', data.album.title);
      console.log('Artist:', data.album.artist);
      console.log('v4vRecipient:', data.album.v4vRecipient || '❌ MISSING');
      console.log('v4vValue:', data.album.v4vValue ? 'Present' : '❌ MISSING');

      if (data.album.v4vValue) {
        console.log('\n💰 v4vValue Structure:');
        console.log(JSON.stringify(data.album.v4vValue, null, 2));
      }
    } else {
      console.log('❌ No album data in response');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testAlbumAPI();
