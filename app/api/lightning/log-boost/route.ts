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
    const { trackId, feedId, trackTitle, artistName, amount, message, type, recipient, preimage } = await req.json();

    if (!trackId || !amount || !type || !recipient) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
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

    console.log('⚡ Boost logged:', boost);

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
