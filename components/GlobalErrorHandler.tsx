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
        errorStack.includes('chrome') && errorStack.includes('workbox')
      ) {
        // Suppress these non-critical errors - they're from third-party code checking for Chrome extensions
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

      // Log other errors normally
      console.error('🔍 Layout error caught:', event.error)
      if (event.error && event.error.stack) {
        console.error('Stack trace:', event.error.stack)
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.message || String(event.reason || '');
      
      // Suppress chrome-related promise rejections
      if (reason.includes('chrome is not defined') || reason.includes('chrome.runtime')) {
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

