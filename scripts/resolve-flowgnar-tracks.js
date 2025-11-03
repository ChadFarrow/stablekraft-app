#!/usr/bin/env node

/**
 * Resolve Flowgnar playlist tracks that need resolution
 */

const fs = require('fs');
const path = require('path');

// Load environment variables for Podcast Index API
require('dotenv').config({ path: '.env.local' });

const PODCAST_INDEX_API_KEY = process.env.PODCAST_INDEX_API_KEY;
const PODCAST_INDEX_API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

// Helper function to create auth headers for Podcast Index API
function createPodcastIndexAuthHeaders() {
    if (!PODCAST_INDEX_API_KEY || !PODCAST_INDEX_API_SECRET) {
        console.error('❌ Podcast Index API credentials not found in .env.local');
        return null;
    }
    
    const crypto = require('crypto');
    const apiTime = Math.floor(Date.now() / 1000);
    const authString = PODCAST_INDEX_API_KEY + PODCAST_INDEX_API_SECRET + apiTime;
    const authHeader = crypto.createHash('sha1').update(authString).digest('hex');
    
    return {
        'User-Agent': 'StableKraft-MusicPlaylist/1.0',
        'X-Auth-Date': apiTime.toString(),
        'X-Auth-Key': PODCAST_INDEX_API_KEY,
        'Authorization': authHeader
    };
}

// Function to resolve a remote item via Podcast Index API
async function resolveRemoteItem(feedGuid, itemGuid) {
    const headers = createPodcastIndexAuthHeaders();
    if (!headers) return null;
    
    try {
        // First, get the feed URL from the feedGuid
        const feedResponse = await fetch(`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${feedGuid}`, {
            headers
        });
        
        if (!feedResponse.ok) {
            console.log(`  ❌ Failed to lookup feed ${feedGuid}: ${feedResponse.status}`);
            return null;
        }
        
        const feedData = await feedResponse.json();
        if (!feedData.feed) {
            console.log(`  ❌ Feed not found for GUID ${feedGuid}`);
            return null;
        }
        
        // Now get episodes from this feed
        const episodesResponse = await fetch(`https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=${feedData.feed.id}&max=1000`, {
            headers
        });
        
        if (!episodesResponse.ok) {
            console.log(`  ❌ Failed to get episodes for feed ${feedData.feed.id}: ${episodesResponse.status}`);
            return null;
        }
        
        const episodesData = await episodesResponse.json();
        
        // Find the specific episode by itemGuid
        const episode = episodesData.items?.find(item => item.guid === itemGuid);
        
        if (!episode) {
            console.log(`  ❌ Episode not found for itemGuid ${itemGuid}`);
            return null;
        }
        
        return {
            title: episode.title,
            artist: feedData.feed.author || feedData.feed.title,
            album: feedData.feed.title,
            image: episode.image || feedData.feed.image || feedData.feed.artwork,
            audioUrl: episode.enclosureUrl,
            duration: episode.duration || 0,
            feedTitle: feedData.feed.title,
            publishDate: episode.datePublished
        };
    } catch (error) {
        console.log(`  ❌ Error resolving: ${error.message}`);
        return null;
    }
}

async function resolveFlowgnarTracks() {
    try {
        console.log('🎵 Resolving Flowgnar Music Playlist tracks...\n');
        
        // Load existing music tracks
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Find Flowgnar tracks that need resolution
        const flowgnarTracks = musicData.musicTracks.filter(track => 
            track.source && track.source.includes('Flowgnar') && 
            track.needsResolution === true
        );
        
        console.log(`Found ${flowgnarTracks.length} Flowgnar tracks needing resolution\n`);
        
        if (flowgnarTracks.length === 0) {
            console.log('✅ All Flowgnar tracks are already resolved!');
            return;
        }
        
        // Track statistics
        let resolvedCount = 0;
        let errorCount = 0;
        
        // Process each track
        for (let i = 0; i < flowgnarTracks.length; i++) {
            const track = flowgnarTracks[i];
            const trackIndex = musicData.musicTracks.indexOf(track);
            
            console.log(`[${i + 1}/${flowgnarTracks.length}] Resolving track ${track.id}:`);
            console.log(`  Feed GUID: ${track.feedGuid}`);
            console.log(`  Item GUID: ${track.itemGuid}`);
            
            // Resolve the remote item
            const resolved = await resolveRemoteItem(track.feedGuid, track.itemGuid);
            
            if (resolved) {
                // Update the track with resolved data
                musicData.musicTracks[trackIndex] = {
                    ...track,
                    title: resolved.title,
                    artist: resolved.artist,
                    album: resolved.album || track.album,
                    artwork: resolved.image || track.artwork,
                    image: resolved.image || track.image,
                    audioUrl: resolved.audioUrl || track.audioUrl,
                    duration: resolved.duration || track.duration,
                    feedTitle: resolved.feedTitle,
                    publishDate: resolved.publishDate || track.publishDate,
                    needsResolution: false,
                    resolvedAt: new Date().toISOString()
                };
                
                console.log(`  ✅ Resolved: ${resolved.title} by ${resolved.artist}`);
                resolvedCount++;
            } else {
                console.log(`  ❌ Failed to resolve`);
                errorCount++;
            }
            
            // Save progress every 10 tracks
            if ((i + 1) % 10 === 0 || i === flowgnarTracks.length - 1) {
                fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
                console.log(`  💾 Saved progress (${i + 1}/${flowgnarTracks.length})\n`);
            }
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Final save
        musicData.metadata.lastUpdated = new Date().toISOString();
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        
        // Print summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 RESOLUTION SUMMARY:');
        console.log(`   ✅ Successfully resolved: ${resolvedCount} tracks`);
        console.log(`   ❌ Failed to resolve: ${errorCount} tracks`);
        console.log(`   📚 Total tracks in database: ${musicData.metadata.totalTracks}`);
        console.log('='.repeat(50));
        
    } catch (error) {
        console.error('❌ Error resolving Flowgnar tracks:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    resolveFlowgnarTracks();
}

module.exports = { resolveFlowgnarTracks };