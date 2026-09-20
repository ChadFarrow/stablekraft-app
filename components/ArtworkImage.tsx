'use client';

import Image, { type ImageProps } from 'next/image';
import { isAnimatedArtworkUrl } from '@/lib/cdn-utils';
import { useDataSaver } from '@/hooks/useDataSaver';
import { artworkPlan } from '@/lib/data-saver';

/**
 * Drop-in replacement for next/image at every site that renders artwork coming
 * from a podcast feed (album covers, track/episode art, avatars).
 *
 * Feed artwork is arbitrary: some feeds ship animated GIFs, and the Next
 * optimizer both refuses to optimize those and logs an error-severity warning
 * for each one. See `isAnimatedArtworkUrl` for the full story. This wrapper
 * marks exactly those images `unoptimized` and leaves every other image on the
 * normal optimized path.
 *
 * An explicit `unoptimized` prop still wins, so call sites can opt out.
 *
 * 'use client' is new, and it is free here: every consumer of this component is
 * already a client component, and all of its props are serializable anyway.
 * It buys the Data Saver reading below.
 */
export default function ArtworkImage({ src, unoptimized, quality, ...props }: ImageProps) {
  const animated = typeof src === 'string' && isAnimatedArtworkUrl(src);
  const dataSaver = useDataSaver();

  /*
   * With Data Saver off this is the identity: `unoptimized ?? animated` and the
   * caller's own quality, which is what this component did before. 75 is the
   * next/image default, so naming it explicitly changes nothing.
   */
  const plan = artworkPlan({
    src: typeof src === 'string' ? src : '',
    dataSaver,
    baseline: {
      quality: typeof quality === 'number' ? quality : 75,
      unoptimized: unoptimized ?? animated,
    },
  });

  /*
   * `alt` is required by ImageProps and arrives through {...props}. jsx-a11y
   * cannot see through a spread, so it reports a missing alt on every render of
   * this wrapper. Every call site passes one, and TypeScript enforces it — the
   * rule is wrong here, not the code.
   */
  // eslint-disable-next-line jsx-a11y/alt-text
  return <Image src={src} unoptimized={plan.unoptimized} quality={plan.quality} {...props} />;
}
