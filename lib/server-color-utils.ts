/**
 * Server-side color extraction utilities using Sharp
 * For use in API routes and server-side processing
 */

import sharp from 'sharp';

interface ColorFrequency {
  [hex: string]: number;
}

interface ColorScore {
  [hex: string]: number;
}

/**
 * Calculate color harmony score based on color theory principles
 * Returns a multiplier (0.5-2.0) for aesthetic appeal
 */
const calculateColorHarmony = (r: number, g: number, b: number): number => {
  // Convert to HSL for better color analysis
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);

  // Calculate hue
  let hue = 0;
  if (max !== min) {
    const delta = max - min;
    switch (max) {
      case r / 255:
        hue = ((g / 255 - b / 255) / delta + (g < b ? 6 : 0)) / 6;
        break;
      case g / 255:
        hue = ((b / 255 - r / 255) / delta + 2) / 6;
        break;
      case b / 255:
        hue = ((r / 255 - g / 255) / delta + 4) / 6;
        break;
    }
  }

  // Prefer warm, pleasant hues (oranges, reds, warm blues)
  const hueScore = (() => {
    const hueDegrees = hue * 360;
    if (hueDegrees >= 0 && hueDegrees <= 60) return 1.8; // Red-Orange (very appealing)
    if (hueDegrees >= 60 && hueDegrees <= 120) return 0.7; // Yellow-Green (often harsh)
    if (hueDegrees >= 120 && hueDegrees <= 180) return 0.8; // Green-Cyan (can be muddy)
    if (hueDegrees >= 180 && hueDegrees <= 240) return 1.4; // Cyan-Blue (pleasant)
    if (hueDegrees >= 240 && hueDegrees <= 300) return 1.0; // Blue-Purple (neutral)
    if (hueDegrees >= 300 && hueDegrees <= 360) return 1.5; // Purple-Red (appealing)
    return 1.0;
  })();

  // Prefer moderate saturation (not too muted, not too intense)
  const saturationScore = saturation > 0.2 && saturation < 0.8 ? 1.5 : 1.0;

  // Prefer medium lightness for backgrounds
  const lightnessScore = lightness > 0.3 && lightness < 0.7 ? 1.4 :
                        lightness > 0.7 ? 0.8 : // Too light
                        0.9; // Too dark

  return Math.min(2.0, hueScore * saturationScore * lightnessScore);
};

/**
 * Convert hex color to RGB object
 */
const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

/**
 * Check if a color provides good contrast for text readability
 * Considers both lightness and color temperature
 */
const hasGoodContrast = (r: number, g: number, b: number): boolean => {
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Avoid very light colors (poor contrast with white text) - more lenient
  if (luminance > 0.85) return false;

  // Avoid very dark colors (poor contrast with light elements) - more lenient
  if (luminance < 0.1) return false;

  // Check for problematic color combinations that hurt readability
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;

  // Very saturated bright colors can be harsh
  if (saturation > 0.9 && luminance > 0.6) return false;

  // Colors that are too close to pure yellow/green (eye strain)
  if (r > 200 && g > 200 && b < 120) return false;
  if (g > 220 && r < 150 && b < 150) return false;

  return true;
};

/**
 * Extract dominant color from an image buffer using Sharp
 */
