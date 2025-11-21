// Check if there's a publisher/artist feed for Kathryn on Fountain
// The album feed is: https://feeds.fountain.fm/DsIzE8JF79ZiGmlen8uC

const albumFeedUrl = 'https://feeds.fountain.fm/DsIzE8JF79ZiGmlen8uC';

async function findPublisherFeed() {
  try {
    console.log('🔍 Fetching album feed to check for publisher/artist info...\n');

    const response = await fetch(albumFeedUrl);
    const xmlText = await response.text();

    // Look for podcast:publisher or similar tags
    const publisherMatch = xmlText.match(/<podcast:publisher[^>]*>([^<]+)<\/podcast:publisher>/);
    const linkMatches = xmlText.match(/<link[^>]*>([^<]+)<\/link>/g);
    const guidMatch = xmlText.match(/<podcast:guid[^>]*>([^<]+)<\/podcast:guid>/);

    console.log('Publisher tag:', publisherMatch ? publisherMatch[1] : 'Not found');
    console.log('GUID:', guidMatch ? guidMatch[1] : 'Not found');

    if (linkMatches) {
      console.log('\nLinks found in feed:');
      linkMatches.forEach(link => {
        const url = link.match(/>([^<]+)</)?.[1];
        if (url) console.log('  -', url);
      });
    }

    // Check for funding tags which might have artist info
    const fundingMatch = xmlText.match(/<podcast:funding[^>]*>([^<]+)<\/podcast:funding>/);
    console.log('\nFunding:', fundingMatch ? fundingMatch[1] : 'Not found');

    // Look for author/creator info
    const authorMatch = xmlText.match(/<itunes:author>([^<]+)<\/itunes:author>/);
    const creatorMatch = xmlText.match(/<dc:creator>([^<]+)<\/dc:creator>/);

    console.log('iTunes Author:', authorMatch ? authorMatch[1] : 'Not found');
    console.log('DC Creator:', creatorMatch ? creatorMatch[1] : 'Not found');

    console.log('\n💡 To find the publisher feed, you may need to:');
    console.log('   1. Check Fountain.fm website for Kathryn\'s artist page');
    console.log('   2. Look for an RSS feed link on the artist profile');
    console.log('   3. Or use the Podcast Index API to search for the publisher feed');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

findPublisherFeed();
