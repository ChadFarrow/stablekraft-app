import { NextRequest, NextResponse } from 'next/server';
import { ensureGoodContrast } from '@/lib/color-utils';
import {
  brightenColorForBackground,
  isValidImageUrl,
  extractColorCandidates,
  pickBestBackgroundColor,
  makeBackgroundSuitable,
  ColorConfig,
  DEFAULT_COLOR_CONFIG
} from '@/lib/server-color-utils';
import { prisma } from '@/lib/prisma';

// GET: Retrieve processed color for an image URL
// Add ?realtime=true to compute fresh with tuning parameters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('imageUrl');
    const realtime = searchParams.get('realtime') === 'true';

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl parameter is required' }, { status: 400 });
    }

    // REALTIME MODE: Skip cache and compute fresh with tuning parameters
    if (realtime) {
      // Parse tuning parameters from query string
      const config: ColorConfig = {
        brightenPercent: searchParams.get('brighten') ? parseFloat(searchParams.get('brighten')!) : DEFAULT_COLOR_CONFIG.brightenPercent,
        maxLightness: searchParams.get('maxLightness') ? parseFloat(searchParams.get('maxLightness')!) : DEFAULT_COLOR_CONFIG.maxLightness,
        minLightness: searchParams.get('minLightness') ? parseFloat(searchParams.get('minLightness')!) : DEFAULT_COLOR_CONFIG.minLightness,
        maxSaturation: searchParams.get('maxSaturation') ? parseFloat(searchParams.get('maxSaturation')!) : DEFAULT_COLOR_CONFIG.maxSaturation,
        minSaturation: searchParams.get('minSaturation') ? parseFloat(searchParams.get('minSaturation')!) : DEFAULT_COLOR_CONFIG.minSaturation,
        grayscaleThreshold: searchParams.get('grayscaleThreshold') ? parseFloat(searchParams.get('grayscaleThreshold')!) : DEFAULT_COLOR_CONFIG.grayscaleThreshold,
      };

      console.log('🎨 REALTIME mode - config:', config);

      // Get proxied image URL
      const proxiedUrl = imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')
        ? imageUrl
        : `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
      const fullProxiedUrl = proxiedUrl.startsWith('/') ? `${baseUrl}${proxiedUrl}` : proxiedUrl;

      let originalColor = '#4F46E5';
      let adjustedColor = '#4F46E5';
      let candidates: string[] = [];

      if (isValidImageUrl(fullProxiedUrl)) {
        try {
          const response = await fetch(fullProxiedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ColorExtractor/1.0)' },
          });

          if (response.ok) {
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            candidates = await extractColorCandidates(imageBuffer);
            originalColor = pickBestBackgroundColor(candidates);
            adjustedColor = makeBackgroundSuitable(originalColor, config);
          }
        } catch (error) {
          console.warn('🎨 REALTIME extraction failed:', error);
        }
      }

      const enhancedColor = brightenColorForBackground(adjustedColor, config);
      const contrastColors = ensureGoodContrast(enhancedColor);

      return NextResponse.json({
        success: true,
        realtime: true,
        config,
        debug: {
          candidates,
          originalColor,
          adjustedColor,
          enhancedColor,
        },
        data: {
          originalColor,
          enhancedColor,
          backgroundColor: contrastColors.backgroundColor,
          textColor: contrastColors.textColor,
          isAppealing: true
        }
      });
    }

    // NORMAL MODE: Check cache
    const existingColor = await prisma.artworkColor.findUnique({
      where: { imageUrl }
    });

    if (existingColor) {
      return NextResponse.json({
        success: true,
        cached: true,
        data: {
          originalColor: existingColor.originalColor,
          enhancedColor: existingColor.enhancedColor,
          backgroundColor: existingColor.backgroundColor,
          textColor: existingColor.textColor,
          isAppealing: existingColor.isAppealing
        }
      });
    }

    // Color not found in cache
    return NextResponse.json({
      success: false,
      cached: false,
      message: 'Color not found in cache'
    }, { status: 404 });

  } catch (error) {
    console.error('Error retrieving artwork color:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve artwork color' },
      { status: 500 }
    );
  }
}

// POST: Process and store color for an image URL
export async function POST(request: NextRequest) {
  try {
    const { imageUrl, forceReprocess = false } = await request.json();

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
    }

    // Check if color is already processed
    if (!forceReprocess) {
      const existingColor = await prisma.artworkColor.findUnique({
        where: { imageUrl }
      });

      if (existingColor) {
        return NextResponse.json({
          success: true,
          cached: true,
          data: {
            originalColor: existingColor.originalColor,
            enhancedColor: existingColor.enhancedColor,
            backgroundColor: existingColor.backgroundColor,
            textColor: existingColor.textColor,
            isAppealing: existingColor.isAppealing
          }
        });
      }
    }

    // Get proxied image URL for processing
    const proxiedUrl = imageUrl.startsWith('/') || imageUrl.includes('/api/proxy-image')
      ? imageUrl
      : `/api/proxy-image?url=${encodeURIComponent(imageUrl)}`;

    // Convert relative URL to absolute for server-side processing
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    const fullProxiedUrl = proxiedUrl.startsWith('/') ? `${baseUrl}${proxiedUrl}` : proxiedUrl;

    console.log('🎨 Extracting color from image:', fullProxiedUrl);

    // Default fallback (only used if image fetch completely fails)
    let originalColor = '#4F46E5';
    let adjustedColor = '#4F46E5';

    if (isValidImageUrl(fullProxiedUrl)) {
      try {
        // Fetch the image
        const response = await fetch(fullProxiedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ColorExtractor/1.0)' },
        });

        if (response.ok) {
          const imageBuffer = Buffer.from(await response.arrayBuffer());

          // Extract multiple color candidates with minimal filtering
          const candidates = await extractColorCandidates(imageBuffer);
          console.log('🎨 Color candidates:', candidates);

          // Pick the best one for background use
          originalColor = pickBestBackgroundColor(candidates);

          // Always transform to ensure suitability (preserves hue!)
          adjustedColor = makeBackgroundSuitable(originalColor, DEFAULT_COLOR_CONFIG);
          console.log(`🎨 Original: ${originalColor} -> Adjusted: ${adjustedColor}`);
        } else {
          console.warn('🎨 Failed to fetch image:', response.status);
        }
      } catch (error) {
        console.warn('🎨 Color extraction failed:', error);
        // Keep default fallback - only happens on network failure
      }
    } else {
      console.warn('🎨 Invalid image URL format');
    }

    // Apply final brightening for better visibility
    const enhancedColor = brightenColorForBackground(adjustedColor, DEFAULT_COLOR_CONFIG);

    // Get contrast colors for text
    const contrastColors = ensureGoodContrast(enhancedColor);

    // Store in database
    const colorData = await prisma.artworkColor.upsert({
      where: { imageUrl },
      update: {
        originalColor,
        enhancedColor,
        backgroundColor: contrastColors.backgroundColor,
        textColor: contrastColors.textColor,
        isAppealing: true, // Always true with new system
        updatedAt: new Date()
      },
      create: {
        imageUrl,
        originalColor,
        enhancedColor,
        backgroundColor: contrastColors.backgroundColor,
        textColor: contrastColors.textColor,
        isAppealing: true
      }
    });

    console.log('🎨 Stored color in database:', {
      imageUrl,
      originalColor,
      adjustedColor,
      enhancedColor
    });

    return NextResponse.json({
      success: true,
      cached: false,
      processed: true,
      data: {
        originalColor: colorData.originalColor,
        enhancedColor: colorData.enhancedColor,
        backgroundColor: colorData.backgroundColor,
        textColor: colorData.textColor,
        isAppealing: colorData.isAppealing
      }
    });

  } catch (error) {
    console.error('Error processing artwork color:', error);
    return NextResponse.json(
      { error: 'Failed to process artwork color' },
      { status: 500 }
    );
  }
}

// DELETE: Remove color entries (for debugging/reprocessing)
// Use ?all=true to delete all entries, or ?imageUrl=<url> for single entry
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('imageUrl');
    const deleteAll = searchParams.get('all') === 'true';

    // Delete all entries if ?all=true
    if (deleteAll) {
      const result = await prisma.artworkColor.deleteMany({});
      console.log(`🗑️ Deleted all ${result.count} artwork color entries`);
      return NextResponse.json({
        success: true,
        message: `Deleted all artwork color entries`,
        deleted: result.count
      });
    }

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl parameter is required (or use ?all=true to delete all)' }, { status: 400 });
    }

    await prisma.artworkColor.delete({
      where: { imageUrl }
    });

    return NextResponse.json({ success: true, message: 'Color data deleted successfully' });

  } catch (error) {
    console.error('Error deleting artwork color:', error);
    return NextResponse.json(
      { error: 'Failed to delete artwork color' },
      { status: 500 }
    );
  }
}