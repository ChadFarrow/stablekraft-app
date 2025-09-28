export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">You&apos;re Offline</h1>
        <p className="text-gray-400 mb-8">Check your internet connection and try again</p>
        <a href="/" className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg">
          Go to Home
        </a>
      </div>
    </div>
  );
} 