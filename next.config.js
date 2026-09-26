const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
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
      // Use NetworkFirst for external images to avoid CORS/blocking issues
      urlPattern: /^https?.*\.(png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'static-images-cache',
        expiration: {
          maxEntries: 100,
          maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
        },
        networkTimeoutSeconds: 5,
        plugins: [
          {
            handlerDidError: async ({ request }) => {
              // Fallback to direct network fetch on SW error
              return fetch(request);
            },
          },
        ],
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
          maxAgeSeconds: 60 * 60, // 1 hour — avoid iOS PWA sitting on stale shells
        },
        networkTimeoutSeconds: 3,
      },
    },
  ],
  // PWA fallback configuration
  fallbacks: {
    document: '/offline', // Offline page for HTML documents
  },
  // Precache the downloads page shell so the offline page's "Play your downloads"
  // CTA reaches it even if /downloads was never visited online (it would otherwise
  // fall back to /offline). Data is fetched client-side, so a static shell is fine.
  additionalManifestEntries: [{ url: '/downloads', revision: null }],
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
});

// Read package.json to get version for build
const fs = require('fs');
const path = require('path');
const packageJsonPath = path.join(__dirname, 'package.json');
let packageVersion = '1.2a000000';
let buildVersion = '1.2a000000';

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  packageVersion = packageJson.version || '1.2a000000';
  buildVersion = packageJson.version || '1.2a000000';
} catch (err) {
  console.warn('⚠️ Could not read package.json for version:', err.message);
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Domain configuration for stablekraft.app deployment
  basePath: '',

  // Fix workspace root detection (bun.lock in parent directory was causing issues)
  outputFileTracingRoot: path.join(__dirname),
  
  // Inject version from package.json as environment variable
  env: {
    NEXT_PUBLIC_APP_VERSION: packageVersion,
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  
  // Performance optimizations
  reactStrictMode: true,
  
  // Dynamic route configuration to prevent build issues
  // `ws` must be require()d from node_modules at runtime, never bundled. Webpack
  // inlines it and its optional native helpers (bufferutil / utf-8-validate) do
  // not survive, so every frame it sends throws `TypeError: b.mask is not a
  // function` as an uncaughtException in the server process -- measured against
  // the standalone build. Marking it external also makes Next trace it into
  // `.next/standalone/node_modules`, which is why `ws` is a production dep.
  // It is the server's only WebSocket: see lib/nostr/node-websocket.ts.
  serverExternalPackages: ['ws'],

  experimental: {
    // Disable worker threads - causes DataCloneError with webpack config
    workerThreads: false,
    // Single CPU to prevent serialization issues, but still faster than CSS optimization
    cpus: 1,
    // Disable CSS optimization during build - this is the main bottleneck
    optimizeCss: false, // Disabled for faster Railway builds (was causing 30min timeouts)
    // lucide-react is imported at 55 sites. Next 15 has a built-in default for
    // it, but naming it here is free and does not depend on that default
    // surviving a version bump.
    optimizePackageImports: ['@/components', 'lucide-react'],
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

  /**
   * Where the build writes. `.next` everywhere except when you say otherwise.
   *
   * `next dev` and `next build` write the SAME directory, so a build started
   * while a dev server is running replaces the chunks its client already
   * fetched: every asset request 400s, the page hangs on its loading state with
   * no obvious error, and the only cure is killing dev, `rm -rf .next` and
   * starting again. Any phone testing over the LAN then needs a hard reload
   * too. Changing the dev PORT does not help — the collision is the directory.
   *
   * So: `NEXT_DIST_DIR=.next-build npm run build` verifies a build without
   * touching a running dev server. Nothing in production sets this, so the
   * deployed build is byte-identical to what it was before this existed.
   *
   * One side effect to undo afterwards: Next rewrites `tsconfig.json` on every
   * build, and with this set it adds `.next-build/types` to `include` and
   * reformats the file. `git checkout tsconfig.json` once the build is done.
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Standalone output for smaller Docker images (~40% reduction)
  output: 'standalone',

  
  // Image optimization configuration
  images: {
    // Performance optimizations - enable optimization but with better error handling
    unoptimized: false, // Re-enable optimization but with better configuration
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    // 50 is Data Saver's (lib/data-saver.ts). Next 15 REFUSES a quality that is
    // not listed here, so the constant and this list have to move together.
    // Adding a value changes no default: nothing asks for 50 unless the user
    // turns Data Saver on.
    qualities: [50, 75, 85, 90, 100],
    // 1 day. This is how long the server keeps an optimized image AND the browser
    // `max-age` it is sent with. At 7 days, an artist who replaced a cover file in
    // place (Hip-Hop Taoist, 2026-09-26) kept showing the old art in every
    // <ArtworkImage> for up to a week after the file had changed.
    minimumCacheTTL: 60 * 60 * 24,
    // Improved loading state configuration
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self' data:; script-src 'none'; img-src 'self' data: https:; sandbox;",
    // Use default loader with better error handling
    loader: 'default',
    loaderFile: undefined,
    // Add better error handling for image optimization
    disableStaticImages: false,
    // Configure local patterns for proxied images and static assets
    localPatterns: [
      {
        pathname: '/api/proxy-image',
        search: '**',
      },
      {
        pathname: '/**',
      },
    ],
    // Note: domains array removed - using remotePatterns instead (deprecated in Next.js 15)
    // Most external images are handled via /api/proxy-image route
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
        pathname: '/**',
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
      // stablekraft.app domain
      {
        protocol: 'https',
        hostname: 'stablekraft.app',
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
        protocol: 'https',
        hostname: 'thebearsnare.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
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
        hostname: 'feeds.podcastindex.org',
        port: '',
        pathname: '/**',
      },
      // Strange Textures podcast hosting
      {
        protocol: 'https',
        hostname: 'f.strangetextures.com',
        port: '',
        pathname: '/**',
      },
      // CloudFront CDN for podcast images
      {
        protocol: 'https',
        hostname: 'deow9bq0xqvbj.cloudfront.net',
        port: '',
        pathname: '/**',
      },
      // Binaural Subliminal album artwork
      {
        protocol: 'https',
        hostname: 'binauralsubliminal.com',
        port: '',
        pathname: '/**',
      },
      // Bass Pistol shop images
      {
        protocol: 'https',
        hostname: 'shop.basspistol.com',
        port: '',
        pathname: '/**',
      },
      // Fountain.fm podcast feed images
      {
        protocol: 'https',
        hostname: 'feeds.fountain.fm',
        port: '',
        pathname: '/**',
      },
      // Podhome.fm podcast assets
      {
        protocol: 'https',
        hostname: 'assets.podhome.fm',
        port: '',
        pathname: '/**',
      },
    ],
  },

  // Performance and caching
  compress: true,
  poweredByHeader: false,
  generateEtags: true,

  // Remove console logs in production
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'], // Keep console.error and console.warn
    } : false,
  },

  // Webpack optimizations for performance
  webpack: (config, { dev, isServer }) => {
    // Performance optimizations - aggressive bundle splitting for first-visit performance
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 20000,
        cacheGroups: {
          // Split heavy Nostr libraries into async chunk (loaded on auth)
          nostr: {
            test: /[\\/]node_modules[\\/](nostr-tools|@noble|@scure|nostr-login)[\\/]/,
            name: 'nostr',
            chunks: 'async',
            priority: 40,
            enforce: true,
          },
          // Split Bitcoin/Lightning libraries into async chunk (loaded on wallet connect)
          bitcoin: {
            test: /[\\/]node_modules[\\/](@getalby|webln|@webbtc|lnc-web|bitcoin-connect)[\\/]/,
            name: 'bitcoin',
            chunks: 'async',
            priority: 40,
            enforce: true,
          },
          // Split HLS.js into async chunk (loaded on video playback)
          hls: {
            test: /[\\/]node_modules[\\/]hls\.js[\\/]/,
            name: 'hls',
            chunks: 'async',
            priority: 40,
            enforce: true,
          },
          // Split QR code library (loaded when needed)
          qrcode: {
            test: /[\\/]node_modules[\\/](qrcode\.react|qrcode)[\\/]/,
            name: 'qrcode',
            chunks: 'async',
            priority: 30,
          },
          // Keep common vendor chunk for essential libraries
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            chunks: 'all',
            priority: 10,
          },
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            priority: 5,
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
            // 0, not 1. The legacy auditor is deprecated everywhere and its
            // blocking mode was itself an XSS vector in older browsers. CSP
            // below is the real control.
            key: 'X-XSS-Protection',
            value: '0',
          },
          {
            // No 'preload': radio.* subdomain must stay reachable if it ever
            // serves over plain HTTP during DNS/cert changes.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Nothing here uses these, and an injected iframe or script should
            // not be able to either. Deliberately NOT disabling `autoplay` —
            // the audio element and the Android WebView need it.
            key: 'Permissions-Policy',
            value: [
              'accelerometer=()',
              'camera=()',
              'display-capture=()',
              'geolocation=()',
              'gyroscope=()',
              'magnetometer=()',
              'microphone=()',
              'payment=()',
              'usb=()',
              'interest-cohort=()',
            ].join(', '),
          },
        ],
      },
      {
        // The podping consumer (msp-podping-service) calls these four from
        // outside the browser and CLAUDE.md marks them intentionally public.
        // They carry no user data and no cookie, so a wildcard is correct here
        // and only here.
        source: '/api/feeds/:path(exists|refresh-by-url|opml)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        source: '/api/feeds',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
      {
        source: '/_next/static/(.*\\.css)',
        headers: [
          {
            key: 'Content-Type',
            value: 'text/css; charset=utf-8',
          },
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
      {
        source: '/_next/static/(.*\\.js)',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
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
          {
            // REPORT-ONLY STILL, deliberately. A wrong script-src white-screens
            // the entire app, this repo has no preview environment, and
            // app/layout.tsx ships an inline <script> alongside Next's own
            // inline bootstrap.
            //
            // Promotion to 'Content-Security-Policy' is gated on
            // /api/admin/diagnostics showing no `csp` category reports from real
            // traffic. The `report-uri` below is what makes that observable —
            // until it was added, this header had no reporting destination at
            // all, so "watch the browser console for violations" meant someone
            // browsing eight surfaces by hand, and nothing was ever collected.
            //
            // worker-src is NOT redundant with default-src. Without it, workers
            // fall back to `default-src 'self'` and a blob: worker is refused —
            // measured in Chromium, and the Worker constructor does NOT throw, so
            // it fails silently. contexts/AudioContext.tsx builds hls.js with
            // `enableWorker: true`, so enforcing without this line would kill HLS
            // playback with no error anywhere.
            //
            // connect-src is copied verbatim from the previous enforcing policy
            // so no relay or wallet socket changes behaviour.
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com data:",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob: https:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "connect-src 'self' https: ws: wss: wss://localrelay.link:28443 wss://relay.nsec.app wss://nos.lol wss://relay.snort.social wss://nostr.oxtr.dev wss://relay.primal.net wss://theforest.nostr1.com wss://relay.damus.io",
              'report-uri /api/csp-report',
            ].join('; '),
          },
        ],
      },
    ];
  },
}

module.exports = withPWA(nextConfig)