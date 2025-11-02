import { NextRequest, NextResponse } from 'next/server';
import { createErrorLogger } from '@/lib/error-utils';
import { prisma } from '@/lib/prisma';

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

    let matchingFeed: any = null;
    let matchingTrack: any = null;

    // First try to find by specific track if itemGuid provided
    if (itemGuid) {
      matchingTrack = await prisma.track.findFirst({
        where: { guid: itemGuid },
        include: { Feed: true }
      });
      
      if (matchingTrack) {
        matchingFeed = matchingTrack.Feed;
        
        // Check if track has its own V4V data
        if (matchingTrack.v4vValue) {
          try {
            const trackV4V = JSON.parse(matchingTrack.v4vValue);
            if (trackV4V.recipients && trackV4V.recipients.length > 0) {
              const valueTag = {
                type: 'lightning',
                method: 'keysend',
                recipients: trackV4V.recipients.map((recipient: any) => ({
                  name: recipient.name || matchingFeed?.artist || 'Unknown',
                  type: recipient.type === 'lnaddress' ? 'lnaddress' : 'node',
                  address: recipient.address || '',
                  split: parseInt(recipient.split) || 100,
                  fee: false
                }))
              };

              logger.info('Found track-specific value splits', { 
                itemGuid,
                recipientsCount: valueTag.recipients.length
              });

              return NextResponse.json({
                success: true,
                data: valueTag
              });
            }
          } catch (parseError) {
            logger.warn('Failed to parse track V4V data', { itemGuid, error: parseError });
          }
        }
      }
    }

    // Find feed by feedGuid or trackId
    if (!matchingFeed) {
      if (feedGuid) {
        matchingFeed = await prisma.feed.findFirst({
          where: { id: feedGuid }
        });
      }

      // If no feedGuid provided, try to find by trackId pattern
      if (!matchingFeed && trackId) {
        // Try to extract feedGuid from trackId if it follows a pattern
        const trackIdParts = trackId.split('-');
        if (trackIdParts.length >= 2) {
          const possibleFeedGuid = trackIdParts[1];
          matchingFeed = await prisma.feed.findFirst({
            where: { id: possibleFeedGuid }
          });
        }
      }
    }

    // Check if feed has V4V data
    if (matchingFeed && matchingFeed.v4vValue) {
      try {
        const feedV4V = JSON.parse(matchingFeed.v4vValue);
        if (feedV4V.recipients && feedV4V.recipients.length > 0) {
          const valueTag = {
            type: 'lightning',
            method: 'keysend',
            recipients: feedV4V.recipients.map((recipient: any) => ({
              name: recipient.name || matchingFeed?.artist || 'Unknown',
              type: recipient.type === 'lnaddress' ? 'lnaddress' : 'node',
              address: recipient.address || '',
              split: parseInt(recipient.split) || 100,
              fee: false
            }))
          };

          logger.info('Found feed-level value splits', { 
            feedGuid: matchingFeed.id,
            recipientsCount: valueTag.recipients.length
          });

          return NextResponse.json({
            success: true,
            data: valueTag
          });
        }
      } catch (parseError) {
        logger.warn('Failed to parse feed V4V data', { feedGuid: matchingFeed.id, error: parseError });
      }
    }

    // Check for simple lightning address fallback
    const lightningAddress = matchingTrack?.v4vRecipient || matchingFeed?.v4vRecipient;
    if (lightningAddress) {
      const valueTag = {
        type: 'lightning',
        method: 'keysend',
        recipients: [{
          name: matchingFeed?.artist || 'Unknown Artist',
          type: 'lnaddress' as const,
          address: lightningAddress,
          split: 100,
          fee: false
        }]
      };

      logger.info('Found lightning address fallback', { 
        lightningAddress,
        feedGuid: matchingFeed?.id
      });

      return NextResponse.json({
        success: true,
        data: valueTag
      });
    }

    logger.info('No value splits found', { feedGuid, itemGuid, trackId });
    return NextResponse.json({
      success: true,
      data: {
        type: 'lightning',
        method: 'keysend',
        recipients: []
      }
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
