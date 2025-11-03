import { NextRequest, NextResponse } from 'next/server';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { XMLParser } from 'fast-xml-parser';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const feedUrl = searchParams.get('feedUrl') || 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml';
    const format = searchParams.get('format') || 'rss'; // 'rss' or 'json'
    const template = (searchParams.get('template') || 'default').toLowerCase(); // 'default' | 'minimal'
    // Optional overrides for minimal template
    const overrideTitle = searchParams.get('title');
    const overrideDescription = searchParams.get('description');
    const overrideLink = searchParams.get('link');
    const overrideImageUrl = searchParams.get('imageUrl');
    const overrideAuthor = searchParams.get('author');
    const overrideGuid = searchParams.get('guid');
    
    // Extract music tracks from the feed
    const result = await MusicTrackParser.extractMusicTracks(feedUrl);
    
    // Filter for V4V tracks with remoteItem references
    const v4vTracks = result.tracks.filter(track => 
      track.source === 'value-split' && 
      track.valueForValue?.feedGuid && 
      track.valueForValue?.itemGuid
    );
    
    // Group tracks by episode for better organization
    const tracksByEpisode = v4vTracks.reduce((acc, track) => {
      if (!acc[track.episodeTitle]) {
        acc[track.episodeTitle] = [];
      }
      acc[track.episodeTitle].push(track);
      return acc;
    }, {} as Record<string, typeof v4vTracks>);
    
    // Generate RSS XML
    const rssXml = template === 'minimal'
      ? generateMinimalPlaylistRSS(v4vTracks, {
          title: overrideTitle,
          description: overrideDescription,
          link: overrideLink,
          imageUrl: overrideImageUrl,
          author: overrideAuthor,
          guid: overrideGuid,
        })
      : generatePlaylistRSS(tracksByEpisode, feedUrl);
    
    if (format === 'json') {
      return NextResponse.json({
        success: true,
        totalTracks: v4vTracks.length,
        episodeCount: Object.keys(tracksByEpisode).length,
        tracks: v4vTracks
      });
    }
    
    // Return RSS XML with proper content type
    return new NextResponse(rssXml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="itdv-music-playlist.xml"'
      }
    });
    
  } catch (error) {
    console.error('Error generating playlist RSS:', error);
    return NextResponse.json(
      { 
        error: 'Failed to generate playlist RSS',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const feedUrl: string = body.feedUrl || 'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml';
    const template: string = (body.template || 'minimal').toLowerCase();
    const overrides = body.overrides || {};
    const fast: boolean = !!body.fast;

    let v4vTracks: any[];
    if (fast) {
      v4vTracks = await quickExtractRemoteItems(feedUrl);
    } else {
      const result = await MusicTrackParser.extractMusicTracks(feedUrl);
      v4vTracks = result.tracks.filter((track: any) =>
        track.source === 'value-split' &&
        track.valueForValue?.feedGuid &&
        track.valueForValue?.itemGuid
      );
    }

    const xml = template === 'minimal'
      ? generateMinimalPlaylistRSS(v4vTracks, {
          title: overrides.title ?? null,
          description: overrides.description ?? null,
          descriptionHtml: overrides.descriptionHtml ?? null,
          link: overrides.link ?? null,
          imageUrl: overrides.imageUrl ?? null,
          author: overrides.author ?? null,
          guid: overrides.guid ?? null,
          medium: overrides.medium ?? 'musicL',
        })
      : (() => {
          const tracksByEpisode = v4vTracks.reduce((acc: Record<string, any[]>, track: any) => {
            if (!acc[track.episodeTitle]) acc[track.episodeTitle] = [];
            acc[track.episodeTitle].push(track);
            return acc;
          }, {});
          return generatePlaylistRSS(tracksByEpisode, feedUrl);
        })();

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="playlist.xml"'
      }
    });
  } catch (error) {
    console.error('Error generating playlist RSS (POST):', error);
    return NextResponse.json(
      {
        error: 'Failed to generate playlist RSS',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// Fast extractor: only finds podcast:remoteItem GUID references with a short timeout
async function quickExtractRemoteItems(feedUrl: string): Promise<any[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'user-agent': 'ITDV-PlaylistMaker/preview' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', trimValues: true });
    const json = parser.parse(xml);
    const channel = json?.rss?.channel;
    if (!channel) return [];

    const tracks: any[] = [];

    // 1) channel-level podcast:remoteItem
    const channelRemote = channel['podcast:remoteItem'];
    const channelRemoteArr = Array.isArray(channelRemote) ? channelRemote : channelRemote ? [channelRemote] : [];
    for (const item of channelRemoteArr) {
      const feedGuid = item?.feedGuid || item?.$?.feedGuid;
      const itemGuid = item?.itemGuid || item?.$?.itemGuid;
      if (feedGuid && itemGuid) {
        tracks.push({ source: 'value-split', valueForValue: { feedGuid, itemGuid } });
      }
    }

    // 2) valueTimeSplit-level remoteItem inside items
    const items = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
    for (const it of items) {
      const value = it?.['podcast:value'] || it?.value;
      if (!value) continue;
      const splits = value['podcast:valueTimeSplit'] || value.valueTimeSplit;
      const splitsArr = Array.isArray(splits) ? splits : splits ? [splits] : [];
      for (const split of splitsArr) {
        const rem = split?.['podcast:remoteItem'] || split?.remoteItem;
        const remArr = Array.isArray(rem) ? rem : rem ? [rem] : [];
        for (const r of remArr) {
          const feedGuid = r?.feedGuid || r?.$?.feedGuid;
          const itemGuid = r?.itemGuid || r?.$?.itemGuid;
          if (feedGuid && itemGuid) {
            tracks.push({ source: 'value-split', valueForValue: { feedGuid, itemGuid } });
          }
        }
      }
    }

    return tracks;
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function generatePlaylistRSS(tracksByEpisode: Record<string, any[]>, sourceFeedUrl: string): string {
  const now = new Date().toUTCString();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  
  // Calculate total tracks
  const totalTracks = Object.values(tracksByEpisode).reduce((sum, tracks) => sum + tracks.length, 0);
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Into The Doerfel Verse - Music Playlist</title>
    <description>A curated playlist of ${totalTracks} music tracks featured on Into The Doerfel Verse podcast. Each track is extracted using V4V (Value for Value) metadata and represents original music played during episodes.</description>
    <link>https://www.doerfelverse.com</link>
    <language>en-us</language>
    <copyright>Music rights belong to respective artists</copyright>
    <lastBuildDate>${now}</lastBuildDate>
    <pubDate>${now}</pubDate>
    <generator>StableKraft Music Extractor</generator>
    <atom:link href="${baseUrl}/api/generate-playlist-rss?feedUrl=${encodeURIComponent(sourceFeedUrl)}" rel="self" type="application/rss+xml"/>
    
    <itunes:author>The Doerfels</itunes:author>
    <itunes:summary>Music playlist from Into The Doerfel Verse podcast</itunes:summary>
    <itunes:owner>
      <itunes:name>The Doerfels</itunes:name>
      <itunes:email>thedoerfels@example.com</itunes:email>
    </itunes:owner>
    <itunes:explicit>no</itunes:explicit>
    <itunes:category text="Music"/>
    <itunes:image href="https://www.doerfelverse.com/images/podcast-cover.jpg"/>
    
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>playlist-${generateGuid(sourceFeedUrl)}</podcast:guid>
    
    ${generateTrackItems(tracksByEpisode, baseUrl)}
  </channel>
</rss>`;

  return xml;
}

function generateMinimalPlaylistRSS(v4vTracks: any[], overrides: {
  title?: string | null;
  description?: string | null;
  descriptionHtml?: string | null;
  link?: string | null;
  imageUrl?: string | null;
  author?: string | null;
  guid?: string | null;
  medium?: string | undefined;
}): string {
  const isUuid = (s: unknown): s is string =>
    typeof s === 'string' && /^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$/.test(s);
  const generateUuid = (): string =>
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? (crypto as any).randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  const now = new Date().toUTCString();
  const title = overrides.title || 'Music playlist';
  const description = overrides.description || 'Every music reference from the source podcast';
  const descriptionHtml = overrides.descriptionHtml || null;
  const link = overrides.link || 'https://example.com';
  const imageUrl = overrides.imageUrl || '';
  const author = overrides.author || 'Playlist';
  const guid = isUuid(overrides.guid) ? overrides.guid! : generateUuid();
  const medium = overrides.medium || 'musicL';

  const remoteItems = v4vTracks
    .filter(t => t?.valueForValue?.feedGuid && t?.valueForValue?.itemGuid)
    .map(t => `  <podcast:remoteItem feedGuid="${escapeXml(t.valueForValue.feedGuid)}" itemGuid="${escapeXml(t.valueForValue.itemGuid)}"/>`)
    .join('\n');

  const imageBlock = imageUrl
    ? `<image>\n<url>\n${escapeXml(imageUrl)}\n</url>\n</image>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:podcast="https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n<channel>\n<author>${escapeXml(author)}</author>\n<title>${escapeXml(title)}</title>\n<description>\n${descriptionHtml ? descriptionHtml : escapeXml(description)}\n</description>\n<link>${escapeXml(link)}</link>\n<language>en</language>\n<pubDate>${now}</pubDate>\n<lastBuildDate>${now}</lastBuildDate>\n${imageBlock}\n<podcast:medium>${escapeXml(medium)}</podcast:medium>\n<podcast:guid>${escapeXml(guid)}</podcast:guid>\n${remoteItems}\n</channel>\n</rss>`;
}

function generateTrackItems(tracksByEpisode: Record<string, any[]>, baseUrl: string): string {
  const remoteItems: string[] = [];

  // Sort episodes by episode number for stable ordering
  const sortedEpisodes = Object.entries(tracksByEpisode).sort((a, b) => {
    const aNum = extractEpisodeNumber(a[0]);
    const bNum = extractEpisodeNumber(b[0]);
    return aNum - bNum;
  });

  for (const [, tracks] of sortedEpisodes) {
    for (const track of tracks) {
      const feedGuid = track?.valueForValue?.feedGuid;
      const itemGuid = track?.valueForValue?.itemGuid;
      if (!feedGuid || !itemGuid) continue;

      remoteItems.push(`    <podcast:remoteItem feedGuid="${escapeXml(feedGuid)}" itemGuid="${escapeXml(itemGuid)}"/>`);
    }
  }

  return remoteItems.join('\n');
}

function extractEpisodeNumber(episodeTitle: string): number {
  const match = episodeTitle.match(/Episode (\d+)/i);
  return match ? parseInt(match[1], 10) : 999;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatTime(seconds: number): string {
  return formatDuration(seconds);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateGuid(input: string): string {
  // Simple hash function to generate a consistent GUID from the input
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}