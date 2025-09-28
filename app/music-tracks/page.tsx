import { Suspense } from 'react';
import MusicTracksClient from './MusicTracksClient';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

export default function MusicSegmentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
      <MusicTracksClient />
    </Suspense>
  );
}