'use client';

import Image, { type ImageProps } from 'next/image';
import { useDataSaver } from '@/hooks/useDataSaver';
import { artworkImagePlan } from '@/lib/artwork-image-url';

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
  const dataSaver = useDataSaver();

  /*
   * With Data Saver off this is the identity. Shared with `artworkImageUrl`,
   * which a CSS backdrop uses to request exactly the URL this component does.
   */
  const plan = artworkImagePlan({
    src: typeof src === 'string' ? src : '',
    quality: typeof quality === 'number' ? quality : undefined,
    unoptimized,
    dataSaver,
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
