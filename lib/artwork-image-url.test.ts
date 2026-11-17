// Run: npx tsx --test lib/artwork-image-url.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ArtworkImage from '../components/ArtworkImage';
import { artworkImageUrl } from './artwork-image-url';

// tsx compiles the component's JSX to `React.createElement` (classic runtime,
// because tsconfig says `jsx: preserve` for Next), so the global must exist.
(globalThis as { React?: typeof React }).React = React;

/**
 * The album page backdrop and the hero cover beside it must be ONE URL.
 *
 * They used to be two: the hero went through `/_next/image` (7-day cache) and
 * the desktop backdrop through a cache-busted `/api/proxy-image?…&cb=<now>`.
 * When an artist replaced a cover file in place (Hip-Hop Taoist, 2026-09-26)
 * the page showed the old art in the hero and the new art behind it.
 */

// The shape `getAlbumArtworkUrl(coverArt, 'medium', true)` produces for a real cover.
const PROXIED_COVER =
  '/api/proxy-image?url=' +
  encodeURIComponent('https://media.basspistol.com/mans1.ch/hiphoptaoist/Hip-Hop%20Taoist%20Tape.jpg');
const ANIMATED_COVER = 'https://example.com/art/cover.gif';

/** The `src` attribute <ArtworkImage> actually renders. */
function renderedSrc(src: string, width: number, height: number): string {
  const html = renderToStaticMarkup(React.createElement(ArtworkImage, { src, width, height, alt: '' }));
  const match = html.match(/ src="([^"]*)"/);
  assert.ok(match, `no src in ${html}`);
  return match[1].replace(/&amp;/g, '&');
}

test('the backdrop URL is exactly the URL the hero <ArtworkImage> requests', () => {
  const url = artworkImageUrl({ src: PROXIED_COVER, width: 280, height: 280 });
  assert.equal(url, renderedSrc(PROXIED_COVER, 280, 280));
  assert.match(url, /^\/_next\/image\?url=/);
});

test('an animated cover stays unoptimized, the same as the hero', () => {
  const url = artworkImageUrl({ src: ANIMATED_COVER, width: 280, height: 280 });
  assert.equal(url, renderedSrc(ANIMATED_COVER, 280, 280));
  assert.equal(url, ANIMATED_COVER);
});

test('the backdrop URL is neither cache-busted nor a separate enhanced copy', () => {
  const url = artworkImageUrl({ src: PROXIED_COVER, width: 280, height: 280 });
  assert.doesNotMatch(url, /[?&]cb=/);
  assert.doesNotMatch(url, /enhance/);
});

test('the album page builds its cover backdrop from the shared helper, with no image cache-buster', () => {
  const source = readFileSync(new URL('../app/album/[id]/AlbumDetailClient.tsx', import.meta.url), 'utf8');
  assert.match(source, /setBackgroundImage\(artworkImageUrl\(\{\s*src: heroArtworkSrc\(/);
  // The album JSON fetch keeps its own `?cb=`; no other line may carry one.
  const busted = source.split('\n').filter((line) => /[?&]cb=/.test(line));
  for (const line of busted) {
    assert.match(line, /fetch\(`\/api\/albums\//, `cache-buster outside the album fetch: ${line.trim()}`);
  }
});
