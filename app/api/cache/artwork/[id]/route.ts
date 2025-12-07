import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { FeedCache } from '@/lib/feed-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cacheDir = path.join(process.cwd(), 'data', 'cache', 'artwork');
    const filePath = path.join(cacheDir, `${id}.jpg`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Artwork not found in cache' 
      }, { status: 404 });
    }
    
    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    const stats = fs.statSync(filePath);
    
    // Set headers
    const headers = new Headers();
    headers.set('Content-Type', 'image/jpeg');
    headers.set('Content-Length', stats.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year
    headers.set('ETag', `"${stats.mtime.getTime()}"`);
    
    // Update access time
    FeedCache.getCachedUrl('', 'artwork', '', 0); // This will update access time
    
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('Error serving cached artwork:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 