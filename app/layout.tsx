import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import ErrorBoundary from '@/components/ErrorBoundary'
import ClientErrorBoundary from '@/components/ClientErrorBoundary'
import { ToastContainer } from '@/components/Toast'
import { AudioProvider } from '@/contexts/AudioContext'
import { SessionProvider } from '@/contexts/SessionContext'
import { NostrProvider } from '@/contexts/NostrContext'
import { UserSettingsProvider } from '@/contexts/UserSettingsContext'
import { SidebarProvider } from '@/contexts/SidebarContext'
import { BatchedFavoritesProvider } from '@/contexts/BatchedFavoritesContext'
import LightningWrapper from '@/components/LightningWrapper'
import GlobalNowPlayingBar from '@/components/GlobalNowPlayingBar'
import NowPlayingScreen from '@/components/NowPlayingScreen'
// import PerformanceMonitor from '@/components/PerformanceMonitor'
import ScrollDetectionProvider from '@/components/ScrollDetectionProvider'
import ScrollRestorationProvider from '@/components/ScrollRestorationProvider'
import GlobalErrorHandler from '@/components/GlobalErrorHandler'



const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: false, // Disable automatic preloading to prevent warnings
  fallback: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif']
})

export const metadata: Metadata = {
  title: 'Project StableKraft - Music & Podcast Hub',
  description: 'Discover and listen to music and podcasts from the Doerfel family and friends',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon-16x16.png?v=20251204', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png?v=20251204', sizes: '32x32', type: 'image/png' },
      { url: '/pwa-icon-192.png?v=20251204', sizes: '192x192', type: 'image/png' },
      { url: '/pwa-icon-512.png?v=20251204', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png?v=20251204', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Project StableKraft',
    startupImage: [
      {
        url: '/apple-touch-icon.png?v=20251204',
        media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)',
      },
    ],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'Project StableKraft',
    'mobile-web-app-capable': 'yes',
    'format-detection': 'telephone=no',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ffffff',
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Early error suppression - runs before React loads */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Suppress chrome API errors from bundled code (workbox, etc.)
                const originalError = window.onerror;
                window.onerror = function(message, source, lineno, colno, error) {
                  const messageStr = typeof message === 'string' ? message : String(message || '');
                  const errorStack = error?.stack || '';
                  
                  // Suppress chrome API errors (from workbox/service worker code)
                  if (messageStr.includes('chrome is not defined') ||
                      messageStr.includes('chrome.runtime') ||
                      messageStr.includes('chrome.storage') ||
                      messageStr.includes('chrome.tabs') ||
                      errorStack.includes('chrome') && (errorStack.includes('workbox') || errorStack.includes('serviceWorker'))) {
                    return true; // Suppress the error
                  }
                  
                  // Suppress WebSocket connection errors for dev server (expected when dev server isn't running)
                  if (messageStr.includes('WebSocket') && 
                      (messageStr.includes('127.0.0.1:8081') || messageStr.includes('localhost:8081'))) {
                    return true; // Suppress dev server connection errors
                  }
                  
                  // Suppress WebSocket rate limiting errors (429 Too Many Requests)
                  if (messageStr.includes('429') || messageStr.includes('Too Many Requests')) {
                    return true; // Suppress rate limiting errors
                  }
                  
                  // Suppress CORS errors for audio files (expected, proxy handles these)
                  if (messageStr.includes('Cross-Origin Request Blocked') && 
                      (messageStr.includes('.mp3') || messageStr.includes('.wav') || messageStr.includes('.m4a'))) {
                    return true; // Suppress expected CORS errors for audio
                  }
                  
                  if (originalError) {
                    return originalError.call(this, message, source, lineno, colno, error);
                  }
                  return false;
                };
                
                // Suppress chrome-related promise rejections
                window.addEventListener('unhandledrejection', function(event) {
                  const reason = event.reason?.message || String(event.reason || '');
                  
                  // Suppress chrome API errors
                  if (reason.includes('chrome is not defined') || 
                      reason.includes('chrome.runtime') ||
                      reason.includes('chrome.storage')) {
                    event.preventDefault();
                    return;
                  }
                  
                  // Suppress WebSocket connection errors for dev server
                  if (reason.includes('WebSocket') && 
                      (reason.includes('127.0.0.1:8081') || reason.includes('localhost:8081'))) {
                    event.preventDefault();
                    return;
                  }
                  
                  // Suppress WebSocket rate limiting errors (429 Too Many Requests)
                  if (reason.includes('429') || reason.includes('Too Many Requests')) {
                    event.preventDefault();
                    return;
                  }
                  
                  // Suppress CORS errors for audio (expected behavior)
                  if (reason.includes('Cross-Origin') && 
                      (reason.includes('.mp3') || reason.includes('.wav') || reason.includes('.m4a'))) {
                    event.preventDefault();
                    return;
                  }
                });
                
                // Suppress noisy console warnings for expected behaviors
                const originalWarn = console.warn;
                console.warn = function(...args) {
                  const message = args.join(' ');
                  
                  // Suppress localStorage quota warnings (expected behavior, fallback works)
                  if (message.includes('localStorage quota exceeded') || 
                      (message.includes('quota exceeded') && message.includes('IndexedDB'))) {
                    // Convert to info log (less alarming, expected behavior)
                    console.log('ℹ️ Storage quota exceeded, using IndexedDB fallback (expected behavior)');
                    return;
                  }
                  
                  // Suppress CORS warnings for audio files (expected, proxy handles these)
                  if (message.includes('Cross-Origin Request Blocked') && 
                      (message.includes('.mp3') || message.includes('.wav') || message.includes('.m4a'))) {
                    return; // Suppress expected CORS warnings
                  }
                  
                  // Suppress WebSocket connection warnings for dev server
                  if (message.includes("can't establish a connection") &&
                      (message.includes('127.0.0.1:8081') || message.includes('localhost:8081'))) {
                    return; // Suppress dev server connection warnings
                  }
                  
                  // Suppress WebSocket rate limiting warnings (429)
                  if (message.includes('429') || message.includes('Too Many Requests')) {
                    return; // Suppress rate limiting warnings
                  }
                  
                  originalWarn.apply(console, args);
                };
                
                // Suppress console errors for expected behaviors
                const originalErrorLog = console.error;
                console.error = function(...args) {
                  const message = args.join(' ');
                  
                  // Suppress chrome API errors in console
                  if (message.includes('chrome is not defined') || 
                      message.includes('chrome.runtime') ||
                      message.includes('chrome.storage')) {
                    return; // Suppress chrome API errors
                  }
                  
                  // Suppress WebSocket connection errors for dev server
                  if (message.includes('WebSocket') && 
                      (message.includes('127.0.0.1:8081') || message.includes('localhost:8081'))) {
                    return; // Suppress dev server connection errors
                  }
                  
                  // Suppress WebSocket rate limiting errors (429)
                  if (message.includes('429') || message.includes('Too Many Requests')) {
                    return; // Suppress rate limiting errors
                  }
                  
                  originalErrorLog.apply(console, args);
                };
              })();
            `,
          }}
        />
        {/* Favicon */}
        <link rel="icon" type="image/png" href="/stablekraft-rocket.png?v=20251204" />
        <link rel="shortcut icon" type="image/png" href="/stablekraft-rocket.png?v=20251204" />
        
        {/* PWA Meta Tags */}
        <meta name="theme-color" content="#1f2937" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Project StableKraft" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-touch-fullscreen" content="yes" />
        <meta name="format-detection" content="telephone=no" />

        {/* Resource hints for performance */}
        <link rel="preconnect" href="https://www.doerfelverse.com" />
        <link rel="dns-prefetch" href="https://www.doerfelverse.com" />
        {/* Removed albums preload to avoid unused resource warning */}
        {/* Removed logo.webp preload as it's not immediately needed */}
      </head>
      <body className={inter.className}>
        <GlobalErrorHandler />
        <ClientErrorBoundary>
          <ErrorBoundary>
            <NostrProvider>
              <UserSettingsProvider>
                <LightningWrapper>
                  <SidebarProvider>
                    <ScrollDetectionProvider>
                      <ScrollRestorationProvider>
                      <SessionProvider>
                        <BatchedFavoritesProvider>
                        <AudioProvider>
                          <div className="min-h-screen relative">
                            {/* Background Image - Lazy loaded for better performance */}
                            <div
                              className="fixed inset-0 z-0"
                              style={{
                                background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
                                opacity: 0.8
                              }}
                            />
                            {/* Background image loads after critical content - using WebP for 55% smaller file */}
                            <div
                              className="fixed inset-0 z-0 opacity-0 transition-opacity duration-1000"
                              id="background-image"
                              style={{
                                background: 'url(/stablekraft-rocket.webp) center/contain fixed',
                                backgroundAttachment: 'fixed',
                                opacity: 0.6
                              }}
                            />

                            {/* Content overlay */}
                            <div className="relative z-10">
                              {children}
                            </div>
                          </div>
                          <GlobalNowPlayingBar />
                          <NowPlayingScreen />
                          <ToastContainer />
                          <ServiceWorkerRegistration />
                        </AudioProvider>
                        </BatchedFavoritesProvider>
                      </SessionProvider>
                      </ScrollRestorationProvider>
                    </ScrollDetectionProvider>
                  </SidebarProvider>
                </LightningWrapper>
              </UserSettingsProvider>
            </NostrProvider>
          </ErrorBoundary>
          {/* <PerformanceMonitor /> */}
        </ClientErrorBoundary>
      </body>
    </html>
  )
}