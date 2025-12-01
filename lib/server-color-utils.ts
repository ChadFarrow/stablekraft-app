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

// Config for tuning color extraction parameters in real-time
export interface ColorConfig {
  brightenPercent?: number;      // 0-100, default 30
  maxLightness?: number;         // 0-1, default 0.65
  minLightness?: number;         // 0-1, default 0.20
  maxSaturation?: number;        // 0-1, default 0.85
  minSaturation?: number;        // 0-1, default 0.15
  grayscaleThreshold?: number;   // 0-1, default 0.08
}

export const DEFAULT_COLOR_CONFIG: ColorConfig = {
  brightenPercent: 0,
  maxLightness: 0.25,
  minLightness: 0.12,
  maxSaturation: 0.95,
  minSaturation: 0.50,
  grayscaleThreshold: 0.08,
};

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
 * Convert RGB to HSL
 */
const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h, s, l };
};

/**
 * Convert HSL to hex color
 */
const hslToHex = (h: number, s: number, l: number): string => {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Transform any extracted color into a background-suitable version
 * NEVER rejects - always transforms while preserving the hue
 * @param hex - The hex color to transform
 * @param config - Optional tuning parameters
 */
export const makeBackgroundSuitable = (hex: string, config: ColorConfig = {}): string => {
  const cfg = { ...DEFAULT_COLOR_CONFIG, ...config };
  const rgb = hexToRgb(hex);
  if (!rgb) return '#1A252F';

  let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Handle grayscale/B&W artwork specially
  if (s < (cfg.grayscaleThreshold || 0.08)) {
    // Check for subtle color bias in original RGB
    const warmth = (rgb.r - rgb.b) / 255; // positive = warm, negative = cool

    if (Math.abs(warmth) > 0.02) {
      // Has subtle tint - use it with low saturation
      s = cfg.minSaturation || 0.15; // Just enough to be visible
      // h is already set from RGB conversion
    } else {
      // True grayscale - keep neutral
      s = 0;
    }

    // Adjust lightness for readability (0.15-0.35 for grayscale backgrounds)
    l = Math.max(0.15, Math.min(0.35, l));

    return hslToHex(h, s, l);
  }

  // For colored artwork:
  // Adjust lightness to configured range (readable with white text)
  const minL = cfg.minLightness || 0.20;
  const maxL = Math.min(cfg.maxLightness || 0.65, 0.50); // Cap at 0.50 for background suitability

  if (l < minL) {
    l = minL + (l * 0.3); // Min ~minL, preserves relative darkness
  }
  if (l > maxL) {
    l = maxL - ((l - maxL) * 0.3); // Compress into usable range
  }

  // Adjust saturation - not too harsh, not too muted
  if (s > (cfg.maxSaturation || 0.85)) {
    s = cfg.maxSaturation || 0.85;
  }
  if (s < (cfg.minSaturation || 0.15)) {
    s = cfg.minSaturation || 0.15; // Minimum saturation to keep visual interest
  }

  return hslToHex(h, s, l);
};

/**
 * Extract multiple color candidates from image with minimal filtering
 * Returns array sorted by vibrancy score (best first)
 */
export const extractColorCandidates = async (imageBuffer: Buffer): Promise<string[]> => {
  try {
    const resized = await sharp(imageBuffer)
      .resize(150, 150, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const { channels } = info;

    const colorScores: { [hex: string]: number } = {};

    // Sample pixels with MINIMAL filtering
    for (let i = 0; i < data.length; i += channels * 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // ONLY skip truly black pixels (nothing to work with)
      if (r < 10 && g < 10 && b < 10) continue;

      // ONLY skip near-white pixels (poor contrast with white text)
      if (r > 245 && g > 245 && b > 245) continue;

      // Calculate vibrancy score (no hue penalties!)
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const brightness = max / 255;
      const lightness = (max + min) / 2 / 255;

      const hex = `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;

      // Vibrancy scoring - heavily favor saturation to pick vibrant colors
      let score = (saturation * 0.85 + brightness * 0.15) * 100;

      // Penalize very light AND very desaturated colors
      if (lightness > 0.85) score *= 0.3;
      else if (lightness > 0.75 && saturation < 0.5) score *= 0.5;

      // Big bonus for highly saturated colors (neon, vibrant)
      if (saturation > 0.7) score *= 2.0;
      else if (saturation > 0.5) score *= 1.5;

      colorScores[hex] = (colorScores[hex] || 0) + score;
    }

    // Get top 5 distinct colors
    const sortedColors = Object.entries(colorScores)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([color]) => color);

    console.log('🎨 Color candidates extracted:', sortedColors);
    return sortedColors.length > 0 ? sortedColors : ['#4F46E5'];
  } catch (error) {
    console.error('Error extracting color candidates:', error);
    return ['#4F46E5'];
  }
};

/**
 * Pick best color for background from candidates
 * Prefers the most SATURATED colorful candidate (not too dark, not grayscale)
 * This helps pick bright neon colors over glows/washed tones
 */
export const pickBestBackgroundColor = (candidates: string[]): string => {
  const fallback = candidates[0] || '#4F46E5';
  let bestColor = fallback;
  let bestScore = 0;

  for (const color of candidates) {
    const rgb = hexToRgb(color);
    if (!rgb) continue;

    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    // Skip very dark colors (they'll all look black after darkening)
    if (l < 0.15) continue;

    // Skip grayscale colors
    if (s < 0.2) continue;

    // Score based on saturation and brightness - prefer vibrant neon colors
    // Saturation is weighted heavily, lightness gives bonus to brighter colors
    const score = s * 0.7 + l * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }

  const rgb = hexToRgb(bestColor);
  if (rgb) {
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    console.log(`🎨 Picked best candidate: ${bestColor} (h: ${(h * 360).toFixed(0)}°, s: ${s.toFixed(2)}, l: ${l.toFixed(2)}, score: ${bestScore.toFixed(2)})`);
  }

  return bestColor;
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
 * Uses HSL to preserve hue while adjusting lightness
 * @param hex - The hex color to brighten
 * @param config - Optional tuning parameters (uses brightenPercent, maxLightness, maxSaturation)
 */
export const brightenColorForBackground = (hex: string, config: ColorConfig = {}): string => {
  const cfg = { ...DEFAULT_COLOR_CONFIG, ...config };
  const percent = cfg.brightenPercent || 30;
  const maxL = cfg.maxLightness || 0.65;
  const maxS = cfg.maxSaturation || 0.7;

  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  // Convert to HSL to preserve hue
  let { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // Increase lightness by percent, but cap at configured level
  const increase = (percent / 100) * (1 - l);
  l = Math.min(maxL, l + increase);

  // Keep saturation reasonable
  if (s > maxS) s = maxS;

  return hslToHex(h, s, l);
};