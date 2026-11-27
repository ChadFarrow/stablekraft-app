import { NextRequest, NextResponse } from 'next/server';
import { USER_AGENT } from '@/lib/user-agent';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing V4V parsing...');
    
    // Test the V4V parsing with the actual RSS feed
    const feedUrl = 'https://www.sirtjthewrathful.com/wp-content/uploads/2023/07/Beware-of-Banjo.xml';
    
    // Fetch the raw XML
    const response = await fetch(feedUrl, { headers: { 'User-Agent': USER_AGENT } });
    const xmlText = await response.text();
    
    console.log('📄 Fetched XML, length:', xmlText.length);
    
    // Test our V4V parsing function
    const { parseV4VFromXML, parseItemV4VFromXML } = await import('../../../../lib/rss-parser-db');
    
    // Test feed-level V4V parsing
    console.log('🔍 Testing feed-level V4V parsing...');
    const feedV4V = parseV4VFromXML(xmlText);
    console.log('✅ Feed V4V result:', feedV4V);
    
    // Test item-level V4V parsing
    console.log('🔍 Testing item-level V4V parsing...');
    const itemV4V = parseItemV4VFromXML(xmlText, 'Morristown Blues');
    console.log('✅ Item V4V result:', itemV4V);
    
    return NextResponse.json({ 
      success: true,
      feedV4V,
      itemV4V,
      xmlLength: xmlText.length,
      message: 'V4V parsing test completed'
    });
    
  } catch (error: any) {
    console.error('❌ V4V parsing test failed:', error);
    
    return NextResponse.json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}
