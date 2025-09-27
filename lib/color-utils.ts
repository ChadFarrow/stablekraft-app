/**
 * Utility functions for extracting colors from images
 */

/**
 * Extract dominant color from an image URL
 */
export const extractDominantColor = async (imageUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve('#1f2937'); // Fallback color
          return;
        }
        
        canvas.width = img.width;
        canvas.height = img.height;
        
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Sample pixels to find vibrant colors
        const colorCounts: { [key: string]: number } = {};
        const vibrantColors: { [key: string]: number } = {};

        // Sample every 8th pixel for better coverage
        for (let i = 0; i < data.length; i += 32) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip transparent pixels
          if (a < 128) continue;

          // Skip very dark pixels (they make poor backgrounds)
          if (r < 20 && g < 20 && b < 20) continue;

          // Skip muddy browns and grays that don't make good backgrounds
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = max === 0 ? 0 : (max - min) / max;
          const brightness = max / 255;

          // Skip very unsaturated (gray/muddy) colors
          if (saturation < 0.15 && brightness < 0.6) continue;

          // Skip muddy browns (high red, low green/blue)
          if (r > g && r > b && g < 80 && b < 80 && r > 100) continue;

          // Convert to hex
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          colorCounts[hex] = (colorCounts[hex] || 0) + 1;

          // Prefer colors that are vibrant, bright, and aesthetically pleasing
          if (saturation > 0.25 || brightness > 0.4) {
            // Boost score for colors with good saturation and brightness balance
            const balanceBonus = saturation > 0.4 && brightness > 0.3 && brightness < 0.8 ? 2 : 1;
            const vibrancyScore = saturation * brightness * 100 * balanceBonus;
            vibrantColors[hex] = (vibrantColors[hex] || 0) + vibrancyScore;
          }
        }

        // First try to find the most vibrant color
        let dominantColor = '#1f2937';
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
            if (count > maxCount) {
              maxCount = count;
              dominantColor = color;
            }
          }
        }
        
        resolve(dominantColor);
      } catch (error) {
        console.warn('Error extracting dominant color:', error);
        resolve('#1f2937'); // Fallback color
      }
    };
    
    img.onerror = () => {
      resolve('#1f2937'); // Fallback color
    };
    
    img.src = imageUrl;
  });
};

/**
 * Generate a color palette from an image
 */
export const generateColorPalette = async (imageUrl: string): Promise<string[]> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          resolve(['#1f2937', '#374151', '#4b5563']); // Fallback palette
          return;
        }
        
        canvas.width = img.width;
        canvas.height = img.height;
        
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Sample pixels to find color palette
        const colors: string[] = [];
        const colorCounts: { [key: string]: number } = {};
        
        // Sample every 20th pixel for performance
        for (let i = 0; i < data.length; i += 80) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          
          // Skip transparent pixels
          if (a < 128) continue;
          
          // Convert to hex
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          colorCounts[hex] = (colorCounts[hex] || 0) + 1;
        }
        
        // Get top 5 colors
        const sortedColors = Object.entries(colorCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([color]) => color);
        
        resolve(sortedColors.length > 0 ? sortedColors : ['#1f2937', '#374151', '#4b5563']);
      } catch (error) {
        console.warn('Error generating color palette:', error);
        resolve(['#1f2937', '#374151', '#4b5563']); // Fallback palette
      }
    };
    
    img.onerror = () => {
      resolve(['#1f2937', '#374151', '#4b5563']); // Fallback palette
    };
    
    img.src = imageUrl;
  });
};

/**
 * Lighten or darken a hex color
 */
export const adjustColorBrightness = (hex: string, percent: number): string => {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;

  return `#${(0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)}`;
};

/**
 * Calculate the relative luminance of a color
 */
export const getColorLuminance = (hex: string): number => {
  const rgb = parseInt(hex.replace('#', ''), 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;

  // Convert to linear RGB
  const [rLinear, gLinear, bLinear] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });

  // Calculate relative luminance
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
};

/**
 * Determine if a color is light or dark based on luminance
 */
export const isColorLight = (hex: string): boolean => {
  return getColorLuminance(hex) > 0.5;
};

/**
 * Get contrasting text color (black or white) for a background color
 */
export const getContrastingTextColor = (backgroundColor: string): string => {
  return isColorLight(backgroundColor) ? '#000000' : '#ffffff';
};

/**
 * Ensure good contrast by darkening light colors or using a dark overlay
 */
export const ensureGoodContrast = (dominantColor: string): { backgroundColor: string; textColor: string } => {
  const isLight = isColorLight(dominantColor);
  
  if (isLight) {
    // For light colors, darken significantly to ensure white text is readable
    const darkerColor = adjustColorBrightness(dominantColor, -60);
    return {
      backgroundColor: darkerColor,
      textColor: '#ffffff'
    };
  } else {
    // For dark colors, use them as-is with white text
    return {
      backgroundColor: dominantColor,
      textColor: '#ffffff'
    };
  }
};