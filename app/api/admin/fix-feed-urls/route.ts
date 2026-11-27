import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { USER_AGENT } from '@/lib/user-agent';

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE_URL = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
  if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
    throw new Error('Podcast Index API credentials not configured');
  }

  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const data4Hash = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiHeaderTime;
  const sha1Algorithm = crypto.createHash('sha1');
  const hash4Header = sha1Algorithm.update(data4Hash).digest('hex');

  return {
    'User-Agent': USER_AGENT,
    'X-Auth-Date': apiHeaderTime.toString(),
    'X-Auth-Key': PODCAST_INDEX_API_KEY,
    'Authorization': hash4Header,
  };
}

async function lookupFeedByGuid(guid: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byguid?guid=${encodeURIComponent(guid)}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 'true' && data.feed) {
      return data.feed;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error looking up by guid ${guid}:`, error);
    return null;
  }
}

async function lookupFeedByUrl(feedUrl: string) {
  try {
    const headers = generateAuthHeaders();
    const url = `${API_BASE_URL}/podcasts/byfeedurl?url=${encodeURIComponent(feedUrl)}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    if (data.status === 'true' && data.feed) {
      return data.feed;
    }

    return null;
  } catch (error) {
    console.error(`❌ Error looking up by url ${feedUrl}:`, error);
    return null;
  }
}

