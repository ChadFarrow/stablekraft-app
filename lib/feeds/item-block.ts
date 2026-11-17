/**
 * Find one <item>'s raw XML block by its title — the lookup every per-item
 * `parseItem*FromXML` in lib/rss-parser-db.ts uses: value splits (V4V),
 * persons, images and funding.
 *
 * The title the callers hold is the PARSED one, which the XML parser has
 * already decoded: a feed's `It&apos;s All Over` arrives as `It's All Over`.
 * The old lookup (four copies of it) re-encoded only `&`, `<` and `>` and
 * compared that against the raw text, so a title the feed wrote with
 * `&apos;`, `&quot;` or a numeric entity (`&#39;`, `&#8217;`) found no block —
 * and that track silently lost its own value split, persons, images and
 * funding link, falling back to the album's. Found 2026-11-01 on three
 * pc2.basspistol.com tracks whose item-level `<podcast:funding>` never
 * reached the boost dialog: "It's All Over", "Grand'ma Is A Cyborg Now",
 * "K'as-tu fait de nous?". This decodes the RAW title and compares text to text.
 *
 * Kept from the old lookup on purpose: the match ignores case, and the FIRST
 * block wins when two items share a title. Every title the old lookup matched
 * still matches (the candidates below include the undecoded text).
 *
 * Import-free so the tests load it without the parser's dependencies.
 */

const XML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Decode XML character references in ONE pass, so `&amp;lt;` stays `&lt;`.
 * (`decodeHtmlEntities` in lib/decode-entities.ts decodes `&amp;` first and
 * would turn it into `<`.) An unknown or out-of-range reference is left as is.
 */
export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return XML_ENTITY[name.toLowerCase()] ?? whole;
  });
}

/** Every `<item>…</item>` block in document order (the same pattern the four parsers used). */
export function itemBlocks(xmlText: string): string[] {
  const out: string[] = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xmlText)) !== null) out.push(m[0]);
  return out;
}

/** The texts a raw `<title>` body can stand for: as written, and decoded; CDATA unwrapped. */
function titleCandidates(rawBody: string): string[] {
  const body = rawBody.trim();
  const cdata = body.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  const inner = (cdata ? cdata[1] : body).trim();
  return [inner, decodeXmlText(inner).trim()];
}

/** Does this item block carry a `<title>` that reads as `itemTitle`? Ignores case. */
export function itemBlockHasTitle(block: string, itemTitle: string): boolean {
  const want = itemTitle.trim().toLowerCase();
  const re = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    if (titleCandidates(m[1]).some((t) => t.toLowerCase() === want)) return true;
  }
  return false;
}

/** The first `<item>` block whose title reads as `itemTitle`, or undefined. */
export function findItemBlockByTitle(xmlText: string, itemTitle: string): string | undefined {
  return itemBlocks(xmlText).find((block) => itemBlockHasTitle(block, itemTitle));
}
