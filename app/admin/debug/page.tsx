'use client';

import dynamicImport from 'next/dynamic';

const AdminDebugClient = dynamicImport(() => import('./AdminDebugClient'), {
  ssr: false,
  loading: () => <div className="min-h-screen bg-gray-50 p-8"><div className="max-w-6xl mx-auto"><div className="mb-8"><h1 className="text-3xl font-bold text-gray-900 mb-4">Admin Debug Dashboard</h1><p className="text-gray-600">Loading...</p></div></div></div>
});

export default function AdminDebugPage() {
  return <AdminDebugClient />;
}