#!/usr/bin/env node

/**
 * Test specific missing feed/item pairs to see if they can be resolved
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Sample missing items from the analysis
const SAMPLE_MISSING_ITEMS = [
  {
    feedGuid: '2cfd7dfd-19e1-545b-b3f3-8465d5d1d362',
    itemGuid: 'fafc072c-9fd8-4eca-8002-89e4b8787d75'
  },
  {
    feedGuid: 'dbad52b9-6253-4a9b-bfab-246b9e839815',
    itemGuid: 'fabc3e64-e470-4f97-bf4a-3957e481e23b'
  },
  {
    feedGuid: 'ece6541b-984d-5f8f-aa02-bb6d0bb1d0ca',
    itemGuid: '548bd314-5e9a-4374-8eae-529ac5628064'
  },
  {
    feedGuid: 'ad7fd2ab-ad39-5117-830c-5cfa52883744',
    itemGuid: '8f762ac5-3dcd-42ff-81ca-0e9720b16c00'
  },
  {
    feedGuid: 'aaeca8b2-4243-59e9-af27-445e1b6ee7ec',
    itemGuid: 'b2058d9c-ee82-46c5-b619-a5892cf6f0c4'
  }
];

// Generate required headers for Podcast Index API
async function generateHeaders(apiKey, apiSecret) {
  const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
  const data4Hash = apiKey + apiSecret + apiHeaderTime;
  
  // Generate SHA1 hash for authentication
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha1').update(data4Hash).digest('hex');
  
  return {
    'Content-Type': 'application/json',
    'X-Auth-Date': apiHeaderTime,
    'X-Auth-Key': apiKey,
    'Authorization': hash,
    'User-Agent': 'FUCKIT-Missing-Track-Test/1.0'
  };
}

// Test feed lookup
async function testFeedLookup(feedGuid) {
  try {
    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    const response = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText}` };
    }
    
    const data = await response.json();
    
    if (data.status === 'true' && (data.feed || (data.feeds && data.feeds.length > 0))) {
      const feed = data.feed || data.feeds[0];
      return {
        found: true,
        title: feed.title,
        author: feed.author,
        url: feed.url,
        dead: feed.dead,
        lastUpdate: new Date(feed.lastUpdateTime * 1000).toISOString(),
        episodeCount: feed.episodeCount || 'unknown'
      };
    } else {
      return { found: false, reason: 'Feed not found in index' };
    }
  } catch (error) {
    return { error: error.message };
  }
}

// Test item lookup
async function testItemLookup(feedGuid, itemGuid) {
  try {
    const headers = await generateHeaders(PODCAST_INDEX_API_KEY, PODCAST_INDEX_API_SECRET);
    
    // Try direct episode lookup first
    const episodeResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=${encodeURIComponent(itemGuid)}`, {
      headers
    });
    
    if (episodeResponse.ok) {
      const episodeData = await episodeResponse.json();
      if (episodeData.status === 'true' && episodeData.episode) {
        const episode = episodeData.episode;
        return {
          found: true,
          method: 'direct',
          title: episode.title,
          description: episode.description?.substring(0, 100) + '...' || 'No description',
          audioUrl: episode.enclosureUrl,
          duration: episode.duration,
          pubDate: new Date(episode.datePublished * 1000).toISOString()
        };
      }
    }
    
    // If direct lookup fails, try via feed episodes
    const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`, {
      headers
    });
    
    if (feedResponse.ok) {
      const feedData = await feedResponse.json();
      if (feedData.status === 'true' && (feedData.feed || (feedData.feeds && feedData.feeds.length > 0))) {
        const feed = feedData.feed || feedData.feeds[0];
        
        // Get episodes from this feed
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feed.id}&max=100`, {
          headers
        });
        
        if (episodesResponse.ok) {
          const episodesData = await episodesResponse.json();
          if (episodesData.status === 'true' && episodesData.items) {
            const episode = episodesData.items.find(ep => ep.guid === itemGuid);
            if (episode) {
              return {
                found: true,
                method: 'feed_episodes',
                title: episode.title,
                description: episode.description?.substring(0, 100) + '...' || 'No description',
                audioUrl: episode.enclosureUrl,
                duration: episode.duration,
                pubDate: new Date(episode.datePublished * 1000).toISOString()
              };
            }
          }
        }
      }
    }
    
    return { found: false, reason: 'Episode not found in feed or direct lookup' };
  } catch (error) {
    return { error: error.message };
  }
}

async function testMissingFeeds() {
  try {
    console.log('🔬 Testing missing feed/item pairs for manual resolution...\n');
    
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
      throw new Error('Missing Podcast Index API credentials in .env.local');
    }
    
    const results = [];
    
    for (const [index, item] of SAMPLE_MISSING_ITEMS.entries()) {
      console.log(`${index + 1}/5 Testing Feed: ${item.feedGuid.substring(0, 16)}...`);
      console.log(`     Item: ${item.itemGuid.substring(0, 16)}...`);
      
      // Test feed lookup
      console.log('  📡 Testing feed lookup...');
      const feedResult = await testFeedLookup(item.feedGuid);
      
      if (feedResult.found) {
        console.log(`  ✅ Feed found: "${feedResult.title}" by ${feedResult.author}`);
        console.log(`      Dead: ${feedResult.dead ? 'YES' : 'NO'} | Episodes: ${feedResult.episodeCount} | Last Update: ${feedResult.lastUpdate}`);
        
        // Test item lookup
        console.log('  📡 Testing item lookup...');
        const itemResult = await testItemLookup(item.feedGuid, item.itemGuid);
        
        if (itemResult.found) {
          console.log(`  ✅ Episode found: "${itemResult.title}"`);
          console.log(`      Method: ${itemResult.method} | Duration: ${itemResult.duration}s`);
          console.log(`      Audio URL: ${itemResult.audioUrl ? 'YES' : 'NO'}`);
        } else if (itemResult.error) {
          console.log(`  ❌ Episode lookup error: ${itemResult.error}`);
        } else {
          console.log(`  ❌ Episode not found: ${itemResult.reason}`);
        }
      } else if (feedResult.error) {
        console.log(`  ❌ Feed lookup error: ${feedResult.error}`);
      } else {
        console.log(`  ❌ Feed not found: ${feedResult.reason || 'Unknown reason'}`);
      }
      
      results.push({
        feedGuid: item.feedGuid,
        itemGuid: item.itemGuid,
        feedResult,
        itemResult: feedResult.found ? await testItemLookup(item.feedGuid, item.itemGuid) : null
      });
      
      console.log('');
      
      // Add delay to avoid rate limiting
      if (index < SAMPLE_MISSING_ITEMS.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Summary
    console.log('=' .repeat(60));
    console.log('📊 MANUAL RESOLUTION TEST SUMMARY:');
    
    const feedsFound = results.filter(r => r.feedResult.found).length;
    const itemsFound = results.filter(r => r.itemResult?.found).length;
    const itemsWithAudio = results.filter(r => r.itemResult?.found && r.itemResult.audioUrl).length;
    
    console.log(`   Feeds found: ${feedsFound}/${results.length}`);
    console.log(`   Episodes found: ${itemsFound}/${results.length}`);
    console.log(`   Episodes with audio: ${itemsWithAudio}/${results.length}`);
    
    if (itemsWithAudio > 0) {
      console.log(`\n✅ ${itemsWithAudio} tracks could potentially be recovered!`);
    } else {
      console.log(`\n❌ No recoverable tracks found in this sample.`);
    }
    
    console.log('=' .repeat(60));
    
    // Save results
    const outputPath = path.join(process.cwd(), 'data/missing-feeds-test-results.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      testedItems: SAMPLE_MISSING_ITEMS.length,
      results: results,
      summary: {
        feedsFound,
        itemsFound,
        itemsWithAudio
      }
    }, null, 2));
    
    console.log(`💾 Detailed test results saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error testing missing feeds:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testMissingFeeds();
}

module.exports = { testMissingFeeds };