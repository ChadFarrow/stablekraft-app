/**
 * XML parsing utilities for playlist feeds
 */

import type { RemoteItem, ParsedPlaylistItem, GroupedItems } from './types';

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

  const remoteItemRegex = /<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*>/g;

  let match;
  while ((match = remoteItemRegex.exec(xmlText)) !== null) {
    const feedGuid = match[1];
    const itemGuid = match[2];

    if (feedGuid && itemGuid) {
      remoteItems.push({
        feedGuid,
        itemGuid
      });
    }
  }

  return remoteItems;
}

/**
 * Parse playlist with episode markers - extracts both episode markers and remote items in order
 */
export function parsePlaylistWithEpisodes(xmlText: string): ParsedPlaylistItem[] {
  const items: ParsedPlaylistItem[] = [];

  // Combined regex to match both episode markers and remote items in document order
  const combinedRegex = /<podcast:txt\s+purpose="episode">([^<]*)<\/podcast:txt>|<podcast:remoteItem[^>]*feedGuid="([^"]*)"[^>]*itemGuid="([^"]*)"[^>]*\/?>/g;

  let match;
  while ((match = combinedRegex.exec(xmlText)) !== null) {
    if (match[1] !== undefined) {
      // Episode marker - match[1] is the episode title
      items.push({
        type: 'episode',
        title: match[1].trim()
      });
    } else if (match[2] && match[3]) {
      // Remote item - match[2] is feedGuid, match[3] is itemGuid
      items.push({
        type: 'remoteItem',
        feedGuid: match[2],
        itemGuid: match[3]
      });
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
 * Group parsed items by episode
 */
export function groupItemsByEpisode(parsedItems: ParsedPlaylistItem[]): GroupedItems {
  const episodes: { title: string; remoteItems: RemoteItem[] }[] = [];
  const ungroupedItems: RemoteItem[] = [];
  let currentEpisode: { title: string; remoteItems: RemoteItem[] } | null = null;
  let foundEpisodeMarker = false;

  for (const item of parsedItems) {
    if (item.type === 'episode') {
      foundEpisodeMarker = true;
      // Start new episode group
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
      'User-Agent': 'StableKraft-Playlist-Parser/1.0'
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
