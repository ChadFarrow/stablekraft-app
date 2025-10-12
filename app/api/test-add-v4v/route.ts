import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Add V4V data to The Doerfels feed for testing
    const doerfelsFeed = await prisma.feed.findFirst({
      where: {
        originalUrl: {
          contains: 'doerfelverse.com'
        }
      }
    });

    if (!doerfelsFeed) {
      return NextResponse.json({ error: 'Could not find The Doerfels feed' }, { status: 404 });
    }

    console.log(`Found feed: ${doerfelsFeed.title}`);

    // Update with test V4V data
    await prisma.feed.update({
      where: { id: doerfelsFeed.id },
      data: {
        v4vRecipient: 'lushnessprecious644398@getalby.com', // Test Lightning Address
        v4vValue: {
          recipients: [
            {
              name: 'The Doerfels',
              type: 'lnaddress',
              address: 'lushnessprecious644398@getalby.com',
              split: 100,
              fee: false
            }
          ]
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: `Added V4V data to ${doerfelsFeed.title}`,
      feedId: doerfelsFeed.id
    });
  } catch (error) {
    console.error('Error adding V4V data:', error);
    return NextResponse.json({ error: 'Failed to add V4V data' }, { status: 500 });
  }
}
