const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: false,
  // Comprehensive exclusions to prevent API and RSC caching issues
  exclude: [
    // Next.js internals
    /_next\/static\/.*\/_buildManifest\.js$/,
    /_next\/static\/.*\/_ssgManifest\.js$/,
    /_next\/static\/.*\/_app-build-manifest\.json$/,
    /_next\/webpack-hmr/,
    
    // API routes - exclude all to prevent caching issues
    /^\/api\/.*/,
    
    // RSC (React Server Components) routes
    /\?_rsc=/,
    /.*\?_rsc=.*/,
    
    // Dynamic routes that cause issues
    /album\/.*\?_rsc=/,
    /publisher\/.*\?_rsc=/,
    
    // Test and debug pages
    /test-mobile-images/,
    /test-jdog/,
    /test-errors/,
    /admin/,
    
    // Image proxying
    /api\/proxy-image/,
    /api\/optimized-images/,
    
    // Data endpoints
    /api\/albums/,
    /api\/parsed-feeds/,
    /api\/feeds/,
    /api\/publishers/,
    /api\/playlist/,
  ],
  // Enhanced runtime caching with better API exclusions
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts-cache',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
      },
    },
    {
      urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'gstatic-fonts-cache',
        expiration: {
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
      },
    },
    {
      // Cache static assets
      urlPattern: /^https?.*\.(png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-images-cache',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        },
      },
    },
    {
      // Cache CSS and JS files
      urlPattern: /^https?.*\.(css|js)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-resources-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
        },
      },
    },
    {
      // Network first for pages (but exclude API and RSC)
      urlPattern: /^https?:\/\/[^/]*\/(?!api\/)(?!.*\?_rsc=).*$/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'pages-cache',
        expiration: {
          maxEntries: 50,
          maxAgeSeconds: 60 * 60 * 24, // 1 day
        },
        networkTimeoutSeconds: 3,
      },
    },
  ],
  // PWA fallback configuration
  fallbacks: {
    document: '/offline', // Offline page for HTML documents
  },
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Domain configuration for re.podtards.com deployment
  basePath: '',
  
  // Performance optimizations
  reactStrictMode: true,
  
  // Dynamic route configuration to prevent build issues
  experimental: {
    // Disable static generation for dynamic API routes
    workerThreads: false,
    cpus: 1,
    // Performance optimizations - CSS optimization is now properly configured
    optimizeCss: true, // Re-enabled now that critters is installed
    optimizePackageImports: ['@/components'],
    // Development performance optimizations
    turbo: {
      rules: {
        '*.js': {
          loaders: ['swc-loader'],
        },
      },
    },
  },
  
  // Turbopack configuration (moved from experimental)
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  
  // Revert static export - doesn't work with API routes
  // output: 'export',
  // trailingSlash: true,
  // distDir: 'out',

  
  // Image optimization configuration
  images: {
    // Performance optimizations - enable optimization but with better error handling
    unoptimized: false, // Re-enable optimization but with better configuration
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 days for faster updates
    // Improved loading state configuration
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self' data:; script-src 'none'; img-src 'self' data: https:; sandbox;",
    // Use default loader with better error handling
    loader: 'default',
    loaderFile: undefined,
    // Add better error handling for image optimization
    disableStaticImages: false,
    // Configure domains for external images
    domains: [
      're.podtards.com',
      'www.doerfelverse.com',
      'www.thisisjdog.com',
      'www.sirtjthewrathful.com',
      'wavlake.com',
      'www.wavlake.com',
      'd12wklypp119aj.cloudfront.net',
      'ableandthewolf.com',
      'music.behindthesch3m3s.com',
      'cypherpunk.today',
      'headstarts.uk',
      'assets.libsyn.com',
      'assets.podhome.fm',
      'backend-api.justcast.com',
      'behindthesch3m3s.com',
      'brrreadfan.github.io',
      'cdn.kolomona.com',
      'feeds.fountain.fm',
      'feeds.podcastindex.org',
      'hogstory.net',
      'i0.wp.com',
      'images.pexels.com',
      'images.squarespace-cdn.com',
      'justcast.sfo2.digitaloceanspaces.com',
      'mmmusic.show',
      'music.jimmyv4v.com',
      'nutshellsermons.com',
      'pbcdn1.podbean.com',
      'taylor-sound.com',
      'thebearsnare.com',
      'whitetriangles.com',
      'www.whitetriangles.com',
      'www.falsefinish.club',
      'www.leuenbergmusic.com',
      'www.socialmedia101pro.com',
      'socialmedia101pro.com',
      'homegrownhits.xyz',
      'lightningthrashes.com',
      'picsum.photos',
      'podcastindex.org',
      'raw.githubusercontent.com',
      'megaphone.imgix.net',
      'cdn-images.owltail.com',
      'www.haciendoelsueco.com'
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'www.doerfelverse.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'feed.bowlafterbowl.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.thisisjdog.com',
        port: '',
        pathname: '/media/**',
      },
      {
        protocol: 'https',
        hostname: 'www.sirtjthewrathful.com',
        port: '',
        pathname: '/wp-content/**',
      },
      {
        protocol: 'https',
        hostname: 'wavlake.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.wavlake.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'd12wklypp119aj.cloudfront.net',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ableandthewolf.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'music.behindthesch3m3s.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'whiterabbitrecords.org',
        port: '',
        pathname: '/wp-content/**',
      },
                      {
                  protocol: 'https',
                  hostname: 'feed.falsefinish.club',
                  port: '',
                  pathname: '/**',
                },
                {
                  protocol: 'https',
                  hostname: 'f4.bcbits.com',
                  port: '',
                  pathname: '/**',
                },
      // re.podtards.com domain
      {
        protocol: 'https',
        hostname: 're.podtards.com',
        port: '',
        pathname: '/**',
      },
      // Fallback for local development
      {
        protocol: 'https',
        hostname: 'localhost',
        port: '3000',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3000',
        pathname: '/**',
      },
      // Additional CDN and image hosting domains
      {
        protocol: 'https',
        hostname: 'static.wixstatic.com',
        port: '',
        pathname: '/**',
      },
      // RSS feed image domains that were causing HTTP 400 errors
      {
        protocol: 'https',
        hostname: 'noagendaassets.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'media.rssblue.com',
        port: '',
        pathname: '/**',
      },
      // Heycitizen domain
      {
        protocol: 'https',
        hostname: 'files.heycitizen.xyz',
        port: '',
        pathname: '/**',
      },
      // Bitpunk.fm domains
      {
        protocol: 'https',
        hostname: 'files.bitpunk.fm',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.bitpunk.fm',
        port: '',
        pathname: '/**',
      },
      // Anni Powell Music domain
      {
        protocol: 'https',
        hostname: 'annipowellmusic.com',
        port: '',
        pathname: '/**',
      },
      // Additional music domains
      {
        protocol: 'https',
        hostname: 'rocknrollbreakheart.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'rocknrollbreakheart.com',
        port: '',
        pathname: '/**',
      },
      // Placeholder image service
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
        port: '',
        pathname: '/**',
      },
      // Nostr image hosting
      {
        protocol: 'https',
        hostname: 'i.nostr.build',
        port: '',
        pathname: '/**',
      },
      // GitHub raw content for playlist artwork
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
      // Megaphone podcast hosting images
      {
        protocol: 'https',
        hostname: 'megaphone.imgix.net',
        port: '',
        pathname: '/**',
      },
      // OwlTail podcast discovery images
      {
        protocol: 'https',
        hostname: 'cdn-images.owltail.com',
        port: '',
        pathname: '/**',
      },
      // Haciendo El Sueco podcast images
      {
        protocol: 'https',
        hostname: 'www.haciendoelsueco.com',
        port: '',
        pathname: '/**',
      },
      // Additional HGH playlist domains that need special patterns
      {
        protocol: 'https',
        hostname: 'destinys-music.nyc3.cdn.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'dtnmusic1w.sfo3.cdn.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'dtnmusic1w.sfo3.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'jimmiebratcher.s3.us-west-1.amazonaws.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'thesynthesatsers.nyc3.cdn.digitaloceanspaces.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'thebearsnare.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'socialmedia101pro.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'bobcatindex.us-southeast-1.linodeobjects.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'bobcatindex.us-southeast-1.linodeobjects.com',
        port: '',
        pathname: '/**',
      },
      // Playlist artwork domains
      {
        protocol: 'https',
        hostname: 'homegrownhits.xyz',
        port: '',
        pathname: '/wp-content/**',
      },
      {
        protocol: 'https',
        hostname: 'lightningthrashes.com',
        port: '',
        pathname: '/wp-content/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'podcastindex.org',
        port: '',
        pathname: '/images/**',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
  },

  // Performance and caching
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  
  // Webpack optimizations for performance
  webpack: (config, { dev, isServer }) => {
    // Performance optimizations
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
          },
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            enforce: true,
          },
        },
      };
    }
    
    return config;
  },
  
  // Headers for CDN and performance
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: '*',
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, OPTIONS',
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
      // Performance headers
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
    ];
  },
}

module.exports = withPWA(nextConfig)