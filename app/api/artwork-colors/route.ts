import { NextRequest, NextResponse } from 'next/server';
import { ensureGoodContrast } from '@/lib/color-utils';
import {
  brightenColorForBackground,
  extractColorCandidates,
  pickBestBackgroundColor,
  makeBackgroundSuitable,
  ColorConfig,
  DEFAULT_COLOR_CONFIG
} from '@/lib/server-color-utils';
import { prisma } from '@/lib/prisma';
import { resolveArtworkSource, artworkBaseUrl } from '@/lib/artwork-image-source';
import { safeFetch, readCappedArrayBuffer, MAX_IMAGE_BYTES } from '@/lib/safe-fetch';
import { USER_AGENT } from '@/lib/user-agent';

/**
 * The image bytes for `imageUrl`, or null if they cannot be had.
 *
 * Fetches the artwork host DIRECTLY. This used to round-trip through our own
 * /api/proxy-image, which exists solely to work around browser CORS — a rule
 * that does not apply to a server-side fetch. See lib/artwork-image-source.ts
 * for what that hop cost.
 *
 * Never throws: every caller treats null as "keep the fallback colour", which is
 * what the old try/catch around the fetch did.
 */
async function loadArtworkBytes(imageUrl: string): Promise<Buffer | null> {
  const source = resolveArtworkSource(imageUrl, artworkBaseUrl());

  try {
    if (source.kind === 'remote') {
      // allowHttp because real catalog rows carry http:// artwork. safeFetch
      // applies isSafePublicUrl, bounds the redirect chain and sets a timeout.
      const result = await safeFetch(source.url, { allowHttp: true });
      if (!result.ok) {
        console.warn(`🎨 artwork fetch refused: ${result.error} for ${source.url}`);
        return null;
      }
      if (!result.response.ok) {
        console.warn(`🎨 artwork fetch failed: ${result.response.status} for ${source.url}`);
        return null;
      }
      const bytes = await readCappedArrayBuffer(result.response, MAX_IMAGE_BYTES);
      if (!bytes.ok) {
        // Oversized artwork lands here — HGH ships ~19MB animated GIFs. The old
        // path reached the same outcome by a longer road: proxy-image applies
        // the same cap and answers with its placeholder, whose colours were then
        // extracted instead of the artwork's. Falling back honestly is better
        // than extracting the placeholder's palette and presenting it as real.
        console.warn(`🎨 artwork too large: ${bytes.error} for ${source.url}`);
        return null;
      }
      return Buffer.from(bytes.value);
    }

    if (source.kind === 'local') {
      // Our own asset over loopback. safeFetch CANNOT be used: isSafePublicUrl
      // rejects localhost, so it would refuse every local placeholder.
      const response = await fetch(source.url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        // Logged, like the remote branches. Returning null silently here cost a
        // round of debugging: a missing local asset looked identical to
        // extraction simply producing nothing.
        console.warn(`🎨 local artwork fetch failed: ${response.status} for ${source.url}`);
        return null;
      }
      return Buffer.from(await response.arrayBuffer());
    }

    return null;
  } catch (error) {
    console.warn('🎨 artwork fetch threw:', error);
    return null;
  }
}

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

      let originalColor = '#4F46E5';
      let adjustedColor = '#4F46E5';
      let candidates: string[] = [];

      const imageBuffer = await loadArtworkBytes(imageUrl);
      if (imageBuffer) {
        try {
          candidates = await extractColorCandidates(imageBuffer);
          originalColor = pickBestBackgroundColor(candidates);
          adjustedColor = makeBackgroundSuitable(originalColor, config);
        } catch (error) {
          // sharp rejecting the bytes is how a non-image is caught. The URL is
          // not pre-filtered on extension: see lib/artwork-image-source.ts.
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

    console.log('🎨 Extracting color from image:', imageUrl);

    // Default fallback (only used if image fetch completely fails)
    let originalColor = '#4F46E5';
    let adjustedColor = '#4F46E5';

    const imageBuffer = await loadArtworkBytes(imageUrl);
    if (imageBuffer) {
      try {
        // Extract multiple color candidates with minimal filtering
        const candidates = await extractColorCandidates(imageBuffer);
        console.log('🎨 Color candidates:', candidates);

        // Pick the best one for background use
        originalColor = pickBestBackgroundColor(candidates);

        // Always transform to ensure suitability (preserves hue!)
        adjustedColor = makeBackgroundSuitable(originalColor, DEFAULT_COLOR_CONFIG);
        console.log(`🎨 Original: ${originalColor} -> Adjusted: ${adjustedColor}`);
      } catch (error) {
        // sharp rejecting the bytes is how a non-image is caught here.
        console.warn('🎨 Color extraction failed:', error);
        // Keep default fallback
      }
    } else {
      // loadArtworkBytes logs its own reason for a refusal, a bad status or a
      // throw. This covers the remaining case: nothing fetchable in the URL.
      console.warn('🎨 No artwork bytes for:', imageUrl);
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
        id: crypto.randomUUID(),
        imageUrl,
        originalColor,
        enhancedColor,
        backgroundColor: contrastColors.backgroundColor,
        textColor: contrastColors.textColor,
        isAppealing: true,
        updatedAt: new Date()
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