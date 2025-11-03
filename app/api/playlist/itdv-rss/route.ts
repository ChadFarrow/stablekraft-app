import { NextResponse } from 'next/server';

const GITHUB_FEED_URL = 'https://chadfarrow.github.io/ITDV-music-playlist/doerfel-verse-music.xml';

export async function GET() {
  try {
    console.log('🔄 Fetching ITDV playlist from GitHub Pages...');
    
    // Fetch the XML from GitHub Pages with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const response = await fetch(GITHUB_FEED_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'StableKraft-Music-Site/1.0',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`GitHub feed returned ${response.status}: ${response.statusText}`);
    }
    
    const xmlContent = await response.text();
    console.log('✅ Successfully fetched ITDV playlist from GitHub Pages');
    
    // Return the XML content with proper headers
    return new NextResponse(xmlContent, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
        'X-Data-Source': 'GitHub Pages',
      },
    });
  } catch (error) {
    console.error('Error fetching ITDV playlist from GitHub:', error);
    
    // Fallback to local file if GitHub fetch fails
    try {
      console.log('🔄 Falling back to local ITDV playlist file...');
      const fs = await import('fs');
      const path = await import('path');
      
      const filePath = path.join(process.cwd(), 'public', 'ITDV-playlist.xml');
      const xmlContent = fs.readFileSync(filePath, 'utf-8');
      
      console.log('✅ Using local ITDV playlist as fallback');
      
      return new NextResponse(xmlContent, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=300', // Shorter cache for fallback
          'X-Data-Source': 'Local File (Fallback)',
        },
      });
    } catch (fallbackError) {
      console.error('Fallback to local file also failed:', fallbackError);
      return new NextResponse('Error loading playlist from all sources', { status: 500 });
    }
  }
} 