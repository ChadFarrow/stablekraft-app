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
        'User-Agent': 'StableKraft-HGH-ValueSplit-Resolver/1.0'
    };
}

async function getEpisodesByFeedId(feedId, maxEpisodes = 100) {
    try {
        const headers = generateAuthHeaders();
        const url = `${API_BASE}/episodes/byfeedid?id=${feedId}&max=${maxEpisodes}`;
        
        const response = await fetch(url, { headers });
        const data = await response.json();
        
        if (data.status === 'true' || data.status === true) {
            return data.items || [];
        }
        return [];
    } catch (error) {
        console.error('Error fetching episodes:', error.message);
        return [];
    }
}

async function getFeedByGuid(feedGuid) {
    try {
        const headers = generateAuthHeaders();
        const url = `${API_BASE}/podcasts/byguid?guid=${feedGuid}`;
        const response = await fetch(url, { headers });
        const data = await response.json();
        
        if (data.status === 'true' || data.status === true) {
            return Array.isArray(data.feed) ? data.feed[0] : data.feed;
        }
        return null;
    } catch (error) {
        return null;
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveHghValueSplits() {
    console.log('🎵 Resolving HGH Value Splits as Music Tracks\n');
    console.log('=' .repeat(60) + '\n');
    
    // Load music tracks
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));
    
    // Create backup
    const backupPath = musicTracksPath + `.backup-hgh-valuesplits-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);
    
    // Load the HGH playlist XML to get remote items
    console.log('📥 Fetching HGH playlist XML for remote items...\n');
    
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
        
        console.log(`🔍 Found ${remoteItems.length} remote items to resolve\n`);
        
        // Get the main HGH feed information
        const mainHghFeedGuid = 'ac746d09-7c3b-5bcd-b28a-f12d6456ca8f';
        const mainFeed = await getFeedByGuid(mainHghFeedGuid);
        
        if (!mainFeed) {
            console.error('❌ Could not find main HGH feed');
            return;
        }
        
        console.log(`✅ Found main feed: "${mainFeed.title}" (ID: ${mainFeed.id})\n`);
        
        // Get all episodes from the main feed
        console.log('📚 Fetching all HGH episodes...');
        const episodes = await getEpisodesByFeedId(mainFeed.id, 200);
        console.log(`📀 Retrieved ${episodes.length} episodes\n`);
        
        // Check existing tracks
        const existingGuids = new Set();
        musicData.musicTracks.forEach(track => {
            if (track.feedGuid && track.itemGuid) {
                const itemGuid = typeof track.itemGuid === 'string' ? track.itemGuid : track.itemGuid?._; 
                const combinedGuid = `${track.feedGuid}:${itemGuid}`;
                existingGuids.add(combinedGuid);
            }
        });
        
        let resolvedCount = 0;
        let failedCount = 0;
        let duplicateCount = 0;
        
        // Process each remote item as a value split reference
        for (const [index, remoteItem] of remoteItems.entries()) {
            const feedGuid = remoteItem['@_feedGuid'];
            const itemGuid = remoteItem['@_itemGuid'];
            
            if (!feedGuid || !itemGuid) {
                failedCount++;
                continue;
            }
            
            const combinedGuid = `${feedGuid}:${itemGuid}`;
            if (existingGuids.has(combinedGuid)) {
                duplicateCount++;
                continue;
            }
            
            console.log(`🔍 [${index + 1}/${remoteItems.length}] Processing: ${feedGuid.substring(0, 8)}...`);
            
            // Try to resolve the remote feedGuid as a separate feed first
            let resolvedTrack = null;
            const remoteFeed = await getFeedByGuid(feedGuid);
            
            if (remoteFeed && remoteFeed.id) {
                console.log(`   ✅ Found remote feed: "${remoteFeed.title}"`);
                
                // Get episodes from remote feed and try to match itemGuid
                const remoteEpisodes = await getEpisodesByFeedId(remoteFeed.id);
                const matchedEpisode = remoteEpisodes.find(ep => 
                    ep.guid === itemGuid || 
                    ep.id === itemGuid ||
                    (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                );
                
                if (matchedEpisode) {
                    resolvedTrack = {
                        id: `hgh_valuesplit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        feedGuid: feedGuid,
                        itemGuid: itemGuid,
                        title: matchedEpisode.title || remoteFeed.title || `HGH Track ${index + 1}`,
                        artist: remoteFeed.author || matchedEpisode.feedTitle || 'Independent Artist',
                        album: remoteFeed.title || 'Homegrown Hits Collection',
                        artwork: matchedEpisode.image || matchedEpisode.feedImage || remoteFeed.image || remoteFeed.artwork || '/stablekraft-rocket.png',
                        audioUrl: matchedEpisode.enclosureUrl || null,
                        duration: matchedEpisode.duration || 5999,
                        description: matchedEpisode.description || remoteFeed.description || null,
                        pubDate: matchedEpisode.datePublished ? new Date(matchedEpisode.datePublished * 1000).toISOString() : new Date().toISOString(),
                        
                        // Feed metadata
                        feedId: remoteFeed.id,
                        feedTitle: remoteFeed.title,
                        feedUrl: remoteFeed.url,
                        feedAuthor: remoteFeed.author,
                        medium: remoteFeed.medium,
                        explicit: matchedEpisode.explicit,
                        
                        // Episode metadata
                        episodeId: matchedEpisode.id,
                        
                        // V4V data if available
                        ...(matchedEpisode.value && { value: matchedEpisode.value }),
                        
                        // HGH context
                        hghMainFeed: mainFeed.title,
                        hghMainFeedId: mainFeed.id,
                        
                        // Resolution metadata
                        source: 'HGH Value Split - Resolved',
                        originalPlaylist: 'HGH Music Playlist',
                        resolvedDate: new Date().toISOString(),
                        resolutionMethod: 'Value Split Remote Feed Resolution'
                    };
                    
                    console.log(`      ✅ Resolved: "${resolvedTrack.title}" by ${resolvedTrack.artist}`);
                }
            }
            
            // If remote feed resolution failed, create placeholder for manual review
            if (!resolvedTrack) {
                resolvedTrack = {
                    id: `hgh_valuesplit_unresolved_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    feedGuid: feedGuid,
                    itemGuid: itemGuid,
                    title: `HGH Value Split ${index + 1}`,
                    artist: 'Unknown Artist',
                    album: 'Homegrown Hits Value Splits',
                    artwork: '/stablekraft-rocket.png',
                    duration: 5999, // 99:99 placeholder
                    audioUrl: null,
                    description: `Value split track from Homegrown Hits playlist. Feed GUID: ${feedGuid}, Item GUID: ${itemGuid}`,
                    pubDate: new Date().toISOString(),
                    
                    // HGH context
                    hghMainFeed: mainFeed.title,
                    hghMainFeedId: mainFeed.id,
                    
                    // Resolution metadata
                    source: 'HGH Value Split - Unresolved',
                    originalPlaylist: 'HGH Music Playlist',
                    needsResolution: true,
                    resolvedDate: new Date().toISOString(),
                    resolutionMethod: 'Value Split Placeholder',
                    durationSource: {
                        method: 'placeholder-duration',
                        reason: 'unresolved value split reference',
                        assignedDate: new Date().toISOString()
                    },
                    artworkSource: {
                        method: 'main-page-background',
                        reason: 'unresolved value split reference',
                        assignedDate: new Date().toISOString()
                    }
                };
                
                console.log(`      ❌ Unresolved: Created placeholder for ${feedGuid.substring(0, 8)}...`);
                failedCount++;
            } else {
                resolvedCount++;
            }
            
            musicData.musicTracks.push(resolvedTrack);
            existingGuids.add(combinedGuid);
            
            // Rate limiting and progress saving
            await delay(500);
            
            if ((index + 1) % 50 === 0) {
                musicData.metadata.lastUpdated = new Date().toISOString();
                fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
                console.log(`   💾 Progress saved (${resolvedCount} resolved, ${failedCount} unresolved so far)\n`);
            }
        }
        
        // Update metadata
        musicData.metadata.lastHghValueSplitResolution = {
            date: new Date().toISOString(),
            sourceUrl: playlistUrl,
            mainFeed: mainFeed.title,
            mainFeedId: mainFeed.id,
            totalValueSplits: remoteItems.length,
            resolved: resolvedCount,
            unresolved: failedCount,
            duplicatesSkipped: duplicateCount,
            method: 'HGH Value Split Resolution'
        };
        
        // Final save
        fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
        
        console.log('\n' + '=' .repeat(60));
        console.log('📊 HGH Value Split Resolution Summary:');
        console.log(`  🎵 Value splits processed: ${remoteItems.length}`);
        console.log(`  ✅ Successfully resolved: ${resolvedCount}`);
        console.log(`  ❌ Unresolved placeholders: ${failedCount}`);
        console.log(`  🔄 Duplicates skipped: ${duplicateCount}`);
        console.log(`  📈 Resolution rate: ${((resolvedCount / remoteItems.length) * 100).toFixed(1)}%`);
        console.log(`  📈 New database total: ${musicData.musicTracks.length}`);
        
        console.log('\n✨ HGH value split resolution complete!');
        if (resolvedCount > 0) {
            console.log(`🎵 Successfully resolved ${resolvedCount} tracks from value split references.`);
        }
        if (failedCount > 0) {
            console.log(`⚠️  ${failedCount} tracks need manual resolution or feed discovery.`);
        }
        
    } catch (error) {
        console.error('❌ Error resolving HGH value splits:', error.message);
        process.exit(1);
    }
}

// Run the resolution
resolveHghValueSplits();