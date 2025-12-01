// CORS-problematic domains that need proxy
// Keep in sync with corsProblematicDomains in contexts/AudioContext.tsx
const corsProblematicDomains = [
  'cloudfront.net',
  'amazonaws.com',
  'wavlake.com',
  'buzzsprout.com',
  'anchor.fm',
  'libsyn.com',
  'whitetriangles.com',
  'falsefinish.club',
  'behindthesch3m3s.com',
  'doerfelverse.com',
  'sirtjthewrathful.com',
  'digitaloceanspaces.com',
  'rocknrollbreakheart.com'
];

/**
 * Returns a proxied URL for CORS-problematic domains, or the original URL otherwise.
 * Use this when creating Audio objects outside of AudioContext.
 */
export function getProxiedAudioUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;

  try {
    const url = new URL(originalUrl);
    const hostname = url.hostname.toLowerCase();

    // Check if domain needs proxy
    const needsProxy = corsProblematicDomains.some(domain =>
      hostname.includes(domain.toLowerCase())
    );

    if (needsProxy) {
      // Use our own proxy for full control
      return `/api/proxy-audio?url=${encodeURIComponent(originalUrl)}`;
    }

    return originalUrl;
  } catch {
    return originalUrl;
  }
}
