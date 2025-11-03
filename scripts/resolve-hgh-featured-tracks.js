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

if (!API_KEY || !API_SECRET) {
    console.error('❌ Podcast Index API credentials not found in .env.local');
    process.exit(1);
}

function generateAuthHeaders() {
    const authTime = Math.floor(Date.now() / 1000);
    const authString = API_KEY + API_SECRET + authTime;
    const authHeader = crypto.createHash('sha1').update(authString).digest('hex');
    
    return {
        'X-Auth-Key': API_KEY,
        'X-Auth-Date': authTime,
        'Authorization': authHeader,
        'User-Agent': 'StableKraft-HGH-Featured-Tracks/1.0'
    };
}

async function searchForTrack(feedGuid, itemGuid) {
    try {
        const headers = generateAuthHeaders();
        
        // Try multiple search approaches
        const searchMethods = [
            // Method 1: Direct feed lookup
            {
                name: 'Feed GUID lookup',
                url: `${API_BASE}/podcasts/byguid?guid=${feedGuid}`
            },
            // Method 2: Episode/item lookup if it's an episode GUID
            {
                name: 'Episode GUID lookup', 
                url: `${API_BASE}/episodes/byguid?guid=${itemGuid}`
            },
            // Method 3: Search by partial GUID
            {
                name: 'Search by feed GUID',
                url: `${API_BASE}/search/byterm?q=${feedGuid.substring(0, 8)}&medium=music`
            }
        ];
        
        for (const method of searchMethods) {
            const response = await fetch(method.url, { headers });
            const data = await response.json();
            
            if (data.status === 'true' || data.status === true) {
                // Handle different response structures
                if (method.name === 'Feed GUID lookup' && data.feed) {
                    const feed = Array.isArray(data.feed) ? data.feed[0] : data.feed;
                    if (feed && feed.id) {
                        // Get episodes from this feed
                        const episodeUrl = `${API_BASE}/episodes/byfeedid?id=${feed.id}&max=50`;
                        const episodeResponse = await fetch(episodeUrl, { headers });
                        const episodeData = await episodeResponse.json();
                        
                        if (episodeData.status === 'true' && episodeData.items) {
                            // Try to match the item GUID
                            const matchedEpisode = episodeData.items.find(ep => 
                                ep.guid === itemGuid || 
                                ep.id === itemGuid ||
                                (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                            );
                            
                            if (matchedEpisode) {
                                return {
                                    method: method.name,
                                    feed: feed,
                                    episode: matchedEpisode,
                                    type: 'episode'
                                };
                            } else {
                                // Return the feed info even if no specific episode match
                                return {
                                    method: method.name,
                                    feed: feed,
                                    episode: null,
                                    type: 'feed'
                                };
                            }
                        }
                    }
                } else if (method.name === 'Episode GUID lookup' && data.episode) {
                    const episode = Array.isArray(data.episode) ? data.episode[0] : data.episode;
                    if (episode) {
                        return {
                            method: method.name,
                            feed: null,
                            episode: episode,
                            type: 'episode'
                        };
                    }
                } else if (method.name === 'Search by feed GUID' && data.feeds) {
                    const feeds = data.feeds || [];
                    if (feeds.length > 0) {
                        return {
                            method: method.name,
                            feed: feeds[0],
                            episode: null,
                            type: 'search'
                        };
                    }
                }
            }
            
            // Rate limiting between methods
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        return null;
        
    } catch (error) {
        console.error(`Error searching for track: ${error.message}`);
        return null;
    }
}

async function resolveHghFeaturedTracks() {
    console.log('🎵 Resolving HGH Featured Music Tracks\n');
    console.log('=' .repeat(60) + '\n');
    
    // Load music tracks
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));
    
    // Create backup
    const backupPath = musicTracksPath + `.backup-hgh-featured-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);
    
    // Load HGH playlist
    const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    console.log(`📥 Fetching HGH playlist from: ${playlistUrl}\n`);
    
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
        
        console.log(`🔍 Found ${remoteItems.length} featured tracks to resolve\n`);
        
        // Check existing
        const existingGuids = new Set();
        musicData.musicTracks.forEach(track => {
            if (track.feedGuid && track.itemGuid) {
                const itemGuid = typeof track.itemGuid === 'string' ? track.itemGuid : track.itemGuid?._; 
                existingGuids.add(`${track.feedGuid}:${itemGuid}`);
            }
        });
        
        let resolvedCount = 0;
        let unresolvedCount = 0;
        let duplicateCount = 0;
        
        // Process a smaller batch first to test
        const batchSize = Math.min(50, remoteItems.length);
        console.log(`🎯 Processing first ${batchSize} tracks as test batch\n`);
        
        for (let i = 0; i < batchSize; i++) {
            const item = remoteItems[i];
            const feedGuid = item['@_feedGuid'];
            const itemGuid = item['@_itemGuid'];
            
            if (!feedGuid || !itemGuid) {
                unresolvedCount++;
                continue;
            }
            
            const combinedGuid = `${feedGuid}:${itemGuid}`;
            if (existingGuids.has(combinedGuid)) {
                duplicateCount++;
                continue;
            }
            
            console.log(`🔍 [${i + 1}/${batchSize}] Searching: ${feedGuid.substring(0, 8)}...`);
            
            const result = await searchForTrack(feedGuid, itemGuid);
            
            if (result) {
                const feed = result.feed;
                const episode = result.episode;
                
                // Create track from resolved data
                const newTrack = {
                    id: `hgh_featured_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    feedGuid: feedGuid,
                    itemGuid: itemGuid,
                    title: episode?.title || feed?.title || `Featured Track ${i + 1}`,
                    artist: feed?.author || episode?.feedTitle || 'Independent Artist',
                    album: feed?.title || episode?.feedTitle || 'Homegrown Hits Featured',
                    artwork: episode?.image || episode?.feedImage || feed?.image || feed?.artwork || '/stablekraft-rocket.png',
                    audioUrl: episode?.enclosureUrl || null,
                    duration: episode?.duration || 5999,
                    description: episode?.description || feed?.description || 'Featured on Homegrown Hits',
                    pubDate: episode?.datePublished ? new Date(episode.datePublished * 1000).toISOString() : new Date().toISOString(),
                    
                    // Metadata
                    feedId: feed?.id || null,
                    feedTitle: feed?.title || null,
                    feedUrl: feed?.url || null,
                    feedAuthor: feed?.author || null,
                    medium: feed?.medium || episode?.feedMedium || 'music',
                    explicit: episode?.explicit || false,
                    episodeId: episode?.id || null,
                    
                    // V4V data
                    ...(episode?.value && { value: episode.value }),
                    
                    // HGH context
                    source: 'HGH Featured Track - Resolved',
                    originalPlaylist: 'HGH Music Playlist',
                    featuredOnHgh: true,
                    resolvedDate: new Date().toISOString(),
                    resolutionMethod: result.method
                };
                
                musicData.musicTracks.push(newTrack);
                existingGuids.add(combinedGuid);
                resolvedCount++;
                
                console.log(`      ✅ Resolved: "${newTrack.title}" by ${newTrack.artist} (${result.method})`);
                
            } else {
                // Create unresolved placeholder for later processing
                const newTrack = {
                    id: `hgh_unresolved_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    feedGuid: feedGuid,
                    itemGuid: itemGuid,
                    title: `HGH Featured Track ${i + 1}`,
                    artist: 'Unknown Artist',
                    album: 'Homegrown Hits Featured',
                    artwork: '/stablekraft-rocket.png',
                    duration: 5999,
                    audioUrl: null,
                    description: `Featured track from HGH playlist. Feed: ${feedGuid}, Item: ${itemGuid}`,
                    pubDate: new Date().toISOString(),
                    
                    // HGH context
                    source: 'HGH Featured Track - Unresolved',
                    originalPlaylist: 'HGH Music Playlist',
                    featuredOnHgh: true,
                    needsResolution: true,
                    resolvedDate: new Date().toISOString(),
                    resolutionMethod: 'None - Not found in Podcast Index'
                };
                
                musicData.musicTracks.push(newTrack);
                existingGuids.add(combinedGuid);
                unresolvedCount++;
                
                console.log(`      ❌ Not found: ${feedGuid.substring(0, 8)}...`);
            }
            
            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Save progress every 10 tracks
            if ((i + 1) % 10 === 0) {
                fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
                console.log(`   💾 Progress saved (${resolvedCount} resolved so far)\n`);
            }
        }
        
        // Update metadata
        musicData.metadata.lastHghFeaturedResolution = {
            date: new Date().toISOString(),
            sourceUrl: playlistUrl,
            totalFeaturedTracks: remoteItems.length,
            batchProcessed: batchSize,
            resolved: resolvedCount,
            unresolved: unresolvedCount,
            duplicatesSkipped: duplicateCount,
            method: 'HGH Featured Track Resolution (Batch Test)'
        };
        
        // Final save
        fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
        
        console.log('\n' + '=' .repeat(60));
        console.log('📊 HGH Featured Track Resolution Summary:');
        console.log(`  🎵 Featured tracks in playlist: ${remoteItems.length}`);
        console.log(`  🎯 Batch processed: ${batchSize}`);
        console.log(`  ✅ Successfully resolved: ${resolvedCount}`);
        console.log(`  ❌ Could not resolve: ${unresolvedCount}`);
        console.log(`  🔄 Duplicates skipped: ${duplicateCount}`);
        console.log(`  📈 Resolution rate: ${((resolvedCount / batchSize) * 100).toFixed(1)}%`);
        console.log(`  📈 New database total: ${musicData.musicTracks.length}`);
        
        if (resolvedCount > 0) {
            console.log(`\n🎵 Successfully resolved ${resolvedCount} tracks that were featured on Homegrown Hits!`);
        }
        
        if (batchSize < remoteItems.length) {
            console.log(`\n🎯 This was a test batch. Run again to process remaining ${remoteItems.length - batchSize} tracks.`);
        }
        
        console.log('\n✨ HGH featured track resolution complete!');
        
    } catch (error) {
        console.error('❌ Error resolving HGH featured tracks:', error.message);
        process.exit(1);
    }
}

// Run the resolution
resolveHghFeaturedTracks();