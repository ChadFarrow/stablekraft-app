import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/**
 * API endpoint to extract the first frame of a GIF as a WebP image
 * This provides a fast-loading placeholder while the full GIF loads
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gifUrl = searchParams.get('url');
    
    if (!gifUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing GIF URL parameter' 
      }, { status: 400 });
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(gifUrl);
    } catch {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid URL format' 
      }, { status: 400 });
    }

    // Only allow HTTPS URLs for security
    if (url.protocol !== 'https:') {
      return NextResponse.json({ 
        success: false, 
        error: 'Only HTTPS URLs are allowed' 
      }, { status: 400 });
    }

    // Validate that it's a GIF
    if (!gifUrl.toLowerCase().includes('.gif') && !gifUrl.toLowerCase().includes('image/gif')) {
      return NextResponse.json({ 
        success: false, 
        error: 'URL must point to a GIF image' 
      }, { status: 400 });
    }

    // Fetch the GIF with timeout
    const response = await fetch(gifUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
        'Accept': 'image/*',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return NextResponse.json({ 
        success: false, 
        error: `Failed to fetch GIF: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    // Get the GIF data
    const gifBuffer = Buffer.from(await response.arrayBuffer());

    // Extract first frame and convert to WebP
    // By setting animated: false, sharp will only process the first frame
    const firstFrame = await sharp(gifBuffer, { 
      animated: false, // Only process first frame
      limitInputPixels: false 
    })
      .webp({ 
        quality: 85,
        effort: 4 
      })
      .toBuffer();

    // Set headers with aggressive caching
    const headers = new Headers();
    headers.set('Content-Type', 'image/webp');
    headers.set('Content-Length', firstFrame.length.toString());
    headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 year
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Image-Type', 'gif-placeholder');
    headers.set('Vary', 'Accept-Encoding');

    return new NextResponse(new Uint8Array(firstFrame), {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('GIF placeholder extraction error:', error);
    
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ 
        success: false, 
        error: 'GIF fetch timeout' 
      }, { status: 408 });
    }

    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

