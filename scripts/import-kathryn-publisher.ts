// Import Kathryn's publisher feed
async function importKathrynPublisher() {
  try {
    const publisherFeedUrl = 'https://feeds.fountain.fm/jokW9pKTREMn9bhoZSRU';

    console.log('🔄 Importing Kathryn publisher feed...\n');

    const response = await fetch('http://localhost:3000/api/feeds', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        originalUrl: publisherFeedUrl,
        type: 'publisher',
        priority: 'normal',
        cdnUrl: ''
      }),
    });

    const data = await response.json();

    if (response.ok || response.status === 206) {
      console.log('✅ Publisher feed imported successfully!');
      console.log('Title:', data.feed?.title);
      console.log('Tracks:', data.feed?._count?.Track || 0);
      console.log('v4vRecipient:', data.feed?.v4vRecipient || 'Not set');
    } else if (response.status === 409) {
      console.log('ℹ️  Publisher feed already exists');
    } else {
      console.log('❌ Failed to import:', data.error || 'Unknown error');
      console.log('Response:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

importKathrynPublisher();
