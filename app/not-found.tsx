import Link from 'next/link';

// Force dynamic rendering to prevent static generation issues
export const dynamic = 'force-dynamic';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-gray-900 rounded-lg shadow-lg p-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="h-16 w-16 bg-blue-500 rounded-full flex items-center justify-center">
            <span className="text-white text-3xl font-bold">?</span>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-gray-400 mb-6">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/playlist/index" className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
            <span className="text-lg">🏠</span>
            Go to Playlists
          </Link>
        </div>
      </div>
    </div>
  );
} 