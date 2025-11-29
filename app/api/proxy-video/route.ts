import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return NextResponse.json({ error: 'Video URL parameter required' }, { status: 400 });
  }

  try {
    // Validate URL
    const url = new URL(videoUrl);
    
    // Only allow Cloudflare Stream domain for now
    const allowedDomains = [
      'customer-dlnbepb8zpz7h846.cloudflarestream.com'
    ];
    
    if (!allowedDomains.includes(url.hostname)) {
      return NextResponse.json({ error: 'Domain not allowed' }, { status: 403 });
    }

    console.log(`📺 Proxying video: ${videoUrl}`);

    // Fetch the video/manifest file
    const response = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'DoerfelVerse/1.0 (Video Proxy)',
        'Accept': 'application/vnd.apple.mpegurl, video/*, */*',
        'Origin': 'https://stablekraft.app',
        'Referer': 'https://stablekraft.app/',
      },
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      console.error(`❌ Video fetch failed: ${response.status} ${response.statusText}`);
      return NextResponse.json({ 
        error: 'Failed to fetch video file',
        status: response.status 
      }, { status: response.status });
    }

    // Determine content type
    let contentType = response.headers.get('Content-Type') || 'application/vnd.apple.mpegurl';
    
    // Handle HLS manifest files
    if (videoUrl.includes('.m3u8')) {
      contentType = 'application/vnd.apple.mpegurl';
    }
    
    const contentLength = response.headers.get('Content-Length');
    
    // Create response with proper headers for video streaming
    const proxyResponse = new NextResponse(response.body, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600', // 1 hour for video
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD',
        'Access-Control-Allow-Headers': 'Range, Accept',
        'Accept-Ranges': 'bytes',
      },
    });

    // Copy relevant headers from original response
    if (contentLength) {
      proxyResponse.headers.set('Content-Length', contentLength);
    }
    
    const contentRange = response.headers.get('Content-Range');
    if (contentRange) {
      proxyResponse.headers.set('Content-Range', contentRange);
    }

    console.log(`✅ Video streamed successfully: ${videoUrl} (${contentLength || 'unknown'} bytes)`);
    return proxyResponse;

  } catch (error) {
    console.error('❌ Video proxy error:', error);
    return NextResponse.json({ 
      error: 'Failed to proxy video file',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      'Access-Control-Max-Age': '86400', // 24 hours
    },
  });
}