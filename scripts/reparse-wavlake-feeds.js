#!/usr/bin/env node

/**
 * Script to re-parse Wavlake feeds that were missing keysend data
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
    const recipients = [];
    
    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags)
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
    let recipientMatch;
    
    while ((recipientMatch = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = recipientMatch[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      // Extract attributes from the tag
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const typeMatch = recipientTag.match(/type="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const customKeyMatch = recipientTag.match(/customKey="([^"]*)"/);
      const customValueMatch = recipientTag.match(/customValue="([^"]*)"/);
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        type: typeMatch ? typeMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        split: splitMatch ? splitMatch[1] : null,
        customKey: customKeyMatch ? customKeyMatch[1] : null,
        customValue: customValueMatch ? customValueMatch[1] : null
      };
      
      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }
    
    console.log('🔍 DEBUG: Total recipients found:', recipients.length);
    
    if (recipients.length === 0) {
      return { recipient: null, value: null };
    }
    
    // Return the first recipient as the main recipient
    const mainRecipient = recipients[0];
    const recipientAddress = mainRecipient.address;
    
    // Return all recipients as the value
    const value = {
      recipients: recipients
    };
    
    console.log('✅ DEBUG: Final result - recipient:', recipientAddress, 'value:', value);
    
    return {
      recipient: recipientAddress,
      value: value
    };
    
  } catch (error) {
    console.error('❌ Error parsing V4V from XML:', error);
    return { recipient: null, value: null };
  }
}

function parseItemV4VFromXML(xmlText) {
  try {
    console.log('🔍 DEBUG: Parsing item V4V from XML...');
    
    // Look for podcast:value tags (handle both self-closing and with content)
    const valueRegex = /<podcast:value[^>]*>(.*?)<\/podcast:value>/gs;
    const valueMatch = valueRegex.exec(xmlText);
    
    if (!valueMatch) {
      console.log('ℹ️ DEBUG: No podcast:value tags found in XML');
      return { recipient: null, value: null };
    }
    
    console.log('🔍 DEBUG: Found podcast:value tag:', valueMatch[0]);
    
    const valueContent = valueMatch[1]; // Content between tags
    const recipients = [];
    
    // Look for podcast:valueRecipient tags within the value (handle both self-closing and opening/closing tags)
    const recipientRegex = /<podcast:valueRecipient[^>]*(?:\/>|><\/podcast:valueRecipient>)/g;
    let recipientMatch;
    
    while ((recipientMatch = recipientRegex.exec(valueContent)) !== null) {
      const recipientTag = recipientMatch[0];
      console.log('🔍 DEBUG: Found recipient tag:', recipientTag);
      
      // Extract attributes from the tag
      const nameMatch = recipientTag.match(/name="([^"]*)"/);
      const typeMatch = recipientTag.match(/type="([^"]*)"/);
      const addressMatch = recipientTag.match(/address="([^"]*)"/);
      const splitMatch = recipientTag.match(/split="([^"]*)"/);
      const customKeyMatch = recipientTag.match(/customKey="([^"]*)"/);
      const customValueMatch = recipientTag.match(/customValue="([^"]*)"/);
      
      const recipient = {
        name: nameMatch ? nameMatch[1] : null,
        type: typeMatch ? typeMatch[1] : null,
        address: addressMatch ? addressMatch[1] : null,
        split: splitMatch ? splitMatch[1] : null,
        customKey: customKeyMatch ? customKeyMatch[1] : null,
        customValue: customValueMatch ? customValueMatch[1] : null
      };
      
      console.log('🔍 DEBUG: Parsed recipient:', recipient);
      recipients.push(recipient);
    }
    
    console.log('🔍 DEBUG: Total recipients found:', recipients.length);
    
    if (recipients.length === 0) {
      return { recipient: null, value: null };
    }
    
    // Return the first recipient as the main recipient
    const mainRecipient = recipients[0];
    const recipientAddress = mainRecipient.address;
    
    // Return all recipients as the value
    const value = {
      recipients: recipients
    };
    
    console.log('✅ DEBUG: Final result - recipient:', recipientAddress, 'value:', value);
    
    return {
      recipient: recipientAddress,
      value: value
    };
    
  } catch (error) {
    console.error('❌ Error parsing item V4V from XML:', error);
    return { recipient: null, value: null };
  }
}

async function reparseWavlakeFeedsMissingKeysend() {
  try {
    console.log('🔄 Re-parsing Wavlake feeds that were missing keysend data...\n');

    // Get Wavlake feeds that should have keysend but don't
    const feedsToReparse = await prisma.feed.findMany({
      where: {
        AND: [
          { originalUrl: { contains: 'wavlake.com' } },
          { v4vRecipient: null }
        ]
      },
      include: {
        Track: true
      },
      take: 20 // Process first 20 for testing
    });

    console.log(`📊 Found ${feedsToReparse.length} Wavlake feeds to re-parse\n`);

    let successCount = 0;
    let errorCount = 0;

    for (const feed of feedsToReparse) {
      console.log(`\n🔍 Processing: ${feed.title}`);
      console.log(`   URL: ${feed.originalUrl}`);
      
      try {
        // Fetch the RSS feed
        const xmlContent = await new Promise((resolve, reject) => {
          https.get(feed.originalUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          }).on('error', reject);
        });

        console.log('📋 Testing feed-level V4V parsing...');
        
        // Parse feed-level V4V
        const feedV4V = parseV4VFromXML(xmlContent);
        
        if (feedV4V.recipient || feedV4V.value) {
          console.log('✅ Found feed-level keysend data!');
          
          // Update the feed
          await prisma.feed.update({
            where: { id: feed.id },
            data: {
              v4vRecipient: feedV4V.recipient,
              v4vValue: feedV4V.value
            }
          });
          
          console.log('✅ Updated feed with keysend data');
          successCount++;
        } else {
          console.log('ℹ️ No feed-level keysend data found');
        }

        // Parse track-level V4V for each track
        for (const track of feed.Track) {
          console.log(`📋 Testing track-level V4V parsing for track: ${track.title}`);
          
          const trackV4V = parseItemV4VFromXML(xmlContent);
          
          if (trackV4V.recipient || trackV4V.value) {
            console.log('✅ Found track-level keysend data!');
            
            // Update the track
            await prisma.track.update({
              where: { id: track.id },
              data: {
                v4vRecipient: trackV4V.recipient,
                v4vValue: trackV4V.value
              }
            });
            
            console.log('✅ Updated track with keysend data');
          } else {
            console.log('ℹ️ No track-level keysend data found');
          }
        }

      } catch (error) {
        console.error(`❌ Error processing ${feed.title}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n📊 Re-parsing complete!`);
    console.log(`✅ Successfully processed: ${successCount} feeds`);
    console.log(`❌ Errors: ${errorCount} feeds`);

  } catch (error) {
    console.error('❌ Error in re-parsing script:', error);
  } finally {
    await prisma.$disconnect();
  }
}

reparseWavlakeFeedsMissingKeysend();