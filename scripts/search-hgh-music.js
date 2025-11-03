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
        'User-Agent': 'StableKraft-HGH-Music-Search/1.0'
    };
}

async function searchHghMusic() {
    console.log('🎵 Searching for HGH Music Tracks in Podcast Index\n');
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
        
        const headers = generateAuthHeaders();
        
        // Try different API endpoints to find music
        const searchEndpoints = [
            {
                name: 'Music Medium Search',
                getUrl: (guid) => `${API_BASE}/search/byterm?q=${guid}&medium=music&max=5`
            },
            {
                name: 'Music Feed Search',  
                getUrl: (guid) => `${API_BASE}/search/music/byterm?q=${guid}&max=5`
            },
            {
                name: 'Episodes by GUID',
                getUrl: (guid) => `${API_BASE}/episodes/byguid?guid=${guid}`
            },
            {
                name: 'Feed by GUID Direct',
                getUrl: (guid) => `${API_BASE}/podcasts/byguid?guid=${guid}&fulltext`
            }
        ];
        
        // Test the first few remote items with all search methods
        const testItems = remoteItems.slice(0, 3);
        
        console.log('🔍 Testing Search Methods:\n');
        
        for (const [itemIndex, item] of testItems.entries()) {
            const feedGuid = item['@_feedGuid'];
            const itemGuid = item['@_itemGuid'];
            
            console.log(`🎯 Testing Item ${itemIndex + 1}:`);
            console.log(`   Feed GUID: ${feedGuid}`);
            console.log(`   Item GUID: ${itemGuid}`);
            
            for (const endpoint of searchEndpoints) {
                console.log(`\n   📡 ${endpoint.name}:`);
                
                // Test with both feed and item GUID
                const guidsToTest = [
                    { type: 'Feed GUID', guid: feedGuid },
                    { type: 'Item GUID', guid: itemGuid }
                ];
                
                for (const guidTest of guidsToTest) {
                    try {
                        const url = endpoint.getUrl(guidTest.guid);
                        const searchResponse = await fetch(url, { headers });
                        const searchData = await searchResponse.json();
                        
                        console.log(`      ${guidTest.type}: ${searchData.status} - ${searchData.description || 'No description'}`);
                        
                        if (searchData.status === 'true' || searchData.status === true) {
                            // Handle different response structures
                            let results = [];
                            
                            if (searchData.feeds) {
                                results = searchData.feeds;
                            } else if (searchData.feed) {
                                results = Array.isArray(searchData.feed) ? searchData.feed : [searchData.feed];
                            } else if (searchData.episode) {
                                results = Array.isArray(searchData.episode) ? searchData.episode : [searchData.episode];
                            } else if (searchData.items) {
                                results = searchData.items;
                            }
                            
                            if (results.length > 0) {
                                const result = results[0];
                                console.log(`         🎵 Found: "${result.title || result.feedTitle || 'Unknown'}" by ${result.author || result.feedAuthor || 'Unknown Artist'}`);
                                console.log(`         📡 Medium: ${result.medium || 'not specified'}`);
                                console.log(`         🆔 ID: ${result.id || result.feedId || 'Unknown'}`);
                                
                                if (result.enclosureUrl) {
                                    console.log(`         🔗 Audio: ${result.enclosureUrl.substring(0, 50)}...`);
                                }
                            }
                        }
                        
                    } catch (error) {
                        console.log(`      ${guidTest.type}: Error - ${error.message}`);
                    }
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            console.log('\n' + '-'.repeat(50) + '\n');
        }
        
        // Try to find any successful pattern and test more items
        console.log('🎯 Summary and Recommendations:\n');
        console.log('Based on the test results above:');
        console.log('1. Check which search method returned actual results');
        console.log('2. Look for medium="music" in successful results');  
        console.log('3. Note any patterns in successful GUIDs vs failed ones');
        console.log('4. Consider if we need different search terms or approaches');
        
    } catch (error) {
        console.error('❌ Error searching for HGH music:', error.message);
        process.exit(1);
    }
}

// Run the search
searchHghMusic();