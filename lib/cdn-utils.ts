/**
 * Image Utilities
 * Simple image serving utilities without CDN dependencies
 */

/**
 * Decode HTML entities in URLs
 * Handles common HTML entities that may appear in image URLs from external sources
 * @param url - The URL that may contain HTML entities
 * @returns The URL with HTML entities decoded
 */
export function decodeHtmlEntitiesInUrl(url: string): string {
  if (!url) return url;
  return url
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * Get album artwork URL with fallback to placeholder
 * @param originalUrl - The original artwork URL
 * @param size - The desired size for placeholder
 * @param useProxy - Whether to use image proxy for optimization (default: false for backward compatibility)
 * @returns The original artwork URL or placeholder
 */
export function getAlbumArtworkUrl(originalUrl: string, size: 'thumbnail' | 'medium' | 'large' | 'xl' = 'medium', useProxy: boolean = false): string {
  // Always return placeholder for missing, empty, or invalid URLs
  if (!originalUrl || originalUrl.trim() === '' || originalUrl === 'undefined' || originalUrl === 'null') {
    return getPlaceholderImageUrl(size);
  }

  // Decode HTML entities in URLs (fixes issues with &#39;, &amp;, etc.)
  originalUrl = decodeHtmlEntitiesInUrl(originalUrl);

  // Handle known missing placeholder images
  if (originalUrl.includes('playlist-track-placeholder.png')) {
    return getPlaceholderImageUrl(size);
  }

  // Handle obvious broken or placeholder URLs
  if (originalUrl.includes('placeholder') || originalUrl.includes('not-found') || originalUrl.includes('404')) {
    return getPlaceholderImageUrl(size);
  }

  // Ensure HTTPS for all URLs
  if (originalUrl.startsWith('http://')) {
    originalUrl = originalUrl.replace('http://', 'https://');
  }

  // List of domains that are configured in next.config.js remotePatterns
  // Images from these domains can be served directly by next/image
  const allowedImageDomains = [
    'www.doerfelverse.com',
    'feed.bowlafterbowl.com',
    'www.thisisjdog.com',
    'www.sirtjthewrathful.com',
    'wavlake.com',
    'www.wavlake.com',
    'd12wklypp119aj.cloudfront.net',
    'ableandthewolf.com',
    'music.behindthesch3m3s.com',
    'whiterabbitrecords.org',
    'feed.falsefinish.club',
    'f4.bcbits.com',
    'stablekraft.app',
    'localhost',
    'static.wixstatic.com',
    'noagendaassets.com',
    'media.rssblue.com',
    'files.heycitizen.xyz',
    'files.bitpunk.fm',
    'www.bitpunk.fm',
    'annipowellmusic.com',
    'rocknrollbreakheart.com',
    'via.placeholder.com',
    'i.nostr.build',
    'raw.githubusercontent.com',
    'megaphone.imgix.net',
    'cdn-images.owltail.com',
    'www.haciendoelsueco.com',
    'destinys-music.nyc3.cdn.digitaloceanspaces.com',
    'dtnmusic1w.sfo3.cdn.digitaloceanspaces.com',
    'dtnmusic1w.sfo3.digitaloceanspaces.com',
    'jimmiebratcher.s3.us-west-1.amazonaws.com',
    'thesynthesatsers.nyc3.cdn.digitaloceanspaces.com',
    'thebearsnare.com',
    'socialmedia101pro.com',
    'bobcatindex.us-southeast-1.linodeobjects.com',
    'homegrownhits.xyz',
    'lightningthrashes.com',
    'picsum.photos',
    'podcastindex.org',
    'f.strangetextures.com',
    'deow9bq0xqvbj.cloudfront.net',
    'binauralsubliminal.com',
    'shop.basspistol.com',
    'feeds.fountain.fm',
    'assets.podhome.fm',
  ];

  // Domains that must always be proxied (even if in allowed list)
  // These domains cause Next.js Image optimization to fail with HTTP 400
  const mustProxyDomains = [
    'feeds.podcastindex.org',
  ];

  // Check if URL is from an allowed domain
  // Use exact hostname matching for more reliable domain checking
  let isAllowedDomain = false;
  let urlHostname = '';
  let mustProxy = false;
  
  try {
    urlHostname = new URL(originalUrl).hostname.toLowerCase();
    
    // Check if this domain must be proxied
    mustProxy = mustProxyDomains.some(domain => 
      urlHostname === domain.toLowerCase() || urlHostname.endsWith('.' + domain.toLowerCase())
    );
    
    // Check for exact match or subdomain match in allowed list
    isAllowedDomain = allowedImageDomains.some(domain => {
      const domainLower = domain.toLowerCase();
      return urlHostname === domainLower || urlHostname.endsWith('.' + domainLower);
    });
  } catch {
    // Invalid URL, will be handled below
  }

  // Don't proxy placeholder-image API URLs, data URLs, relative URLs, or already-proxied URLs
  const shouldSkipProxy = originalUrl.includes('/api/placeholder-image') || 
                          originalUrl.includes('re.podtards.com') || 
                          originalUrl.includes('/api/proxy-image') || 
                          originalUrl.startsWith('data:') || 
                          originalUrl.startsWith('/');

  // Always proxy domains that must be proxied (fixes Next.js Image 400 errors)
  if (!shouldSkipProxy && mustProxy) {
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  // Always proxy external domains not in allowed list (regardless of useProxy parameter)
  // This fixes issues where Next.js Image optimization fails for external domains
  if (!shouldSkipProxy && !isAllowedDomain) {
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  // If proxy is explicitly requested and domain is allowed, still use proxy
  if (!shouldSkipProxy && useProxy && isAllowedDomain) {
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  // Use original URLs directly for allowed domains (when useProxy is false and not mustProxy)
  return originalUrl;
}

/**
 * Get a placeholder image URL for missing artwork
 * @param size - The desired size
 * @returns A placeholder image URL
 */
export function getPlaceholderImageUrl(size: 'thumbnail' | 'medium' | 'large' | 'xl' = 'medium'): string {
  // Map size parameters to corresponding static image files
  const sizeMap: Record<'thumbnail' | 'medium' | 'large' | 'xl', string> = {
    thumbnail: '/album-placeholder-thumbnail.png',
    medium: '/album-placeholder-medium.png',
    large: '/album-placeholder-large.png',
    xl: '/album-placeholder-xl.png',
  };
  
  return sizeMap[size];
}

/**
 * Get track artwork URL - returns original URL
 * @param originalUrl - The original artwork URL
 * @returns The original artwork URL or empty string
 */
export function getTrackArtworkUrl(originalUrl: string): string {
  return originalUrl || '';
} 