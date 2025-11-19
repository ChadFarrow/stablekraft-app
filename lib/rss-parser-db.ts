import Parser from 'rss-parser';
import { XMLParser } from 'fast-xml-parser';

interface CustomFeed {
  title?: string;
  description?: string;
  link?: string;
  image?: {
    url?: string;
    title?: string;
    link?: string;
  };
  itunes?: {
    author?: string;
    summary?: string;
    image?: { $?: { href?: string } } | { href?: string } | string;
    explicit?: string;
    categories?: Array<{ $?: { text?: string } }> | string[];
    keywords?: string;
  };
  language?: string;
  items?: CustomItem[];
}

interface CustomItem {
  title?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  link?: string;
  enclosure?: {
    url?: string;
    type?: string;
    length?: string;
  };
  itunes?: {
    author?: string;
    subtitle?: string;
    summary?: string;
    duration?: string;
    explicit?: string;
    keywords?: string;
    image?: string;
    episode?: string;
    season?: string;
  };
  'podcast:chapters'?: any;
  'podcast:value'?: any;
  'podcast:valueTimeSplit'?: any;
}

const parser: Parser<CustomFeed, CustomItem> = new Parser({
  customFields: {
    feed: [
      ['itunes:author', 'itunes.author'],
      ['itunes:summary', 'itunes.summary'],
      ['itunes:image', 'itunes.image'],
      ['itunes:explicit', 'itunes.explicit'],
      ['itunes:category', 'itunes.categories', { keepArray: true }],
      ['itunes:keywords', 'itunes.keywords'],
      'language',
      ['podcast:value', 'podcast:value']
    ] as any,
    item: [
      ['itunes:author', 'itunes.author'],
      ['itunes:subtitle', 'itunes.subtitle'],
      ['itunes:summary', 'itunes.summary'],
      ['itunes:duration', 'itunes.duration'],
      ['itunes:explicit', 'itunes.explicit'],
      ['itunes:keywords', 'itunes.keywords'],
      ['itunes:image', 'itunes.image'],
      ['itunes:episode', 'itunes.episode'],
      ['itunes:season', 'itunes.season'],
      ['podcast:chapters', 'podcast:chapters'],
      ['podcast:value', 'podcast:value'],
      ['podcast:valueTimeSplit', 'podcast:valueTimeSplit']
    ] as any
  }
});

export interface ParsedFeed {
  title: string;
  description?: string;
  image?: string;
  artist?: string;
  language?: string;
  category?: string;
  explicit: boolean;
  podcastGuid?: string;
  items: ParsedItem[];
  v4vRecipient?: string;
  v4vValue?: any;
}

export interface ParsedItem {
  guid?: string;
  title: string;
  subtitle?: string;
  description?: string;
  artist?: string;
  audioUrl: string;
  duration?: number;
  explicit: boolean;
  image?: string;
  publishedAt?: Date;
  itunesAuthor?: string;
  itunesSummary?: string;
  itunesImage?: string;
  itunesDuration?: string;
  itunesKeywords?: string[];
  itunesCategories?: string[];
  v4vRecipient?: string;
  v4vValue?: any;
  startTime?: number;
  endTime?: number;
}

