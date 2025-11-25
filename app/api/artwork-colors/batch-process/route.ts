import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const { batchSize = 10, forceReprocess = false, delayMs = 500 } = await request.json();

    console.log(`🎨 Starting batch artwork color processing (batchSize: ${batchSize}, delay: ${delayMs}ms)...`);

    // Get all unique artwork URLs from feeds and tracks
    const feedImages = await prisma.feed.findMany({
      where: {
        image: { not: null },
        status: 'active'
      },
      select: { image: true }
    });

    const trackImages = await prisma.track.findMany({
      where: {
        image: { not: null }
      },
      select: { image: true },
      distinct: ['image']
    });

    // Combine and deduplicate image URLs
    const allImages = new Set<string>();
    feedImages.forEach(feed => {
      if (feed.image) allImages.add(feed.image);
    });
    trackImages.forEach(track => {
      if (track.image) allImages.add(track.image);
    });

    const imageUrls = Array.from(allImages);
    console.log(`🎨 Found ${imageUrls.length} unique artwork URLs`);

    // Filter out already processed images (unless force reprocessing)
    let urlsToProcess = imageUrls;
    if (!forceReprocess) {
      const processedColors = await prisma.artworkColor.findMany({
        select: { imageUrl: true }
      });
      const processedUrls = new Set(processedColors.map(pc => pc.imageUrl));
      urlsToProcess = imageUrls.filter(url => !processedUrls.has(url));
      console.log(`🎨 ${urlsToProcess.length} URLs need processing (${imageUrls.length - urlsToProcess.length} already processed)`);
    }

    if (urlsToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All artwork colors already processed',
        total: imageUrls.length,
        processed: 0,
        skipped: imageUrls.length
      });
    }

    // Process in batches
    const batch = urlsToProcess.slice(0, batchSize);
    const results = {
      total: urlsToProcess.length,
      processed: 0,
      failed: 0,
      batch: batch.length
    };

    console.log(`🎨 Processing batch of ${batch.length} images sequentially with ${delayMs}ms delay...`);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

    // Process images sequentially with delay to prevent overwhelming the server
    for (let i = 0; i < batch.length; i++) {
      const imageUrl = batch[i];
      try {
        const response = await fetch(`${baseUrl}/api/artwork-colors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl,
            forceReprocess
          })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            results.processed++;
            console.log(`✅ [${i + 1}/${batch.length}] Processed: ${imageUrl.substring(0, 60)}...`);
          } else {
            results.failed++;
            console.log(`⚠️ [${i + 1}/${batch.length}] Failed: ${imageUrl.substring(0, 60)}...`);
          }
        } else {
          results.failed++;
          console.log(`❌ [${i + 1}/${batch.length}] HTTP error: ${imageUrl.substring(0, 60)}...`);
        }
      } catch (error) {
        results.failed++;
        console.log(`❌ [${i + 1}/${batch.length}] Error: ${imageUrl.substring(0, 60)}...`);
      }

      // Add delay between requests (except after the last one)
      if (delayMs > 0 && i < batch.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.log(`🎨 Batch complete: ${results.processed} processed, ${results.failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Batch processing complete`,
      results,
      remaining: Math.max(0, urlsToProcess.length - batch.length)
    });

  } catch (error) {
    console.error('❌ Batch processing error:', error);
    return NextResponse.json(
      { error: 'Batch processing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET: Check batch processing status
export async function GET() {
  try {
    // Get statistics
    const totalArtwork = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT image) as count
      FROM (
        SELECT image FROM "Feed" WHERE image IS NOT NULL AND status = 'active'
        UNION
        SELECT image FROM "Track" WHERE image IS NOT NULL
      ) combined
    `;

    const processedCount = await prisma.artworkColor.count();
    const total = Number(totalArtwork[0]?.count || 0);

    return NextResponse.json({
      success: true,
      statistics: {
        totalArtwork: total,
        processed: processedCount,
        remaining: Math.max(0, total - processedCount),
        percentage: total > 0 ? Math.round((processedCount / total) * 100) : 0
      }
    });

  } catch (error) {
    console.error('Error getting batch processing status:', error);
    return NextResponse.json(
      { error: 'Failed to get status' },
      { status: 500 }
    );
  }
}