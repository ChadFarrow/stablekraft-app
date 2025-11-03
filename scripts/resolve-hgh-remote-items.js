#!/usr/bin/env node

<<<<<<< HEAD
/**
 * Resolve HGH remote items using the enhanced RSS parser
 */

const fs = require('fs');
const path = require('path');

async function resolveHGHRemoteItems() {
    try {
        console.log('🔍 Resolving HGH remote items...\n');
        
        // Import the RSS parser from src directory
        const { createRSSParser } = await import('../src/lib/rss-parser-config.js');
        const rssParser = createRSSParser();
        
        if (!rssParser) {
            console.log('❌ Enhanced RSS parser not available');
            return;
        }
        
        // Load the main music tracks database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Filter HGH tracks
        const hghTracks = musicData.musicTracks.filter(track => 
            track.source && track.source.includes('HGH')
        );
        
        console.log(`Found ${hghTracks.length} HGH tracks to resolve\n`);
        
        // Collect unique feedGuid+itemGuid pairs that need resolution
        const remoteItemsToResolve = new Set();
        const tracksByRemoteItem = new Map();
        
        hghTracks.forEach((track, index) => {
            const originalIndex = musicData.musicTracks.indexOf(track);
            
            if (track.feedGuid) {
                // For HGH tracks, we need to try resolving them as remote items
                // The feedGuid from HGH tracks should correspond to actual feeds with items
                const key = track.feedGuid;
                remoteItemsToResolve.add(key);
                
                if (!tracksByRemoteItem.has(key)) {
                    tracksByRemoteItem.set(key, []);
                }
                tracksByRemoteItem.get(key).push({
                    track,
                    originalIndex
                });
            }
        });
        
        console.log(`Found ${remoteItemsToResolve.size} unique feed GUIDs to resolve\n`);
        
        const resolvedTracks = [];
        const failedResolutions = [];
        let processedCount = 0;
        
        // Process remote items in smaller batches
        const batchSize = 3;
        const remoteItemsArray = [...remoteItemsToResolve];
        
        for (let i = 0; i < remoteItemsArray.length; i += batchSize) {
            const batch = remoteItemsArray.slice(i, i + batchSize);
            
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(remoteItemsArray.length / batchSize)} (${batch.length} items)...`);
            
            const batchPromises = batch.map(async (feedGuid) => {
                try {
                    processedCount++;
                    
                    // Try to resolve the remote item by looking up the feed
                    const feedData = await rssParser.lookupByFeedGuid(feedGuid);
                    
                    if (feedData && feedData.feed) {
                        const feed = feedData.feed;
                        console.log(`✅ Resolved feed: "${feed.title}" by ${feed.author || 'Unknown'}`);
                        
                        // Get the tracks that need this resolution
                        const tracksToUpdate = tracksByRemoteItem.get(feedGuid) || [];
                        
                        tracksToUpdate.forEach(({ track, originalIndex }) => {
                            const resolvedTrack = {
                                ...track,
                                title: track.title.replace(/^HGH (Featured )?Track \d+$/, feed.title) || track.title,
                                feedTitle: feed.title,
                                feedArtist: feed.author || 'Various Artists',
                                feedDescription: feed.description || 'From HGH Music Playlist',
                                feedUrl: feed.url,
                                feedImage: feed.image,
                                resolvedAt: new Date().toISOString(),
                                resolutionSource: 'podcast-index-feed-lookup',
                                originalSource: track.source
                            };
                            
                            resolvedTracks.push({
                                originalIndex,
                                resolved: resolvedTrack
                            });
                        });
                        
                        return { success: true, feedGuid, feed: feed.title };
                    } else {
                        console.log(`⚠️ No feed found for GUID: ${feedGuid}`);
                        failedResolutions.push({ feedGuid, reason: 'Feed not found in index' });
                        return { success: false, feedGuid };
                    }
                    
                } catch (error) {
                    console.log(`❌ Error resolving ${feedGuid}: ${error.message}`);
                    failedResolutions.push({ feedGuid, reason: error.message });
                    return { success: false, feedGuid, error: error.message };
                }
            });
            
            // Wait for batch to complete
            await Promise.all(batchPromises);
            
            // Small delay between batches
            if (i + batchSize < remoteItemsArray.length) {
                console.log('Waiting 2 seconds before next batch...\n');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`\n📊 Resolution Results:`);
        console.log(`Processed: ${processedCount} feed GUIDs`);
        console.log(`Successfully resolved: ${resolvedTracks.length} tracks`);
        console.log(`Failed resolutions: ${failedResolutions.length}\n`);
        
        if (resolvedTracks.length > 0) {
            console.log(`✅ Sample resolved tracks:`);
            resolvedTracks.slice(0, 10).forEach((item, i) => {
                const track = item.resolved;
                console.log(`  ${i + 1}. "${track.title}"`);
                console.log(`     Artist: "${track.feedArtist}"`);
                console.log(`     Feed: "${track.feedTitle}"`);
                console.log(`     Original: ${track.originalSource}`);
                console.log();
            });
            
            // Apply the resolved data to the original database
            console.log('💾 Applying resolved data to database...');
            resolvedTracks.forEach(({ originalIndex, resolved }) => {
                musicData.musicTracks[originalIndex] = resolved;
            });
            
            // Update metadata
            musicData.metadata = {
                ...musicData.metadata,
                lastUpdated: new Date().toISOString(),
                hghRemoteItemResolution: {
                    date: new Date().toISOString(),
                    resolvedTracks: resolvedTracks.length,
                    failedResolutions: failedResolutions.length,
                    processedFeeds: processedCount
                }
            };
            
            // Create backup
            const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-hgh-remote-${Date.now()}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(musicData, null, 2));
            console.log(`📋 Backup created: ${path.basename(backupPath)}`);
            
            // Save updated database
            fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
            console.log('✅ Database updated with resolved HGH remote items');
            
        } else {
            console.log('⚠️ No tracks were resolved - database not modified');
        }
        
        if (failedResolutions.length > 0 && failedResolutions.length < 20) {
            console.log(`\n❌ Failed resolutions:`);
            failedResolutions.forEach(({ feedGuid, reason }, i) => {
                console.log(`  ${i + 1}. ${feedGuid}: ${reason}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error resolving HGH remote items:', error);
=======
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
        'User-Agent': 'StableKraft-HGH-Remote-Resolver/1.0'
    };
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
        return [];
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveHghRemoteItems() {
    console.log('🏠 Resolving Homegrown Hits Remote Items\n');
    console.log('=' .repeat(60) + '\n');
    
    // Load music tracks 
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));
    
    // Create backup
    const backupPath = musicTracksPath + `.backup-hgh-resolve-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);
    
    // First, let's add back the HGH remote items (they were removed by cleanup)
    console.log('📥 Re-importing HGH remote items from original source...\n');
    
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
        
        // Check what we already have
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
        
        // Group by feedGuid for efficient processing
        const feedGroups = {};
        remoteItems.forEach((item, index) => {
            const feedGuid = item['@_feedGuid'];
            const itemGuid = item['@_itemGuid'];
            
            if (!feedGuid || !itemGuid) return;
            
            const combinedGuid = `${feedGuid}:${itemGuid}`;
            if (existingGuids.has(combinedGuid)) {
                duplicateCount++;
                return;
            }
            
            if (!feedGroups[feedGuid]) {
                feedGroups[feedGuid] = [];
            }
            feedGroups[feedGuid].push({ feedGuid, itemGuid, index });
        });
        
        const uniqueFeeds = Object.keys(feedGroups);
        console.log(`📊 Processing ${uniqueFeeds.length} unique feeds containing ${remoteItems.length - duplicateCount} new items\n`);
        
        // Process each feed
        for (const [feedIndex, feedGuid] of uniqueFeeds.entries()) {
            const items = feedGroups[feedGuid];
            console.log(`🔍 [${feedIndex + 1}/${uniqueFeeds.length}] Processing feed: ${feedGuid.substring(0, 8)}...${feedGuid.substring(-8)}`);
            console.log(`   📊 Items to resolve: ${items.length}`);
            
            // Look up feed in Podcast Index
            const feed = await getFeedByGuid(feedGuid);
            
            if (!feed || !feed.id) {
                console.log(`   ❌ Feed not found in Podcast Index`);
                items.forEach(item => failedCount++);
                await delay(500);
                continue;
            }
            
            console.log(`   ✅ Found feed: "${feed.title}" by ${feed.author || 'Unknown'}`);
            console.log(`   📱 Medium: ${feed.medium || 'not specified'}`);
            console.log(`   🎨 Artwork: ${feed.artwork ? '✅' : '❌'}`);
            
            // Get episodes for this feed
            console.log(`   📚 Fetching episodes...`);
            const episodes = await getEpisodesByFeedId(feed.id);
            console.log(`   📀 Retrieved ${episodes.length} episodes`);
            
            // Resolve each item
            for (const item of items) {
                const { feedGuid, itemGuid, index } = item;
                
                // Try to match episode by itemGuid
                const episode = episodes.find(ep => 
                    ep.guid === itemGuid ||
                    ep.id === itemGuid ||
                    (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                );
                
                if (episode) {
                    // Create resolved track
                    const newTrack = {
                        id: `hgh_resolved_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        feedGuid: feedGuid,
                        itemGuid: itemGuid,
                        title: episode.title || feed.title || `Track ${index + 1}`,
                        artist: feed.author || episode.feedTitle || 'Independent Artist',
                        album: feed.title || episode.feedTitle || 'Homegrown Hits Collection', 
                        artwork: episode.image || episode.feedImage || feed.image || feed.artwork || '/stablekraft-rocket.png',
                        audioUrl: episode.enclosureUrl || null,
                        duration: episode.duration || 5999, // 99:99 if no duration
                        description: episode.description || feed.description || null,
                        pubDate: episode.datePublished ? new Date(episode.datePublished * 1000).toISOString() : new Date().toISOString(),
                        
                        // Feed metadata
                        feedId: feed.id,
                        feedTitle: feed.title,
                        feedUrl: feed.url,
                        feedAuthor: feed.author,
                        medium: feed.medium,
                        explicit: episode.explicit,
                        
                        // Episode metadata
                        episodeId: episode.id,
                        
                        // V4V data if available
                        ...(episode.value && { value: episode.value }),
                        
                        // Resolution metadata
                        source: 'HGH Playlist - Resolved',
                        originalPlaylist: 'HGH Music Playlist',
                        resolvedDate: new Date().toISOString(),
                        resolutionMethod: 'Targeted HGH Resolution'
                    };
                    
                    musicData.musicTracks.push(newTrack);
                    existingGuids.add(`${feedGuid}:${itemGuid}`);
                    resolvedCount++;
                    
                    console.log(`      ✅ Resolved: "${newTrack.title}" - ${Math.floor(newTrack.duration / 60)}:${String(newTrack.duration % 60).padStart(2, '0')}`);
                } else {
                    console.log(`      ❌ Episode not found for itemGuid: ${itemGuid.substring(0, 8)}...`);
                    failedCount++;
                }
            }
            
            await delay(500); // Rate limiting
            
            // Save progress every 10 feeds
            if ((feedIndex + 1) % 10 === 0) {
                musicData.metadata.lastUpdated = new Date().toISOString();
                fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
                console.log(`   💾 Progress saved (${resolvedCount} resolved so far)\n`);
            }
        }
        
        // Update metadata
        musicData.metadata.lastHghResolution = {
            date: new Date().toISOString(),
            sourceUrl: playlistUrl,
            feedsProcessed: uniqueFeeds.length,
            itemsProcessed: remoteItems.length - duplicateCount,
            resolved: resolvedCount,
            failed: failedCount,
            duplicatesSkipped: duplicateCount,
            method: 'Targeted HGH Remote Item Resolution'
        };
        
        // Final save
        fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
        
        console.log('\n' + '=' .repeat(60));
        console.log('📊 HGH Resolution Summary:');
        console.log(`  🎵 Remote items processed: ${remoteItems.length - duplicateCount}`);
        console.log(`  ✅ Successfully resolved: ${resolvedCount}`);
        console.log(`  ❌ Failed to resolve: ${failedCount}`);
        console.log(`  🔄 Duplicates skipped: ${duplicateCount}`);
        console.log(`  📈 Resolution rate: ${((resolvedCount / (remoteItems.length - duplicateCount)) * 100).toFixed(1)}%`);
        console.log(`  📈 New database total: ${musicData.musicTracks.length}`);
        
        console.log('\n✨ HGH remote item resolution complete!');
        if (resolvedCount > 0) {
            console.log(`🎵 Successfully added ${resolvedCount} tracks from Homegrown Hits references.`);
        }
        
    } catch (error) {
        console.error('❌ Error resolving HGH remote items:', error.message);
        process.exit(1);
>>>>>>> 13bd851 (feat: optimize site performance and add HGH playlist to navigation)
    }
}

// Run the resolution
<<<<<<< HEAD
resolveHGHRemoteItems();
=======
resolveHghRemoteItems();
>>>>>>> 13bd851 (feat: optimize site performance and add HGH playlist to navigation)
