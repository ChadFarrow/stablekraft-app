import { NextRequest, NextResponse } from 'next/server';
import { ensureGoodContrast } from '@/lib/color-utils';
import { extractDominantColorFromUrl, brightenColorForBackground, isValidImageUrl } from '@/lib/server-color-utils';
import { prisma } from '@/lib/prisma';

// Helper function to check if a color is appealing for backgrounds
const isAppealingColor = (hexColor: string): boolean => {
  const rgb = parseInt(hexColor.replace('#', ''), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;

  // Calculate HSL values for better color assessment
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const diff = max - min;

  const lightness = (max + min) / 2;
  const saturation = diff === 0 ? 0 : diff / (1 - Math.abs(2 * lightness - 1));

  // Avoid very dark colors, very muddy colors, and browns/grays
  if (lightness < 0.15) return false; // Too dark
  if (saturation < 0.2) return false; // Too gray/muddy

  // Avoid muddy browns and reddish-browns
  if (r > g && r > b && g < 100 && b < 100) return false; // Muddy reds/browns
  if (r > 120 && g < r * 0.7 && b < r * 0.7) return false; // Brownish tones

  return true;
};

// Helper function to brighten a hex color
const brightenColor = (hex: string, percent: number): string => {
  // Remove # if present
  const color = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);

  // Brighten each component
  const brightenComponent = (component: number): number => {
    // If the component is very dark, boost it much more aggressively
    if (component < 30) {
      return Math.min(255, component + (255 - component) * (percent / 100) + 120);
    }
    // For dark components, still boost significantly
    if (component < 80) {
      return Math.min(255, component + (255 - component) * (percent / 100) + 60);
    }
    // For brighter components, use standard brightening
    return Math.min(255, component + (255 - component) * (percent / 100));
  };

  const newR = Math.round(brightenComponent(r));
  const newG = Math.round(brightenComponent(g));
  const newB = Math.round(brightenComponent(b));

  // Convert back to hex
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
};

// GET: Retrieve processed color for an image URL
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get('imageUrl');

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl parameter is required' }, { status: 400 });
    }

    // Check if color is already processed
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
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const fullProxiedUrl = proxiedUrl.startsWith('/') ? `${baseUrl}${proxiedUrl}` : proxiedUrl;

    console.log('🎨 Extracting color from image:', fullProxiedUrl);

    // Extract actual dominant color from the image
    let originalColor = '#4F46E5'; // Fallback color

    if (isValidImageUrl(fullProxiedUrl)) {
      try {
        originalColor = await extractDominantColorFromUrl(fullProxiedUrl);
        console.log('🎨 Extracted color:', originalColor);
      } catch (error) {
        console.warn('🎨 Color extraction failed, using fallback color:', error);
        // Use deterministic fallback if extraction fails
        const vibrantColors = [
          '#E11D48', '#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6',
          '#EF4444', '#06B6D4', '#84CC16', '#EC4899', '#10B981',
          '#F97316', '#3B82F6', '#8B5CF6', '#14B8A6', '#F59E0B',
          '#DC2626', '#7C3AED', '#059669', '#DB2777', '#2563EB'
        ];
        const urlHash = imageUrl.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
        const colorIndex = Math.abs(urlHash) % vibrantColors.length;
        originalColor = vibrantColors[colorIndex];
      }
    } else {
      console.warn('🎨 Invalid image URL, using deterministic color');
      // Use deterministic fallback for invalid URLs
      const vibrantColors = [
        '#E11D48', '#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6',
        '#EF4444', '#06B6D4', '#84CC16', '#EC4899', '#10B981'
      ];
      const urlHash = imageUrl.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0);
      const colorIndex = Math.abs(urlHash) % vibrantColors.length;
      originalColor = vibrantColors[colorIndex];
    }

    console.log('🎨 Database processing:', { imageUrl, originalColor });

    // Determine if the color is appealing
    const appealing = isAppealingColor(originalColor);
    let finalColor = originalColor;

    // If color is not appealing, use a vibrant fallback
    if (!appealing) {
      const vibrantColors = [
        '#E11D48', '#0EA5E9', '#22C55E', '#F59E0B', '#8B5CF6',
        '#EF4444', '#06B6D4', '#84CC16', '#EC4899', '#10B981'
      ];
      // Use a deterministic selection based on the image URL
      const colorIndex = Math.abs(imageUrl.split('').reduce((a: number, b: string) => a + b.charCodeAt(0), 0)) % vibrantColors.length;
      finalColor = vibrantColors[colorIndex];
      console.log('🎨 Using vibrant fallback:', finalColor, 'for unappealing original:', originalColor);
    }

    // Brighten the color for better background visibility
    const brightenAmount = appealing ? 40 : 70;
    const enhancedColor = brightenColorForBackground(finalColor, brightenAmount);

    // Get contrast colors
    const contrastColors = ensureGoodContrast(enhancedColor);

    // Store in database
    const colorData = await prisma.artworkColor.upsert({
      where: { imageUrl },
      update: {
        originalColor,
        enhancedColor,
        backgroundColor: contrastColors.backgroundColor,
        textColor: contrastColors.textColor,
        isAppealing: appealing,
        updatedAt: new Date()
      },
      create: {
        imageUrl,
        originalColor,
        enhancedColor,
        backgroundColor: contrastColors.backgroundColor,
        textColor: contrastColors.textColor,
        isAppealing: appealing
      }
    });

    console.log('🎨 Stored color in database:', {
      imageUrl,
      originalColor,
      enhancedColor,
      appealing,
      brightenAmount
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