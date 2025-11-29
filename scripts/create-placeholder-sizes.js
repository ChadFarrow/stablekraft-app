const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sourceImage = '/home/laptop/Downloads/aa199a1c-f50e-489e-9d38-c75dd2f94d1d.png';
const publicDir = path.join(__dirname, '..', 'public');

// Size configurations
const sizes = {
  thumbnail: 150,
  medium: 300,
  large: 600,
  xl: 1200
};

async function createPlaceholderSizes() {
  try {
    // Check if source image exists
    if (!fs.existsSync(sourceImage)) {
      throw new Error(`Source image not found: ${sourceImage}`);
    }

    console.log('Processing placeholder image...');
    
    // Read the source image
    const imageBuffer = fs.readFileSync(sourceImage);
    
    // Create base version (copy original)
    const basePath = path.join(publicDir, 'album-placeholder.png');
    fs.writeFileSync(basePath, imageBuffer);
    console.log('✓ Created base image: album-placeholder.png');

    // Create size variants
    for (const [sizeName, dimension] of Object.entries(sizes)) {
      const outputPath = path.join(publicDir, `album-placeholder-${sizeName}.png`);
      
      await sharp(imageBuffer)
        .resize(dimension, dimension, {
          fit: 'cover',
          position: 'center',
          kernel: sharp.kernel.lanczos3
        })
        .png({ quality: 90, compressionLevel: 9 })
        .toFile(outputPath);
      
      console.log(`✓ Created ${sizeName} size (${dimension}x${dimension}): album-placeholder-${sizeName}.png`);
    }

    console.log('\n✅ All placeholder images created successfully!');
  } catch (error) {
    console.error('❌ Error creating placeholder images:', error);
    process.exit(1);
  }
}

createPlaceholderSizes();

