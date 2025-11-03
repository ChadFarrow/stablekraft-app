#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const API_KEY = process.env.PODCAST_INDEX_API_KEY;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET;
const API_BASE = 'https://api.podcastindex.org/api/1.0';

function generateAuthHeaders() {
    const authTime = Math.floor(Date.now() / 1000);
    const authString = API_KEY + API_SECRET + authTime;
    const authHeader = crypto.createHash('sha1').update(authString).digest('hex');
    
    return {
        'X-Auth-Key': API_KEY,
        'X-Auth-Date': authTime,
        'Authorization': authHeader,
        'User-Agent': 'StableKraft-HGH-GUID-Analyzer/1.0'
    };
}

async function analyzeHghGuids() {
    console.log('🔍 Analyzing HGH GUID Patterns\n');
    console.log('=' .repeat(60) + '\n');
    
    // Load HGH playlist
    const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    
    try {
        const response = await fetch(playlistUrl);
        const xmlContent = await response.text();
        
        const { XMLParser } = require('fast-xml-parser');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            isArray: (name) => name === 'podcast:remoteItem'
        });
        
        const parsedXml = parser.parse(xmlContent);
        let remoteItems = parsedXml?.rss?.channel?.['podcast:remoteItem'] || [];
        
        if (!Array.isArray(remoteItems)) {
            remoteItems = [remoteItems];
        }
        
        console.log(`📊 Found ${remoteItems.length} remote items\n`);
        
        // Analyze patterns
        const feedGuids = new Set();
        const itemGuids = new Set();
        const feedGuidCounts = {};
        
        remoteItems.forEach(item => {
            const feedGuid = item['@_feedGuid'];
            const itemGuid = item['@_itemGuid'];
            
            if (feedGuid) {
                feedGuids.add(feedGuid);
                feedGuidCounts[feedGuid] = (feedGuidCounts[feedGuid] || 0) + 1;
            }
            if (itemGuid) {
                itemGuids.add(itemGuid);
            }
        });
        
        console.log('📈 Pattern Analysis:');
        console.log(`  🎯 Unique feed GUIDs: ${feedGuids.size}`);
        console.log(`  🎯 Unique item GUIDs: ${itemGuids.size}`);
        console.log(`  🎯 Total remote items: ${remoteItems.length}\n`);
        
        // Show most common feed GUIDs
        console.log('🔥 Most Referenced Feed GUIDs:');
        const sortedFeeds = Object.entries(feedGuidCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10);
            
        sortedFeeds.forEach(([guid, count], index) => {
            console.log(`  ${index + 1}. ${guid.substring(0, 8)}...${guid.substring(-8)} (${count} items)`);
        });
        
        // Get HGH main feed episodes and check if any itemGuids match
        console.log('\n🏠 Checking if item GUIDs match main HGH feed episodes...\n');
        
        const headers = generateAuthHeaders();
        const hghFeedId = 6611624; // From our test
        const episodeUrl = `${API_BASE}/episodes/byfeedid?id=${hghFeedId}&max=200`;
        
        const episodeResponse = await fetch(episodeUrl, { headers });
        const episodeData = await episodeResponse.json();
        
        if (episodeData.status === 'true' && episodeData.items) {
            const hghEpisodes = episodeData.items;
            console.log(`📀 Retrieved ${hghEpisodes.length} HGH episodes`);
            
            // Check for matches
            const matches = [];
            const itemGuidArray = Array.from(itemGuids);
            
            hghEpisodes.forEach(episode => {
                if (itemGuidArray.includes(episode.guid)) {
                    matches.push({
                        itemGuid: episode.guid,
                        title: episode.title,
                        id: episode.id
                    });
                }
            });
            
            console.log(`✅ Found ${matches.length} item GUID matches with HGH episodes\n`);
            
            if (matches.length > 0) {
                console.log('🎯 Matched Episodes:');
                matches.slice(0, 5).forEach((match, index) => {
                    console.log(`  ${index + 1}. "${match.title}" (${match.itemGuid.substring(0, 8)}...)`);
                });
                if (matches.length > 5) {
                    console.log(`  ... and ${matches.length - 5} more`);
                }
            }
            
        } else {
            console.log('❌ Could not fetch HGH episodes');
        }
        
        // Sample a few feed GUIDs for detailed analysis
        console.log('\n🔍 Sample Feed GUID Analysis:');
        const sampleFeeds = Array.from(feedGuids).slice(0, 3);
        
        for (const [index, feedGuid] of sampleFeeds.entries()) {
            console.log(`\n${index + 1}. Testing ${feedGuid}:`);
            
            // Try different search methods
            const searchMethods = [
                `${API_BASE}/podcasts/byguid?guid=${feedGuid}`,
                `${API_BASE}/search/byterm?q=${feedGuid}&max=1`,
                `${API_BASE}/search/byterm?q=${feedGuid.substring(0, 16)}&max=1`
            ];
            
            for (const url of searchMethods) {
                try {
                    const testResponse = await fetch(url, { headers });
                    const testData = await testResponse.json();
                    console.log(`     ${url.includes('/search/') ? 'Search' : 'Direct'}: ${testData.status} - ${testData.description || 'No description'}`);
                    
                    if (testData.feeds && testData.feeds.length > 0) {
                        console.log(`       Found: "${testData.feeds[0].title}" by ${testData.feeds[0].author}`);
                    } else if (testData.feed) {
                        const feed = Array.isArray(testData.feed) ? testData.feed[0] : testData.feed;
                        console.log(`       Found: "${feed.title}" by ${feed.author}`);
                    }
                } catch (error) {
                    console.log(`     Error: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        
        console.log('\n' + '=' .repeat(60));
        console.log('💡 Analysis Complete!\n');
        console.log('Key Findings:');
        console.log(`• ${feedGuids.size} unique feed references across ${remoteItems.length} items`);
        console.log(`• Most referenced feeds suggest music creators with multiple tracks`);
        console.log(`• ${matches?.length || 0} item GUIDs match episodes in main HGH feed`);
        console.log('\n🎯 Next Steps:');
        console.log('• If item GUIDs match HGH episodes, they may be internal segments');
        console.log('• Feed GUIDs likely reference independent music creators');
        console.log('• May need alternative resolution approach or manual curation');
        
    } catch (error) {
        console.error('❌ Error analyzing HGH GUIDs:', error.message);
        process.exit(1);
    }
}

// Run the analysis
analyzeHghGuids();