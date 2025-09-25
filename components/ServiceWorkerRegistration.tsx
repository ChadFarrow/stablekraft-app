'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegistration() {
  const [updateReady, setUpdateReady] = useState(false);
  const [newVersion, setNewVersion] = useState('');

  useEffect(() => {
    // Skip service worker registration in development
    if (process.env.NODE_ENV === 'development') {
      console.log('🔧 Service Worker disabled in development mode');
      return;
    }
    
    // Re-enabled Service Worker with improved API exclusions
    console.log('🔧 Service Worker registration enabled with improved API exclusions');
    
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      let registration: ServiceWorkerRegistration;
      let updateInterval: NodeJS.Timeout | null = null;

      // Register service worker with cache busting
      const swUrl = `/sw.js?v=${Date.now()}`;
      navigator.serviceWorker
        .register(swUrl, {
          scope: '/',
          updateViaCache: 'none' // Don't cache the service worker itself
        })
        .then((reg) => {
          registration = reg;
          console.log('✅ Service Worker registered successfully:', reg);
          
          // Check for updates immediately, but only if no update is already in progress
          if (!registration.installing && !registration.waiting) {
            reg.update().catch((error) => {
              // Ignore update errors to prevent race conditions
              console.warn('Service worker update skipped:', error.message);
            });
          }
          
          // Check for updates every 5 minutes when app is active (less frequent to prevent race conditions)
          updateInterval = setInterval(() => {
            if (document.visibilityState === 'visible' && registration && !registration.installing && !registration.waiting) {
              registration.update().catch((error) => {
                // Ignore update errors to prevent race conditions
                console.warn('Service worker update skipped:', error.message);
              });
            }
          }, 300000); // 5 minutes instead of 60 seconds
        })
        .catch((error) => {
          console.error('❌ Service Worker registration failed:', error);
          // Don't throw - allow the app to continue without service worker
        });

      // Clean up interval on unmount
      return () => {
        if (updateInterval) {
          clearInterval(updateInterval);
        }
      };

      // Listen for service worker updates
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('🔄 Service Worker controller changed - reloading page');
        window.location.reload();
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('📨 Message from Service Worker:', event.data);
        
        if (event.data.type === 'SW_UPDATED') {
          setNewVersion(event.data.version);
          setUpdateReady(true);
          
          // Show update notification to user instead of auto-reload
          console.log('🔄 Service Worker updated, new version available');
        }
      });

      // Improved error handling - only clear specific problematic caches
      const handleFetchFailure = () => {
        console.warn('🔄 API/RSC fetch failed, clearing problematic caches...');
        
        if ('caches' in window) {
          caches.keys().then(cacheNames => {
            cacheNames.forEach(cacheName => {
              // Only clear caches that might interfere with API/RSC
              if (cacheName.includes('api-') || 
                  cacheName.includes('pages-cache') ||
                  cacheName.includes('start-url')) {
                caches.delete(cacheName).then(() => {
                  console.log(`🗑️ Cleared problematic cache: ${cacheName}`);
                });
              }
            });
          });
        }
      };

      // Listen for fetch errors with more specific handling
      window.addEventListener('error', (event) => {
        const message = event.message || '';
        if (message.includes('Failed to fetch RSC payload') || 
            message.includes('Decoding failed')) {
          handleFetchFailure();
        }
      });

      // Listen for unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        const message = event.reason?.message || '';
        if (message.includes('Decoding failed') || 
            message.includes('Failed to fetch RSC payload')) {
          handleFetchFailure();
        }
      });
    }
  }, []);

  // Show update notification if available
  if (updateReady) {
    return (
      <div className="fixed bottom-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50">
        <p className="text-sm">App updated! Reload to get the latest version.</p>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-2 bg-white text-blue-600 px-3 py-1 rounded text-sm hover:bg-gray-100"
        >
          Reload Now
        </button>
      </div>
    );
  }
  
  return null;
}