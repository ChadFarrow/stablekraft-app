/**
 * `<podcast:funding url="…">label</podcast:funding>` — a non-Lightning way to
 * support a show or an artist (PayPal, Patreon, a merch store).
 *
 * The tag may sit in `<channel>`, `<item>` or `<podcast:liveItem>`, any number
 * of times. `url` is required; the text is a label an app shows beside the link,
 * and an aggregator may cut it at 128 characters.
 * https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/funding.md
 *
 * **The URL becomes an `href`, so it is checked HERE, at the parse boundary.**
 * React does not block a `javascript:` href (it only warns in dev), and this
 * origin holds the user's wallet connection and Nostr session. Only `http:` and
 * `https:` survive. The same check runs again on READ (`fundingFromJson`),
 * because the database is a second place a value can come from: a row written
 * before this guard existed, or by hand, must not reach an `href` unchecked.
 *
 * Import-free on purpose, so `podcast-funding.test.ts` loads the shipping module
 * under plain `tsx`.
 */

export interface FundingLink {
  url: string;
  /** The tag's text. Empty when the feed gave none — the UI supplies its own word. */
  message: string;
}

/** The namespace asks aggregators to keep labels to 128 characters. */
export const FUNDING_MESSAGE_MAX = 128;
/** A feed that lists more than this is not asking for a row of buttons. */
export const FUNDING_LINKS_MAX = 8;

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[name.toLowerCase()] ?? whole;
  });
}

/** An absolute http(s) URL, normalised, or null. Never anything else. */
export function safeFundingUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanMessage(raw: string): string {
  const text = decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > FUNDING_MESSAGE_MAX ? text.slice(0, FUNDING_MESSAGE_MAX - 1).trimEnd() + '…' : text;
}

function urlAttribute(attrs: string): string | null {
  const m = /(?:^|\s)url\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!m) return null;
  return decodeEntities(m[1] ?? m[2] ?? '');
}

/**
 * Every `<podcast:funding>` in `xmlBlock`, in document order, deduplicated by
 * URL. The CALLER decides the scope: hand it a channel block with the items
 * already removed (`channelFundingXml`), or one item's XML — never a whole feed,
 * or an item's link reads as the album's.
 */
export function parseFundingFromBlock(xmlBlock: string): FundingLink[] {
  const out: FundingLink[] = [];
  const seen = new Set<string>();
  // Both the paired and the self-closing form; the `\b` keeps a hypothetical
  // `<podcast:fundingGoal>` from matching.
  const tag = /<podcast:funding\b([^>]*?)(?:\/>|>([\s\S]*?)<\/podcast:funding\s*>)/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xmlBlock)) !== null && out.length < FUNDING_LINKS_MAX) {
    const url = safeFundingUrl(urlAttribute(m[1] || ''));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, message: cleanMessage(m[2] || '') });
  }
  return out;
}

/**
 * The channel's own tags: the feed with every `<item>` and `<podcast:liveItem>`
 * cut out. Element order inside `<channel>` is free, and MSP-made music feeds put
 * channel tags AFTER the items, so slicing at the first `<item>` is wrong
 * (CLAUDE.md, `channelMetadataXml`). An unclosed block is left in place rather
 * than eating the rest of the feed.
 */
export function channelFundingXml(xmlText: string): string {
  const channel = /<channel\b[^>]*>([\s\S]*)<\/channel>/i.exec(xmlText);
  const body = channel ? channel[1] : xmlText;
  return body
    .replace(/<item\b[^>]*>[\s\S]*?<\/item\s*>/gi, '')
    .replace(/<podcast:liveItem\b[^>]*>[\s\S]*?<\/podcast:liveItem\s*>/gi, '');
}

export function parseChannelFundingFromXML(xmlText: string): FundingLink[] {
  try {
    return parseFundingFromBlock(channelFundingXml(xmlText));
  } catch {
    return [];
  }
}

/**
 * Funding read back from a Json column (or any untrusted value), re-checked.
 * Returns undefined — not [] — for "nothing", so an API response omits the key.
 */
export function fundingFromJson(value: unknown): FundingLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: FundingLink[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const url = safeFundingUrl((entry as { url?: unknown }).url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const raw = (entry as { message?: unknown }).message;
    out.push({ url, message: typeof raw === 'string' ? cleanMessage(raw) : '' });
    if (out.length >= FUNDING_LINKS_MAX) break;
  }
  return out.length > 0 ? out : undefined;
}
