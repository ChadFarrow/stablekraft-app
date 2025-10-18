#!/usr/bin/env node

/**
 * Add LNURL Test Feed to Database
 * 
 * This script adds the LNURL test feed to the database with special configuration
 * to only show in the side menu, not in main feed listings.
 */

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const { PrismaClient } = require('@prisma/client');
const axios = require('axios');

const prisma = new PrismaClient();

const LNURL_TEST_FEED_URL = 'https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml';

async function parseRSSFeed(url) {
  try {
    console.log(`📡 Fetching RSS feed: ${url}`);
    const { data: xmlString } = await axios.get(url);
    
    // Simple XML parsing for basic feed info
    const titleMatch = xmlString.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const descriptionMatch = xmlString.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/);
    const imageMatch = xmlString.match(/<image><!\[CDATA\[(.*?)\]\]><\/image>|<image>(.*?)<\/image>/);
    const languageMatch = xmlString.match(/<language>(.*?)<\/language>/);
    const categoryMatch = xmlString.match(/<category><!\[CDATA\[(.*?)\]\]><\/category>|<category>(.*?)<\/category>/);
    const explicitMatch = xmlString.match(/<itunes:explicit>(.*?)<\/itunes:explicit>/);
    
    const title = titleMatch ? (titleMatch[1] || titleMatch[2]) : 'LNURL Testing Podcast';
    const description = descriptionMatch ? (descriptionMatch[1] || descriptionMatch[2]) : 'Test podcast feed for LNURL payment integration and Lightning Network testing';
    const image = imageMatch ? (imageMatch[1] || imageMatch[2]) : null;
    const language = languageMatch ? languageMatch[1] : 'en';
    const category = categoryMatch ? (categoryMatch[1] || categoryMatch[2]) : 'Technology';
    const explicit = explicitMatch ? explicitMatch[1] === 'yes' : false;
    
    // Extract artist from title or use default
    const artist = 'ChadF';
    
    return {
      title: title.trim(),
      description: description.trim(),
      artist: artist.trim(),
      image: image ? image.trim() : null,
      language: language.trim(),
      category: category.trim(),
      explicit
    };
  } catch (error) {
    console.error('Error parsing RSS feed:', error);
    throw error;
  }
}

async function addLNURLTestFeed() {
  try {
    console.log('🚀 Adding LNURL Test Feed to database...\n');
    
    // Check if feed already exists
    const existingFeed = await prisma.feed.findFirst({
      where: { originalUrl: LNURL_TEST_FEED_URL }
    });
    
    if (existingFeed) {
      console.log('✅ LNURL Test Feed already exists in database');
      console.log(`   ID: ${existingFeed.id}`);
      console.log(`   Title: ${existingFeed.title}`);
      console.log(`   Status: ${existingFeed.status}`);
      return;
    }
    
    // Parse the RSS feed
    const feedData = await parseRSSFeed(LNURL_TEST_FEED_URL);
    
    console.log('📊 Parsed feed data:');
    console.log(`   Title: ${feedData.title}`);
    console.log(`   Artist: ${feedData.artist}`);
    console.log(`   Description: ${feedData.description.substring(0, 100)}...`);
    console.log(`   Language: ${feedData.language}`);
    console.log(`   Category: ${feedData.category}`);
    console.log(`   Explicit: ${feedData.explicit}`);
    console.log(`   Image: ${feedData.image || 'None'}\n`);
    
    // Create the feed with special configuration
    const feed = await prisma.feed.create({
      data: {
        id: 'lnurl-test-feed',
        originalUrl: LNURL_TEST_FEED_URL,
        cdnUrl: LNURL_TEST_FEED_URL,
        title: feedData.title,
        description: feedData.description,
        artist: feedData.artist,
        image: feedData.image,
        language: feedData.language,
        category: feedData.category,
        explicit: feedData.explicit,
        type: 'test', // Special type for test feeds
        priority: 'low', // Low priority so it doesn't interfere with main feeds
        status: 'active',
        lastFetched: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    
    console.log('✅ LNURL Test Feed added successfully!');
    console.log(`   Database ID: ${feed.id}`);
    console.log(`   Type: ${feed.type} (test feed)`);
    console.log(`   Priority: ${feed.priority}`);
    console.log(`   Status: ${feed.status}`);
    
    // Note about side menu visibility
    console.log('\n📝 Note: This feed is configured as a test feed and should only appear in the side menu.');
    console.log('   The frontend will need to be updated to filter test feeds from main listings.');
    
  } catch (error) {
    console.error('❌ Error adding LNURL Test Feed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  addLNURLTestFeed()
    .then(() => {
      console.log('\n🎉 Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addLNURLTestFeed };
