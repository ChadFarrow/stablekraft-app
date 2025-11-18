'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function TestNip55CallbackPage() {
  const [debugInfo, setDebugInfo] = useState<any>({});
  const searchParams = useSearchParams();

  useEffect(() => {
    const fullUrl = window.location.href;
    const hash = window.location.hash;
    const search = window.location.search;

    // Parse all query params
    const allParams: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      allParams[key] = value;
    });

    // Parse hash params too
    const hashParams: Record<string, string> = {};
    if (hash.includes('?')) {
      const hashSearch = hash.split('?')[1];
      const params = new URLSearchParams(hashSearch);
      params.forEach((value, key) => {
        hashParams[key] = value;
      });
    }

    const info = {
      fullUrl,
      pathname: window.location.pathname,
      search,
      hash,
      queryParams: allParams,
      hashParams,
      hasNip55Callback: search.includes('nip55-callback') || hash.includes('nip55-callback'),
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    };

    setDebugInfo(info);

    console.log('🔍 NIP-55 Callback Test Page:', info);
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <h1 className="text-2xl font-bold mb-4">NIP-55 Callback Test</h1>

      <div className="space-y-4">
        <div className="bg-gray-800 p-4 rounded">
          <h2 className="font-bold mb-2">🎯 Is Callback?</h2>
          <p className={`text-2xl font-bold ${debugInfo.hasNip55Callback ? 'text-green-400' : 'text-red-400'}`}>
            {debugInfo.hasNip55Callback ? 'YES - Callback detected!' : 'NO - No callback params'}
          </p>
        </div>

        <div className="bg-gray-800 p-4 rounded">
          <h2 className="font-bold mb-2">Full URL</h2>
          <p className="text-sm break-all font-mono text-green-400">{debugInfo.fullUrl}</p>
        </div>

        <div className="bg-gray-800 p-4 rounded">
          <h2 className="font-bold mb-2">Query Params</h2>
          <pre className="text-xs overflow-auto">{JSON.stringify(debugInfo.queryParams, null, 2)}</pre>
        </div>

        <div className="bg-gray-800 p-4 rounded">
          <h2 className="font-bold mb-2">Hash Params</h2>
          <pre className="text-xs overflow-auto">{JSON.stringify(debugInfo.hashParams, null, 2)}</pre>
        </div>

        <div className="bg-gray-800 p-4 rounded">
          <h2 className="font-bold mb-2">Full Debug Info</h2>
          <pre className="text-xs overflow-auto">{JSON.stringify(debugInfo, null, 2)}</pre>
        </div>

        <div className="bg-blue-900 p-4 rounded">
          <h2 className="font-bold mb-2">📋 Instructions</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Copy this URL</li>
            <li>Open Amber app</li>
            <li>Go to Settings → Connected Apps</li>
            <li>Add a manual connection or test</li>
            <li>Use this URL as the callback: <code className="bg-black p-1 rounded">http://192.168.0.207:3001/test-nip55-callback?nip55-callback=true&requestId=test123&signature=testsig&pubkey=testpubkey</code></li>
            <li>See if Amber can redirect back here</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
