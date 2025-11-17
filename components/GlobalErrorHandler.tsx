'use client'

import React, { useEffect } from 'react'

/**
 * Global error handler component that sets up window-level error listeners.
 * This is a client component to avoid SSR issues with window object.
 */
export default function GlobalErrorHandler() {
  useEffect(() => {
    // Set up global error handlers
    const handleError = (event: ErrorEvent) => {
      console.error('🔍 Layout error caught:', event.error)
      if (event.error && event.error.stack) {
        console.error('Stack trace:', event.error.stack)
      }
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('🔍 Layout promise rejection caught:', event.reason)
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Cleanup on unmount
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null // This component doesn't render anything
}

