import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const { limit = 50, dryRun = false } = await request.json().catch(() => ({}));

    // Get feeds without images (exclude unresolved/invalid feeds)
    const feedsWithoutImages = await prisma.feed.findMany({
      where: {
        type: 'album',
        status: 'active',
        OR: [
          { image: null },
          { image: '' }
        ],
        AND: [
          {
            originalUrl: {
              not: ''
            }
          },
          {
            title: {
              not: {
                startsWith: 'Unresolved'
              }
            }
          }
        ]
      },
      select: {
        id: true,
        title: true,
        originalUrl: true
      },
      take: limit
    });

    console.log(`Found ${feedsWithoutImages.length} feeds without images`);

    const results = {
      total: feedsWithoutImages.length,
      updated: 0,
      failed: 0,
      skipped: 0,
      details: [] as any[]
    };

    for (const feed of feedsWithoutImages) {
      try {
        console.log(`Fetching feed: ${feed.title} (${feed.originalUrl})`);

        // Fetch the RSS feed XML
        const response = await fetch(feed.originalUrl, {
          signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        if (!response.ok) {
          console.warn(`Failed to fetch feed ${feed.title}: ${response.status}`);
          results.failed++;
          results.details.push({
            id: feed.id,
            title: feed.title,
            status: 'failed',
            reason: `HTTP ${response.status}`
          });
          continue;
        }

        const xmlText = await response.text();

        // Try to extract iTunes image
        let imageUrl: string | null = null;

        // Try <itunes:image href="..."> first
        const itunesImageMatch = xmlText.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
        if (itunesImageMatch && itunesImageMatch[1]) {
          imageUrl = itunesImageMatch[1].trim();
        } else {
          // Try <image><url>...</url></image>
          const imageMatch = xmlText.match(/<image>[\s\S]*?<url>([^<]+)<\/url>/i);
          if (imageMatch && imageMatch[1]) {
            imageUrl = imageMatch[1].trim();
          }
        }

        if (!imageUrl) {
          console.warn(`No image found in feed XML for ${feed.title}`);
          results.skipped++;
          results.details.push({
            id: feed.id,
            title: feed.title,
            status: 'skipped',
            reason: 'No image in feed XML'
          });
          continue;
        }

        // Update the database if not dry run
        if (!dryRun) {
          await prisma.feed.update({
            where: { id: feed.id },
            data: { image: imageUrl }
          });
          console.log(`✅ Updated ${feed.title} with image: ${imageUrl}`);
        } else {
          console.log(`[DRY RUN] Would update ${feed.title} with image: ${imageUrl}`);
        }

        results.updated++;
        results.details.push({
          id: feed.id,
          title: feed.title,
          status: 'updated',
          imageUrl: imageUrl
        });

        // Add a small delay to avoid overwhelming servers
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`Error processing feed ${feed.title}:`, error);
        results.failed++;
        results.details.push({
          id: feed.id,
          title: feed.title,
          status: 'failed',
          reason: (error as Error).message
        });
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      results
    }, { status: 200 });

  } catch (error) {
    console.error('Error refreshing missing artwork:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: (error as Error).message },
      { status: 500 }
    );
  }
}
