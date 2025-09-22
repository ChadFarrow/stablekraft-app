import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: albumId } = await params;
  
  // Redirect to the correct plural endpoint
  return NextResponse.redirect(new URL(`/api/albums/${albumId}`, request.url), 301);
}
