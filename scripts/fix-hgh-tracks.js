#!/usr/bin/env node

/**
 * Fix HGH tracks by updating them to use the correct feed approach
 * Since the remote items reference feedGuids not in the index,
 * but the tracks should resolve against the actual HGH show feed
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

async function fixHGHTracks() {
    try {
        console.log('🔧 Fixing HGH tracks resolution approach...\n');
        
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Get HGH tracks that were marked as non-resolvable
        const hghTracks = musicData.musicTracks.filter(track => 
            track.source && track.source.includes('HGH')
        );
        
        console.log(`Found ${hghTracks.length} HGH tracks to fix`);
        
        // Get episodes from the actual HGH show feed (ID: 6611624)
        const headers = createPodcastIndexAuthHeaders();
        if (!headers) return;
        
        console.log('📡 Getting episodes from actual HGH show feed (ID: 6611624)...');
        const episodesResponse = await fetch('https://api.podcastindex.org/api/1.0/episodes/byfeedid?id=6611624&max=500', { headers });
        const episodesData = await episodesResponse.json();
        
        if (!episodesData.items || episodesData.items.length === 0) {
            console.error('❌ No episodes found in HGH show feed');
            return;
        }
        
        console.log(`Found ${episodesData.items.length} episodes in HGH show feed`);
        
        // Strategy: Try to resolve HGH tracks by matching their itemGuids with episodes
        let resolvedCount = 0;
        let updatedCount = 0;
        
        console.log('\n🎵 Attempting to resolve HGH tracks...');
        
        for (let i = 0; i < hghTracks.length; i++) {
            const track = hghTracks[i];
            const trackIndex = musicData.musicTracks.indexOf(track);
            
            // Try to find matching episode by itemGuid
            const episode = episodesData.items.find(ep => ep.guid === track.itemGuid);
            
            if (episode) {
                // Update track with resolved data from actual HGH show
                musicData.musicTracks[trackIndex] = {
                    ...track,
                    title: episode.title,
                    artist: 'Homegrown Hits', // Show name
                    album: 'Homegrown Hits',
                    artwork: episode.image || 'https://feed.homegrownhits.xyz/artwork.jpg',
                    image: episode.image || 'https://feed.homegrownhits.xyz/artwork.jpg',
                    audioUrl: episode.enclosureUrl,
                    duration: episode.duration || 0,
                    feedTitle: 'Homegrown Hits',
                    feedGuid: 'ac746d09-7c3b-5bcd-b28a-f12d6456ca8f', // Correct HGH show feed GUID
                    publishDate: episode.datePublished,
                    needsResolution: false,
                    resolvedAt: new Date().toISOString(),
                    resolutionNote: 'Resolved using actual HGH show feed'
                };
                
                console.log(`  ✅ Resolved: ${episode.title}`);
                resolvedCount++;
            } else {
                // Mark as updated but still unresolvable
                musicData.musicTracks[trackIndex] = {
                    ...track,
                    needsResolution: false,
                    resolvedAt: new Date().toISOString(),
                    resolutionNote: 'itemGuid not found in HGH show episodes'
                };
                updatedCount++;
            }
            
            // Progress indicator
            if ((i + 1) % 100 === 0) {
                console.log(`  Progress: ${i + 1}/${hghTracks.length} tracks processed`);
            }
        }
        
        // Update metadata
        musicData.metadata.lastUpdated = new Date().toISOString();
        musicData.metadata.pendingResolution = musicData.musicTracks.filter(t => t.needsResolution === true).length;
        
        // Save updated database
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        
        // Print summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 HGH TRACKS FIX SUMMARY:');
        console.log('='.repeat(60));
        console.log(`   ✅ Successfully resolved: ${resolvedCount} tracks`);
        console.log(`   ⚠️  Updated but unresolvable: ${updatedCount} tracks`);
        console.log(`   📚 Total HGH tracks processed: ${hghTracks.length}`);
        console.log(`   🎯 Remaining tracks needing resolution: ${musicData.metadata.pendingResolution}`);
        
        if (resolvedCount > 0) {
            const successRate = Math.round((resolvedCount / hghTracks.length) * 100);
            console.log(`   📈 HGH resolution rate: ${successRate}%`);
        }
        
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error fixing HGH tracks:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    fixHGHTracks();
}

module.exports = { fixHGHTracks };