import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY || '';
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET || '';
const PODCAST_INDEX_BASE_URL = 'https://api.podcastindex.org/api/1.0';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const feedUrl = searchParams.get('feedUrl');
    const endpoint = searchParams.get('endpoint') || 'episodes/byfeedurl';
    const guid = searchParams.get('guid'); // For episode-specific requests
    const feedId = searchParams.get('feedId'); // For feed-specific requests
    
    if (!feedUrl && !guid && !feedId) {
      return NextResponse.json({ error: 'Feed URL, GUID, or Feed ID is required' }, { status: 400 });
    }

    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      console.error('PodcastIndex API credentials not configured');
      console.error('API Key:', PODCAST_INDEX_API_KEY ? 'Present' : 'Missing');
      console.error('API Secret:', PODCAST_INDEX_API_SECRET ? 'Present' : 'Missing');
      // Fallback to direct RSS feed fetch
      if (feedUrl) {
        const response = await fetch(`${request.nextUrl.origin}/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`);
        return new NextResponse(await response.text(), {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } else {
        return NextResponse.json({ error: 'Cannot fetch by GUID or Feed ID without Podcast Index API' }, { status: 400 });
      }
    }

    // Generate auth headers for PodcastIndex
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash('sha1');
    hash.update(PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime);
    const hashString = hash.digest('hex');

    // Build API URL based on request type
    let apiUrl: string;
    if (guid) {
      // Fetch specific episode by GUID
      apiUrl = `${PODCAST_INDEX_BASE_URL}/episodes/byguid?guid=${encodeURIComponent(guid)}`;
    } else if (feedId) {
      // Fetch feed by ID (GUID)
      apiUrl = `${PODCAST_INDEX_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(feedId)}`;
    } else {
      // Fetch episodes by feed URL
      apiUrl = `${PODCAST_INDEX_BASE_URL}/${endpoint}?url=${encodeURIComponent(feedUrl!)}&max=1000`;
    }

    // Fetch from PodcastIndex
    const response = await fetch(apiUrl, {
      headers: {
        'X-Auth-Key': PODCAST_INDEX_API_KEY,
        'X-Auth-Date': apiHeaderTime.toString(),
        'Authorization': hashString,
        'User-Agent': 'stablekraft.app'
      }
    });

    if (!response.ok) {
      console.error(`PodcastIndex API error: ${response.status} ${response.statusText}`);
      // Fallback to direct RSS feed fetch
      if (feedUrl) {
        const fallbackResponse = await fetch(`${request.nextUrl.origin}/api/fetch-rss?url=${encodeURIComponent(feedUrl)}`);
        return new NextResponse(await fallbackResponse.text(), {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } else {
        return NextResponse.json({ error: 'Podcast Index API failed and no fallback available' }, { status: 500 });
      }
    }

    const data = await response.json();

    // Check if we have valid data from PodcastIndex
    if (guid) {
      // Single episode response
      if (data.episode) {
        const rssXml = convertPodcastIndexEpisodeToRSS(data.episode, data.feed);
        return new NextResponse(rssXml, {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } else if (feedId) {
      // Feed lookup response
      if (data.feed) {
        // Return the feed data directly for now
        return NextResponse.json(data.feed, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    } else {
      // Feed episodes response
      if (data.items && data.items.length > 0 && data.feed && data.feed.title) {
        // Convert to RSS XML format that our parser expects
        const rssXml = convertPodcastIndexToRSS(data);
        return new NextResponse(rssXml, {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } else {
        // PodcastIndex doesn't have this feed or has incomplete data - fallback to direct RSS
        console.log(`PodcastIndex missing feed data for ${feedUrl}, falling back to direct RSS`);
        const fallbackResponse = await fetch(`${request.nextUrl.origin}/api/fetch-rss?url=${encodeURIComponent(feedUrl!)}`);
        return new NextResponse(await fallbackResponse.text(), {
          headers: {
            'Content-Type': 'application/xml',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    }

    return NextResponse.json({ error: 'No valid data found' }, { status: 404 });
  } catch (error) {
    console.error('PodcastIndex route error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from PodcastIndex' },
      { status: 500 }
    );
  }
}

function convertPodcastIndexToRSS(data: any): string {
  const feed = data.feed || {};
  const items = data.items || [];

  // Build RSS XML from PodcastIndex data with V4V support
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md">
  <channel>
    <title>${escapeXml(feed.title || 'Unknown Title')}</title>
    <description>${escapeXml(feed.description || '')}</description>
    <link>${escapeXml(feed.link || '')}</link>
    <itunes:author>${escapeXml(feed.author || feed.ownerName || '')}</itunes:author>
    <itunes:image href="${escapeXml(feed.image || feed.artwork || '')}" />
    ${items.map((item: any) => convertPodcastIndexItemToRSS(item)).join('')}
  </channel>
</rss>`;

  return rssXml;
}

function convertPodcastIndexEpisodeToRSS(episode: any, feed: any): string {
  // Create a minimal RSS feed with just the requested episode
  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md">
  <channel>
    <title>${escapeXml(feed?.title || 'Episode')}</title>
    <description>${escapeXml(feed?.description || '')}</description>
    <link>${escapeXml(feed?.link || '')}</link>
    <itunes:author>${escapeXml(feed?.author || feed?.ownerName || '')}</itunes:author>
    <itunes:image href="${escapeXml(feed?.image || feed?.artwork || '')}" />
    ${convertPodcastIndexItemToRSS(episode)}
  </channel>
</rss>`;

  return rssXml;
}

function convertPodcastIndexItemToRSS(item: any): string {
  // Convert Podcast Index episode to RSS item with V4V support
  let itemXml = `
    <item>
      <title>${escapeXml(item.title || '')}</title>
      <description>${escapeXml(item.description || '')}</description>
      <enclosure url="${escapeXml(item.enclosureUrl || '')}" type="${escapeXml(item.enclosureType || 'audio/mpeg')}" length="${item.enclosureLength || 0}" />
      <pubDate>${new Date(item.datePublished * 1000).toUTCString()}</pubDate>
      <itunes:duration>${item.duration || 0}</itunes:duration>
      <itunes:image href="${escapeXml(item.image || '')}" />
      <guid>${escapeXml(item.guid || '')}</guid>`;

  // Add V4V data if available
  if (item.value) {
    itemXml += convertPodcastIndexValueToRSS(item.value);
  }

  // Add chapters if available
  if (item.chaptersUrl) {
    itemXml += `
      <podcast:chapters url="${escapeXml(item.chaptersUrl)}" type="application/json" />`;
  }

  // Add transcript if available
  if (item.transcriptUrl) {
    itemXml += `
      <podcast:transcript url="${escapeXml(item.transcriptUrl)}" type="application/json" />`;
  }

  itemXml += `
    </item>`;

  return itemXml;
}

function convertPodcastIndexValueToRSS(value: any): string {
  let valueXml = `
      <podcast:value type="lightning" method="keysend" suggested="0.00000005000" />`;

  // Add value time splits if available
  if (value.timeSplits && Array.isArray(value.timeSplits)) {
    value.timeSplits.forEach((timeSplit: any) => {
      valueXml += `
      <podcast:valueTimeSplit startTime="${timeSplit.startTime || 0}" endTime="${timeSplit.endTime || 0}" totalAmount="${timeSplit.totalAmount || 0}" currency="${escapeXml(timeSplit.currency || 'sats')}">`;
      
      if (timeSplit.recipients && Array.isArray(timeSplit.recipients)) {
        timeSplit.recipients.forEach((recipient: any) => {
          valueXml += `
        <podcast:valueRecipient name="${escapeXml(recipient.name || '')}" type="${escapeXml(recipient.type || 'remote')}" address="${escapeXml(recipient.address || '')}" split="${recipient.split || 0}" />`;
        });
      }
      
      valueXml += `
      </podcast:valueTimeSplit>`;
    });
  }

  // Add boostagrams if available
  if (value.boostagrams && Array.isArray(value.boostagrams)) {
    value.boostagrams.forEach((boostagram: any) => {
      valueXml += `
      <boostagram senderName="${escapeXml(boostagram.senderName || '')}" message="${escapeXml(boostagram.message || '')}" amount="${boostagram.amount || 0}" currency="${escapeXml(boostagram.currency || 'sats')}" />`;
    });
  }

  return valueXml;
}

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}