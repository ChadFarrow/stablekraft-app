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

    // Try to upgrade HTTP to HTTPS for security
    let fetchUrl = imageUrl;
    if (url.protocol === 'http:') {
      console.log(`⚠️ HTTP URL detected, attempting HTTPS upgrade: ${imageUrl}`);
      fetchUrl = imageUrl.replace(/^http:/, 'https:');
    }

    // Fetch the image with better error handling
    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PodtardsImageProxy/1.0)',
        'Accept': 'image/*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      // Reduce timeout to prevent long-hanging requests
      signal: AbortSignal.timeout(8000), // 8 second timeout
      redirect: 'follow', // Follow redirects (including HTTP -> HTTPS)
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

    // Get the image data (read once, reuse for validation and processing)
    const arrayBuffer = await response.arrayBuffer();
    
    // Validate buffer before processing
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Received empty image data' 
      }, { status: 400 });
    }
    
    const imageBuffer = Buffer.from(arrayBuffer);
    
    // Quick validation: check for common image file signatures (optional check)
    try {
      const isValidImageSignature = 
        (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8 && imageBuffer[2] === 0xFF) || // JPEG
        (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) || // PNG
        (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46) || // GIF
        (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) || // WebP (RIFF)
        (imageBuffer[0] === 0x3C && imageBuffer[1] === 0x3F && imageBuffer[2] === 0x78 && imageBuffer[3] === 0x6D); // SVG (XML)
      
      // If we have a content-type header saying it's an image, trust it even without signature match
      // (some images might have different signatures or be valid but not match common ones)
      if (!isValidImageSignature && !isValidImageType && imageBuffer.length > 10) {
        console.warn(`⚠️ Image signature validation failed for ${imageUrl}, but proceeding with content-type: ${contentType}`);
      }
    } catch (validationError) {
      console.warn('⚠️ Image validation check failed, proceeding anyway:', validationError);
    }
    
    // Validate buffer size (must be at least a few bytes to be a valid image)
    if (imageBuffer.length < 10) {
      return NextResponse.json({ 
        success: false, 
        error: 'Image data too small to be valid' 
      }, { status: 400 });
    }

    // Check if we should enhance the image (for backgrounds, use enhance=true parameter)
    const enhance = searchParams.get('enhance') === 'true';
    const minWidth = parseInt(searchParams.get('minWidth') || '1920');
    const minHeight = parseInt(searchParams.get('minHeight') || '1080');
    
    let processedBuffer = imageBuffer;
    let finalContentType = contentType || 'image/jpeg';
    
    // Enhance image quality for backgrounds if requested
    if (enhance) {
      try {
        // Validate buffer before passing to sharp
        if (!imageBuffer || imageBuffer.length === 0) {
          throw new Error('Invalid image buffer');
        }
        
        // Try to validate the image can be processed by sharp
        let image: sharp.Sharp;
        try {
          image = sharp(imageBuffer);
        } catch (sharpInitError) {
          throw new Error(`Failed to initialize sharp with image: ${sharpInitError instanceof Error ? sharpInitError.message : 'Unknown error'}`);
        }
        
        const metadata = await image.metadata();
        
        // Validate metadata was retrieved successfully
        if (!metadata) {
          throw new Error('Failed to retrieve image metadata');
        }
        
        // Validate metadata has valid dimensions
        if (!metadata.width || !metadata.height || metadata.width <= 0 || metadata.height <= 0) {
          throw new Error(`Invalid image dimensions: ${metadata.width}x${metadata.height}`);
        }
        
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
          
          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }
          
          finalContentType = 'image/jpeg';
        } else if (!metadata.format || metadata.format === 'gif') {
          // For GIFs or unsupported formats, convert to high-quality JPEG for backgrounds
          processedBuffer = await sharp(imageBuffer)
            .jpeg({ 
              quality: 95,
              mozjpeg: true 
            })
            .toBuffer();
          
          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }
          
          finalContentType = 'image/jpeg';
        } else {
          // Just optimize existing image without resizing
          processedBuffer = await sharp(imageBuffer)
            .jpeg({ 
              quality: 95,
              mozjpeg: true 
            })
            .toBuffer();
          
          // Validate processed buffer
          if (!processedBuffer || processedBuffer.length === 0) {
            throw new Error('Sharp processing returned empty buffer');
          }
          
          finalContentType = 'image/jpeg';
        }
      } catch (sharpError) {
        console.warn('⚠️ Sharp processing failed, using original image:', sharpError);
        // Fall back to original buffer if sharp processing fails, but validate it first
        if (!imageBuffer || imageBuffer.length === 0) {
          return NextResponse.json({ 
            success: false, 
            error: 'Image processing failed and original buffer is invalid' 
          }, { status: 500 });
        }
        processedBuffer = imageBuffer;
      }
    }
    
    // Final validation before returning
    if (!processedBuffer || processedBuffer.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Processed image buffer is invalid or empty' 
      }, { status: 500 });
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