export const extractDominantColorFromBuffer = async (imageBuffer: Buffer): Promise<string> => {
  try {
    console.log('🎨 Processing image buffer, size:', imageBuffer.length, 'bytes');

    // Resize to reduce processing time while maintaining color accuracy
    const resized = await sharp(imageBuffer)
      .resize(150, 150, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const { width, height, channels } = info;

    console.log('🎨 Sharp processing successful:', { width, height, channels, dataLength: data.length });

    const colorCounts: ColorFrequency = {};
    const vibrantColors: ColorScore = {};

    // Sample pixels to find vibrant colors (every 4th pixel for performance)
    for (let i = 0; i < data.length; i += channels * 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Skip very dark pixels (they make poor backgrounds)
      if (r < 20 && g < 20 && b < 20) continue;

      // Calculate saturation and brightness
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const brightness = max / 255;

      // Skip very unsaturated (gray/muddy) colors
      if (saturation < 0.15 && brightness < 0.6) continue;

      // Advanced color filtering for better aesthetic appeal
      // Skip muddy browns (high red, low green/blue)
      if (r > g && r > b && g < 80 && b < 80 && r > 100) continue;

      // Skip sickly yellows and greens
      if ((r > 200 && g > 200 && b < 100) || (g > 200 && r < 100 && b < 100)) continue;

      // Skip overly purple/magenta backgrounds (poor readability)
      if (r > 150 && b > 150 && g < 100) continue;

      // Convert to hex
      const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
      colorCounts[hex] = (colorCounts[hex] || 0) + 1;

      // Enhanced aesthetic scoring with color harmony rules (less restrictive)
      if (saturation > 0.15 || brightness > 0.25) {
        // Calculate color harmony score
        const harmonyScore = calculateColorHarmony(r, g, b);

        // Base vibrancy score
        const baseVibrancy = saturation * brightness * 100;

        // Balance bonus for ideal ranges (more lenient)
        const balanceBonus = saturation > 0.2 && brightness > 0.2 && brightness < 0.9 ? 1.3 : 1;

        // Warm color bonus (more aesthetically pleasing for backgrounds)
        const warmBonus = (r > g && r > b) || (r > 100 && g > 60) ? 1.2 : 1;

        // Final score combining all factors (ensure we get colors)
        const vibrancyScore = Math.max(1, baseVibrancy * balanceBonus * warmBonus * harmonyScore);
        vibrantColors[hex] = (vibrantColors[hex] || 0) + vibrancyScore;
      }
    }

    // First try to find the most vibrant color
    let dominantColor = '#4F46E5'; // Fallback color
    let maxVibrancy = 0;

    for (const [color, vibrancy] of Object.entries(vibrantColors)) {
      if (vibrancy > maxVibrancy) {
        maxVibrancy = vibrancy;
        dominantColor = color;
      }
    }

    // If no vibrant colors found, fall back to most common color (excluding very dark ones)
    if (maxVibrancy === 0) {
      let maxCount = 0;
      for (const [color, count] of Object.entries(colorCounts)) {
        // Ensure fallback colors also meet basic readability standards
        const rgb = hexToRgb(color);
        if (rgb && hasGoodContrast(rgb.r, rgb.g, rgb.b) && count > maxCount) {
          maxCount = count;
          dominantColor = color;
        }
      }
    }

    // Log the extracted color before contrast check
    console.log('🎨 Extracted raw dominant color:', dominantColor, 'with vibrancy score:', maxVibrancy);

    // Final contrast check - if selected color has poor contrast, use fallback
    // Note: We're more lenient here since colors get brightened later in the pipeline
    const finalRgb = hexToRgb(dominantColor);
    if (finalRgb && !hasGoodContrast(finalRgb.r, finalRgb.g, finalRgb.b)) {
      const luminance = (0.299 * finalRgb.r + 0.587 * finalRgb.g + 0.114 * finalRgb.b) / 255;
      console.log('🎨 Color failed contrast check:', dominantColor, 'luminance:', luminance.toFixed(3));
      // Only reject if VERY extreme (will be brightened later anyway)
      if (luminance > 0.95 || luminance < 0.05) {
        console.log('🎨 Color too extreme, using fallback');
        dominantColor = '#4F46E5';
      } else {
        console.log('🎨 Accepting color despite contrast warning (will be brightened)');
      }
    }

    return dominantColor;
  } catch (error) {
    console.error('Error extracting dominant color from buffer:', error);
    return '#4F46E5'; // Fallback color
  }
};

/**
 * Extract dominant color from image URL by fetching and processing
 */
export const extractDominantColorFromUrl = async (imageUrl: string): Promise<string> => {
  try {
    console.log('🎨 Fetching image for color extraction:', imageUrl);

    // Fetch the image
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ColorExtractor/1.0)',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch image: ${response.status} ${response.statusText}`);
      return '#4F46E5'; // Fallback color
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    return await extractDominantColorFromBuffer(imageBuffer);
  } catch (error) {
    console.error('Error extracting dominant color from URL:', error);
    return '#4F46E5'; // Fallback color
  }
};

/**
 * Extract color palette from image buffer
 */
export const extractColorPaletteFromBuffer = async (imageBuffer: Buffer): Promise<string[]> => {
  try {
    // Resize to reduce processing time
    const resized = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const { channels } = info;

    const colorCounts: ColorFrequency = {};

    // Sample pixels (every 8th pixel for performance)
    for (let i = 0; i < data.length; i += channels * 8) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Skip very dark pixels
      if (r < 30 && g < 30 && b < 30) continue;

      // Convert to hex
      const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
      colorCounts[hex] = (colorCounts[hex] || 0) + 1;
    }

    // Get top 5 colors
    const sortedColors = Object.entries(colorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([color]) => color);

    return sortedColors.length > 0 ? sortedColors : ['#4F46E5', '#374151', '#4b5563'];
  } catch (error) {
    console.error('Error extracting color palette from buffer:', error);
    return ['#4F46E5', '#374151', '#4b5563']; // Fallback palette
  }
};

/**
 * Check if an image URL is likely to work with color extraction
 */
export const isValidImageUrl = (url: string): boolean => {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname.toLowerCase();

    // Check for common image extensions
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    const hasImageExtension = imageExtensions.some(ext => pathname.endsWith(ext));

    // Also accept URLs that might serve images without extensions
    const hasImagePath = pathname.includes('image') || pathname.includes('artwork') || pathname.includes('cover');

    return hasImageExtension || hasImagePath || pathname === '/';
  } catch {
    return false;
  }
};

/**
 * Helper function to brighten colors for better background visibility
 */
export const brightenColorForBackground = (hex: string, percent: number = 40): string => {
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