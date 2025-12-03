import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';

// Size threshold for converting GIFs to video (5MB)
export const GIF_SIZE_THRESHOLD = 5 * 1024 * 1024;

interface ConversionResult {
  mp4: string;
  webm: string;
  mp4Size: number;
  webmSize: number;
  originalSize: number;
}

/**
 * Check if a buffer is a GIF based on magic bytes
 */
export function isGifBuffer(buffer: Buffer): boolean {
  // GIF magic bytes: GIF87a or GIF89a
  return buffer.length >= 6 &&
    buffer[0] === 0x47 && // G
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x38 && // 8
    (buffer[4] === 0x37 || buffer[4] === 0x39) && // 7 or 9
    buffer[5] === 0x61; // a
}

/**
 * Check if a GIF exceeds the size threshold for conversion
 */
export function isLargeGif(buffer: Buffer, threshold = GIF_SIZE_THRESHOLD): boolean {
  return isGifBuffer(buffer) && buffer.length > threshold;
}

/**
 * Convert a GIF file to MP4 format
 */
function convertToMp4(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-movflags', 'faststart',  // Move metadata to beginning for faster web playback
        '-pix_fmt', 'yuv420p',     // Ensure compatibility with all players
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure dimensions are divisible by 2
        '-c:v', 'libx264',         // H.264 codec
        '-crf', '23',              // Quality level (lower = better quality, larger file)
        '-preset', 'medium',       // Encoding speed/quality tradeoff
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Convert a GIF file to WebM format
 */
function convertToWebm(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        '-c:v', 'libvpx-vp9',      // VP9 codec for WebM
        '-crf', '30',              // Quality level for VP9
        '-b:v', '0',               // Variable bitrate mode
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure dimensions are divisible by 2
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Convert a GIF file to both MP4 and WebM video formats
 *
 * @param inputPath - Path to the input GIF file
 * @param outputDir - Directory where video files will be created
 * @returns Object containing paths to the generated MP4 and WebM files
 */
export async function convertGifToVideo(
  inputPath: string,
  outputDir: string
): Promise<ConversionResult> {
  // Validate input file exists and is a GIF
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const inputBuffer = fs.readFileSync(inputPath);
  if (!isGifBuffer(inputBuffer)) {
    throw new Error(`Input file is not a valid GIF: ${inputPath}`);
  }

  const originalSize = inputBuffer.length;

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Generate output filenames
  const baseName = path.basename(inputPath, '.gif');
  const mp4Path = path.join(outputDir, `${baseName}.mp4`);
  const webmPath = path.join(outputDir, `${baseName}.webm`);

  console.log(`Converting ${inputPath} to video formats...`);
  console.log(`  Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);

  // Convert to both formats in parallel
  await Promise.all([
    convertToMp4(inputPath, mp4Path),
    convertToWebm(inputPath, webmPath),
  ]);

  // Get file sizes
  const mp4Size = fs.statSync(mp4Path).size;
  const webmSize = fs.statSync(webmPath).size;

  console.log(`  MP4 size: ${(mp4Size / 1024 / 1024).toFixed(2)} MB (${((1 - mp4Size / originalSize) * 100).toFixed(0)}% reduction)`);
  console.log(`  WebM size: ${(webmSize / 1024 / 1024).toFixed(2)} MB (${((1 - webmSize / originalSize) * 100).toFixed(0)}% reduction)`);

  return {
    mp4: mp4Path,
    webm: webmPath,
    mp4Size,
    webmSize,
    originalSize,
  };
}

/**
 * Check if FFmpeg is available on the system
 */
export function checkFfmpegAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        console.warn('FFmpeg is not available:', err.message);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Convert a GIF buffer to video files
 * Useful when working with downloaded content that hasn't been saved to disk yet
 *
 * @param buffer - GIF buffer to convert
 * @param baseName - Base filename for the output videos (without extension)
 * @param outputDir - Directory where video files will be created
 * @returns Object containing paths to the generated MP4 and WebM files
 */
export async function convertGifBufferToVideo(
  buffer: Buffer,
  baseName: string,
  outputDir: string
): Promise<ConversionResult> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write buffer to temporary GIF file
  const tempGifPath = path.join(outputDir, `${baseName}.gif`);
  fs.writeFileSync(tempGifPath, buffer);

  try {
    // Convert using the file-based function
    return await convertGifToVideo(tempGifPath, outputDir);
  } finally {
    // Note: We keep the GIF file as a fallback
    // If you want to delete it, uncomment the line below:
    // fs.unlinkSync(tempGifPath);
  }
}
