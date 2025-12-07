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
    const cacheDir = path.join(process.cwd(), 'data', 'cache', 'audio');
    const filePath = path.join(cacheDir, `${id}.mp3`);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Audio not found in cache' 
      }, { status: 404 });
    }
    
    // Get file stats
    const stats = fs.statSync(filePath);
    
    // Handle range requests for audio streaming
    const range = request.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      
      const file = fs.createReadStream(filePath, { start, end });
      const headers = new Headers();
      headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Length', chunksize.toString());
      headers.set('Content-Type', 'audio/mpeg');
      headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year
      
      return new NextResponse(file as any, {
        status: 206,
        headers
      });
    }
    
    // Full file request
    const fileBuffer = fs.readFileSync(filePath);
    const headers = new Headers();
    headers.set('Content-Type', 'audio/mpeg');
    headers.set('Content-Length', stats.size.toString());
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year
    headers.set('ETag', `"${stats.mtime.getTime()}"`);
    
    // Update access time
    FeedCache.getCachedUrl('', 'audio', '', 0); // This will update access time
    
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers
    });
    
  } catch (error) {
    console.error('Error serving cached audio:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 