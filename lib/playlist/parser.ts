/**
 * XML parsing utilities for playlist feeds
 */

import type { RemoteItem, ParsedPlaylistItem, GroupedItems } from './types';
import { readXmlAttr, remoteItemTracks } from '@/lib/playlist/musicl-feed';
import { USER_AGENT } from '../user-agent';

/**
 * Decode XML entities to their character equivalents
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Parse artwork URL from playlist XML
 */
export function parseArtworkUrl(xmlText: string): string | null {
  const imageRegex = /<image>\s*<url>(.*?)<\/url>\s*<\/image>/s;
  const match = xmlText.match(imageRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Parse playlist link from XML
 */
export function parsePlaylistLink(xmlText: string): string | null {
  const linkRegex = /<link>(.*?)<\/link>/;
  const match = xmlText.match(linkRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Parse remote items from XML (simple extraction without episode context)
 */
export function parseRemoteItems(xmlText: string): RemoteItem[] {
  const remoteItems: RemoteItem[] = [];

  // Attributes are read by name, in any order and with either quote (#309).
  // A remoteItem with no itemGuid (a <podcast:publisher> back-link) is not a track.
  for (const { feedGuid, itemGuid } of remoteItemTracks(xmlText)) {
    remoteItems.push({ feedGuid, itemGuid });
  }
  return remoteItems;
}

/**
 * Parse playlist with episode markers - extracts both episode markers and remote items in order
 */
export function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];

  // Combined regex to match episode markers, playcount markers, and remote items in document order
  // A remoteItem's attributes are read by name (readXmlAttr), so any order and
  // either quote is read; one with no itemGuid (a publisher back-link) is skipped (#309).
  const combinedRegex = /<podcast:txt\s+purpose="(episode|playcount)">([^<]*)<\/podcast:txt>|(<podcast:remoteItem\b[^>]*>)/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined && match[2] !== undefined) {
      // Episode or playcount marker - match[1] is the purpose, match[2] is the title
      const purpose = match[1] as 'episode' | 'playcount';
      items.push({
        type: purpose,
        title: decodeXmlEntities(match[2].trim())
      });
    } else if (match[3]) {
      const feedGuid = readXmlAttr(match[3], 'feedGuid');
      const itemGuid = readXmlAttr(match[3], 'itemGuid');
      if (feedGuid && itemGuid) {
        items.push({ type: 'remoteItem', feedGuid, itemGuid });
      }
    }
  }

  return items;
}

/**
 * Generate a stable ID from episode title
 */
export function generateEpisodeId(title: string): string {
  return 'ep-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

/**
 * Group parsed items by episode or playcount marker
 */
export function groupItemsByEpisode(parsedItems: ParsedPlaylistItem[]): GroupedItems {
  const episodes: { title: string; remoteItems: RemoteItem[] }[] = [];
  const ungroupedItems: RemoteItem[] = [];
  let currentEpisode: { title: string; remoteItems: RemoteItem[] } | null = null;
  let foundEpisodeMarker = false;

  for (const item of parsedItems) {
    if (item.type === 'episode' || item.type === 'playcount') {
      foundEpisodeMarker = true;
      // Start new episode/playcount group
      if (currentEpisode) {
        episodes.push(currentEpisode);
      }
      currentEpisode = {
        title: item.title,
        remoteItems: []
      };
    } else if (item.type === 'remoteItem') {
      const remoteItem: RemoteItem = {
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid
      };

      if (currentEpisode) {
        // Add episode context to the remote item
        remoteItem.episodeTitle = currentEpisode.title;
        remoteItem.episodeId = generateEpisodeId(currentEpisode.title);
        remoteItem.episodeIndex = currentEpisode.remoteItems.length;
        currentEpisode.remoteItems.push(remoteItem);
      } else {
        // Track before any episode marker
        ungroupedItems.push(remoteItem);
      }
    }
  }

  // Push final episode
  if (currentEpisode) {
    episodes.push(currentEpisode);
  }

  return {
    episodes,
    ungroupedItems,
    hasEpisodeMarkers: foundEpisodeMarker
  };
}

/**
 * Fetch and parse playlist XML
 */
export async function fetchAndParsePlaylist(url: string): Promise<{
  xmlText: string;
  artworkUrl: string | null;
  playlistLink: string | null;
  remoteItems: RemoteItem[];
  groupedItems: GroupedItems;
}> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }

  const xmlText = await response.text();

  const artworkUrl = parseArtworkUrl(xmlText);
  const playlistLink = parsePlaylistLink(xmlText);

  // Parse with episode markers
  const parsedItems = parsePlaylistWithEpisodes(xmlText);
  const groupedItems = groupItemsByEpisode(parsedItems);

  // Flatten all remote items for resolution (preserving episode context)
  const remoteItems: RemoteItem[] = [
    ...groupedItems.ungroupedItems,
    ...groupedItems.episodes.flatMap(ep => ep.remoteItems)
  ];

  return {
    xmlText,
    artworkUrl,
    playlistLink,
    remoteItems,
    groupedItems
  };
}
