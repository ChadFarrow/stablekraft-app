'use client';

import { useState, useEffect } from 'react';
import { toast } from '@/components/Toast';
import dynamic from 'next/dynamic';

// Dynamic import for the heavy admin panel component
const AdminPanel = dynamic(() => import('@/components/AdminPanel'), {
  loading: () => (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-lg">Loading admin panel...</p>
      </div>
    </div>
  ),
  ssr: false // Admin panels typically don't need SSR
});

export default function AdminPage() {
  return <AdminPanel />;
}