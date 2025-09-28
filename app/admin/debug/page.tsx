'use client';

export const dynamic = 'force-dynamic';

export default function AdminDebugPage() {
  // Simple loading state that renders immediately
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Admin Debug Dashboard</h1>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    </div>
  );
}