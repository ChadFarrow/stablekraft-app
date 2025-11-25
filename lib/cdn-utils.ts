/**
 * Image Utilities
 * Simple image serving utilities without CDN dependencies
 */

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
    'deow9bq0xqvbj.cloudfront.net',
    'binauralsubliminal.com',
    'shop.basspistol.com',
    'feeds.fountain.fm',
    'assets.podhome.fm',
  ];

  // Check if URL is from an allowed domain
  const isAllowedDomain = allowedImageDomains.some(domain => {
    try {
      const urlHostname = new URL(originalUrl).hostname.toLowerCase();
      return urlHostname === domain.toLowerCase() || urlHostname.endsWith('.' + domain.toLowerCase());
    } catch {
      return false;
    }
  });

  // If proxy is explicitly requested OR domain is NOT in allowed list, use image proxy
  // Skip proxy for data URLs, relative URLs, and already-proxied URLs
  if ((useProxy || !isAllowedDomain) && !originalUrl.includes('re.podtards.com') && !originalUrl.includes('/api/proxy-image') && !originalUrl.startsWith('data:') && !originalUrl.startsWith('/')) {
    return `/api/proxy-image?url=${encodeURIComponent(originalUrl)}`;
  }

  // Use original URLs directly for allowed domains
  return originalUrl;
}

/**
 * Get a placeholder image URL for missing artwork
 * @param size - The desired size
 * @returns A placeholder image URL
 */
export function getPlaceholderImageUrl(size: 'thumbnail' | 'medium' | 'large' | 'xl' = 'medium'): string {
  const sizeMap = {
    thumbnail: { width: 150, height: 150 },
    medium: { width: 300, height: 300 },
    large: { width: 600, height: 600 },
    xl: { width: 1200, height: 1200 },
  };

  const { width, height } = sizeMap[size];
  
  // Generate a more appealing placeholder with music note icon
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#1e40af;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#3b82f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#60a5fa;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad)"/>
      <g transform="translate(${width/2}, ${height/2})" fill="white" opacity="0.9">
        <!-- Music note icon -->
        <circle cx="0" cy="-${height*0.15}" r="${Math.min(width, height) * 0.08}" fill="white"/>
        <rect x="-${Math.min(width, height) * 0.02}" y="-${height*0.15}" width="${Math.min(width, height) * 0.04}" height="${height*0.4}" fill="white"/>
        <circle cx="0" cy="${height*0.25}" r="${Math.min(width, height) * 0.08}" fill="white"/>
        <rect x="-${Math.min(width, height) * 0.02}" y="${height*0.25}" width="${Math.min(width, height) * 0.04}" height="${height*0.2}" fill="white"/>
      </g>
    </svg>
  `;
  
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Get track artwork URL - returns original URL
 * @param originalUrl - The original artwork URL
 * @returns The original artwork URL or empty string
 */
export function getTrackArtworkUrl(originalUrl: string): string {
  return originalUrl || '';
} 