// POST /api/admin/fix-feed-urls - Fix broken feed URLs using Podcast Index
export async function POST() {
  try {
    console.log('🔧 Starting feed URL fix using Podcast Index API...');

    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      return NextResponse.json(
        { error: 'Podcast Index API credentials not configured' },
        { status: 500 }
      );
    }

    // Get all error feeds (with and without GUIDs)
    const errorFeedsWithGuid = await prisma.feed.findMany({
      where: {
        status: 'error',
        guid: { not: null }
      },
      select: {
        id: true,
        guid: true,
        title: true,
        originalUrl: true
      }
    });

    const errorFeedsWithoutGuid = await prisma.feed.findMany({
      where: {
        status: 'error',
        guid: null
      },
      select: {
        id: true,
        guid: true,
        title: true,
        originalUrl: true
      }
    });

    const errorFeeds = errorFeedsWithGuid;
    console.log(`📋 Found ${errorFeedsWithGuid.length} error feeds with GUIDs`);
    console.log(`📋 Found ${errorFeedsWithoutGuid.length} error feeds without GUIDs (will lookup by URL)`);

    let fixedCount = 0;
    let notFoundCount = 0;
    let sameUrlCount = 0;
    let errorCount = 0;
    const results: Array<{ title: string; status: string; oldUrl?: string; newUrl?: string }> = [];

    // Process in batches to avoid rate limiting
    const BATCH_SIZE = 10;
    for (let i = 0; i < errorFeeds.length; i += BATCH_SIZE) {
      const batch = errorFeeds.slice(i, Math.min(i + BATCH_SIZE, errorFeeds.length));

      await Promise.all(batch.map(async (feed) => {
        try {
          if (!feed.guid) return;

          const podcastIndexFeed = await lookupFeedByGuid(feed.guid);

          if (!podcastIndexFeed || !podcastIndexFeed.url) {
            notFoundCount++;
            results.push({ title: feed.title, status: 'not_found_in_podcast_index' });
            return;
          }

          const newUrl = podcastIndexFeed.url;

          // Check if URL is different
          if (newUrl === feed.originalUrl) {
            sameUrlCount++;
            results.push({ title: feed.title, status: 'url_unchanged' });
            return;
          }

          // Update the feed URL and reset status
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              originalUrl: newUrl,
              status: 'active',
              lastError: null,
              updatedAt: new Date()
            }
          });

          fixedCount++;
          results.push({
            title: feed.title,
            status: 'fixed',
            oldUrl: feed.originalUrl,
            newUrl: newUrl
          });
          console.log(`✅ Fixed ${feed.title}: ${feed.originalUrl} → ${newUrl}`);

        } catch (error) {
          errorCount++;
          results.push({
            title: feed.title,
            status: 'error',
            oldUrl: feed.originalUrl
          });
          console.error(`❌ Error processing ${feed.title}:`, error);
        }
      }));

      // Delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < errorFeeds.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Now process feeds WITHOUT GUIDs by looking them up by URL
    console.log(`\n📋 Processing ${errorFeedsWithoutGuid.length} feeds without GUIDs (by URL lookup)...`);

    let urlLookupFixed = 0;
    let urlLookupNotFound = 0;
    let urlLookupGuidAdded = 0;

    for (let i = 0; i < errorFeedsWithoutGuid.length; i += BATCH_SIZE) {
      const batch = errorFeedsWithoutGuid.slice(i, Math.min(i + BATCH_SIZE, errorFeedsWithoutGuid.length));

      await Promise.all(batch.map(async (feed) => {
        try {
          const podcastIndexFeed = await lookupFeedByUrl(feed.originalUrl);

          if (!podcastIndexFeed) {
            urlLookupNotFound++;
            return;
          }

          // Found in Podcast Index! Update with GUID and potentially new URL
          const updates: any = {
            status: 'active',
            lastError: null,
            updatedAt: new Date()
          };

          // Add GUID if we got one
          if (podcastIndexFeed.podcastGuid) {
            updates.guid = podcastIndexFeed.podcastGuid;
            urlLookupGuidAdded++;
          }

          // Update URL if different
          if (podcastIndexFeed.url && podcastIndexFeed.url !== feed.originalUrl) {
            updates.originalUrl = podcastIndexFeed.url;
            urlLookupFixed++;
            results.push({
              title: feed.title,
              status: 'fixed',
              oldUrl: feed.originalUrl,
              newUrl: podcastIndexFeed.url
            });
            console.log(`✅ Fixed (by URL): ${feed.title}`);
          } else {
            // URL same but we found it - reset status
            results.push({ title: feed.title, status: 'found_reset_status' });
          }

          await prisma.feed.update({
            where: { id: feed.id },
            data: updates
          });

        } catch (error) {
          errorCount++;
          console.error(`❌ Error processing ${feed.title}:`, error);
        }
      }));

      // Delay between batches
      if (i + BATCH_SIZE < errorFeedsWithoutGuid.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const summary = {
      success: true,
      message: 'Feed URL fix completed',
      stats: {
        feedsWithGuid: {
          total: errorFeedsWithGuid.length,
          fixed: fixedCount,
          notFound: notFoundCount,
          urlUnchanged: sameUrlCount
        },
        feedsWithoutGuid: {
          total: errorFeedsWithoutGuid.length,
          fixed: urlLookupFixed,
          notFound: urlLookupNotFound,
          guidsAdded: urlLookupGuidAdded
        },
        totalFixed: fixedCount + urlLookupFixed,
        errors: errorCount
      },
      fixedFeeds: results.filter(r => r.status === 'fixed').slice(0, 20)
    };

    console.log('✅ Feed URL fix completed:', summary.stats);

    return NextResponse.json(summary);

  } catch (error) {
    console.error('❌ Feed URL fix error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fix feed URLs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check status
export async function GET() {
  try {
    const errorFeedsWithGuid = await prisma.feed.count({
      where: {
        status: 'error',
        guid: { not: null }
      }
    });

    const errorFeedsWithoutGuid = await prisma.feed.count({
      where: {
        status: 'error',
        guid: null
      }
    });

    return NextResponse.json({
      status: 'ready',
      errorFeeds: {
        withGuid: errorFeedsWithGuid,
        withoutGuid: errorFeedsWithoutGuid,
        total: errorFeedsWithGuid + errorFeedsWithoutGuid
      },
      message: 'POST to this endpoint to fix feed URLs using Podcast Index API'
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Database error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