// Helper function to parse V4V data from XML directly
export function parseV4VFromXML(xmlText: string): { recipient: string | null; value: any } {
  try {
    console.log('🔍 DEBUG: Parsing V4V from XML...');
    
    // Look for podcast:value tags (handle both self-closing and with content)
    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const valueMatch = valueRegex.exec(xmlText);
    
    if (!valueMatch) {
      console.log('ℹ️ DEBUG: No podcast:value tags found in XML');
      return { recipient: null, value: null };
    }
    
    console.log('🔍 DEBUG: Found podcast:value tag:', valueMatch[0]);
    
    const valueContent = valueMatch[1]; // Content between tags
    const typeMatch = valueMatch[0].match(/type="([^"]*)"/);
    const methodMatch = valueMatch[0].match(/method="([^"]*)"/);
    
    console.log('🔍 DEBUG: Type:', typeMatch ? typeMatch[1] : 'not found');
    console.log('🔍 DEBUG: Method:', methodMatch ? methodMatch[1] : 'not found');
    
    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags)
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
    const recipients = [];
    let match;
    
    while ((match = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = match[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const typeMatch = recipientTag.match(/type="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const feeMatch = recipientTag.match(/fee="([^"]*)"/);
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        type: typeMatch ? typeMatch[1] : 'node',
        split: splitMatch ? splitMatch[1] : '100',
        fee: feeMatch ? feeMatch[1] : null
      };
      
      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }
    
    if (recipients.length > 0) {
      // Filter out fee recipients (Podcastindex.org fee injection)
      const nonFeeRecipients = recipients.filter(r => r.fee !== 'true');

      // Use the first recipient with split="100" (usually the artist)
      const primaryRecipient = nonFeeRecipients.find(r => r.split === '100') || nonFeeRecipients[0];

      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      console.log('✅ DEBUG: Filtered out fee recipients, remaining:', nonFeeRecipients.length);

      return {
        recipient: primaryRecipient.address,
        value: {
          type: typeMatch ? typeMatch[1] : 'lightning',
          method: methodMatch ? methodMatch[1] : 'keysend',
          recipients: nonFeeRecipients
        }
      };
    }
    
    console.log('⚠️ DEBUG: No recipients found in podcast:value');
    return { recipient: null, value: null };
  } catch (error) {
    console.error('Error parsing V4V from XML:', error);
    return { recipient: null, value: null };
  }
}

// Helper function to extract podcast:guid from channel level
export function parsePodcastGuidFromXML(xmlText: string): string | null {
  try {
    // Extract channel section from XML
    const channelMatch = xmlText.match(/<channel[^>]*>(.*?)<\/channel>/s);
    if (!channelMatch) {
      return null;
    }

    const channelContent = channelMatch[1];

    // Look for podcast:guid tag at channel level (not in items)
    // We need to extract it before the first <item> tag
    const beforeItems = channelContent.split(/<item[\s>]/)[0];
    const guidRegex = /<podcast:guid>([^<]+)<\/podcast:guid>/;
    const guidMatch = beforeItems.match(guidRegex);

    if (guidMatch && guidMatch[1]) {
      console.log('✅ Found podcast:guid:', guidMatch[1]);
      return guidMatch[1].trim();
    }

    return null;
  } catch (error) {
    console.error('Error extracting podcast:guid from XML:', error);
    return null;
  }
}

// Helper function to parse V4V data for a specific item from XML
export function parseItemV4VFromXML(xmlText: string, itemTitle: string): { recipient: string | null; value: any } {
  try {
    console.log(`🔍 DEBUG: Parsing V4V for item "${itemTitle}" from XML...`);
    
    // Find the specific item by looking for the title
    const itemRegex = new RegExp(`<item[^>]*>.*?<title>${itemTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>.*?</item>`, 'gs');
    const itemMatch = itemRegex.exec(xmlText);
    
    if (!itemMatch) {
      console.log(`ℹ️ DEBUG: Item "${itemTitle}" not found in XML`);
      return { recipient: null, value: null };
    }
    
    const itemContent = itemMatch[0];
    console.log(`🔍 DEBUG: Found item content for "${itemTitle}"`);
    
    // Look for podcast:value tags within this specific item
    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const valueMatch = valueRegex.exec(itemContent);
    
    if (!valueMatch) {
      console.log(`ℹ️ DEBUG: No podcast:value tags found in item "${itemTitle}"`);
      return { recipient: null, value: null };
    }
    
    console.log(`🔍 DEBUG: Found podcast:value tag in item "${itemTitle}":`, valueMatch[0]);
    
    const valueContent = valueMatch[1];
    const typeMatch = valueMatch[0].match(/type="([^"]*)"/);
    const methodMatch = valueMatch[0].match(/method="([^"]*)"/);
    
    console.log('🔍 DEBUG: Type:', typeMatch ? typeMatch[1] : 'not found');
    console.log('🔍 DEBUG: Method:', methodMatch ? methodMatch[1] : 'not found');
    
    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags)
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
    const recipients = [];
    let match;
    
    while ((match = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = match[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const typeMatch = recipientTag.match(/type="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const feeMatch = recipientTag.match(/fee="([^"]*)"/);
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        type: typeMatch ? typeMatch[1] : 'node',
        split: splitMatch ? splitMatch[1] : '100',
        fee: feeMatch ? feeMatch[1] : null
      };
      
      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }
    
    if (recipients.length > 0) {
      // Filter out fee recipients (Podcastindex.org fee injection)
      const nonFeeRecipients = recipients.filter(r => r.fee !== 'true');

      // Use the first recipient with split="100" (usually the artist)
      const primaryRecipient = nonFeeRecipients.find(r => r.split === '100') || nonFeeRecipients[0];

      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      console.log('✅ DEBUG: Filtered out fee recipients, remaining:', nonFeeRecipients.length);

      return {
        recipient: primaryRecipient.address,
        value: {
          type: typeMatch ? typeMatch[1] : 'lightning',
          method: methodMatch ? methodMatch[1] : 'keysend',
          recipients: nonFeeRecipients
        }
      };
    }
    
    console.log(`⚠️ DEBUG: No recipients found in podcast:value for item "${itemTitle}"`);
    return { recipient: null, value: null };
  } catch (error) {
    console.error(`Error parsing V4V for item "${itemTitle}" from XML:`, error);
    return { recipient: null, value: null };
  }
}

function extractItunesImage(itunesImage: any): string | undefined {
  if (!itunesImage) return undefined;
  
  if (typeof itunesImage === 'string') {
    return itunesImage;
  }
  
  if (itunesImage.$ && itunesImage.$.href) {
    return itunesImage.$.href;
  }
  
  if (itunesImage.href) {
    return itunesImage.href;
  }
  
  return undefined;
}

function extractItunesCategories(categories: any): string[] {
  if (!categories) return [];
  
  const result: string[] = [];
  
  if (Array.isArray(categories)) {
    categories.forEach(cat => {
      if (!cat) return; // Skip null/undefined items
      if (typeof cat === 'string') {
        result.push(cat);
      } else if (cat && cat.$ && cat.$.text) {
        result.push(cat.$.text);
      }
    });
  }
  
  return result;
}

function parseDuration(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  
  // Handle HH:MM:SS format
  if (duration.includes(':')) {
    const parts = duration.split(':').map(p => parseInt(p, 10));
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }
  
  // Handle seconds as string
  const seconds = parseInt(duration, 10);
  return isNaN(seconds) ? undefined : seconds;
}

function parseKeywords(keywords: string | undefined): string[] {
  if (!keywords) return [];
  return keywords.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

export async function parseRSSFeed(feedUrl: string): Promise<ParsedFeed> {
  try {
    console.log(`🔍 Parsing RSS feed: ${feedUrl}`);
    
    // Fetch the raw XML first for direct V4V parsing
    const response = await fetch(feedUrl);
    let xmlText = await response.text();
    
    // Fix common XML typos that break parsing
    xmlText = xmlText.replace(/endcoding=/gi, 'encoding=');
    
    // Parse V4V data directly from XML
    const v4vData = parseV4VFromXML(xmlText);
    console.log('🔍 DEBUG: Direct XML V4V parsing result:', v4vData);

    // Extract podcast:guid from channel level
    const podcastGuid = parsePodcastGuidFromXML(xmlText);

    // Now parse with the RSS parser
    // Since rss-parser doesn't support parseString in Node.js, we'll use parseURL
    // The XML typo fix above helps, but parseURL will fetch again
    // So we need to ensure the typo is fixed server-side or use a workaround
    let feed;
    try {
      // Try to use parseString if available (some versions support it)
      if (typeof (parser as any).parseString === 'function') {
        feed = await (parser as any).parseString(xmlText);
      } else {
        // Use parseURL - it will fetch the original URL which still has the typo
        // But many XML parsers are lenient and will handle "endcoding" as "encoding"
        feed = await parser.parseURL(feedUrl);
      }
    } catch (parseError) {
      // If parsing fails, the error is likely due to the $ property access issue
      // which we've fixed in the code above, but the server needs to reload
      console.error('RSS parsing error (server may need restart):', parseError);
      throw parseError;
    }
    console.log('🔍 DEBUG: RSS parser completed, processing items...');
    
    // Extract feed-level metadata
    const feedImage = extractItunesImage(feed.itunes?.image) || 
                     feed.image?.url || 
                     undefined;
    
    const feedArtist = feed.itunes?.author || undefined;
    const feedCategories = extractItunesCategories(feed.itunes?.categories);
    const feedExplicit = feed.itunes?.explicit?.toLowerCase() === 'yes' || 
                        feed.itunes?.explicit?.toLowerCase() === 'true';
    
    // Parse items
    const items: ParsedItem[] = [];
    
    if (feed.items) {
      console.log(`🔍 DEBUG: Processing ${feed.items.length} total items from RSS feed...`);
      let skippedCount = 0;
      let videoSkippedCount = 0;
      for (const item of feed.items) {
        // Skip items without enclosures
        if (!item.enclosure?.url) {
          skippedCount++;
          continue;
        }
        
        // Skip video streams (HLS, MP4, etc.) - only include audio
        const enclosureType = item.enclosure.type?.toLowerCase() || '';
        const enclosureUrl = item.enclosure.url.toLowerCase();
        if (
          enclosureType.includes('video') ||
          enclosureType.includes('mpegurl') ||
          enclosureType.includes('x-mpegurl') ||
          enclosureUrl.includes('.m3u8') ||
          enclosureUrl.includes('cloudflarestream.com')
        ) {
          console.log(`⏭️  Skipping video item: ${item.title || 'Untitled'}`);
          videoSkippedCount++;
          continue;
        }
        
        const parsedItem: ParsedItem = {
          guid: item.guid || undefined,
          title: item.title || 'Untitled',
          subtitle: item.itunes?.subtitle || undefined,
          description: item.contentSnippet || item.content || undefined,
          artist: item.itunes?.author || feedArtist,
          audioUrl: item.enclosure.url,
          duration: parseDuration(item.itunes?.duration),
          explicit: item.itunes?.explicit?.toLowerCase() === 'yes' || 
                   item.itunes?.explicit?.toLowerCase() === 'true' ||
                   feedExplicit,
          image: extractItunesImage(item.itunes?.image) || feedImage,
          publishedAt: item.isoDate ? new Date(item.isoDate) : 
                      item.pubDate ? new Date(item.pubDate) : undefined,
          itunesAuthor: item.itunes?.author,
          itunesSummary: item.itunes?.summary,
          itunesImage: extractItunesImage(item.itunes?.image),
          itunesDuration: item.itunes?.duration,
          itunesKeywords: parseKeywords(item.itunes?.keywords),
          itunesCategories: feedCategories // Inherit from feed
        };
        
        // Parse V4V (Value for Value) information if present
        // First try to parse from the raw XML for this specific item
        const itemV4vData = parseItemV4VFromXML(xmlText, item.title || '');
        
        if (itemV4vData.recipient) {
          parsedItem.v4vRecipient = itemV4vData.recipient;
          parsedItem.v4vValue = itemV4vData.value;
          console.log('✅ DEBUG: Set item v4vRecipient from XML:', parsedItem.v4vRecipient);
        } else if (item['podcast:value']) {
          console.log('🔍 DEBUG: Found podcast:value in item:', JSON.stringify(item['podcast:value'], null, 2));
          const valueData = item['podcast:value'];
          
          // Handle nested podcast:valueRecipient elements
          if (valueData['podcast:valueRecipient']) {
            console.log('🔍 DEBUG: Found nested podcast:valueRecipient:', JSON.stringify(valueData['podcast:valueRecipient'], null, 2));
            const recipients = Array.isArray(valueData['podcast:valueRecipient']) 
              ? valueData['podcast:valueRecipient'] 
              : [valueData['podcast:valueRecipient']];
            
            // Use the first recipient (usually the artist)
            const primaryRecipient = recipients.find(r => (r.$ && r.$.split === '100') || (r.split === '100')) || recipients[0];
            
            if (primaryRecipient) {
              // Handle both $ attribute format and direct attribute format
              const recipientData = primaryRecipient.$ || primaryRecipient;
              if (recipientData.address) {
                parsedItem.v4vRecipient = recipientData.address;
                parsedItem.v4vValue = {
                  type: (valueData.$?.type || valueData.type || 'lightning'),
                  method: (valueData.$?.method || valueData.method || 'keysend'),
                  recipients: recipients
                    .filter(r => {
                      const rData = r.$ || r;
                      // Filter out fee recipients (Podcastindex.org fee injection)
                      return rData.fee !== 'true';
                    })
                    .map(r => {
                      const rData = r.$ || r;
                      return {
                        name: rData.name,
                        address: rData.address,
                        type: rData.type || 'node',
                        split: rData.split || '100',
                        fee: rData.fee
                      };
                    })
                };
                console.log('✅ DEBUG: Set v4vRecipient to:', parsedItem.v4vRecipient);
                console.log('✅ DEBUG: Filtered out fee recipients, remaining:', parsedItem.v4vValue.recipients.length);
              }
            }
          } else if (valueData.recipient) {
            // Handle simple recipient format
            parsedItem.v4vRecipient = valueData.recipient;
            parsedItem.v4vValue = valueData;
            console.log('✅ DEBUG: Set v4vRecipient to (simple):', parsedItem.v4vRecipient);
          } else {
            console.log('⚠️ DEBUG: No recipients found in podcast:value');
          }
        } else if ((item as any)['podcast:valueRecipient']) {
          console.log('🔍 DEBUG: Found standalone podcast:valueRecipient:', JSON.stringify((item as any)['podcast:valueRecipient'], null, 2));
          // Handle podcast:valueRecipient format (common in some feeds)
          const recipient = (item as any)['podcast:valueRecipient'];
          if (recipient.$) {
            // Extract Lightning address or node pubkey from the recipient object
            parsedItem.v4vRecipient = recipient.$.address || recipient.$.name;
            parsedItem.v4vValue = {
              recipient: recipient.$.address || recipient.$.name,
              type: recipient.$.type || 'node',
              split: recipient.$.split || '100'
            };
            console.log('✅ DEBUG: Set v4vRecipient to (standalone):', parsedItem.v4vRecipient);
          }
        } else {
          console.log('ℹ️ DEBUG: No V4V data found in item');
        }
        
        // Parse time segments if present (for music segments in podcasts)
        if (item['podcast:chapters']) {
          // This would need more complex parsing based on the chapters format
          // For now, we'll leave it as a placeholder
        }
        
        items.push(parsedItem);
      }
      
      console.log(`✅ DEBUG: Parsed ${items.length} audio items from feed (skipped ${skippedCount} without enclosures, ${videoSkippedCount} video items)`);
    }
    
    // Parse feed-level V4V data
    let feedV4vRecipient = null;
    let feedV4vValue = null;
    
    // Use direct XML parsing result if available
    if (v4vData.recipient) {
      feedV4vRecipient = v4vData.recipient;
      feedV4vValue = v4vData.value;
      console.log('✅ DEBUG: Using direct XML V4V data:', { recipient: feedV4vRecipient, value: feedV4vValue });
    } else {
      console.log('🔍 DEBUG: Checking feed-level V4V data from RSS parser...');
      console.log('🔍 DEBUG: feed object keys:', Object.keys(feed));
      
      if ((feed as any)['podcast:value']) {
        console.log('🔍 DEBUG: Found podcast:value in feed:', JSON.stringify((feed as any)['podcast:value'], null, 2));
        const valueData = (feed as any)['podcast:value'];
        
        // Handle nested podcast:valueRecipient elements
        if (valueData['podcast:valueRecipient']) {
          console.log('🔍 DEBUG: Found nested podcast:valueRecipient in feed:', JSON.stringify(valueData['podcast:valueRecipient'], null, 2));
          const recipients = Array.isArray(valueData['podcast:valueRecipient']) 
            ? valueData['podcast:valueRecipient'] 
            : [valueData['podcast:valueRecipient']];
          
          // Use the first recipient (usually the artist)
          const primaryRecipient = recipients.find(r => (r.$ && r.$.split === '100') || (r.split === '100')) || recipients[0];
          
          if (primaryRecipient) {
            // Handle both $ attribute format and direct attribute format
            const recipientData = primaryRecipient.$ || primaryRecipient;
            if (recipientData.address) {
              feedV4vRecipient = recipientData.address;
              feedV4vValue = {
                type: (valueData.$?.type || valueData.type || 'lightning'),
                method: (valueData.$?.method || valueData.method || 'keysend'),
                recipients: recipients
                  .filter(r => {
                    const rData = r.$ || r;
                    // Filter out fee recipients (Podcastindex.org fee injection)
                    return rData.fee !== 'true';
                  })
                  .map(r => {
                    const rData = r.$ || r;
                    return {
                      name: rData.name,
                      address: rData.address,
                      type: rData.type || 'node',
                      split: rData.split || '100',
                      fee: rData.fee
                    };
                  })
              };
              console.log('✅ DEBUG: Set feed v4vRecipient to:', feedV4vRecipient);
              console.log('✅ DEBUG: Filtered out fee recipients, remaining:', feedV4vValue.recipients.length);
            }
          }
        }
      } else {
        console.log('ℹ️ DEBUG: No feed-level podcast:value found');
      }
    }
    
    return {
      title: feed.title || 'Untitled Feed',
      description: feed.description || feed.itunes?.summary,
      image: feedImage,
      artist: feedArtist,
      language: feed.language,
      category: feedCategories[0], // Take first category as primary
      explicit: feedExplicit,
      podcastGuid: podcastGuid || undefined,
      items,
      v4vRecipient: feedV4vRecipient,
      v4vValue: feedV4vValue
    };
  } catch (error) {
    console.error('Error parsing RSS feed:', error);
    throw new Error(`Failed to parse RSS feed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Helper function to parse music segments from podcast RSS feeds
export async function parseMusicSegments(feedUrl: string): Promise<ParsedItem[]> {
  try {
    const xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });
    
    const response = await fetch(feedUrl);
    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);
    
    const items: ParsedItem[] = [];
    const channel = parsed.rss?.channel || parsed.feed;
    
    if (!channel) {
      throw new Error('Invalid RSS/Atom feed structure');
    }
    
    const feedItems = channel.item || channel.entry || [];
    
    for (const item of Array.isArray(feedItems) ? feedItems : [feedItems]) {
      // Look for remote items (music segments in podcasts)
      if (item['podcast:remoteItem']) {
        const remoteItems = Array.isArray(item['podcast:remoteItem']) 
          ? item['podcast:remoteItem'] 
          : [item['podcast:remoteItem']];
        
        for (const remoteItem of remoteItems) {
          const segment: ParsedItem = {
            guid: remoteItem['@_guid'] || remoteItem.guid,
            title: remoteItem.title || 'Music Segment',
            artist: remoteItem.artist || remoteItem['@_artist'],
            audioUrl: remoteItem['@_enclosureUrl'] || remoteItem.enclosureUrl || item.enclosure?.['@_url'],
            startTime: parseFloat(remoteItem['@_startTime'] || remoteItem.startTime || '0'),
            endTime: remoteItem['@_endTime'] ? parseFloat(remoteItem['@_endTime']) : undefined,
            duration: remoteItem['@_duration'] ? parseFloat(remoteItem['@_duration']) : undefined,
            image: remoteItem['@_image'] || remoteItem.image,
            explicit: false,
            publishedAt: item.pubDate ? new Date(item.pubDate) : undefined
          };
          
          // Parse V4V info if present
          if (remoteItem['podcast:value'] || remoteItem['@_value']) {
            segment.v4vValue = remoteItem['podcast:value'] || remoteItem['@_value'];
          }
          
          items.push(segment);
        }
      }
      
      // Also check for valueTimeSplit which might contain music segments
      if (item['podcast:valueTimeSplit']) {
        const splits = Array.isArray(item['podcast:valueTimeSplit']) 
          ? item['podcast:valueTimeSplit'] 
          : [item['podcast:valueTimeSplit']];
        
        for (const split of splits) {
          if (split['podcast:remoteItem']) {
            const remoteItem = split['podcast:remoteItem'];
            const segment: ParsedItem = {
              guid: remoteItem['@_guid'] || remoteItem.guid,
              title: remoteItem.title || split['@_title'] || 'Music Segment',
              artist: remoteItem.artist || remoteItem['@_artist'],
              audioUrl: item.enclosure?.['@_url'] || item.enclosure?.url,
              startTime: parseFloat(split['@_startTime'] || '0'),
              endTime: split['@_endTime'] ? parseFloat(split['@_endTime']) : undefined,
              duration: split['@_duration'] ? parseFloat(split['@_duration']) : undefined,
              image: remoteItem['@_image'] || remoteItem.image,
              explicit: false,
              publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
              v4vValue: split['podcast:value'] || split['@_value']
            };
            
            items.push(segment);
          }
        }
      }
    }
    
    return items;
  } catch (error) {
    console.error('Error parsing music segments:', error);
    return [];
  }
}

// Combined parser that handles both regular RSS and music segments
export async function parseRSSFeedWithSegments(feedUrl: string): Promise<ParsedFeed> {
  // First try regular RSS parsing
  const feed = await parseRSSFeed(feedUrl);
  
  // Then try to extract any music segments
  const segments = await parseMusicSegments(feedUrl);
  
  // Merge segments into feed items if any were found
  if (segments.length > 0) {
    // Add segments as additional items, avoiding duplicates based on guid
    const existingGuids = new Set(feed.items.map(item => item.guid).filter(Boolean));
    const newSegments = segments.filter(seg => !seg.guid || !existingGuids.has(seg.guid));
    feed.items.push(...newSegments);
  }
  
  return feed;
}