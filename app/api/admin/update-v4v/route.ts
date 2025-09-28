import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: NextRequest) {
  try {
    console.log('🔧 Manually updating V4V data for Beware of Banjo...');
    
    // Update the feed with V4V data
    const feedUpdate = await prisma.feed.update({
      where: { id: 'sir-tj-the-wrathful-beware-of-banjo' },
      data: {
        v4vRecipient: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
        v4vValue: {
          type: 'lightning',
          method: 'keysend',
          recipients: [
            {
              name: 'Sir TJ The Wrathful',
              address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
              type: 'node',
              split: '100'
            },
            {
              name: 'Sovereign Feeds',
              address: 'steven@curiohoster.com',
              type: 'lnaddress',
              fee: 'true',
              split: '5'
            }
          ]
        }
      }
    });
    
    console.log('✅ Updated feed V4V data:', feedUpdate.v4vRecipient);
    
    // Update all tracks with V4V data
    const trackUpdates = await prisma.track.updateMany({
      where: { feedId: 'sir-tj-the-wrathful-beware-of-banjo' },
      data: {
        v4vRecipient: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
        v4vValue: {
          type: 'lightning',
          method: 'keysend',
          suggested: '0.00000005000',
          recipients: [
            {
              name: 'Sir TJ The Wrathful',
              address: '031ce2f133b570edf1c776e571e27d22a715dc6ea73956f0e79f4272d81d9dc0d5',
              type: 'node',
              split: '100'
            },
            {
              name: 'Sovereign Feeds',
              address: 'steven@curiohoster.com',
              type: 'lnaddress',
              fee: 'true',
              split: '5'
            }
          ]
        }
      }
    });
    
    console.log(`✅ Updated ${trackUpdates.count} tracks with V4V data`);
    
    return NextResponse.json({ 
      success: true,
      message: 'V4V data updated successfully',
      feedUpdate: feedUpdate.v4vRecipient,
      trackUpdates: trackUpdates.count
    });
    
  } catch (error: any) {
    console.error('❌ V4V update failed:', error);
    
    return NextResponse.json({ 
      success: false, 
      error: error.message
    }, { status: 500 });
  }
}
