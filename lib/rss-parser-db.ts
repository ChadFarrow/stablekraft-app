import Parser from 'rss-parser';
import { XMLParser } from 'fast-xml-parser';
import { validateDuration } from './duration-validation';
import { PodcastImage, pickSquareArtwork, pickCanvasBackground } from './podcast-images';

// Re-export so existing import sites (e.g. lib/feed-parsing.ts) keep resolving these
// from rss-parser-db; the canonical, dependency-free home is lib/podcast-images.ts.
export type { PodcastImage };
export { pickSquareArtwork, pickCanvasBackground };

interface CustomFeed {
  title?: string;
  description?: string;
  link?: string;
  image?: {
    url?: string;
    title?: string;
    link?: string;
  };
  itunes?: {
    author?: string;
    summary?: string;
    image?: { $?: { href?: string } } | { href?: string } | string;
    explicit?: string;
    categories?: Array<{ $?: { text?: string } }> | string[];
    keywords?: string;
  };
  language?: string;
  items?: CustomItem[];
}

interface CustomItem {
  title?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  link?: string;
  enclosure?: {
    url?: string;
    type?: string;
    length?: string;
  };
  itunes?: {
    author?: string;
    subtitle?: string;
    summary?: string;
    duration?: string;
    explicit?: string;
    keywords?: string;
    image?: string;
    episode?: string;
    season?: string;
  };
  'podcast:chapters'?: any;
  'podcast:value'?: any;
  'podcast:valueTimeSplit'?: any;
}

const parser: Parser<CustomFeed, CustomItem> = new Parser({
  customFields: {
    feed: [
      ['itunes:author', 'itunes.author'],
      ['itunes:summary', 'itunes.summary'],
      ['itunes:image', 'itunes.image'],
      ['itunes:explicit', 'itunes.explicit'],
      ['itunes:category', 'itunes.categories', { keepArray: true }],
      ['itunes:keywords', 'itunes.keywords'],
      'language',
      ['podcast:value', 'podcast:value']
    ] as any,
    item: [
      ['itunes:author', 'itunes.author'],
      ['itunes:subtitle', 'itunes.subtitle'],
      ['itunes:summary', 'itunes.summary'],
      ['itunes:duration', 'itunes.duration'],
      ['itunes:explicit', 'itunes.explicit'],
      ['itunes:keywords', 'itunes.keywords'],
      ['itunes:image', 'itunes.image'],
      ['itunes:episode', 'itunes.episode'],
      ['itunes:season', 'itunes.season'],
      ['podcast:chapters', 'podcast:chapters'],
      ['podcast:value', 'podcast:value'],
      ['podcast:valueTimeSplit', 'podcast:valueTimeSplit']
    ] as any
  }
});

export interface ParsedFeed {
  title: string;
  description?: string;
  image?: string;
  artist?: string;
  language?: string;
  category?: string;
  podcastCategories?: string[];
  explicit: boolean;
  podcastGuid?: string;
  medium?: string;
  items: ParsedItem[];
  podcastImages?: PodcastImage[];
  v4vRecipient?: string;
  v4vValue?: any;
  publisherFeed?: {
    feedGuid: string;
    feedUrl: string;
    title?: string;  // Optional - Wavlake format doesn't include title in remoteItem
    medium?: string;
  };
}

export interface AlternateEnclosure {
  type: string;       // MIME type
  url: string;        // Media URL
  length?: number;    // File size in bytes
  bitrate?: number;
  height?: number;    // Video height for quality
  title?: string;     // Human-readable (max 32 chars)
  default?: boolean;
}

export interface ParsedItem {
  guid?: string;
  title: string;
  subtitle?: string;
  description?: string;
  artist?: string;
  audioUrl: string;
  duration?: number;
  explicit: boolean;
  image?: string;
  publishedAt?: Date;
  itunesAuthor?: string;
  itunesSummary?: string;
  itunesImage?: string;
  itunesDuration?: string;
  itunesKeywords?: string[];
  itunesCategories?: string[];
  v4vRecipient?: string;
  v4vValue?: any;
  startTime?: number;
  endTime?: number;
  episode?: number; // podcast:episode or itunes:episode number for track ordering
  season?: number; // podcast:season or itunes:season number for track ordering
  // Media type fields for video support
  mediaType?: 'audio' | 'video';
  mimeType?: string;
  alternateEnclosures?: AlternateEnclosure[];
  chaptersUrl?: string;
  chapters?: Array<{ title: string; startTime: number; endTime?: number; img?: string }>;
  valueTimeSplits?: Array<{ startTime: number; duration: number; remotePercentage: number; remoteItem?: { feedGuid: string; itemGuid: string; medium?: string } }>;
  persons?: ParsedPerson[];
  podcastImages?: PodcastImage[];
}

export interface ParsedPerson {
  name: string;
  role?: string;
  group?: string;
  href?: string;
  img?: string;
  // Nostr public key in npub1... bech32 form. Emitted by MSP on the custom
  // `npub=` attribute; also recovered from `href="nostr:npub1..."` as a fallback.
  npub?: string;
}

import { PodcastChapter, ValueTimeSplit } from '@/lib/podcast-types';

export type ParsedChapter = PodcastChapter;

/**
 * Normalize raw chapters JSON data: filter toc:false, sort by startTime, chain endTimes.
 * Shared by fetchChapters() (server-side import) and /api/chapters (client proxy).
 */
export function parseChaptersJSON(
  data: any
): ParsedChapter[] | null {
  if (!data?.chapters || !Array.isArray(data.chapters)) return null;

  const chapters = data.chapters
    .filter((ch: any) => ch.toc !== false)
    .sort((a: any, b: any) => a.startTime - b.startTime)
    .map((ch: any, i: number, arr: any[]) => ({
      title: ch.title,
      startTime: ch.startTime,
      endTime: ch.endTime ?? arr[i + 1]?.startTime ?? undefined,
      img: ch.img || ch.image || undefined,
    }));

  return chapters.length > 0 ? chapters : null;
}

/**
 * Fetch and parse podcast chapters from a chapters JSON URL.
 * Filters toc:false, sorts by startTime, chains endTimes.
 */
