import { Suspense } from 'react';
import DatabaseMusicPlayer from '@/components/DatabaseMusicPlayer';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-white">Loading...</div></div>}>
      <DatabaseMusicPlayer />
    </Suspense>
  );
}