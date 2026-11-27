import { NextRequest, NextResponse } from 'next/server';
import { XMLParser } from 'fast-xml-parser';
import { isSafePublicUrl } from '@/lib/url-security';
import { safeFetch, readCappedText, MAX_FEED_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const feedUrl = url.searchParams.get('feedUrl');
    if (!feedUrl) {
      return NextResponse.json({ error: 'Missing feedUrl' }, { status: 400 });
    }

    // Fetches a caller-supplied URL, so it must go through the same guard as
    // /api/chapters, /api/proxy-image and /api/proxy-audio. Without it, any
    // link-local or RFC-1918 host was reachable AND its body was reflected
    // back to the caller.
    const urlCheck = isSafePublicUrl(feedUrl);
    if (!urlCheck.ok) {
      return NextResponse.json({ error: urlCheck.error }, { status: 400 });
    }

    // safeFetch owns the timeout, and re-runs the guard above on every redirect
    // hop — the guard alone saw only the first URL, so a 302 into the private
    // range reached it and the body was reflected back to the caller.
    const fetched = await safeFetch(feedUrl, {
      timeoutMs: 10000,
      headers: {
        'user-agent': USER_AGENT
      },
    });

    if (!fetched.ok) {
      console.warn(`⚠️ Feed metadata fetch refused for ${feedUrl}: ${fetched.error}`);
      return NextResponse.json({ error: 'Failed to fetch feed' }, { status: 502 });
    }

    const res = fetched.response;
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch feed (${res.status})` }, { status: 502 });
    }
    const readXml = await readCappedText(res, MAX_FEED_BYTES);
    if (!readXml.ok) {
      return NextResponse.json({ error: 'Feed too large' }, { status: 413 });
    }
    const xml = readXml.value;

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      trimValues: true,
      parseTagValue: true,
      parseAttributeValue: true,
    });
    const data = parser.parse(xml);

    const channel = data?.rss?.channel || data?.feed || {};

    // Common fields
    const title = channel.title?.['#text'] || channel.title || '';
    const description = channel.description?.['#text'] || channel.description || '';
    const link = channel.link?.href || channel.link || '';

    // Images (itunes or image.url)
    const itunesImage = channel['itunes:image']?.href || channel['itunes:image']?.url;
    const imageUrl = itunesImage || channel.image?.url || '';

    // Podcasting 2.0
    const podcastMedium = channel['podcast:medium'] || channel.podcast?.medium || '';
    const podcastGuid = channel['podcast:guid'] || channel.podcast?.guid || '';

    // Author
    const author = channel['itunes:author'] || channel.author?.name || channel.author || '';

    return NextResponse.json({
      success: true,
      metadata: {
        title: String(title || ''),
        description: String(description || ''),
        link: String(link || ''),
        imageUrl: String(imageUrl || ''),
        author: String(author || ''),
        medium: String(podcastMedium || ''),
        guid: String(podcastGuid || ''),
      },
    });
  } catch (error) {
    console.error('Failed to parse feed:', error);
    return NextResponse.json({ error: 'Failed to parse feed' }, { status: 500 });
  }
}


