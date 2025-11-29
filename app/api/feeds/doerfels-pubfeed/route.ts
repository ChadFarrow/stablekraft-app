import { NextResponse } from 'next/server';

// Define the Doerfels album feeds with their metadata
const doerfelsAlbums = [
  { feedGuid: '2b62ef49-fcff-523c-b81a-0a7dde2b0609', feedUrl: 'https://www.doerfelverse.com/feeds/music-from-the-doerfelverse.xml', title: 'Music from the Doerfelverse (Stay Awhile)' },
  { feedGuid: '5a95f9d8-35e3-51f5-a269-ba1df36b4bd8', feedUrl: 'https://www.doerfelverse.com/feeds/bloodshot-lies-album.xml', title: 'Bloodshot Lies' },
  { feedGuid: '41aace28-8679-5ef1-9958-75cf76c2b5f0', feedUrl: 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml', title: 'Into the Doerfelverse' },
  { feedGuid: '4a483a4b-867c-50d5-a61a-e99fe03ea57e', feedUrl: 'https://www.doerfelverse.com/feeds/wrath-of-banjo.xml', title: 'Wrath of Banjo' },
  { feedGuid: '08604071-83cc-5810-bec2-bea0f0cd0033', feedUrl: 'https://www.doerfelverse.com/feeds/ben-doerfel.xml', title: 'Ben Doerfel' },
  { feedGuid: '910874e0-86cc-5d95-9589-a9948c32880a', feedUrl: 'https://www.doerfelverse.com/feeds/18sundays.xml', title: '18 Sundays' },
  { feedGuid: 'a40615ac-1b3c-5c76-8961-6bbc86e20439', feedUrl: 'https://www.doerfelverse.com/feeds/alandace.xml', title: 'Alandace' },
  { feedGuid: '47768d25-74d9-5ba4-82db-aeaa7f50e29c', feedUrl: 'https://www.doerfelverse.com/feeds/autumn.xml', title: 'Autumn' },
  { feedGuid: '1aeccb22-0dce-57e8-80fb-01053f506763', feedUrl: 'https://www.doerfelverse.com/feeds/christ-exalted.xml', title: 'Christ Exalted' },
  { feedGuid: '3d929593-c368-5a59-aefd-50ec8d788874', feedUrl: 'https://www.doerfelverse.com/feeds/come-back-to-me.xml', title: 'Come Back to Me' },
  { feedGuid: 'd4608e6e-024c-5482-befc-7bee3753167d', feedUrl: 'https://www.doerfelverse.com/feeds/dead-time-live-2016.xml', title: 'Dead Time Live 2016' },
  { feedGuid: '1bb0f289-877b-5460-ab92-f8e25a2d4c89', feedUrl: 'https://www.doerfelverse.com/feeds/dfbv1.xml', title: 'DFB V1' },
  { feedGuid: '6bf3785f-e053-57f4-9f70-261ee5e3747f', feedUrl: 'https://www.doerfelverse.com/feeds/dfbv2.xml', title: 'DFB V2' },
  { feedGuid: 'de196d3e-276d-5b5f-aa30-34d747e5f6a7', feedUrl: 'https://www.doerfelverse.com/feeds/disco-swag.xml', title: 'Disco Swag' },
  { feedGuid: 'a3d6d7d5-4b5d-5161-b119-cf5e99d35fda', feedUrl: 'https://www.doerfelverse.com/feeds/first-married-christmas.xml', title: 'First Married Christmas' },
  { feedGuid: 'e0658b29-1cd3-55b8-ac51-0997764ce334', feedUrl: 'https://www.doerfelverse.com/feeds/generation-gap.xml', title: 'Generation Gap' },
  { feedGuid: 'e2d6766a-5c28-5cbd-b678-4d7595646e4e', feedUrl: 'https://www.doerfelverse.com/feeds/heartbreak.xml', title: 'Heartbreak' },
  { feedGuid: 'f275657c-4b58-563a-ad3b-91b65035b3d8', feedUrl: 'https://www.doerfelverse.com/feeds/merry-christmix.xml', title: 'Merry Christmix' },
  { feedGuid: '3074902b-b2dc-5877-bfc3-30f5df0fbe6a', feedUrl: 'https://www.doerfelverse.com/feeds/middle-season-let-go.xml', title: 'Middle Season Let Go' },
  { feedGuid: '94c8a0bf-f76e-5f8c-ba1d-c0c15a642271', feedUrl: 'https://www.doerfelverse.com/feeds/phatty-the-grasshopper.xml', title: 'Phatty the Grasshopper' },
  { feedGuid: 'd13eab76-a4c4-5e4b-a0fb-25ed1386bc51', feedUrl: 'https://www.doerfelverse.com/feeds/possible.xml', title: 'Possible' },
  { feedGuid: 'b84c3345-55db-54e0-ac41-4b1cc6f3df67', feedUrl: 'https://www.doerfelverse.com/feeds/pour-over.xml', title: 'Pour Over' },
  { feedGuid: '8c5dd9fd-4257-5e7b-9e94-643e6aa4ca1c', feedUrl: 'https://www.doerfelverse.com/feeds/psalm-54.xml', title: 'Psalm 54' },
  { feedGuid: '6eef0b66-bb86-5d0c-b260-099bcc920b7c', feedUrl: 'https://www.doerfelverse.com/feeds/sensitive-guy.xml', title: 'Sensitive Guy' },
  { feedGuid: 'f7d933c8-032a-52e5-9598-e34d833a3e8e', feedUrl: 'https://www.doerfelverse.com/feeds/they-dont-know.xml', title: 'They Don\'t Know' },
  { feedGuid: 'af99d1b4-e10e-503f-8321-8d748bdc76f8', feedUrl: 'https://www.doerfelverse.com/feeds/think-ep.xml', title: 'Think EP' },
  { feedGuid: 'c2095619-a9d0-5e7c-80e1-59e520ce55d3', feedUrl: 'https://www.doerfelverse.com/feeds/underwater-single.xml', title: 'Underwater Single' },
  { feedGuid: '00addc23-7769-5471-bb9a-c0acb6f27437', feedUrl: 'https://www.doerfelverse.com/feeds/unsound-existence.xml', title: 'Unsound Existence' },
  { feedGuid: '3679b281-4f40-5463-aa5a-6ea91b8a4957', feedUrl: 'https://www.doerfelverse.com/feeds/you-are-my-world.xml', title: 'You Are My World' },
  { feedGuid: '141b86d8-76bc-581a-adf1-2f836a4dde91', feedUrl: 'https://www.doerfelverse.com/feeds/you-feel-like-home.xml', title: 'You Feel Like Home' },
  { feedGuid: '4ab3741a-4a10-5631-a026-a9d0eb62fe11', feedUrl: 'https://www.doerfelverse.com/feeds/your-chance.xml', title: 'Your Chance' },
  
  // Additional albums found in V4V time splits that need to be added
  { feedGuid: 'bba99401-378c-5540-bf95-c456b3d4de26', feedUrl: 'https://www.doerfelverse.com/feeds/playlist-track-1.xml', title: 'Featured Track (11:06-14:27) - 3m 21s' }, // Track at 11:06-14:27
          { feedGuid: '69c634ad-afea-5826-ad9a-8e1f06d6470b', feedUrl: 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Kurtisdrums-V1.xml', title: 'Worthy Lofi - Kurtisdrums (19:02-23:33) - 4m 31s' }, // Track at 19:02-23:33
          { feedGuid: '1e7ed1fa-0456-5860-9b34-825d1335d8f8', feedUrl: 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/08/Nostalgic.xml', title: 'SWEATS - CityBeach (55:44-59:30) - 3m 46s' }, // Track at 55:44-59:30
  { feedGuid: 'c76ef0a6-0181-5b9b-a4bc-dd85d4ed178b', feedUrl: 'https://www.doerfelverse.com/feeds/playlist-track-4.xml', title: 'Featured Track (1:04:00-1:07:12) - 3m 12s' }, // Track at 1:04:00-1:07:12
];

export async function GET() {
  try {
    // Generate the publisher feed XML
    const publisherFeedGuid = '5526a0ee-069d-4c76-8bd4-7fd2022034bc'; // Unique GUID for The Doerfels publisher feed
    const currentDate = new Date().toUTCString();
    
    const remoteItems = doerfelsAlbums
      .map(album => `    <podcast:remoteItem medium="music" feedGuid="${album.feedGuid}" feedUrl="${album.feedUrl}" />`)
      .join('\n');

    const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:psc="http://podlove.org/simple-chapters" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title><![CDATA[The Doerfels]]></title>
    <description><![CDATA[The Doerfels are a family band from Buffalo, NY, creating original music across multiple genres including folk, rock, and acoustic. Their catalog includes albums like "Bloodshot Lies", "Stay Awhile", and many more.]]></description>
    <link>https://www.doerfelverse.com/</link>
    <generator>Podtards / Wavlake</generator>
    <lastBuildDate>${currentDate}</lastBuildDate>
    <atom:link href="https://stablekraft.app/api/feeds/doerfels-pubfeed" rel="self" type="application/rss+xml" />
    
    <podcast:medium>publisher</podcast:medium>
    <podcast:guid>${publisherFeedGuid}</podcast:guid>
    
    <podcast:person role="artist" href="https://www.doerfelverse.com">The Doerfels</podcast:person>
    
${remoteItems}
    
    <itunes:summary>The Doerfels are a family band from Buffalo, NY, creating original music across multiple genres including folk, rock, and acoustic. Their catalog includes albums like "Bloodshot Lies", "Stay Awhile", and many more.</itunes:summary>
    <itunes:owner>
      <itunes:name>The Doerfels</itunes:name>
      <itunes:email>contact@doerfelverse.com</itunes:email>
    </itunes:owner>
    <itunes:author>The Doerfels</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="https://www.doerfelverse.com/art/doerfels-hockeystick.png"/>
    <itunes:category text="Music" />
  </channel>
</rss>`;

    return new NextResponse(feedXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error generating Doerfels publisher feed:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}