import { NextRequest, NextResponse } from 'next/server';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { valueTagParser } from '@/lib/lightning/value-parser';
import axios from 'axios';

// Mock database or external service to get track details and value4value config
async function getTrackValue4ValueConfig(trackId: string) {
  // In a real application, this would fetch from a database or external API
  // For now, we'll use a hardcoded example or fetch a test RSS feed
  const testFeedUrl = 'https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml';
  try {
    const { data: xmlString } = await axios.get(testFeedUrl);
    const parsedData = valueTagParser.parseValueTags(xmlString);
    
    // Return the channel-level value tag for simplicity
    return parsedData.channelValue;
  } catch (error) {
    console.error('Error fetching or parsing test feed for Value4Value:', error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { trackId, amount, message } = await req.json();

    if (!trackId || !amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Invalid trackId or amount' }, { status: 400 });
    }

    const value4ValueConfig = await getTrackValue4ValueConfig(trackId);

    if (!value4ValueConfig || value4ValueConfig.recipients.length === 0) {
      // Fallback to platform's lightning address if no V4V config
      if (LIGHTNING_CONFIG.platform.address) {
        const lnAddress = LIGHTNING_CONFIG.platform.address;
        const { invoice } = await LNURLService.payLightningAddress(lnAddress, amount, message);
        return NextResponse.json({ invoice });
      }
      return NextResponse.json({ error: 'No Value4Value configuration found and no platform lightning address set.' }, { status: 404 });
    }

    // For simplicity, we'll aggregate all recipients into a single keysend or LNURL payment
    // In a real scenario, you might create multiple payments or a more complex keysend
    const totalAmountMilliSats = amount * 1000;
    const recipients = value4ValueConfig.recipients.map(r => ({
      ...r,
      amountMilliSats: Math.round(totalAmountMilliSats * (r.split / 100)),
    }));

    // Example: If using keysend (for a node with a pubkey)
    // This part would need more sophisticated logic to handle different recipient types
    const keysendRecipient = recipients.find(r => r.type === 'node' && r.address);
    if (keysendRecipient && LIGHTNING_CONFIG.platform.nodePublicKey) {
      // This is a simplified example. A real keysend would likely involve
      // sending to multiple recipients or a more complex custom record structure.
      // For now, we'll just send to the primary node if available.
      return NextResponse.json({
        keysend: {
          destination: keysendRecipient.address,
          amount: keysendRecipient.amountMilliSats / 1000, // amount in sats
          customRecords: {
            '7629169': Buffer.from(message).toString('hex'), // Boostagram message
          },
        },
      });
    }

    // Fallback to LNURL for the platform's address if keysend is not fully configured or applicable
    if (LIGHTNING_CONFIG.platform.address) {
      const lnAddress = LIGHTNING_CONFIG.platform.address;
      const { invoice } = await LNURLService.payLightningAddress(lnAddress, amount, message);
      return NextResponse.json({ invoice });
    }

    return NextResponse.json({ error: 'No suitable payment method found for recipients.' }, { status: 500 });

  } catch (error: any) {
    console.error('Lightning boost API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    // TODO: Fetch boost history from database when schema is updated

    return NextResponse.json({
      success: true,
      boosts: [],
      totalAmount: 0,
    });
  } catch (error) {
    console.error('Error fetching boosts:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch boosts',
      },
      { status: 500 }
    );
  }
}