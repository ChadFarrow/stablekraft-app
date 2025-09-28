import Link from 'next/link';
import { Wifi, WifiOff, Music, RefreshCw } from 'lucide-react';

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-6">
        {/* Offline Icon */}
        <div className="mb-8">
          <div className="relative inline-block">
            <WifiOff className="h-24 w-24 text-red-400 mx-auto mb-4" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Wifi className="h-12 w-12 text-gray-600" />
            </div>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold mb-4">You&apos;re Offline</h1>
        
        {/* Description */}
        <p className="text-gray-400 mb-8 leading-relaxed">
          Don&apos;t worry! You can still enjoy your cached music and browse previously loaded content. 
          Some features may be limited until you&apos;re back online.
        </p>

        {/* Features Available Offline */}
        <div className="bg-black/20 backdrop-blur-sm rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center justify-center">
            <Music className="h-5 w-5 mr-2" />
            Available Offline
          </h2>
          <ul className="text-sm text-gray-300 space-y-2">
            <li>• Previously loaded albums and tracks</li>
            <li>• Cached album artwork</li>
            <li>• Music player functionality</li>
            <li>• Basic navigation</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          <a
            href="/"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </a>
          
          <Link
            href="/"
            className="block w-full border border-gray-600 hover:border-gray-500 text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Go to Home
          </Link>
        </div>

        {/* Network Status */}
        <div className="mt-8 pt-6 border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Check your internet connection and try again
          </p>
        </div>
      </div>
    </div>
  );
} 