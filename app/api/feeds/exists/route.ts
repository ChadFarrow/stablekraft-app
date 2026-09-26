import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findFeedIdByUrl } from '@/lib/feed-lookup';
import { isBlacklistedFeedUrl } from '@/lib/feed-exclusions';
import { guidExistsBody } from '@/lib/feeds/exists-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const guid = searchParams.get('guid');

  if (!url && !guid) {
    return NextResponse.json(
      { error: 'url or guid query param is required' },
      { status: 400 }
    );
  }

  if (url && isBlacklistedFeedUrl(url)) {
    return NextResponse.json({ exists: false });
  }

  if (guid) {
    const match = await prisma.feed.findFirst({
      where: { guid },
      select: { id: true, originalUrl: true },
    });
    // Includes the stored URL: the podping service needs one to call
    // refresh-by-url for a podping that named the feed by guid.
    return NextResponse.json(guidExistsBody(match));
  }

  // Shared lookup ladder (exact URL variants → case-insensitive → uuid-in-URL) lives in
  // lib/feed-lookup.ts so this endpoint, POST /api/feeds/refresh-by-url, and
  // POST /api/feeds can't drift apart — divergence between the first two caused the
  // Podhome/UpBeats silent-skip bug.
  const match = await findFeedIdByUrl(url!);

  return NextResponse.json({ exists: Boolean(match) });
}
