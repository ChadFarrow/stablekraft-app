/**
 * Writing and reading musicL playlist feeds — the pieces the playlist maker
 * (`app/api/generate-playlist-rss`) and the playlist readers share (#309).
 *
 * - The Podcasting 2.0 namespace is https://podcastindex.org/namespace/1.0.
 *   The GitHub doc URL that several writers used is a different namespace to
 *   any namespace-aware parser, so they saw no podcast:* tags at all.
 * - A playlist's <podcast:guid> is its own identity. It is never the source
 *   show's guid, and it is never minted again on each build.
 * - The guid helpers that need node's crypto are in musicl-guid.ts, so this
 *   file stays safe to import from client code.
 * - A remoteItem's attributes are read by NAME, in any order and with either
 *   quote, and a remoteItem with no itemGuid (a <podcast:publisher> back-link)
 *   is not a track.
 */
export const PODCAST_NS = 'https://podcastindex.org/namespace/1.0';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Any RFC 9562 UUID, v7 included (the old check refused anything above v5). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/** Drop characters XML 1.0 forbids even when escaped. */
export function stripXmlForbidden(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += value[i];
  }
  return out;
}

export function escapeXml(value: unknown): string {
  return stripXmlForbidden(value == null ? '' : String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Text that may hold HTML, as one CDATA section. A `]]>` inside it is split
 * across two sections, so the HTML can never close the section early.
 */
export function cdata(value: string): string {
  return `<![CDATA[${stripXmlForbidden(value).split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

export interface RemoteItemRef {
  feedGuid: string;
  itemGuid?: string;
  feedUrl?: string;
  medium?: string;
  title?: string;
}

/** Read one attribute by name from a tag's source text, either quote. */
export function readXmlAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = tag.match(re);
  if (!m) return undefined;
  const raw = m[1] ?? m[2] ?? '';
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Every <podcast:remoteItem> in a document, attributes read by name. Tracks
 * are the ones with an itemGuid (`remoteItemTracks`); a remoteItem with no
 * itemGuid points at a whole feed (a publisher back-link, a podroll entry).
 */
export function parseRemoteItems(xml: string): RemoteItemRef[] {
  const out: RemoteItemRef[] = [];
  const re = /<podcast:remoteItem\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tag = m[0];
    const feedGuid = readXmlAttr(tag, 'feedGuid');
    if (!feedGuid) continue;
    const ref: RemoteItemRef = { feedGuid };
    const itemGuid = readXmlAttr(tag, 'itemGuid');
    if (itemGuid) ref.itemGuid = itemGuid;
    const feedUrl = readXmlAttr(tag, 'feedUrl');
    if (feedUrl) ref.feedUrl = feedUrl;
    const medium = readXmlAttr(tag, 'medium');
    if (medium) ref.medium = medium;
    const title = readXmlAttr(tag, 'title');
    if (title) ref.title = title;
    out.push(ref);
  }
  return out;
}

/** The remoteItems that are tracks: those with an itemGuid. */
export function remoteItemTracks(xml: string): (RemoteItemRef & { itemGuid: string })[] {
  return parseRemoteItems(xml).filter((r): r is RemoteItemRef & { itemGuid: string } => !!r.itemGuid);
}

/**
 * Podcasting 2.0 list mediums (a feed of remoteItems, not of media). An
 * allowlist, never `endsWith('L')`.
 */
export const LIST_MEDIUMS = new Set(['musicL', 'podcastL', 'videoL', 'filmL', 'audiobookL', 'newsletterL', 'blogL', 'mixed']);

export function isListMedium(medium: string | null | undefined): boolean {
  return !!medium && LIST_MEDIUMS.has(medium.trim());
}

export interface MinimalPlaylistOptions {
  guid: string;
  title: string;
  author: string;
  description: string;
  /** Text that may hold HTML; written as CDATA. Wins over `description`. */
  descriptionHtml?: string | null;
  link: string;
  imageUrl?: string | null;
  medium?: string;
  publisher?: { feedGuid?: string | null; feedUrl?: string | null } | null;
  tracks: { feedGuid: string; itemGuid: string }[];
}

/** The musicL feed the playlist maker publishes. */
export function buildMinimalPlaylistXml(o: MinimalPlaylistOptions): string {
  if (!isUuid(o.guid)) throw new Error('The playlist needs a podcast:guid (a UUID).');
  const now = new Date().toUTCString();
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<rss version="2.0" xmlns:podcast="${PODCAST_NS}" xmlns:content="http://purl.org/rss/1.0/modules/content/">`);
  lines.push('<channel>');
  lines.push(`<author>${escapeXml(o.author)}</author>`);
  lines.push(`<title>${escapeXml(o.title)}</title>`);
  lines.push(
    o.descriptionHtml && o.descriptionHtml.trim()
      ? `<description>${cdata(o.descriptionHtml.trim())}</description>`
      : `<description>${escapeXml(o.description)}</description>`
  );
  lines.push(`<link>${escapeXml(o.link)}</link>`);
  lines.push('<language>en</language>');
  lines.push(`<pubDate>${now}</pubDate>`);
  lines.push(`<lastBuildDate>${now}</lastBuildDate>`);
  const imageUrl = (o.imageUrl || '').trim();
  if (imageUrl) {
    lines.push('<image>');
    lines.push(`<url>${escapeXml(imageUrl)}</url>`);
    lines.push(`<title>${escapeXml(o.title)}</title>`);
    lines.push(`<link>${escapeXml(o.link)}</link>`);
    lines.push('</image>');
  }
  lines.push(`<podcast:medium>${escapeXml(o.medium || 'musicL')}</podcast:medium>`);
  lines.push(`<podcast:guid>${escapeXml(o.guid)}</podcast:guid>`);
  const pubGuid = (o.publisher?.feedGuid || '').trim();
  if (pubGuid) {
    if (!isUuid(pubGuid)) throw new Error('The publisher feedGuid must be a UUID.');
    const pubUrl = (o.publisher?.feedUrl || '').trim();
    lines.push('<podcast:publisher>');
    lines.push(
      `  <podcast:remoteItem medium="publisher" feedGuid="${escapeXml(pubGuid)}"` +
        (pubUrl ? ` feedUrl="${escapeXml(pubUrl)}"` : '') +
        '/>'
    );
    lines.push('</podcast:publisher>');
  }
  for (const t of o.tracks) {
    if (!t.feedGuid || !t.itemGuid) continue;
    lines.push(`  <podcast:remoteItem feedGuid="${escapeXml(t.feedGuid)}" itemGuid="${escapeXml(t.itemGuid)}"/>`);
  }
  lines.push('</channel>');
  lines.push('</rss>');
  return lines.join('\n');
}
