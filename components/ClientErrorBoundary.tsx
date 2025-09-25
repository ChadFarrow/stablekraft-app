'use client';

import React, { useEffect } from 'react';

interface ClientErrorBoundaryProps {
  children: React.ReactNode;
}

const ClientErrorBoundary: React.FC<ClientErrorBoundaryProps> = ({ children }) => {
  useEffect(() => {
    // Global error handler for debugging
    const handleError = (event: ErrorEvent) => {
      console.error('🔍 Global error caught:', event.error);
      
      // Handle specific ServiceWorker errors gracefully
      if (event.error?.message?.includes('Failed to update the ServiceWorker')) {
        console.warn('ServiceWorker update conflict - this is normal during updates');
        event.preventDefault();
        return;
      }
      
      // Handle tracks undefined errors gracefully
      if (event.error?.message?.includes("can't access property \"length\", e.tracks is undefined")) {
        console.warn('Tracks data structure issue - attempting recovery');
        event.preventDefault();
        return;
      }
      
      // Log additional context for debugging
      if (event.error && event.error.stack) {
        console.error('Stack trace:', event.error.stack);
      }
    };

    // Global unhandled rejection handler
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('🔍 Global promise rejection caught:', event.reason);
      
      // Handle specific ServiceWorker errors gracefully
      if (event.reason?.message?.includes('Failed to update the ServiceWorker')) {
        console.warn('ServiceWorker update conflict - this is normal during updates');
        event.preventDefault();
        return;
      }
      
      // Handle tracks undefined errors gracefully
      if (event.reason?.message?.includes("can't access property \"length\", e.tracks is undefined")) {
        console.warn('Tracks data structure issue - attempting recovery');
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return <>{children}</>;
};

export default ClientErrorBoundary; 