'use client'

import React, { useEffect } from 'react'

/**
 * Global error handler component that sets up window-level error listeners.
 * This is a client component to avoid SSR issues with window object.
 */
export default function GlobalErrorHandler() {
  useEffect(() => {
    // Suppress non-critical chrome API errors from bundled code (workbox, etc.)
    // These occur when code checks for Chrome extension APIs that don't exist in regular browsers
    const suppressChromeErrors = (event: ErrorEvent) => {
      const errorMessage = event.message || event.error?.message || '';
      const errorStack = event.error?.stack || '';
      
      // Check if this is a chrome API error from bundled code
      if (
        errorMessage.includes('chrome is not defined') ||
        errorMessage.includes('chrome.runtime') ||
        errorMessage.includes('chrome.storage') ||
        errorMessage.includes('chrome.tabs') ||
        (errorStack.includes('chrome') && (errorStack.includes('workbox') || errorStack.includes('serviceWorker')))
      ) {
        // Suppress these non-critical errors - they're from third-party code checking for Chrome extensions
        event.preventDefault();
        return true;
      }
      
      // Suppress WebSocket connection errors for dev server
      if (errorMessage.includes('WebSocket') && 
          (errorMessage.includes('127.0.0.1:8081') || errorMessage.includes('localhost:8081'))) {
        event.preventDefault();
        return true;
      }
      
      // Suppress WebSocket rate limiting errors (429 Too Many Requests)
      if (errorMessage.includes('429') || errorMessage.includes('Too Many Requests')) {
        event.preventDefault();
        return true;
      }
      
      // Suppress CORS errors for audio files (expected, proxy handles these)
      if (errorMessage.includes('Cross-Origin Request Blocked') && 
          (errorMessage.includes('.mp3') || errorMessage.includes('.wav') || errorMessage.includes('.m4a'))) {
        event.preventDefault();
        return true;
      }
      
      return false;
    };

    // Set up global error handlers
    const handleError = (event: ErrorEvent) => {
      // Suppress chrome API errors first
      if (suppressChromeErrors(event)) {
        return;
      }

      // Suppress errors without an error object (typically resource load failures like images/CORS)
      if (!event.error) {
        // These are usually image load failures, CORS blocks, or network errors
        // that don't have actionable error objects
        event.preventDefault();
        return;
      }

      // Suppress NS_BINDING_ABORTED errors (cancelled network requests)
      const errorMessage = event.message || event.error?.message || '';
      if (errorMessage.includes('NS_BINDING_ABORTED') ||
          errorMessage.includes('aborted') ||
          errorMessage.includes('OpaqueResponseBlocking')) {
        event.preventDefault();
        return;
      }

      // Log other errors normally
      console.error('🔍 Layout error caught:', event.error)
      if (event.error && event.error.stack) {
        console.error('Stack trace:', event.error.stack)
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.message || String(event.reason || '');
      
      // Suppress chrome-related promise rejections
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

      console.error('🔍 Layout promise rejection caught:', event.reason)
    }

    window.addEventListener('error', handleError, true) // Use capture phase
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Cleanup on unmount
    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null // This component doesn't render anything
}

