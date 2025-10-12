import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory storage for testing (replace with database in production)
const boostLog: Array<{
  id: string;
  trackId: string;
  feedId?: string;
  trackTitle?: string;
  artistName?: string;
  amount: number;
  message: string;
  type: string;
  recipient: string;
  preimage?: string;
  timestamp: Date;
}> = [];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Access fields directly from body to avoid destructuring issues
    const trackId = body.trackId;
    const feedId = body.feedId;
    const trackTitle = body.trackTitle;
    const artistName = body.artistName;
    const amount = body.amount;
    const message = body.message;
    const type = body.type;
    const recipient = body.recipient;
    const preimage = body.preimage;

    // Check which required fields are missing
    const missingFields = [];
    if (!trackId || typeof trackId !== 'string' || trackId.trim().length === 0) missingFields.push('trackId');
    if (!amount || amount <= 0) missingFields.push('amount');
    if (!type || typeof type !== 'string' || type.trim().length === 0) missingFields.push('type');
    if (!recipient || typeof recipient !== 'string' || recipient.trim().length === 0) missingFields.push('recipient');
    
    if (missingFields.length > 0) {
      console.error('❌ Missing required fields:', missingFields);
      return NextResponse.json({ 
        error: `Missing required fields: ${missingFields.join(', ')}`,
        received: body 
      }, { status: 400 });
    }

    const boost = {
      id: `boost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      trackId,
      feedId,
      trackTitle,
      artistName,
      amount,
      message: message || '',
      type,
      recipient,
      preimage,
      timestamp: new Date(),
    };

    boostLog.push(boost);

    console.log('⚡ Boost logged successfully:', boost.id);

    return NextResponse.json({
      success: true,
      boostId: boost.id,
      message: 'Boost logged successfully',
    });
  } catch (error) {
    console.error('Error logging boost:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to log boost',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const trackId = searchParams.get('trackId');

    let filteredBoosts = boostLog;

    if (trackId) {
      filteredBoosts = boostLog.filter(boost => boost.trackId === trackId);
    }

    // Sort by timestamp (newest first) and limit results
    const sortedBoosts = filteredBoosts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    const totalAmount = sortedBoosts.reduce((sum, boost) => sum + boost.amount, 0);

    return NextResponse.json({
      success: true,
      boosts: sortedBoosts,
      totalAmount,
      count: sortedBoosts.length,
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