export async function fetchChapters(
  chaptersUrl: string
): Promise<ParsedChapter[] | null> {
  try {
    const response = await fetch(chaptersUrl, {
      headers: { 'User-Agent': 'StableKraft/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // If reflex proxy fails, try extracting the direct URL from the proxy path
      // Format: https://reflex.livewire.io/chapters/.../chapters/https://actual-url.json
      const directUrlMatch = chaptersUrl.match(/\/chapters\/(https?:\/\/.+)$/);
      if (directUrlMatch) {
        console.log(`🔄 Reflex proxy failed, trying direct chapters URL`);
        const directResponse = await fetch(directUrlMatch[1], {
          headers: { 'User-Agent': 'StableKraft/1.0' },
          signal: AbortSignal.timeout(10000),
        });
        if (directResponse.ok) {
          const data = await directResponse.json();
          return parseChaptersJSON(data);
        }
      }
      return null;
    }

    const data = await response.json();
    return parseChaptersJSON(data);
  } catch (error) {
    console.warn(`⚠️ Failed to fetch chapters from ${chaptersUrl}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Apply v4v, chapter, and VTS fields from a parsed RSS item to a Prisma update object.
 * Shared by single-feed and bulk reparse routes.
 */
export function applyParsedItemFields(updateData: any, matchedItem: ParsedItem | null): void {
  if (!matchedItem) return;
  if (matchedItem.v4vRecipient) updateData.v4vRecipient = matchedItem.v4vRecipient;
  if (matchedItem.v4vValue) updateData.v4vValue = matchedItem.v4vValue;
  if (matchedItem.chaptersUrl) updateData.chaptersUrl = matchedItem.chaptersUrl;
  if (matchedItem.chapters) updateData.chapters = matchedItem.chapters;
  if (matchedItem.valueTimeSplits) updateData.valueTimeSplits = matchedItem.valueTimeSplits;
  if (matchedItem.persons && matchedItem.persons.length > 0) updateData.persons = matchedItem.persons;
  if (matchedItem.podcastImages && matchedItem.podcastImages.length > 0) updateData.podcastImages = matchedItem.podcastImages;
}

// NIP-19 bech32 npub format: 63 chars total, lowercase letters + numbers minus 1/b/i/o
const NPUB_REGEX = /^npub1[02-9ac-hj-np-z]{58,63}$/i;

function parsePersonAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z:][a-zA-Z0-9:_-]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(attrString)) !== null) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

// Extract <podcast:person> entries from any XML block (item or channel scope).
function parsePersonsFromBlock(xmlBlock: string): ParsedPerson[] {
  const persons: ParsedPerson[] = [];
  // Matches both self-closing (`<podcast:person …/>`) and open/close forms
  const regex = /<podcast:person\b([^>]*?)(?:\/>|>([\s\S]*?)<\/podcast:person>)/gi;
  let match;
  while ((match = regex.exec(xmlBlock)) !== null) {
    const attrStr = match[1] || '';
    const rawContent = (match[2] || '').trim();
    const attrs = parsePersonAttrs(attrStr);
    const name = rawContent.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || attrs.name || '';
    if (!name && !attrs.npub && !attrs.href) continue;
    const person: ParsedPerson = { name };
    if (attrs.role) person.role = attrs.role;
    if (attrs.group) person.group = attrs.group;
    if (attrs.href) person.href = attrs.href;
    if (attrs.img) person.img = attrs.img;
    let npubCandidate = attrs.npub;
    if (!npubCandidate && attrs.href && /^nostr:npub1/i.test(attrs.href)) {
      npubCandidate = attrs.href.replace(/^nostr:/i, '');
    }
    if (npubCandidate && NPUB_REGEX.test(npubCandidate)) {
      person.npub = npubCandidate;
    }
    persons.push(person);
  }
  return persons;
}

export function parseItemPersonsFromXML(xmlText: string, itemTitle: string): ParsedPerson[] {
  try {
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    const items: string[] = [];
    let itemMatch;
    while ((itemMatch = itemRegex.exec(xmlText)) !== null) items.push(itemMatch[0]);

    const xmlEncodedTitle = itemTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedTitle = itemTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedXmlTitle = xmlEncodedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedTitle}(\\]\\]>)?</title>`, 'i');
    const xmlTitleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedXmlTitle}(\\]\\]>)?</title>`, 'i');
    const itemContent = items.find(item => titleRegex.test(item) || xmlTitleRegex.test(item));
    if (!itemContent) return [];
    return withTxtNpubPersons(parsePersonsFromBlock(itemContent), itemContent);
  } catch {
    return [];
  }
}

export function parseChannelPersonsFromXML(xmlText: string): ParsedPerson[] {
  try {
    // Channel-level tags may sit before OR after the items — see channelMetadataXml.
    // This used to slice "everything up to the first <item>", which finds nothing at
    // all on the MSP-generated music feeds, the very feeds that carry the npubs.
    const channelBlock = channelMetadataXml(xmlText);
    if (!channelBlock) return [];
    return withTxtNpubPersons(parsePersonsFromBlock(channelBlock), channelBlock);
  } catch {
    return [];
  }
}

/**
 * Nostr public keys carried by `<podcast:txt>` rather than by `<podcast:person>`.
 *
 * Both forms are in the wild for the same fact — "this is my Nostr identity" —
 * and only the person form was read, so a feed that published
 * `<podcast:txt purpose="nostr">npub1…</podcast:txt>` reached the boost note
 * with nobody tagged.
 *
 * The PURPOSE is deliberately not matched, and neither is the SHAPE of the
 * value. `purpose` is free text — feeds use `nostr`, `npub` and
 * verification-flavoured spellings for the same thing — and the value is
 * sometimes the bare key, sometimes the `nostr:` URI a client copies, sometimes
 * a sentence with the key inside it. Guessing any of that wrong fails silently:
 * the feed parses, and simply looks like it named nobody.
 *
 * The payload is what validates, and it validates itself. `npub1` plus 58-63
 * bech32 characters is a checksummed key by construction, so the values that
 * must NOT match cannot match by accident — an Apple verification token, the
 * `source-feed` URL our own playlists emit, an `nsec` somebody pasted by
 * mistake. Scanning the text for the key is therefore both wider and safer than
 * requiring an exact spelling of either half.
 *
 * The boundaries are load-bearing. A bech32 run longer than 63 characters is
 * not an npub with something after it, it is a different identifier: the
 * trailing lookahead makes the match fail rather than take a 63-character
 * prefix of it, which would be a plausible-looking key belonging to nobody.
 */
function parseNpubTxtFromBlock(xmlBlock: string): string[] {
  const npubs: string[] = [];
  // Open/close form only: a self-closing <podcast:txt/> carries no value.
  const regex = /<podcast:txt\b[^>]*>([\s\S]*?)<\/podcast:txt>/gi;
  // Not anchored: the key may be the whole value or sit inside a sentence.
  const inner = /(?<![0-9a-z])(?:nostr:)?(npub1[02-9ac-hj-np-z]{58,63})(?![0-9a-z])/gi;
  let match;
  while ((match = regex.exec(xmlBlock)) !== null) {
    const text = (match[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    inner.lastIndex = 0;
    let keyMatch;
    while ((keyMatch = inner.exec(text)) !== null) {
      // bech32 is case-insensitive, and lowercase is the form every reader
      // downstream expects — BoostButton filters on a literal `npub1` prefix.
      const npub = keyMatch[1].toLowerCase();
      if (!NPUB_REGEX.test(npub)) continue;
      if (!npubs.includes(npub)) npubs.push(npub);
    }
  }
  return npubs;
}

/**
 * Fold txt-carried npubs into the person list of the same block.
 *
 * `persons` is the single store, so every reader downstream — the boost note's
 * p-tags above all — picks these up with no further change. An npub already
 * named by a `<podcast:person>` is skipped: the person entry carries a name and
 * a role, and a second entry for the same key would p-tag the same pubkey twice.
 *
 * The name is left EMPTY. A txt tag states a key and nothing else, and the feed
 * title is the album's name, not the person's — putting it here would invent a
 * credit that the feed never made. Only `npub` is a fact, so only `npub` is set.
 */
function withTxtNpubPersons(persons: ParsedPerson[], xmlBlock: string): ParsedPerson[] {
  const txtNpubs = parseNpubTxtFromBlock(xmlBlock);
  if (txtNpubs.length === 0) return persons;
  const known = new Set(persons.map(p => p.npub?.toLowerCase()).filter(Boolean));
  const merged = [...persons];
  for (const npub of txtNpubs) {
    if (known.has(npub.toLowerCase())) continue;
    known.add(npub.toLowerCase());
    merged.push({ name: '', npub });
  }
  return merged;
}

// Extract <podcast:image> entries from any XML block (item or channel scope).
function parsePodcastImagesFromBlock(xmlBlock: string): PodcastImage[] {
  const images: PodcastImage[] = [];
  // Matches both self-closing (`<podcast:image …/>`) and open/close forms
  const regex = /<podcast:image\b([^>]*?)(?:\/>|>[\s\S]*?<\/podcast:image>)/gi;
  let match;
  while ((match = regex.exec(xmlBlock)) !== null) {
    const attrs = parsePersonAttrs(match[1] || '');
    if (!attrs.href) continue; // href is required per spec
    const image: PodcastImage = { href: attrs.href };
    if (attrs.alt) image.alt = attrs.alt;
    if (attrs['aspect-ratio']) image.aspectRatio = attrs['aspect-ratio'];
    if (attrs.type) image.type = attrs.type;
    if (attrs.purpose) image.purpose = attrs.purpose;
    const width = parseInt(attrs.width, 10);
    if (Number.isFinite(width)) image.width = width;
    const height = parseInt(attrs.height, 10);
    if (Number.isFinite(height)) image.height = height;
    images.push(image);
  }
  return images;
}

export function parseItemPodcastImagesFromXML(xmlText: string, itemTitle: string): PodcastImage[] {
  try {
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    const items: string[] = [];
    let itemMatch;
    while ((itemMatch = itemRegex.exec(xmlText)) !== null) items.push(itemMatch[0]);

    const xmlEncodedTitle = itemTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedTitle = itemTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedXmlTitle = xmlEncodedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedTitle}(\\]\\]>)?</title>`, 'i');
    const xmlTitleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedXmlTitle}(\\]\\]>)?</title>`, 'i');
    const itemContent = items.find(item => titleRegex.test(item) || xmlTitleRegex.test(item));
    if (!itemContent) return [];
    return parsePodcastImagesFromBlock(itemContent);
  } catch {
    return [];
  }
}

export function parseChannelPodcastImagesFromXML(xmlText: string): PodcastImage[] {
  try {
    // Channel block = from opening <channel> up to first <item> (or </channel>)
    const channelMatch = xmlText.match(/<channel[^>]*>([\s\S]*?)(?=<item\b|<\/channel>)/i);
    if (!channelMatch) return [];
    return parsePodcastImagesFromBlock(channelMatch[1] || '');
  } catch {
    return [];
  }
}

// Helper function to detect media type from MIME type or URL
export function detectMediaType(mimeType: string | undefined, url: string | undefined): 'audio' | 'video' {
  const type = mimeType?.toLowerCase() || '';
  const urlLower = url?.toLowerCase() || '';

  if (
    type.includes('video') ||
    type.includes('mpegurl') ||
    type.includes('x-mpegurl') ||
    urlLower.includes('.mp4') ||
    urlLower.includes('.webm') ||
    urlLower.includes('.m3u8') ||
    urlLower.includes('.mov') ||
    urlLower.includes('.moov') ||
    urlLower.includes('cloudflarestream.com')
  ) {
    return 'video';
  }
  return 'audio';
}

// Helper function to detect media type from a track object, including alternateEnclosures
// Use this when creating/updating tracks to properly detect video content
export function detectTrackMediaType(track: {
  mediaType?: string;
  mimeType?: string;
  audioUrl?: string;
  alternateEnclosures?: Array<{ type?: string; url?: string }>;
}): 'audio' | 'video' {
  // If already marked as video, keep it
  if (track.mediaType === 'video') {
    return 'video';
  }

  // Check main enclosure
  if (detectMediaType(track.mimeType, track.audioUrl) === 'video') {
    return 'video';
  }

  // Check alternateEnclosures for video content
  if (track.alternateEnclosures?.length) {
    const hasVideoAlt = track.alternateEnclosures.some((enc) =>
      enc.type?.toLowerCase().includes('video') ||
      enc.type?.toLowerCase().includes('mpegurl') ||
      enc.url?.toLowerCase().includes('.mp4') ||
      enc.url?.toLowerCase().includes('.m3u8') ||
      enc.url?.toLowerCase().includes('.webm') ||
      enc.url?.toLowerCase().includes('.moov')
    );
    if (hasVideoAlt) {
      return 'video';
    }
  }

  return 'audio';
}

// Helper function to parse alternate enclosures from XML for a specific item
export function parseAlternateEnclosures(xmlText: string, itemGuid: string): AlternateEnclosure[] {
  const enclosures: AlternateEnclosure[] = [];

  try {
    // Find the item block containing this GUID
    const guidEscaped = itemGuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Try to find the item containing this GUID
    // Match from <item> to </item>
    const itemRegex = new RegExp(`<item[^>]*>(?:(?!</item>)[\\s\\S])*?<guid[^>]*>\\s*${guidEscaped}\\s*</guid>(?:(?!</item>)[\\s\\S])*?</item>`, 'i');
    const itemMatch = xmlText.match(itemRegex);

    if (!itemMatch) {
      return enclosures;
    }

    const itemContent = itemMatch[0];

    // Parse podcast:alternateEnclosure tags
    // Pattern: <podcast:alternateEnclosure type="..." length="..." ...> ... </podcast:alternateEnclosure>
    const altEnclosureRegex = /<podcast:alternateEnclosure([^>]*)>([\s\S]*?)<\/podcast:alternateEnclosure>/gi;
    let match;

    while ((match = altEnclosureRegex.exec(itemContent)) !== null) {
      const attributes = match[1];
      const innerContent = match[2];

      // Extract attributes
      const typeMatch = attributes.match(/type="([^"]*)"/);
      const lengthMatch = attributes.match(/length="([^"]*)"/);
      const bitrateMatch = attributes.match(/bitrate="([^"]*)"/);
      const heightMatch = attributes.match(/height="([^"]*)"/);
      const titleMatch = attributes.match(/title="([^"]*)"/);
      const defaultMatch = attributes.match(/default="([^"]*)"/);

      // Extract nested source URI
      const sourceMatch = innerContent.match(/<podcast:source[^>]*uri="([^"]*)"/);

      if (typeMatch && sourceMatch) {
        const enclosure: AlternateEnclosure = {
          type: typeMatch[1],
          url: sourceMatch[1],
          length: lengthMatch ? parseInt(lengthMatch[1], 10) : undefined,
          bitrate: bitrateMatch ? parseInt(bitrateMatch[1], 10) : undefined,
          height: heightMatch ? parseInt(heightMatch[1], 10) : undefined,
          title: titleMatch ? titleMatch[1].substring(0, 32) : undefined,
          default: defaultMatch ? defaultMatch[1].toLowerCase() === 'true' : undefined,
        };
        enclosures.push(enclosure);
      }
    }

    // Also handle self-closing alternate enclosures with uri attribute
    const selfClosingRegex = /<podcast:alternateEnclosure([^>]*)\/>/gi;
    while ((match = selfClosingRegex.exec(itemContent)) !== null) {
      const attributes = match[1];

      const typeMatch = attributes.match(/type="([^"]*)"/);
      const uriMatch = attributes.match(/uri="([^"]*)"/);
      const lengthMatch = attributes.match(/length="([^"]*)"/);
      const bitrateMatch = attributes.match(/bitrate="([^"]*)"/);
      const heightMatch = attributes.match(/height="([^"]*)"/);
      const titleMatch = attributes.match(/title="([^"]*)"/);
      const defaultMatch = attributes.match(/default="([^"]*)"/);

      if (typeMatch && uriMatch) {
        const enclosure: AlternateEnclosure = {
          type: typeMatch[1],
          url: uriMatch[1],
          length: lengthMatch ? parseInt(lengthMatch[1], 10) : undefined,
          bitrate: bitrateMatch ? parseInt(bitrateMatch[1], 10) : undefined,
          height: heightMatch ? parseInt(heightMatch[1], 10) : undefined,
          title: titleMatch ? titleMatch[1].substring(0, 32) : undefined,
          default: defaultMatch ? defaultMatch[1].toLowerCase() === 'true' : undefined,
        };
        enclosures.push(enclosure);
      }
    }
  } catch (error) {
    console.warn(`⚠️ Error parsing alternate enclosures for item ${itemGuid}:`, error);
  }

  return enclosures;
}

// Helper function to parse V4V data from XML directly
export function parseV4VFromXML(xmlText: string): { recipient: string | null; value: any } {
  try {
    console.log('🔍 DEBUG: Parsing V4V from XML...');
    
    // Look for podcast:value tags (handle both self-closing and with content)
    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const valueMatch = valueRegex.exec(xmlText);
    
    if (!valueMatch) {
      console.log('ℹ️ DEBUG: No podcast:value tags found in XML');
      return { recipient: null, value: null };
    }
    
    console.log('🔍 DEBUG: Found podcast:value tag:', valueMatch[0]);
    
    const valueContent = valueMatch[1]; // Content between tags
    const typeMatch = valueMatch[0].match(/type="([^"]*)"/);
    const methodMatch = valueMatch[0].match(/method="([^"]*)"/);
    
    console.log('🔍 DEBUG: Type:', typeMatch ? typeMatch[1] : 'not found');
    console.log('🔍 DEBUG: Method:', methodMatch ? methodMatch[1] : 'not found');
    
    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags with nested content)
    // Updated regex to properly match each recipient individually, handling nested <value> and <key> elements
    // Match opening tag with attributes, then either self-closing or content until closing tag
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|>(?:(?!<podcast:valueRecipient)[\s\S])*?<\/podcast:valueRecipient>)/g;
    const recipients = [];
    let match;
    
    while ((match = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = match[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const typeMatch = recipientTag.match(/type="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const feeMatch = recipientTag.match(/fee="([^"]*)"/);
      
      // Extract customKey/customValue - prefer nested elements over attributes
      // Some feeds use attributes, others use nested <key>/<value> elements, some use both
      let customKey = recipientTag.match(/customKey="([^"]*)"/)?.[1];
      let customValue = recipientTag.match(/customValue="([^"]*)"/)?.[1];

      // Check for nested <key> element - these override attributes when present
      const keyMatch = recipientTag.match(/<key>([\s\S]*?)<\/key>/);
      if (keyMatch) {
        customKey = keyMatch[1].trim();
      }

      // Check for nested <value> element - these override attributes when present
      const valueMatch = recipientTag.match(/<value>([\s\S]*?)<\/value>/);
      if (valueMatch) {
        customValue = valueMatch[1].trim();
      }
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        type: typeMatch ? typeMatch[1] : 'node',
        split: splitMatch ? parseInt(splitMatch[1], 10) || 100 : 100,
        fee: feeMatch ? feeMatch[1] === 'true' : false,
        customKey: customKey || null,
        customValue: customValue || null
      };

      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }

    if (recipients.length > 0) {
      // Filter out fee recipients (Podcastindex.org fee injection)
      const nonFeeRecipients = recipients.filter(r => !r.fee);

      // Use the recipient with the highest split percentage (usually the artist/main recipient)
      const sorted = [...nonFeeRecipients].sort((a, b) => (b.split || 0) - (a.split || 0));
      const primaryRecipient = sorted[0];

      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      console.log('✅ DEBUG: Filtered out fee recipients, remaining:', nonFeeRecipients.length);

      return {
        recipient: primaryRecipient.address,
        value: {
          type: typeMatch ? typeMatch[1] : 'lightning',
          method: methodMatch ? methodMatch[1] : 'keysend',
          recipients: nonFeeRecipients
        }
      };
    }
    
    console.log('⚠️ DEBUG: No recipients found in podcast:value');
    return { recipient: null, value: null };
  } catch (error) {
    console.error('Error parsing V4V from XML:', error);
    return { recipient: null, value: null };
  }
}

// Helper function to extract remoteItem attributes from XML content
function extractRemoteItemAttributes(content: string): { feedGuid: string; feedUrl: string; title?: string; medium?: string } | null {
  const feedGuidMatch = content.match(/feedGuid="([^"]+)"/);
  const feedUrlMatch = content.match(/feedUrl="([^"]+)"/);
  const titleMatch = content.match(/title="([^"]+)"/);
  const mediumMatch = content.match(/medium="([^"]+)"/);

  if (feedGuidMatch && feedUrlMatch) {
    return {
      feedGuid: feedGuidMatch[1],
      feedUrl: feedUrlMatch[1],
      title: titleMatch?.[1],
      medium: mediumMatch?.[1]
    };
  }
  return null;
}

// Helper function to extract podcast:publisher remoteItem from channel level
// Supports two formats:
// 1. Nested: <podcast:publisher><podcast:remoteItem .../></podcast:publisher>
// 2. Wavlake: <podcast:remoteItem medium="publisher" .../> at channel level
export function parsePublisherFeedFromXML(xmlText: string): { feedGuid: string; feedUrl: string; title?: string; medium?: string } | null {
  try {
    // Channel metadata may sit before OR after the items — see channelMetadataXml.
    const beforeItems = channelMetadataXml(xmlText);
    if (!beforeItems) {
      return null;
    }

    // Method 1: Look for <podcast:publisher><podcast:remoteItem/></podcast:publisher> (nested format)
    const publisherMatch = beforeItems.match(/<podcast:publisher[^>]*>(.*?)<\/podcast:publisher>/s);
    if (publisherMatch) {
      const remoteItemMatch = publisherMatch[1].match(/<podcast:remoteItem\s+([^>]+)\/>/);
      if (remoteItemMatch) {
        const result = extractRemoteItemAttributes(remoteItemMatch[0]);
        if (result) {
          console.log('✅ Found podcast:publisher remoteItem (nested format):', result);
          return result;
        }
      }
    }

    // Method 2: Look for <podcast:remoteItem medium="publisher" ...> at channel level (Wavlake format)
    // Handles both self-closing (/>)  and closing tag (</podcast:remoteItem>) formats
    const remoteItemRegex = /<podcast:remoteItem\s+[^>]*medium="publisher"[^>]*(?:\/>|>[\s\S]*?<\/podcast:remoteItem>)/;
    const remoteItemMatch = beforeItems.match(remoteItemRegex);
    if (remoteItemMatch) {
      const result = extractRemoteItemAttributes(remoteItemMatch[0]);
      if (result) {
        console.log('✅ Found podcast:remoteItem with medium="publisher" (Wavlake format):', result);
        return result;
      }
    }

    return null;
  } catch (error) {
    console.error('Error extracting publisher from XML:', error);
    return null;
  }
}

// Helper function to extract podcast:medium from channel level
export function parsePodcastMediumFromXML(xmlText: string): string | null {
  try {
    // Channel metadata may sit before OR after the items — see channelMetadataXml.
    // This one decides album-vs-podcast typing, so a miss here mistypes the feed.
    const beforeItems = channelMetadataXml(xmlText);
    if (!beforeItems) return null;
    const mediumMatch = beforeItems.match(/<podcast:medium>([^<]+)<\/podcast:medium>/);

    if (mediumMatch && mediumMatch[1]) {
      return mediumMatch[1].trim().toLowerCase();
    }
    return null;
  } catch (error) {
    console.error('Error extracting podcast:medium from XML:', error);
    return null;
  }
}

/**
 * The channel's own metadata, with every `<item>` block removed.
 *
 * **Channel-level tags are NOT required to precede the items.** Element order
 * inside `<channel>` is unconstrained by RSS, and real feeds use both layouts —
 * the MSP-generated music feeds put `<podcast:guid>`, `<podcast:medium>` and
 * friends *after* the last item (measured: guid at byte 17041, first `<item>`
 * at 664).
 *
 * Every reader here used to take `channelContent.split(/<item[\s>]/)[0]` —
 * "everything before the first item" — which silently returns nothing at all
 * for those feeds. It fails quietly, in the worst way: the feed parses fine and
 * simply has no guid, no medium and no categories, so an album that declares
 * `<podcast:medium>music</podcast:medium>` looks like it declared nothing.
 * That is why 7 feeds sat with a null `Feed.guid` no reparse could fill, and
 * their tracks couldn't carry the parent-feed hint on the shared favorites list.
 *
 * Stripping the items instead is correct for both layouts, and still can't pick
 * up an item-level tag by mistake.
 */
function channelMetadataXml(xmlText: string): string | null {
  const channelMatch = xmlText.match(/<channel[^>]*>([\s\S]*?)<\/channel>/);
  if (!channelMatch) return null;
  const channelContent = channelMatch[1];
  const stripped = channelContent.replace(/<item[\s>][\s\S]*?<\/item>/gi, '');
  // An unclosed <item> means the strip did nothing and item bodies are still in
  // there. Fall back to the old pre-item slice rather than risk reading an
  // item-level tag as channel metadata — narrower, but never wrong.
  if (/<item[\s>]/i.test(stripped)) return channelContent.split(/<item[\s>]/)[0];
  return stripped;
}

// Helper function to extract podcast:guid from channel level
export function parsePodcastGuidFromXML(xmlText: string): string | null {
  try {
    // Channel metadata may sit before OR after the items — see channelMetadataXml.
    const beforeItems = channelMetadataXml(xmlText);
    if (!beforeItems) {
      return null;
    }
    const guidRegex = /<podcast:guid>([^<]+)<\/podcast:guid>/;
    const guidMatch = beforeItems.match(guidRegex);

    if (guidMatch && guidMatch[1]) {
      console.log('✅ Found podcast:guid:', guidMatch[1]);
      return guidMatch[1].trim();
    }

    return null;
  } catch (error) {
    console.error('Error extracting podcast:guid from XML:', error);
    return null;
  }
}

// Helper function to extract episode and season numbers from XML for all items
// Returns a Map of guid -> { episode, season } for track ordering
export function parseEpisodeNumbersFromXML(xmlText: string): Map<string, { episode: number; season?: number }> {
  const episodeMap = new Map<string, { episode: number; season?: number }>();

  try {
    // Extract all items from XML
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    let itemMatch;

    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      const itemContent = itemMatch[1];

      // Extract GUID
      const guidMatch = itemContent.match(/<guid[^>]*>(.*?)<\/guid>/);
      const guid = guidMatch ? guidMatch[1].trim() : null;

      // Extract episode number (try podcast:episode first, then itunes:episode)
      const episodeMatch = itemContent.match(/<podcast:episode>(\d+)<\/podcast:episode>|<itunes:episode>(\d+)<\/itunes:episode>/);
      const episode = episodeMatch ? parseInt(episodeMatch[1] || episodeMatch[2]) : null;

      // Extract season number (try podcast:season first, then itunes:season)
      const seasonMatch = itemContent.match(/<podcast:season>(\d+)<\/podcast:season>|<itunes:season>(\d+)<\/itunes:season>/);
      const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2]) : undefined;

      if (guid && episode !== null) {
        episodeMap.set(guid, { episode, season });
      }
    }
  } catch (error) {
    console.error('Error extracting episode/season numbers from XML:', error);
  }

  return episodeMap;
}

// Helper function to calculate trackOrder from season and episode
// Uses formula: (season * 1000) + episode to ensure proper ordering across seasons
export function calculateTrackOrder(episode: number, season?: number): number {
  if (season !== undefined && season > 0) {
    return (season * 1000) + episode;
  }
  return episode;
}

// Helper function to parse V4V data for a specific item from XML
export function parseItemV4VFromXML(xmlText: string, itemTitle: string): { recipient: string | null; value: any; valueTimeSplits: Array<{ startTime: number; duration: number; remotePercentage: number; remoteItem?: { feedGuid: string; itemGuid: string; medium?: string } }> } {
  try {
    console.log(`🔍 DEBUG: Parsing V4V for item "${itemTitle}" from XML...`);

    // Split XML into individual items to avoid regex matching across item boundaries
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
    const items = [];
    let itemMatch;
    while ((itemMatch = itemRegex.exec(xmlText)) !== null) {
      items.push(itemMatch[0]);
    }

    console.log(`🔍 DEBUG: Found ${items.length} items in XML`);

    // Find the item with the matching title
    // Try both decoded title and XML-encoded version (& -> &amp;, etc.)
    const xmlEncodedTitle = itemTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedTitle = itemTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedXmlTitle = xmlEncodedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedTitle}(\\]\\]>)?</title>`, 'i');
    const xmlTitleRegex = new RegExp(`<title>(<!\\[CDATA\\[)?${escapedXmlTitle}(\\]\\]>)?</title>`, 'i');

    const itemContent = items.find(item => titleRegex.test(item) || xmlTitleRegex.test(item));

    if (!itemContent) {
      console.log(`ℹ️ DEBUG: Item "${itemTitle}" not found in XML (tried both decoded and XML-encoded)`);
      return { recipient: null, value: null, valueTimeSplits: [] };
    }

    console.log(`🔍 DEBUG: Found item content for "${itemTitle}" (${itemContent.length} chars)`);
    
    // Look for podcast:value tags within this specific item
    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const valueMatch = valueRegex.exec(itemContent);
    
    if (!valueMatch) {
      console.log(`ℹ️ DEBUG: No podcast:value tags found in item "${itemTitle}"`);
      return { recipient: null, value: null, valueTimeSplits: [] };
    }
    
    console.log(`🔍 DEBUG: Found podcast:value tag in item "${itemTitle}":`, valueMatch[0]);

    let valueContent = valueMatch[1];
    const valueTypeMatch = valueMatch[0].match(/type="([^"]*)"/);
    const valueMethodMatch = valueMatch[0].match(/method="([^"]*)"/);

    console.log('🔍 DEBUG: Type:', valueTypeMatch ? valueTypeMatch[1] : 'not found');
    console.log('🔍 DEBUG: Method:', valueMethodMatch ? valueMethodMatch[1] : 'not found');

    // Capture VTS blocks BEFORE stripping them from valueContent
    const vtsRegex = /<podcast:valueTimeSplit([^>]*)>([\s\S]*?)<\/podcast:valueTimeSplit>/g;
    const valueTimeSplits: Array<{ startTime: number; duration: number; remotePercentage: number; remoteItem?: { feedGuid: string; itemGuid: string; medium?: string } }> = [];
    let vtsMatch;
    while ((vtsMatch = vtsRegex.exec(valueContent)) !== null) {
      const attrs = vtsMatch[1];
      const inner = vtsMatch[2];

      const startTime = parseFloat(attrs.match(/startTime="([^"]*)"/)?.[1] || '0');
      const duration = parseFloat(attrs.match(/duration="([^"]*)"/)?.[1] || '0');
      const remotePercentage = parseFloat(attrs.match(/remotePercentage="([^"]*)"/)?.[1] || '100');

      if (duration <= 0) continue;

      const remoteMatch = /<podcast:remoteItem([^>]*)\/?>/i.exec(inner);
      let remoteItem: { feedGuid: string; itemGuid: string; medium?: string } | undefined;
      if (remoteMatch) {
        const ra = remoteMatch[1];
        const feedGuid = ra.match(/feedGuid="([^"]*)"/)?.[1] || '';
        const itemGuid = ra.match(/itemGuid="([^"]*)"/)?.[1] || '';
        const medium = ra.match(/medium="([^"]*)"/)?.[1];
        remoteItem = { feedGuid, itemGuid };
        if (medium) remoteItem.medium = medium;
      }

      valueTimeSplits.push({ startTime, duration, remotePercentage, remoteItem });
    }

    if (valueTimeSplits.length > 0) {
      console.log(`🔍 DEBUG: Captured ${valueTimeSplits.length} valueTimeSplit blocks from XML`);
    }

    // Remove podcast:valueTimeSplit blocks to avoid duplicating their recipients
    valueContent = valueContent.replace(/<podcast:valueTimeSplit[^>]*>[\s\S]*?<\/podcast:valueTimeSplit>/g, '');

    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags with nested content)
    // Updated regex to properly match each recipient individually, handling nested <value> and <key> elements
    // Match opening tag with attributes, then either self-closing or content until closing tag
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|>(?:(?!<podcast:valueRecipient)[\s\S])*?<\/podcast:valueRecipient>)/g;
    const recipients = [];
    let match;
    
    while ((match = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = match[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const recipientTypeMatch = recipientTag.match(/type="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const feeMatch = recipientTag.match(/fee="([^"]*)"/);
      
      // Extract customKey/customValue - prefer nested elements over attributes
      // Some feeds use attributes, others use nested <key>/<value> elements, some use both
      let customKey = recipientTag.match(/customKey="([^"]*)"/)?.[1];
      let customValue = recipientTag.match(/customValue="([^"]*)"/)?.[1];

      // Check for nested <key> element - these override attributes when present
      const keyMatch = recipientTag.match(/<key>([\s\S]*?)<\/key>/);
      if (keyMatch) {
        customKey = keyMatch[1].trim();
      }

      // Check for nested <value> element - these override attributes when present
      const valueMatch = recipientTag.match(/<value>([\s\S]*?)<\/value>/);
      if (valueMatch) {
        customValue = valueMatch[1].trim();
      }
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        type: recipientTypeMatch ? recipientTypeMatch[1] : 'node',
        split: splitMatch ? parseInt(splitMatch[1], 10) || 100 : 100,
        fee: feeMatch ? feeMatch[1] === 'true' : false,
        customKey: customKey || null,
        customValue: customValue || null
      };

      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }

    if (recipients.length > 0) {
      // Filter out fee recipients (Podcastindex.org fee injection)
      const nonFeeRecipients = recipients.filter(r => !r.fee);

      // Use the recipient with the highest split percentage (usually the artist/main recipient)
      const sorted = [...nonFeeRecipients].sort((a, b) => (b.split || 0) - (a.split || 0));
      const primaryRecipient = sorted[0];

      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      console.log('✅ DEBUG: Filtered out fee recipients, remaining:', nonFeeRecipients.length);

      return {
        recipient: primaryRecipient.address,
        value: {
          type: valueTypeMatch ? valueTypeMatch[1] : 'lightning',
          method: valueMethodMatch ? valueMethodMatch[1] : 'keysend',
          recipients: nonFeeRecipients
        },
        valueTimeSplits
      };
    }
    
    console.log(`⚠️ DEBUG: No recipients found in podcast:value for item "${itemTitle}"`);
    return { recipient: null, value: null, valueTimeSplits };
  } catch (error) {
    console.error(`Error parsing V4V for item "${itemTitle}" from XML:`, error);
    return { recipient: null, value: null, valueTimeSplits: [] };
  }
}

