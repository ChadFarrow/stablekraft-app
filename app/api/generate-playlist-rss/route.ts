import { NextRequest, NextResponse } from 'next/server';
import { safeFetch, readCappedText, MAX_FEED_BYTES } from '@/lib/safe-fetch';
import { MusicTrackParser } from '@/lib/music-track-parser';
import { XMLParser } from 'fast-xml-parser';
import { PODCAST_NS, buildMinimalPlaylistXml, escapeXml } from '@/lib/playlist/musicl-feed';
import { playlistGuid, podcastGuidFromUrl } from '@/lib/playlist/musicl-guid';

const NO_GUID_ERROR =
  'The playlist needs its own podcast:guid: pass guid (a UUID) or playlistFeedUrl (where the playlist is hosted).';

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
    const overridePlaylistFeedUrl = searchParams.get('playlistFeedUrl');
    
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
    let rssXml: string;
    if (template === 'minimal') {
      const guid = playlistGuid(overrideGuid, overridePlaylistFeedUrl);
      if (!guid) return NextResponse.json({ error: NO_GUID_ERROR }, { status: 400 });
      rssXml = generateMinimalPlaylistRSS(v4vTracks, {
        title: overrideTitle,
        description: overrideDescription,
        link: overrideLink,
        imageUrl: overrideImageUrl,
        author: overrideAuthor,
        guid,
      });
    } else {
      rssXml = generatePlaylistRSS(tracksByEpisode, feedUrl);
    }
    
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
        error: 'Failed to generate playlist RSS'
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

    let guid: string | null = null;
    if (template === 'minimal') {
      guid = playlistGuid(overrides.guid, overrides.playlistFeedUrl);
      if (!guid) return NextResponse.json({ error: NO_GUID_ERROR }, { status: 400 });
    }

    const xml = template === 'minimal'
      ? generateMinimalPlaylistRSS(v4vTracks, {
          title: overrides.title ?? null,
          description: overrides.description ?? null,
          descriptionHtml: overrides.descriptionHtml ?? null,
          link: overrides.link ?? null,
          imageUrl: overrides.imageUrl ?? null,
          author: overrides.author ?? null,
          guid: guid!,
          medium: overrides.medium ?? 'musicL',
          publisher: overrides.publisherFeedGuid
            ? { feedGuid: overrides.publisherFeedGuid, feedUrl: overrides.publisherFeedUrl ?? null }
            : null,
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
        error: 'Failed to generate playlist RSS'
      },
      { status: 500 }
    );
  }
}

// Fast extractor: only finds podcast:remoteItem GUID references with a short timeout
async function quickExtractRemoteItems(feedUrl: string): Promise<any[]> {
  try {
    // safeFetch, not fetch: `feedUrl` is caller-supplied (the playlist maker
    // posts it), so a raw fetch here read any URL the server could reach.
    const fetched = await safeFetch(feedUrl, {
      allowHttp: true,
      timeoutMs: 10000,
      headers: { 'user-agent': 'ITDV-PlaylistMaker/preview' },
    });
    if (!fetched.ok) {
      console.warn(`⚠️ Playlist preview refused ${feedUrl}: ${fetched.error}`);
      return [];
    }
    const res = fetched.response;
    if (!res.ok) return [];
    const read = await readCappedText(res, MAX_FEED_BYTES);
    if (!read.ok) return [];
    const xml = read.value;
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
    // safeFetch owns the timeout now, so there is no timer to clear here.
    return [];
  }
}

function generatePlaylistRSS(tracksByEpisode: Record<string, any[]>, sourceFeedUrl: string): string {
  const now = new Date().toUTCString();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const selfUrl = `${baseUrl}/api/generate-playlist-rss?feedUrl=${encodeURIComponent(sourceFeedUrl)}`;

  // Calculate total tracks
  const totalTracks = Object.values(tracksByEpisode).reduce((sum, tracks) => sum + tracks.length, 0);
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" 
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:podcast="${PODCAST_NS}"
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
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
    
    <itunes:author>The Doerfels</itunes:author>
    <itunes:summary>Music playlist from Into The Doerfel Verse podcast</itunes:summary>
    <itunes:owner>
      <itunes:name>The Doerfels</itunes:name>
      <itunes:email>thedoerfels@example.com</itunes:email>
    </itunes:owner>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Music"/>
    <itunes:image href="https://www.doerfelverse.com/images/podcast-cover.jpg"/>
    
    <podcast:medium>musicL</podcast:medium>
    <podcast:guid>${podcastGuidFromUrl(selfUrl)}</podcast:guid>
    
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
  guid: string;
  medium?: string | undefined;
  publisher?: { feedGuid?: string | null; feedUrl?: string | null } | null;
}): string {
  // One writer for the maker's feed (lib/playlist/musicl-feed.ts): the
  // namespace, the escaping, the CDATA description and the guid rule live
  // there, with tests (#309).
  return buildMinimalPlaylistXml({
    guid: overrides.guid,
    title: overrides.title || 'Music playlist',
    author: overrides.author || 'Playlist',
    description: overrides.description || 'Every music reference from the source podcast',
    descriptionHtml: overrides.descriptionHtml || null,
    link: overrides.link || 'https://example.com',
    imageUrl: overrides.imageUrl || '',
    medium: overrides.medium || 'musicL',
    publisher: overrides.publisher ?? null,
    tracks: v4vTracks
      .filter(t => t?.valueForValue?.feedGuid && t?.valueForValue?.itemGuid)
      .map(t => ({ feedGuid: t.valueForValue.feedGuid, itemGuid: t.valueForValue.itemGuid })),
  });
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
