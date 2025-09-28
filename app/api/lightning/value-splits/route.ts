import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createErrorLogger } from '@/lib/error-utils';

const logger = createErrorLogger('ValueSplitsAPI');

interface ValueDestination {
  name: string;
  type: 'node' | 'lnaddress';
  address: string;
  split: number;
  fee?: boolean;
  customKey?: string;
  customValue?: string;
}

interface ValueModel {
  type: string;
  method: string;
}

interface FeedValue {
  model: ValueModel;
  destinations: ValueDestination[];
}

interface Feed {
  id: string;
  title: string;
  artist: string;
  feedGuid: string;
  value?: FeedValue;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const feedGuid = searchParams.get('feedGuid');
    const itemGuid = searchParams.get('itemGuid');
    const trackId = searchParams.get('trackId');

    logger.info('Fetching value splits', { feedGuid, itemGuid, trackId });

    // Read feeds.json file
    const feedsPath = path.join(process.cwd(), 'data', 'feeds.json');
    
    if (!fs.existsSync(feedsPath)) {
      return NextResponse.json({
        success: false,
        error: 'Feeds data not found'
      }, { status: 404 });
    }

    const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
    const feeds: Feed[] = feedsData.feeds || [];

    let matchingFeed: Feed | null = null;

    // Find feed by feedGuid
    if (feedGuid) {
      matchingFeed = feeds.find(feed => feed.feedGuid === feedGuid) || null;
    }

    // If no feedGuid provided, try to find by trackId pattern
    if (!matchingFeed && trackId) {
      // Try to extract feedGuid from trackId if it follows a pattern
      const trackIdParts = trackId.split('-');
      if (trackIdParts.length >= 2) {
        const possibleFeedGuid = trackIdParts[1];
        matchingFeed = feeds.find(feed => feed.feedGuid === possibleFeedGuid) || null;
      }
    }

    if (!matchingFeed || !matchingFeed.value) {
      logger.info('No value splits found', { feedGuid, itemGuid, trackId });
      return NextResponse.json({
        success: true,
        data: {
          type: 'lightning',
          method: 'keysend',
          recipients: []
        }
      });
    }

    // Transform feed value data to ValueTag format
    const valueTag = {
      type: matchingFeed.value.model.type,
      method: matchingFeed.value.model.method,
      recipients: matchingFeed.value.destinations.map(dest => ({
        name: dest.name,
        type: dest.type,
        address: dest.address,
        split: dest.split,
        fee: dest.fee || false,
        customKey: dest.customKey,
        customValue: dest.customValue
      }))
    };

    logger.info('Found value splits', { 
      feedGuid, 
      recipientsCount: valueTag.recipients.length,
      recipients: valueTag.recipients.map(r => ({ name: r.name, type: r.type, split: r.split }))
    });

    return NextResponse.json({
      success: true,
      data: valueTag
    });

  } catch (error) {
    logger.error('Error fetching value splits', { 
      error: (error as Error).message 
    });
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}
