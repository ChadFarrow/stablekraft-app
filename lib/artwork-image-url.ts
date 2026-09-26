import { getImageProps } from 'next/image';
import { isAnimatedArtworkUrl } from './cdn-utils';
import { artworkPlan, type ArtworkPlan } from './data-saver';

/**
 * How `components/ArtworkImage.tsx` hands a piece of feed artwork to next/image.
 *
 * With Data Saver off this is the identity: `unoptimized ?? animated` and the
 * caller's own quality, which is what that component did before. 75 is the
 * next/image default, so naming it explicitly changes nothing.
 *
 * It lives here rather than inside the component so that `artworkImageUrl`
 * below can ask the same question and get the same answer.
 */
export function artworkImagePlan({
  src,
  quality,
  unoptimized,
  dataSaver,
}: {
  src: string;
  quality?: number;
  unoptimized?: boolean;
  dataSaver: boolean;
}): ArtworkPlan {
  const animated = isAnimatedArtworkUrl(src);
  return artworkPlan({
    src,
    dataSaver,
    baseline: {
      quality: typeof quality === 'number' ? quality : 75,
      unoptimized: unoptimized ?? animated,
    },
  });
}

/**
 * The URL an `<ArtworkImage>` with these props requests, with Data Saver off.
 *
 * WHY: a CSS background cannot be a next/image, so the album page backdrop used
 * to request the cover through a URL of its own — a cache-busted
 * `/api/proxy-image?…&enhance=true&cb=<now>` — while the hero beside it went
 * through `/_next/image` and its multi-day cache. Two URLs for one file means two
 * caches, and when an artist replaced a cover in place (Hip-Hop Taoist,
 * 2026-09-26) the page showed the old art in the hero and the new art behind
 * it. Asking next/image for the URL it would render gives the backdrop the same
 * response and the same cache entry as the `<img>`, so the two cannot disagree.
 *
 * Data Saver is not an input: callers that paint a backdrop drop it entirely in
 * Data Saver (see `lib/page-background-style.ts`).
 */
export function artworkImageUrl({
  src,
  width,
  height,
  quality,
  unoptimized,
}: {
  src: string;
  width: number;
  height: number;
  quality?: number;
  unoptimized?: boolean;
}): string {
  const plan = artworkImagePlan({ src, quality, unoptimized, dataSaver: false });
  const { props } = getImageProps({
    src,
    width,
    height,
    alt: '',
    unoptimized: plan.unoptimized,
    quality: plan.quality,
  });
  return props.src;
}
