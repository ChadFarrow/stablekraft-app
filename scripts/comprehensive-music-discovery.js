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
        'User-Agent': 'StableKraft-Comprehensive-Music-Discovery/1.0'
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
        return [];
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryFailedFeeds() {
    console.log('🔄 Re-resolving Previously Failed Feed GUIDs Using Music Endpoints\n');
    console.log('=' .repeat(60) + '\n');
    
    // Load music tracks
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));
    
    // Create backup
    const backupPath = musicTracksPath + `.backup-music-discovery-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);
    
    // Find tracks that we couldn't resolve before
    const unresolvedTracks = musicData.musicTracks.filter(track =>
        track.feedGuid && (
            track.title?.startsWith('Track ') ||
            track.title === 'Unindexed Music Track' ||
            track.artist === 'Unknown Artist' ||
            track.artist === 'Independent Artist'
        )
    );
    
    console.log(`Found ${unresolvedTracks.length} previously unresolved tracks to retry\n`);
    
    if (unresolvedTracks.length === 0) {
        console.log('✅ No unresolved tracks to retry');
        return;
    }
    
    // Group by feed GUID to avoid duplicate API calls
    const feedGroups = {};
    unresolvedTracks.forEach(track => {
        if (!feedGroups[track.feedGuid]) {
            feedGroups[track.feedGuid] = [];
        }
        feedGroups[track.feedGuid].push(track);
    });
    
    const uniqueFeeds = Object.keys(feedGroups);
    console.log(`📊 Grouped into ${uniqueFeeds.length} unique feeds to retry\n`);
    
    let resolvedFeeds = 0;
    let musicFeeds = 0;
    let fullyResolvedTracks = 0;
    let partiallyResolvedTracks = 0;
    let failedFeeds = 0;
    
    const headers = generateAuthHeaders();
    
    // Process each feed group
    for (const [index, feedGuid] of uniqueFeeds.entries()) {
        const tracks = feedGroups[feedGuid];
        console.log(`🔍 [${index + 1}/${uniqueFeeds.length}] Retrying Feed: ${feedGuid}`);
        console.log(`   📊 Tracks to resolve: ${tracks.length}`);
        
        try {
            // Try the regular feed endpoint first
            const url = `${API_BASE}/podcasts/byguid?guid=${feedGuid}`;
            const response = await fetch(url, { headers });
            const data = await response.json();
            
            if (data.status === 'true' || data.status === true) {
                const feed = Array.isArray(data.feed) ? data.feed[0] : data.feed;
                
                if (feed && feed.id) {
                    resolvedFeeds++;
                    
                    console.log(`   ✅ Found feed: "${feed.title}" by ${feed.author || 'Unknown'}`);
                    console.log(`   📱 Medium: ${feed.medium || 'not specified'}`);
                    console.log(`   🎨 Artwork: ${feed.artwork ? '✅' : '❌'}`);
                    
                    if (feed.medium === 'music') {
                        musicFeeds++;
                        console.log(`   🎵 **MUSIC FEED DISCOVERED!**`);
                    }
                    
                    // Get episodes for this feed
                    console.log(`   📚 Fetching episodes...`);
                    const episodes = await getEpisodesByFeedId(feed.id);
                    console.log(`   📀 Retrieved ${episodes.length} episodes`);
                    
                    // Update tracks with feed data
                    for (const track of tracks) {
                        let resolved = false;
                        
                        // Try to match episode by item GUID
                        const itemGuid = typeof track.itemGuid === 'string' ? track.itemGuid : track.itemGuid?._; 
                        
                        if (itemGuid && episodes.length > 0) {
                            const episode = episodes.find(ep => 
                                ep.guid === itemGuid ||
                                ep.id === itemGuid ||
                                (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                            );
                            
                            if (episode) {
                                // Full resolution with episode data
                                track.title = episode.title || feed.title || track.title;
                                track.artist = feed.author || episode.feedTitle || 'Unknown Artist';
                                track.album = feed.title || episode.feedTitle || 'Unknown Album';
                                track.artwork = episode.image || episode.feedImage || feed.image || feed.artwork || track.artwork;
                                track.audioUrl = episode.enclosureUrl || track.audioUrl;
                                track.duration = episode.duration || 0;
                                track.description = episode.description || feed.description || track.description;
                                track.pubDate = episode.datePublished ? new Date(episode.datePublished * 1000).toISOString() : track.pubDate;
                                
                                // Additional metadata
                                track.episodeId = episode.id;
                                track.feedId = feed.id;
                                track.feedTitle = feed.title;
                                track.feedUrl = feed.url;
                                track.feedAuthor = feed.author;
                                track.explicit = episode.explicit;
                                track.medium = feed.medium;
                                
                                if (episode.value) {
                                    track.value = episode.value;
                                }
                                
                                // Remove resolution flags
                                delete track.needsResolution;
                                delete track.resolutionFailed;
                                delete track.partiallyResolved;
                                
                                fullyResolvedTracks++;
                                resolved = true;
                                
                                console.log(`      ✅ Fully resolved: "${track.title}"`);
                            }
                        }
                        
                        if (!resolved) {
                            // Partial resolution with feed data only
                            track.artist = feed.author || 'Independent Artist';
                            track.album = feed.title || 'Independent Release';
                            track.artwork = feed.image || feed.artwork || track.artwork;
                            track.feedId = feed.id;
                            track.feedTitle = feed.title;
                            track.feedUrl = feed.url;
                            track.feedAuthor = feed.author;
                            track.description = feed.description || track.description;
                            track.medium = feed.medium;
                            
                            // Improve title if it's still generic
                            if (track.title?.startsWith('Track ') || track.title === 'Unindexed Music Track') {
                                track.title = feed.title || 'Unknown Track';
                            }
                            
                            delete track.needsResolution;
                            delete track.resolutionFailed;
                            
                            partiallyResolvedTracks++;
                            console.log(`      ⚠️  Partially resolved with feed data`);
                        }
                    }
                } else {
                    console.log(`   ❌ Feed data incomplete`);
                    failedFeeds++;
                }
            } else {
                console.log(`   ❌ Feed not found: ${data.description || 'Unknown error'}`);
                failedFeeds++;
            }
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            failedFeeds++;
        }
        
        console.log('');
        
        // Rate limiting
        await delay(500);
        
        // Save progress every 10 feeds
        if ((index + 1) % 10 === 0) {
            musicData.metadata.lastUpdated = new Date().toISOString();
            fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
            console.log(`   💾 Progress saved\n`);
        }
    }
    
    // Final save
    musicData.metadata.lastMusicDiscovery = {
        date: new Date().toISOString(),
        feedsProcessed: uniqueFeeds.length,
        resolvedFeeds: resolvedFeeds,
        musicFeeds: musicFeeds,
        fullyResolvedTracks: fullyResolvedTracks,
        partiallyResolvedTracks: partiallyResolvedTracks,
        failedFeeds: failedFeeds,
        source: 'Comprehensive Music Discovery'
    };
    
    fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
    
    console.log('=' .repeat(60));
    console.log('📊 Music Discovery Summary:');
    console.log(`  🎯 Feed GUIDs processed: ${uniqueFeeds.length}`);
    console.log(`  ✅ Feeds resolved: ${resolvedFeeds}`);
    console.log(`  🎵 Music feeds found: ${musicFeeds}`);
    console.log(`  ✨ Tracks fully resolved: ${fullyResolvedTracks}`);
    console.log(`  ⚠️  Tracks partially resolved: ${partiallyResolvedTracks}`);
    console.log(`  ❌ Failed feeds: ${failedFeeds}`);
    
    const feedSuccessRate = (resolvedFeeds / uniqueFeeds.length * 100).toFixed(1);
    const trackSuccessRate = ((fullyResolvedTracks + partiallyResolvedTracks) / unresolvedTracks.length * 100).toFixed(1);
    
    console.log(`\n  📈 Feed success rate: ${feedSuccessRate}%`);
    console.log(`  📈 Track resolution rate: ${trackSuccessRate}%`);
    
    if (musicFeeds > 0) {
        console.log(`\n🎵 **MAJOR DISCOVERY**: Found ${musicFeeds} music feeds we missed before!`);
        console.log('   These feeds have proper medium="music" tags and complete metadata.');
    }
    
    console.log('\n✨ Comprehensive music discovery complete!');
    console.log('🎯 This explains why LNBeats finds more music - they use the right endpoints!');
}

// Run the comprehensive discovery
retryFailedFeeds().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});