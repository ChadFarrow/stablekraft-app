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
        
        // Sample pixels to find dominant color
        const colorCounts: { [key: string]: number } = {};
        
        // Sample every 10th pixel for performance
        for (let i = 0; i < data.length; i += 40) {
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
        
        // Find most common color
        let dominantColor = '#1f2937';
        let maxCount = 0;
        
        for (const [color, count] of Object.entries(colorCounts)) {
          if (count > maxCount) {
            maxCount = count;
            dominantColor = color;
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