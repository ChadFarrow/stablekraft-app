#!/usr/bin/env node

/**
 * Script to re-parse RSS feeds that were missing keysend data
 * This will use the fixed parsing logic to extract keysend information
 */

const { PrismaClient } = require('@prisma/client');
const https = require('https');

const prisma = new PrismaClient();

// Fixed parsing functions (copied from the fixed rss-parser-db.ts)
function parseV4VFromXML(xmlText) {
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
      // Use the first recipient with split="100" (usually the artist)
      const primaryRecipient = recipients.find(r => r.split === '100') || recipients[0];
      
      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      
      return {
        recipient: primaryRecipient.address,
        value: {
          type: typeMatch ? typeMatch[1] : 'lightning',
          method: methodMatch ? methodMatch[1] : 'keysend',
          recipients: recipients
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

function parseItemV4VFromXML(xmlText, itemTitle) {
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
      // Use the first recipient with split="100" (usually the artist)
      const primaryRecipient = recipients.find(r => r.split === '100') || recipients[0];
      
      console.log('✅ DEBUG: Selected primary recipient:', primaryRecipient);
      
      return {
        recipient: primaryRecipient.address,
        value: {
          type: typeMatch ? typeMatch[1] : 'lightning',
          method: methodMatch ? methodMatch[1] : 'keysend',
          recipients: recipients
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

async function reparseFeedsMissingKeysend() {
  try {
    console.log('🔄 Re-parsing feeds that were missing keysend data...\n');

    // Get feeds that should have keysend but don't (based on our analysis)
    const feedsToReparse = await prisma.feed.findMany({
      where: {
        AND: [
          { originalUrl: { contains: 'rssblue.com' } },
          { v4vRecipient: null }
        ]
      },
      include: {
        Track: true
      },
      take: 200 // Process all remaining feeds
    });

    console.log(`📊 Found ${feedsToReparse.length} RSS Blue feeds to re-parse\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const feed of feedsToReparse) {
      console.log(`\n🔍 Re-parsing: ${feed.title}`);
      console.log(`   URL: ${feed.originalUrl}`);
      
      try {
        // Fetch the RSS feed
        const xmlContent = await fetchRSSFeed(feed.originalUrl);
        
        if (!xmlContent) {
          console.log('❌ Failed to fetch RSS feed');
          errorCount++;
          continue;
        }

        // Parse feed-level V4V data
        console.log('📋 Parsing feed-level V4V data...');
        const feedV4V = parseV4VFromXML(xmlContent);
        
        if (feedV4V.recipient || feedV4V.value) {
          console.log('✅ Found feed-level keysend data');
          
          // Update feed with V4V data
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              v4vRecipient: feedV4V.recipient,
              v4vValue: feedV4V.value
            }
          });
          
          console.log('✅ Updated feed with V4V data');
        } else {
          console.log('ℹ️ No feed-level keysend data found');
        }

        // Parse track-level V4V data
        console.log('📋 Parsing track-level V4V data...');
        for (const track of feed.Track) {
          const trackV4V = parseItemV4VFromXML(xmlContent, track.title);
          
          if (trackV4V.recipient || trackV4V.value) {
            console.log(`✅ Found keysend data for track: ${track.title}`);
            
            // Update track with V4V data
            await prisma.track.update({
              where: { id: track.id },
              data: {
                v4vRecipient: trackV4V.recipient,
                v4vValue: trackV4V.value
              }
            });
            
            console.log('✅ Updated track with V4V data');
          } else {
            console.log(`ℹ️ No keysend data found for track: ${track.title}`);
          }
        }

        successCount++;
        console.log('✅ Successfully re-parsed feed');

      } catch (error) {
        console.error(`❌ Error re-parsing ${feed.title}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Re-parsing Summary:');
    console.log(`   ✅ Successfully re-parsed: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📊 Total processed: ${feedsToReparse.length}`);

  } catch (error) {
    console.error('❌ Error in re-parsing script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function fetchRSSFeed(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', (error) => {
      console.error(`Error fetching ${url}:`, error.message);
      resolve(null);
    });
  });
}

// Run the script
reparseFeedsMissingKeysend();