function extractItunesImage(itunesImage: any): string | undefined {
  if (!itunesImage) return undefined;
  
  if (typeof itunesImage === 'string') {
    return itunesImage;
  }
  
  if (itunesImage.$ && itunesImage.$.href) {
    return itunesImage.$.href;
  }
  
  if (itunesImage.href) {
    return itunesImage.href;
  }
  
  return undefined;
}

function extractItunesCategories(categories: any): string[] {
  if (!categories) return [];

  const result: string[] = [];

  if (Array.isArray(categories)) {
    categories.forEach(cat => {
      if (!cat) return; // Skip null/undefined items
      if (typeof cat === 'string') {
        result.push(cat);
      } else if (cat && cat.$ && cat.$.text) {
        result.push(cat.$.text);
      }
    });
  }

  return result;
}

/**
 * Extract podcast:category tags from XML including nested subcategories
 * Example input:
 * <podcast:category text="Pop">
 *   <podcast:category text="Indie Pop"/>
 * </podcast:category>
 * Returns: ["Pop", "Indie Pop"]
 */
function extractPodcastCategories(xmlText: string): string[] {
  const categories: string[] = [];

  try {
    // Channel metadata may sit before OR after the items — see channelMetadataXml.
    const beforeItems = channelMetadataXml(xmlText);
    if (!beforeItems) return categories;

    // Match all podcast:category tags with their content
    // Handles both self-closing and tags with children
    const categoryRegex = /<podcast:category[^>]*text=["']([^"']+)["'][^>]*(?:\/>|>([\s\S]*?)<\/podcast:category>)/gi;

    let match;
    while ((match = categoryRegex.exec(beforeItems)) !== null) {
      const categoryText = match[1];
      const innerContent = match[2] || '';

      if (categoryText && !categories.includes(categoryText)) {
        categories.push(categoryText);
      }

      // Parse nested subcategories
      if (innerContent) {
        const nestedRegex = /<podcast:category[^>]*text=["']([^"']+)["'][^>]*(?:\/>|>[^<]*<\/podcast:category>)/gi;
        let nestedMatch;
        while ((nestedMatch = nestedRegex.exec(innerContent)) !== null) {
          const subCategoryText = nestedMatch[1];
          if (subCategoryText && !categories.includes(subCategoryText)) {
            categories.push(subCategoryText);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error extracting podcast categories from XML:', error);
  }

  return categories;
}

function parseDuration(duration: string | undefined): number | undefined {
  if (!duration) return undefined;

  // Handle HH:MM:SS format
  if (duration.includes(':')) {
    const parts = duration.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  // Handle seconds as string
  const seconds = parseInt(duration, 10);
  return isNaN(seconds) ? undefined : seconds;
}

function parseKeywords(keywords: string | undefined): string[] {
  if (!keywords) return [];
  return keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

export async function parseRSSFeed(feedUrl: string): Promise<ParsedFeed> {
  try {
    console.log(`🔍 Parsing RSS feed: ${feedUrl}`);
    
    // Fetch the raw XML first for direct V4V parsing
    const response = await fetch(feedUrl);
    let xmlText = await response.text();
    
    // Fix common XML typos that break parsing
    xmlText = xmlText.replace(/endcoding=/gi, 'encoding=');
    
    // Parse V4V data directly from XML
    const v4vData = parseV4VFromXML(xmlText);
    console.log('🔍 DEBUG: Direct XML V4V parsing result:', v4vData);

    // Extract podcast:guid and podcast:medium from channel level
    const podcastGuid = parsePodcastGuidFromXML(xmlText);
    const podcastMedium = parsePodcastMediumFromXML(xmlText);

    // Extract podcast:publisher remoteItem from channel level
    const publisherFeed = parsePublisherFeedFromXML(xmlText);

    // Extract channel-level <podcast:image> variants (Podcasting 2.0 multi-variant artwork)
    const channelPodcastImages = parseChannelPodcastImagesFromXML(xmlText);

    // Now parse with the RSS parser
    // Since rss-parser doesn't support parseString in Node.js, we'll use parseURL
    // The XML typo fix above helps, but parseURL will fetch again
    // So we need to ensure the typo is fixed server-side or use a workaround
    let feed;
    try {
      // Try to use parseString if available (some versions support it)
      if (typeof (parser as any).parseString === 'function') {
        feed = await (parser as any).parseString(xmlText);
      } else {
        // Use parseURL - it will fetch the original URL which still has the typo
        // But many XML parsers are lenient and will handle "endcoding" as "encoding"
        feed = await parser.parseURL(feedUrl);
      }
    } catch (parseError) {
      // If parsing fails, the error is likely due to the $ property access issue
      // which we've fixed in the code above, but the server needs to reload
      console.error('RSS parsing error (server may need restart):', parseError);
      throw parseError;
    }
    console.log('🔍 DEBUG: RSS parser completed, processing items...');
    
    // Extract feed-level metadata
    const feedImage = extractItunesImage(feed.itunes?.image) || 
                     feed.image?.url || 
                     undefined;
    
    const feedArtist = feed.itunes?.author || undefined;
    const feedCategories = extractItunesCategories(feed.itunes?.categories);
    const podcastCategories = extractPodcastCategories(xmlText);
    const feedExplicit = feed.itunes?.explicit?.toLowerCase() === 'yes' ||
                        feed.itunes?.explicit?.toLowerCase() === 'true';
    
    // Parse items
    const items: ParsedItem[] = [];
    
    if (feed.items) {
      console.log(`🔍 DEBUG: Processing ${feed.items.length} total items from RSS feed...`);
      let skippedCount = 0;
      let videoCount = 0;
      for (const item of feed.items) {
        // Skip items without enclosures
        if (!item.enclosure?.url) {
          skippedCount++;
          continue;
        }

        // Detect media type (audio or video) instead of skipping video
        const enclosureType = item.enclosure.type || undefined;
        const enclosureUrl = item.enclosure.url;
        const mediaType = detectMediaType(enclosureType, enclosureUrl);

        if (mediaType === 'video') {
          console.log(`🎬 Found video item: ${item.title || 'Untitled'}`);
          videoCount++;
        }

        // Extract episode and season numbers from itunes or from XML (for podcast: namespace)
        let episodeNumber: number | undefined = undefined;
        let seasonNumber: number | undefined = undefined;

        if (item.itunes?.episode) {
          episodeNumber = parseInt(item.itunes.episode);
        }
        if (item.itunes?.season) {
          seasonNumber = parseInt(item.itunes.season);
        }

        // If not found in itunes, try to get from XML (for podcast:episode and podcast:season)
        if ((episodeNumber === undefined || seasonNumber === undefined) && xmlText) {
          const episodeMap = parseEpisodeNumbersFromXML(xmlText);
          if (item.guid && episodeMap.has(item.guid)) {
            const episodeData = episodeMap.get(item.guid);
            if (episodeData) {
              if (episodeNumber === undefined) {
                episodeNumber = episodeData.episode;
              }
              if (seasonNumber === undefined) {
                seasonNumber = episodeData.season;
              }
            }
          }
        }

        // Parse alternate enclosures for this item if available
        const alternateEnclosures = item.guid ? parseAlternateEnclosures(xmlText, item.guid) : [];

        const parsedItem: ParsedItem = {
          guid: item.guid || undefined,
          title: item.title || 'Untitled',
          subtitle: item.itunes?.subtitle || undefined,
          description: item.contentSnippet || item.content || undefined,
          artist: item.itunes?.author || feedArtist,
          audioUrl: item.enclosure.url,
          duration: validateDuration(parseDuration(item.itunes?.duration), item.title),
          explicit: item.itunes?.explicit?.toLowerCase() === 'yes' ||
                   item.itunes?.explicit?.toLowerCase() === 'true' ||
                   feedExplicit,
          image: extractItunesImage(item.itunes?.image) || feedImage,
          publishedAt: item.isoDate ? new Date(item.isoDate) :
                      item.pubDate ? new Date(item.pubDate) : undefined,
          itunesAuthor: item.itunes?.author,
          itunesSummary: item.itunes?.summary,
          itunesImage: extractItunesImage(item.itunes?.image),
          itunesDuration: item.itunes?.duration,
          itunesKeywords: parseKeywords(item.itunes?.keywords),
          itunesCategories: feedCategories, // Inherit from feed
          episode: episodeNumber,
          season: seasonNumber,
          // Video support fields
          mediaType,
          mimeType: enclosureType,
          alternateEnclosures: alternateEnclosures.length > 0 ? alternateEnclosures : undefined,
        };
        
        // Parse V4V (Value for Value) information if present
        // First try to parse from the raw XML for this specific item
        const itemV4vData = parseItemV4VFromXML(xmlText, item.title || '');

        if (itemV4vData.valueTimeSplits.length > 0) {
          parsedItem.valueTimeSplits = itemV4vData.valueTimeSplits;
        }

        // Parse <podcast:person> tags (with optional npub attribute) at item level
        const itemPersons = parseItemPersonsFromXML(xmlText, item.title || '');
        if (itemPersons.length > 0) {
          parsedItem.persons = itemPersons;
        }

        // Parse <podcast:image> tags at item level
        const itemPodcastImages = parseItemPodcastImagesFromXML(xmlText, item.title || '');
        if (itemPodcastImages.length > 0) {
          parsedItem.podcastImages = itemPodcastImages;
        }

        if (itemV4vData.recipient) {
          parsedItem.v4vRecipient = itemV4vData.recipient;
          parsedItem.v4vValue = itemV4vData.value;
          console.log('✅ DEBUG: Set item v4vRecipient from XML:', parsedItem.v4vRecipient);
        } else if (item['podcast:value']) {
          console.log('🔍 DEBUG: Found podcast:value in item:', JSON.stringify(item['podcast:value'], null, 2));
          const valueData = item['podcast:value'];
          
          // Handle nested podcast:valueRecipient elements
          if (valueData['podcast:valueRecipient']) {
            console.log('🔍 DEBUG: Found nested podcast:valueRecipient:', JSON.stringify(valueData['podcast:valueRecipient'], null, 2));
            const recipients = Array.isArray(valueData['podcast:valueRecipient']) 
              ? valueData['podcast:valueRecipient'] 
              : [valueData['podcast:valueRecipient']];
            
            // Use the recipient with the highest split percentage (usually the artist/main recipient)
            const recipientsWithSplits = recipients.map(r => {
              const rData = r.$ || r;
              return {
                recipient: r,
                splitNum: parseInt(rData.split) || 0
              };
            });
            recipientsWithSplits.sort((a, b) => b.splitNum - a.splitNum);
            const primaryRecipient = recipientsWithSplits[0]?.recipient || recipients[0];
            
            if (primaryRecipient) {
              // Handle both $ attribute format and direct attribute format
              const recipientData = primaryRecipient.$ || primaryRecipient;
              if (recipientData.address) {
                parsedItem.v4vRecipient = recipientData.address;
                parsedItem.v4vValue = {
                  type: (valueData.$?.type || valueData.type || 'lightning'),
                  method: (valueData.$?.method || valueData.method || 'keysend'),
                  recipients: recipients
                    .filter(r => {
                      const rData = r.$ || r;
                      // Filter out fee recipients (Podcastindex.org fee injection)
                      return rData.fee !== 'true' && rData.fee !== true;
                    })
                    .map(r => {
                      const rData = r.$ || r;
                      // Handle nested <key> and <value> elements (some feeds use these instead of attributes)
                      let customKey = rData.customKey;
                      let customValue = rData.customValue;

                      // Check for nested <key> element
                      if (!customKey && r.key) {
                        customKey = typeof r.key === 'string'
                          ? r.key
                          : r.key._text || r.key['#text'] || r.key;
                      }

                      // Check for nested <value> element
                      if (!customValue && r.value) {
                        customValue = typeof r.value === 'string'
                          ? r.value
                          : r.value._text || r.value['#text'] || r.value;
                      }

                      return {
                        name: rData.name,
                        address: rData.address,
                        type: rData.type || 'node',
                        split: parseInt(rData.split, 10) || 100,
                        fee: rData.fee === 'true' || rData.fee === true,
                        customKey: customKey || undefined,
                        customValue: customValue || undefined
                      };
                    })
                };
                console.log('✅ DEBUG: Set v4vRecipient to:', parsedItem.v4vRecipient);
                console.log('✅ DEBUG: Filtered out fee recipients, remaining:', parsedItem.v4vValue.recipients.length);
              }
            }
          } else if (valueData.recipient) {
            // Handle simple recipient format
            parsedItem.v4vRecipient = valueData.recipient;
            parsedItem.v4vValue = valueData;
            console.log('✅ DEBUG: Set v4vRecipient to (simple):', parsedItem.v4vRecipient);
          } else {
            console.log('⚠️ DEBUG: No recipients found in podcast:value');
          }
        } else if ((item as any)['podcast:valueRecipient']) {
          console.log('🔍 DEBUG: Found standalone podcast:valueRecipient:', JSON.stringify((item as any)['podcast:valueRecipient'], null, 2));
          // Handle podcast:valueRecipient format (common in some feeds)
          const recipient = (item as any)['podcast:valueRecipient'];
          if (recipient.$) {
            // Extract Lightning address or node pubkey from the recipient object
            parsedItem.v4vRecipient = recipient.$.address || recipient.$.name;
            parsedItem.v4vValue = {
              recipient: recipient.$.address || recipient.$.name,
              type: recipient.$.type || 'node',
              split: recipient.$.split || '100'
            };
            console.log('✅ DEBUG: Set v4vRecipient to (standalone):', parsedItem.v4vRecipient);
          }
        } else {
          console.log('ℹ️ DEBUG: No V4V data found in item');
        }
        
        // Extract chapters URL for podcast chapter navigation
        if (item['podcast:chapters']) {
          const chaptersElement = item['podcast:chapters'];
          const chapUrl = chaptersElement?.$?.url || chaptersElement?.url;
          if (chapUrl && typeof chapUrl === 'string') {
            parsedItem.chaptersUrl = chapUrl;
          }
        }

        // Extract valueTimeSplits for chapter-level V4V (fallback if regex-based extraction didn't find any)
        const valueElement = item['podcast:value'];
        const vtsSource = valueElement?.['podcast:valueTimeSplit'] || item['podcast:valueTimeSplit'];
        if (!parsedItem.valueTimeSplits && vtsSource) {
          const splits = Array.isArray(vtsSource) ? vtsSource : [vtsSource];
          const valueTimeSplits = splits
            .map((split: any) => {
              const startTime = parseFloat(split?.$?.startTime || split?.startTime || '0');
              const duration = parseFloat(split?.$?.duration || split?.duration || '0');
              const remotePercentage = parseFloat(split?.$?.remotePercentage || split?.remotePercentage || '100');
              const remote = split['podcast:remoteItem'];
              const remoteItem = remote ? {
                feedGuid: remote?.$?.feedGuid || remote?.feedGuid || '',
                itemGuid: remote?.$?.itemGuid || remote?.itemGuid || '',
                ...(remote?.$?.medium || remote?.medium ? { medium: remote?.$?.medium || remote?.medium } : {}),
              } : undefined;
              if (duration > 0) {
                return { startTime, duration, remotePercentage, remoteItem };
              }
              return null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
          if (valueTimeSplits.length > 0) {
            parsedItem.valueTimeSplits = valueTimeSplits;
          }
        }

        items.push(parsedItem);
      }
      
      console.log(`✅ DEBUG: Parsed ${items.length} items from feed (skipped ${skippedCount} without enclosures, found ${videoCount} video items)`);
    }

    // Fetch chapters for items that have chaptersUrl (batch, max 10 concurrent)
    const itemsWithChapters = items.filter(item => item.chaptersUrl);
    if (itemsWithChapters.length > 0) {
      console.log(`📖 Fetching chapters for ${itemsWithChapters.length} episodes...`);
      const batchSize = 10;
      for (let i = 0; i < itemsWithChapters.length; i += batchSize) {
        const batch = itemsWithChapters.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            const chapters = await fetchChapters(item.chaptersUrl!);
            if (chapters) {
              item.chapters = chapters;
            }
          })
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        console.log(`  📖 Batch ${Math.floor(i / batchSize) + 1}: ${succeeded}/${batch.length} chapters fetched`);
      }
    }

    // Parse feed-level V4V data
    let feedV4vRecipient = null;
    let feedV4vValue = null;
    
    // Use direct XML parsing result if available
    if (v4vData.recipient) {
      feedV4vRecipient = v4vData.recipient;
      feedV4vValue = v4vData.value;
      console.log('✅ DEBUG: Using direct XML V4V data:', { recipient: feedV4vRecipient, value: feedV4vValue });
    } else {
      console.log('🔍 DEBUG: Checking feed-level V4V data from RSS parser...');
      console.log('🔍 DEBUG: feed object keys:', Object.keys(feed));
      
      if ((feed as any)['podcast:value']) {
        console.log('🔍 DEBUG: Found podcast:value in feed:', JSON.stringify((feed as any)['podcast:value'], null, 2));
        const valueData = (feed as any)['podcast:value'];
        
        // Handle nested podcast:valueRecipient elements
        if (valueData['podcast:valueRecipient']) {
          console.log('🔍 DEBUG: Found nested podcast:valueRecipient in feed:', JSON.stringify(valueData['podcast:valueRecipient'], null, 2));
          const recipients = Array.isArray(valueData['podcast:valueRecipient']) 
            ? valueData['podcast:valueRecipient'] 
            : [valueData['podcast:valueRecipient']];
          
          // Use the recipient with the highest split percentage (usually the artist/main recipient)
          const recipientsWithSplits = recipients.map(r => {
            const rData = r.$ || r;
            return {
              recipient: r,
              splitNum: parseInt(rData.split) || 0
            };
          });
          recipientsWithSplits.sort((a, b) => b.splitNum - a.splitNum);
          const primaryRecipient = recipientsWithSplits[0]?.recipient || recipients[0];
          
          if (primaryRecipient) {
            // Handle both $ attribute format and direct attribute format
            const recipientData = primaryRecipient.$ || primaryRecipient;
            if (recipientData.address) {
              feedV4vRecipient = recipientData.address;
              feedV4vValue = {
                type: (valueData.$?.type || valueData.type || 'lightning'),
                method: (valueData.$?.method || valueData.method || 'keysend'),
                recipients: recipients
                  .filter(r => {
                    const rData = r.$ || r;
                    // Filter out fee recipients (Podcastindex.org fee injection)
                    return rData.fee !== 'true' && rData.fee !== true;
                  })
                  .map(r => {
                    const rData = r.$ || r;
                    return {
                      name: rData.name,
                      address: rData.address,
                      type: rData.type || 'node',
                      split: parseInt(rData.split, 10) || 100,
                      fee: rData.fee === 'true' || rData.fee === true
                    };
                  })
              };
              console.log('✅ DEBUG: Set feed v4vRecipient to:', feedV4vRecipient);
              console.log('✅ DEBUG: Filtered out fee recipients, remaining:', feedV4vValue.recipients.length);
            }
          }
        }
      } else {
        console.log('ℹ️ DEBUG: No feed-level podcast:value found');
      }
    }
    
    return {
      title: feed.title || feedArtist || 'Untitled Feed',
      description: feed.description || feed.itunes?.summary,
      image: feedImage,
      artist: feedArtist,
      language: feed.language,
      category: feedCategories[0], // Take first category as primary
      podcastCategories: podcastCategories.length > 0 ? podcastCategories : undefined,
      explicit: feedExplicit,
      podcastGuid: podcastGuid || undefined,
      medium: podcastMedium || undefined,
      items,
      podcastImages: channelPodcastImages.length > 0 ? channelPodcastImages : undefined,
      v4vRecipient: feedV4vRecipient,
      v4vValue: feedV4vValue,
      publisherFeed: publisherFeed || undefined
    };
  } catch (error) {
    console.error('Error parsing RSS feed:', error);
    throw new Error(`Failed to parse RSS feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to parse music segments from podcast RSS feeds
export async function parseMusicSegments(feedUrl: string): Promise<ParsedItem[]> {
  try {
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    
    const response = await fetch(feedUrl);
    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);
    
    const items: ParsedItem[] = [];
    const channel = parsed.rss?.channel || parsed.feed;
    
    if (!channel) {
      throw new Error('Invalid RSS/Atom feed structure');
    }
    
    const feedItems = channel.item || channel.entry || [];
    
    for (const item of Array.isArray(feedItems) ? feedItems : [feedItems]) {
      // Look for remote items (music segments in podcasts)
      if (item['podcast:remoteItem']) {
        const remoteItems = Array.isArray(item['podcast:remoteItem']) 
          ? item['podcast:remoteItem'] 
          : [item['podcast:remoteItem']];
        
        for (const remoteItem of remoteItems) {
          const segment: ParsedItem = {
            guid: remoteItem['@_guid'] || remoteItem.guid,
            title: remoteItem.title || 'Music Segment',
            artist: remoteItem.artist || remoteItem['@_artist'],
            audioUrl: remoteItem['@_enclosureUrl'] || remoteItem.enclosureUrl || item.enclosure?.['@_url'],
            startTime: parseFloat(remoteItem['@_startTime'] || remoteItem.startTime || '0'),
            endTime: remoteItem['@_endTime'] ? parseFloat(remoteItem['@_endTime']) : undefined,
            duration: validateDuration(
              remoteItem['@_duration'] ? parseFloat(remoteItem['@_duration']) : undefined,
              remoteItem.title || 'Music Segment'
            ),
            image: remoteItem['@_image'] || remoteItem.image,
            explicit: false,
            publishedAt: item.pubDate ? new Date(item.pubDate) : undefined
          };
          
          // Parse V4V info if present
          if (remoteItem['podcast:value'] || remoteItem['@_value']) {
            segment.v4vValue = remoteItem['podcast:value'] || remoteItem['@_value'];
          }
          
          items.push(segment);
        }
      }
      
      // Also check for valueTimeSplit which might contain music segments
      if (item['podcast:valueTimeSplit']) {
        const splits = Array.isArray(item['podcast:valueTimeSplit']) 
          ? item['podcast:valueTimeSplit'] 
          : [item['podcast:valueTimeSplit']];
        
        for (const split of splits) {
          if (split['podcast:remoteItem']) {
            const remoteItem = split['podcast:remoteItem'];
            const segment: ParsedItem = {
              guid: remoteItem['@_guid'] || remoteItem.guid,
              title: remoteItem.title || split['@_title'] || 'Music Segment',
              artist: remoteItem.artist || remoteItem['@_artist'],
              audioUrl: item.enclosure?.['@_url'] || item.enclosure?.url,
              startTime: parseFloat(split['@_startTime'] || '0'),
              endTime: split['@_endTime'] ? parseFloat(split['@_endTime']) : undefined,
              duration: validateDuration(
                split['@_duration'] ? parseFloat(split['@_duration']) : undefined,
                remoteItem.title || split['@_title'] || 'Music Segment'
              ),
              image: remoteItem['@_image'] || remoteItem.image,
              explicit: false,
              publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
              v4vValue: split['podcast:value'] || split['@_value']
            };
            
            items.push(segment);
          }
        }
      }
    }
    
    return items;
  } catch (error) {
    console.error('Error parsing music segments:', error);
    return [];
  }
}

// Combined parser that handles both regular RSS and music segments
export async function parseRSSFeedWithSegments(feedUrl: string): Promise<ParsedFeed> {
  // First try regular RSS parsing
  const feed = await parseRSSFeed(feedUrl);
  
  // Then try to extract any music segments
  const segments = await parseMusicSegments(feedUrl);
  
  // Merge segments into feed items if any were found
  if (segments.length > 0) {
    // Add segments as additional items, avoiding duplicates based on guid
    const existingGuids = new Set(feed.items.map(item => item.guid).filter(Boolean));
    const newSegments = segments.filter(seg => !seg.guid || !existingGuids.has(seg.guid));
    feed.items.push(...newSegments);
  }
  
  return feed;
}