#!/usr/bin/env node

/**
 * Test parsing a small sample of newly discovered feeds
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                process.env[key] = value.trim();
            }
        });
    }
}

loadEnvFile();

async function testParseSampleFeeds() {
    console.log('🧪 Testing Parse Sample Feeds\n');

    try {
        // Load feeds database
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        // Find a small sample of music feeds from HGH
        const hghFeeds = feedsData.feeds.filter(feed =>
            feed.discoveredVia === 'HGH Playlist' &&
            feed.type === 'album' &&
            !feed.lastFetched
        ).slice(0, 3); // Just test 3 feeds

        console.log(`Testing ${hghFeeds.length} sample feeds:\n`);

        hghFeeds.forEach((feed, index) => {
            console.log(`${index + 1}. "${feed.title}" by ${feed.artist}`);
            console.log(`   URL: ${feed.originalUrl}`);
            console.log(`   Type: ${feed.type} | Medium: ${feed.medium}\n`);
        });

        // Simple fetch test
        for (const feed of hghFeeds) {
            console.log(`🔍 Testing fetch: "${feed.title}"`);
            try {
                const response = await fetch(feed.originalUrl, {
                    headers: { 'User-Agent': 'FUCKIT-Feed-Test/1.0' },
                    timeout: 10000
                });

                if (response.ok) {
                    const xmlText = await response.text();
                    console.log(`   ✅ Successfully fetched ${xmlText.length} characters`);

                    // Simple check if it looks like RSS
                    if (xmlText.includes('<rss') || xmlText.includes('<feed')) {
                        console.log(`   ✅ Looks like valid RSS/Atom feed`);

                        // Count items
                        const itemCount = (xmlText.match(/<item>/g) || []).length;
                        const entryCount = (xmlText.match(/<entry>/g) || []).length;
                        console.log(`   📊 Contains ${itemCount + entryCount} items/entries`);
                    } else {
                        console.log(`   ⚠️ Doesn't look like RSS feed`);
                    }
                } else {
                    console.log(`   ❌ HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (error) {
                console.log(`   ❌ Fetch error: ${error.message}`);
            }
            console.log('');
        }

        console.log('🧪 Sample test complete!');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testParseSampleFeeds();