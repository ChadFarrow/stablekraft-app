#!/usr/bin/env node

/**
 * Fix LNURL Test Feed by importing its tracks
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixLNURLTestFeed() {
  try {
    console.log('🔄 Fixing LNURL Test Feed by importing tracks...\n');
    
    // Get the feed from database
    const feed = await prisma.feed.findFirst({
      where: { id: 'lnurl-test-feed' }
    });
    
    if (!feed) {
      console.log('❌ LNURL Test Feed not found in database');
      return;
    }
    
    console.log(`✅ Found feed: ${feed.title}`);
    console.log(`   URL: ${feed.originalUrl}`);
    
    // Fetch the RSS feed
    console.log('\n📡 Fetching RSS feed...');
    const response = await fetch(feed.originalUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const xmlText = await response.text();
    console.log(`📄 Fetched ${xmlText.length} characters`);
    
    // Parse RSS using simple XML parsing to extract episodes
    const RSSParser = require('rss-parser');
    const parser = new RSSParser({
      customFields: {
        item: [
          ['enclosure', 'enclosure'],
          ['itunes:duration', 'duration'],
          ['itunes:explicit', 'explicit'],
          ['itunes:subtitle', 'subtitle'],
          ['itunes:summary', 'summary'],
          ['itunes:image', 'image'],
          ['podcast:value', 'value'],
          ['podcast:person', 'person']
        ]
      }
    });
    
    const rssData = await parser.parseString(xmlText);
    console.log(`📊 Found ${rssData.items.length} episodes in RSS feed`);
    
    if (rssData.items.length === 0) {
      console.log('⚠️  No episodes found in RSS feed');
      return;
    }
    
    // Check if tracks already exist
    const existingTracks = await prisma.track.findMany({
      where: { feedId: feed.id }
    });
    
    if (existingTracks.length > 0) {
      console.log(`🔍 Found ${existingTracks.length} existing tracks, removing them first...`);
      await prisma.track.deleteMany({
        where: { feedId: feed.id }
      });
      console.log('🗑️  Removed existing tracks');
    }
    
    // Import episodes as tracks
    console.log('\n🎵 Importing episodes as tracks...');
    let trackCount = 0;
    
    for (const [index, item] of rssData.items.entries()) {
      try {
        // Extract audio URL from enclosure
        let audioUrl = '';
        if (item.enclosure && item.enclosure.url) {
          audioUrl = item.enclosure.url;
        } else if (item.enclosures && item.enclosures.length > 0) {
          audioUrl = item.enclosures[0].url;
        }
        
        if (!audioUrl) {
          console.log(`⚠️  Skipping "${item.title}" - no audio URL found`);
          continue;
        }
        
        // Parse duration
        let duration = 0;
        if (item.duration) {
          const durationStr = item.duration.toString();
          if (durationStr.includes(':')) {
            const parts = durationStr.split(':');
            if (parts.length === 2) {
              duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            } else if (parts.length === 3) {
              duration = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
            }
          } else {
            duration = parseInt(durationStr) || 0;
          }
        }
        
        // Generate unique ID for track
        const trackId = `${feed.id}-track-${index + 1}`;
        
        // Extract image URL properly
        let imageUrl = feed.image || '';
        if (item.image) {
          if (typeof item.image === 'string') {
            imageUrl = item.image;
          } else if (item.image.href) {
            imageUrl = item.image.href;
          } else if (item.image.$?.href) {
            imageUrl = item.image.$.href;
          }
        }
        
        // Create track
        const track = await prisma.track.create({
          data: {
            id: trackId,
            feedId: feed.id,
            guid: item.guid || `lnurl-test-${index + 1}`,
            title: item.title || `Episode ${index + 1}`,
            description: item.summary || item.contentSnippet || item.content || '',
            audioUrl: audioUrl,
            duration: duration,
            trackOrder: index + 1,
            publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            image: imageUrl,
            artist: feed.artist,
            explicit: item.explicit === 'yes' || item.explicit === true,
            subtitle: item.subtitle || '',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        });
        
        console.log(`   ✅ [${index + 1}] ${track.title} (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')})`);
        trackCount++;
        
      } catch (error) {
        console.log(`   ❌ [${index + 1}] Failed to import "${item.title}": ${error.message}`);
      }
    }
    
    // Update feed lastFetched
    await prisma.feed.update({
      where: { id: feed.id },
      data: { lastFetched: new Date() }
    });
    
    console.log(`\n✅ Successfully imported ${trackCount} tracks for LNURL Test Feed`);
    console.log(`🌐 Page should now load: https://stablekraft.app/album/lnurl-test-feed`);
    
  } catch (error) {
    console.error('❌ Error fixing LNURL Test Feed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  fixLNURLTestFeed()
    .then(() => {
      console.log('\n🎉 Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixLNURLTestFeed };