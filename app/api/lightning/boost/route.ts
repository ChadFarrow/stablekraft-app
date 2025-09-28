import { NextRequest, NextResponse } from 'next/server';
import { LIGHTNING_CONFIG } from '@/lib/lightning/config';
import { LNURLService } from '@/lib/lightning/lnurl';
import { valueTagParser } from '@/lib/lightning/value-parser';
import { ValueSplitsService } from '@/lib/lightning/value-splits';
import axios from 'axios';

// Get track details and value4value config from database or RSS feed
async function getTrackValue4ValueConfig(trackId: string) {
  try {
    // First try to get from database
    const dbResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/music-tracks/${trackId}`);
    if (dbResponse.ok) {
      const trackData = await dbResponse.json();
      if (trackData.success && trackData.data?.valueForValue) {
        // Convert database V4V data to ValueTag format
        const v4vData = trackData.data.valueForValue;
        if (v4vData.lightningAddress || v4vData.customKey) {
          return {
            type: 'lightning',
            method: 'keysend',
            recipients: [
              {
                name: trackData.data.artist || 'Unknown Artist',
                type: v4vData.lightningAddress ? 'lnaddress' : 'node',
                address: v4vData.lightningAddress || v4vData.customKey || '',
                split: 100,
                fee: false
              }
            ]
          };
        }
      }
    }

    // Fallback to RSS feed parsing
    const testFeedUrl = 'https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml';
    const { data: xmlString } = await axios.get(testFeedUrl);
    const parsedData = valueTagParser.parseValueTags(xmlString);
    
    return parsedData.channelValue;
  } catch (error) {
    console.error('Error fetching track V4V config:', error);
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
        return NextResponse.json({ 
          invoice,
          paymentMethod: 'platform-lightning-address',
          recipient: lnAddress,
          amount 
        });
      }
      return NextResponse.json({ error: 'No Value4Value configuration found and no platform lightning address set.' }, { status: 404 });
    }

    // Validate value splits
    const validation = ValueSplitsService.validateValueSplits(value4ValueConfig.recipients);
    if (!validation.valid) {
      console.error('Invalid value splits:', validation.errors);
      return NextResponse.json({ error: `Invalid value splits: ${validation.errors.join(', ')}` }, { status: 400 });
    }

    // Add platform fee if configured
    const { recipients, totalWithFee } = ValueSplitsService.addPlatformFee(value4ValueConfig.recipients, amount);

    // Calculate split amounts
    const splitAmounts = ValueSplitsService.calculateSplitAmounts(recipients, totalWithFee);

    // For now, return the first recipient's payment details
    // In a full implementation, you might want to return multiple payment instructions
    const primaryRecipient = splitAmounts[0];
    if (!primaryRecipient) {
      return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
    }

    const { recipient, amount: recipientAmount } = primaryRecipient;

    if (recipient.type === 'lnaddress' && LNURLService.isLightningAddress(recipient.address)) {
      // Pay via Lightning Address
      const { invoice } = await LNURLService.payLightningAddress(recipient.address, recipientAmount, message);
      return NextResponse.json({
        invoice,
        paymentMethod: 'lightning-address',
        recipient: recipient.address,
        amount: recipientAmount,
        splits: splitAmounts.map(s => ({
          name: s.recipient.name,
          address: s.recipient.address,
          amount: s.amount,
          type: s.recipient.type
        }))
      });
    } else if (recipient.type === 'node') {
      // Pay via keysend
      return NextResponse.json({
        keysend: {
          destination: recipient.address,
          amount: recipientAmount,
          customRecords: {
            '7629169': Buffer.from(message || '').toString('hex'), // Boostagram message
          },
        },
        paymentMethod: 'keysend',
        recipient: recipient.address,
        amount: recipientAmount,
        splits: splitAmounts.map(s => ({
          name: s.recipient.name,
          address: s.recipient.address,
          amount: s.amount,
          type: s.recipient.type
        }))
      });
    } else {
      return NextResponse.json({ error: `Unsupported recipient type: ${recipient.type}` }, { status: 400 });
    }

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