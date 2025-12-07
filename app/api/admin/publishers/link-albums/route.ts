import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/admin/publishers/link-albums
 * Parse a publisher's XML feed and link albums via publisherId
 * Body: { publisherId: string } or { all: true }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { publisherId, all } = body;

    if (!publisherId && !all) {
      return NextResponse.json({
        success: false,
        error: 'Either publisherId or all:true required'
      }, { status: 400 });
    }

    // Get publisher feeds to process
    const publishers = await prisma.feed.findMany({
      where: {
        type: 'publisher',
        status: 'active',
        ...(publisherId ? { id: publisherId } : {})
      },
      select: {
        id: true,
        title: true,
        originalUrl: true
      }
    });

    if (publishers.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No publishers found'
      }, { status: 404 });
    }

    const results: Array<{
      publisherId: string;
      title: string;
      linkedAlbums: number;
      errors: string[];
    }> = [];

    for (const publisher of publishers) {
      const result = {
        publisherId: publisher.id,
        title: publisher.title,
        linkedAlbums: 0,
        errors: [] as string[]
      };

      try {
        // Fetch publisher's XML feed
        const response = await fetch(publisher.originalUrl, {
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          result.errors.push(`Failed to fetch feed: HTTP ${response.status}`);
          results.push(result);
          continue;
        }

        const xmlText = await response.text();

        // Extract podcast:remoteItem tags
        const remoteItemRegex = /<podcast:remoteItem[^>]*>/g;
        const matches = xmlText.match(remoteItemRegex) || [];

        const feedUrls: string[] = [];
        const feedGuids: string[] = [];

        for (const match of matches) {
          const feedUrlMatch = match.match(/feedUrl="([^"]+)"/);
          const feedGuidMatch = match.match(/feedGuid="([^"]+)"/);
          const mediumMatch = match.match(/medium="([^"]+)"/);

          // Skip publisher references
          if (mediumMatch?.[1] === 'publisher') continue;

          if (feedUrlMatch?.[1]) {
            feedUrls.push(feedUrlMatch[1]);
          }
          if (feedGuidMatch?.[1]) {
            feedGuids.push(feedGuidMatch[1]);
          }
        }

        console.log(`📋 Publisher "${publisher.title}": Found ${feedUrls.length} URLs, ${feedGuids.length} GUIDs`);

        // Find matching feeds in database and update publisherId
        if (feedUrls.length > 0 || feedGuids.length > 0) {
          // Build OR conditions
          const conditions: any[] = [];

          for (const url of feedUrls) {
            conditions.push({ originalUrl: url });
          }

          for (const guid of feedGuids) {
            conditions.push({ id: guid });
            conditions.push({ guid: guid });
          }

          // Find and update matching feeds
          const matchingFeeds = await prisma.feed.findMany({
            where: {
              OR: conditions,
              type: { in: ['album', 'music'] },
              status: 'active'
            },
            select: { id: true, title: true }
          });

          console.log(`   Found ${matchingFeeds.length} matching feeds in database`);

          if (matchingFeeds.length > 0) {
            const updateResult = await prisma.feed.updateMany({
              where: {
                id: { in: matchingFeeds.map(f => f.id) }
              },
              data: {
                publisherId: publisher.id
              }
            });

            result.linkedAlbums = updateResult.count;
            console.log(`   ✅ Linked ${updateResult.count} albums to publisher`);
          }
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      }

      results.push(result);
    }

    const totalLinked = results.reduce((sum, r) => sum + r.linkedAlbums, 0);

    return NextResponse.json({
      success: true,
      message: `Processed ${publishers.length} publishers, linked ${totalLinked} albums`,
      results
    });

  } catch (error) {
    console.error('Error linking albums to publishers:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
