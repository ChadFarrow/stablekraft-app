import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('url');
    
    if (!imageUrl) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing image URL parameter' 
      }, { status: 400 });
    }

    // Validate URL
    let url: URL;
    try {
      url = new URL(imageUrl);
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

    // Fetch the image with better error handling
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
        'Accept': 'image/*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      // Reduce timeout to prevent long-hanging requests
      signal: AbortSignal.timeout(8000), // 8 second timeout
    });

    if (!response.ok) {
      return NextResponse.json({ 
        success: false, 
        error: `Failed to fetch image: ${response.status} ${response.statusText}` 
      }, { status: response.status });
    }

    // Validate that we actually got an image
    const contentType = response.headers.get('content-type');
    const isValidImageType = contentType && contentType.startsWith('image/');
    
    // If content-type is not image/*, check if URL looks like an image file
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const hasImageExtension = imageExtensions.some(ext => imageUrl.toLowerCase().includes(ext));
    
    if (!isValidImageType && !hasImageExtension) {
      return NextResponse.json({ 
        success: false, 
        error: `Invalid content type: ${contentType}. Expected image/* or image file extension` 
      }, { status: 400 });
    }

    // Get the image data
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    // Check if we should enhance the image (for backgrounds, use enhance=true parameter)
    const enhance = searchParams.get('enhance') === 'true';
    const minWidth = parseInt(searchParams.get('minWidth') || '1920');
    const minHeight = parseInt(searchParams.get('minHeight') || '1080');
    
    let processedBuffer = imageBuffer;
    let finalContentType = contentType || 'image/jpeg';
    
    // Enhance image quality for backgrounds if requested
    if (enhance) {
      try {
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        
        // Check if image needs upscaling for background use
        const needsUpscale = metadata.width && metadata.height && 
                            (metadata.width < minWidth || metadata.height < minHeight);
        
        if (needsUpscale && metadata.width && metadata.height) {
          // Upscale image to minimum dimensions while maintaining aspect ratio
          const aspectRatio = metadata.width / metadata.height;
          let targetWidth = minWidth;
          let targetHeight = minHeight;
          
          if (aspectRatio > 1) {
            // Landscape: fit to width
            targetHeight = Math.round(minWidth / aspectRatio);
          } else {
            // Portrait: fit to height
            targetWidth = Math.round(minHeight * aspectRatio);
          }
          
          console.log(`🖼️ Upscaling image from ${metadata.width}x${metadata.height} to ${targetWidth}x${targetHeight}`);
          
          processedBuffer = await image
            .resize(targetWidth, targetHeight, {
              fit: 'fill',
              kernel: sharp.kernel.lanczos3, // High-quality upscaling
              withoutEnlargement: false // Allow upscaling
            })
            .jpeg({ 
              quality: 95, // High quality for backgrounds
              mozjpeg: true 
            })
            .toBuffer();
          
          finalContentType = 'image/jpeg';
        } else if (!metadata.format || metadata.format === 'gif') {
          // For GIFs or unsupported formats, convert to high-quality JPEG for backgrounds
          processedBuffer = await sharp(imageBuffer)
            .jpeg({ 
              quality: 95,
              mozjpeg: true 
            })
            .toBuffer();
          
          finalContentType = 'image/jpeg';
        } else {
          // Just optimize existing image without resizing
          processedBuffer = await sharp(imageBuffer)
            .jpeg({ 
              quality: 95,
              mozjpeg: true 
            })
            .toBuffer();
          
          finalContentType = 'image/jpeg';
        }
      } catch (sharpError) {
        console.warn('⚠️ Sharp processing failed, using original image:', sharpError);
        // Fall back to original buffer if sharp processing fails
        processedBuffer = imageBuffer;
      }
    }

    // Set headers for image serving
    const headers = new Headers();
    // Use detected content-type or inferred type
    if (!isValidImageType) {
      if (imageUrl.toLowerCase().includes('.png')) finalContentType = 'image/png';
      else if (imageUrl.toLowerCase().includes('.gif')) finalContentType = 'image/gif';
      else if (imageUrl.toLowerCase().includes('.webp')) finalContentType = 'image/webp';
      else finalContentType = 'image/jpeg'; // Default fallback
    }
    headers.set('Content-Type', finalContentType);
    headers.set('Content-Length', processedBuffer.length.toString());
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400'); // 1 hour client, 24 hours CDN
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
    headers.set('X-Image-Proxy', 're.podtards.com');
    if (enhance) {
      headers.set('X-Image-Enhanced', 'true');
    }
    headers.set('Vary', 'Accept-Encoding');

    return new NextResponse(processedBuffer, {
      status: 200,
      headers
    });

  } catch (error) {
    console.error('Image proxy error:', error);
    
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ 
        success: false, 
        error: 'Image fetch timeout' 
      }, { status: 408 });
    }

    // Handle DNS resolution errors specifically
    if (error instanceof Error && error.message.includes('ENOTFOUND')) {
      return NextResponse.json({ 
        success: false, 
        error: 'Domain not found - DNS resolution failed' 
      }, { status: 404 });
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