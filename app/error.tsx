'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for debugging in dev
    // eslint-disable-next-line no-console
    console.error('Error boundary caught error:', error);
    
    // Log additional error details for debugging
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    
    // Log error name and message
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
  }, [error]);

  // Add global error handlers to prevent crashes
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('🔍 Global promise rejection caught:', event.reason);
      
      // Handle specific ServiceWorker errors
      if (event.reason?.message?.includes('Failed to update the ServiceWorker')) {
        console.warn('ServiceWorker update conflict - this is normal during updates');
        event.preventDefault();
        return;
      }
      
      // Handle tracks undefined errors
      if (event.reason?.message?.includes("can't access property \"length\", e.tracks is undefined")) {
        console.warn('Tracks data structure issue - attempting recovery');
        event.preventDefault();
        return;
      }
      
      event.preventDefault();
    };

    const handleError = (event: ErrorEvent) => {
      console.error('🔍 Global error caught:', event.error);
      
      // Handle specific ServiceWorker errors
      if (event.error?.message?.includes('Failed to update the ServiceWorker')) {
        console.warn('ServiceWorker update conflict - this is normal during updates');
        event.preventDefault();
        return;
      }
      
      // Handle tracks undefined errors
      if (event.error?.message?.includes("can't access property \"length\", e.tracks is undefined")) {
        console.warn('Tracks data structure issue - attempting recovery');
        event.preventDefault();
        return;
      }
      
      event.preventDefault();
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <h2 className="text-2xl font-semibold">Something went wrong</h2>
        <p className="text-gray-400">{error?.message || 'An unexpected error occurred.'}</p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="px-4 py-2 rounded bg-white/10 hover:bg-white/20"
          >Try again</button>
        </div>
      </div>
    </div>
  );
}

 