#!/usr/bin/env node

/**
 * Resolve HGH (HomegrownHits) playlist tracks that need resolution
 * Targets both "HGH Playlist - Music Reference" and "HGH Featured Track - Unresolved"
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

async function resolveHGHTracks() {
    try {
        console.log('🎵 Resolving HGH (HomegrownHits) Playlist tracks...\n');
        
        // Load existing music tracks
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Find HGH tracks that need resolution
        const hghTracks = musicData.musicTracks.filter(track => 
            track.source && 
            (track.source.includes('HGH Playlist - Music Reference') || 
             track.source.includes('HGH Featured Track - Unresolved')) &&
            track.needsResolution === true
        );
        
        console.log(`Found ${hghTracks.length} HGH tracks needing resolution\n`);
        
        if (hghTracks.length === 0) {
            console.log('✅ All HGH tracks are already resolved!');
            return;
        }
        
        // Group by source for better tracking
        const musicRef = hghTracks.filter(t => t.source.includes('HGH Playlist - Music Reference'));
        const featured = hghTracks.filter(t => t.source.includes('HGH Featured Track - Unresolved'));
        
        console.log(`📊 HGH Track Breakdown:`);
        console.log(`   🎵 Music Reference: ${musicRef.length} tracks`);
        console.log(`   ⭐ Featured Tracks: ${featured.length} tracks\n`);
        
        // Track statistics
        let resolvedCount = 0;
        let errorCount = 0;
        let startTime = Date.now();
        
        // Process each track
        for (let i = 0; i < hghTracks.length; i++) {
            const track = hghTracks[i];
            const trackIndex = musicData.musicTracks.indexOf(track);
            
            console.log(`[${i + 1}/${hghTracks.length}] Resolving track ${track.id}:`);
            console.log(`  Source: ${track.source.replace('HGH ', '')}`);
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
            
            // Save progress every 25 tracks (HGH is a big batch)
            if ((i + 1) % 25 === 0 || i === hghTracks.length - 1) {
                fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
                
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                const rate = Math.round((i + 1) / elapsed * 60); // tracks per minute
                const remaining = hghTracks.length - (i + 1);
                const eta = remaining > 0 ? Math.round(remaining / (rate / 60) / 60) : 0; // hours
                
                console.log(`  💾 Saved progress (${i + 1}/${hghTracks.length})`);
                console.log(`  📊 Rate: ${rate} tracks/min | ETA: ${eta}h ${Math.round((remaining / (rate / 60)) % 60)}m\n`);
            }
            
            // Add a small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Final save and metadata update
        musicData.metadata.lastUpdated = new Date().toISOString();
        musicData.metadata.resolvedTracks = musicData.musicTracks.filter(t => 
            t.needsResolution === false && t.title !== `Track ${t.id}`
        ).length;
        musicData.metadata.pendingResolution = musicData.musicTracks.filter(t => 
            t.needsResolution === true
        ).length;
        
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        
        // Print summary
        const successRate = Math.round((resolvedCount / hghTracks.length) * 100);
        const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 HGH RESOLUTION SUMMARY:');
        console.log('='.repeat(60));
        console.log(`   ✅ Successfully resolved: ${resolvedCount} tracks (${successRate}%)`);
        console.log(`   ❌ Failed to resolve: ${errorCount} tracks`);
        console.log(`   ⏱️  Total time: ${totalTime} minutes`);
        console.log(`   📚 Total tracks in database: ${musicData.metadata.totalTracks}`);
        console.log(`   🎯 Database now ${Math.round((musicData.metadata.resolvedTracks / musicData.metadata.totalTracks) * 100)}% resolved`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error resolving HGH tracks:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    resolveHGHTracks();
}

module.exports = { resolveHGHTracks };