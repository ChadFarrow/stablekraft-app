import { Suspense } from 'react';
import HomePageClient from './HomePageClient';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
      <HomePageClient />
    </Suspense>
  );
}