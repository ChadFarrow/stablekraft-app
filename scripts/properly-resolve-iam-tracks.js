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
        'User-Agent': 'StableKraft-Music-Resolver/1.0'
    };
}

async function getFeedByGuid(feedGuid) {
    try {
        const headers = generateAuthHeaders();
        const url = `${API_BASE}/podcasts/byguid?guid=${feedGuid}`;
        
        const response = await fetch(url, { headers });
        const data = await response.json();
        
        if (data.status === 'true' || data.status === true) {
            if (data.feed && data.feed.length > 0) {
                return data.feed[0];
            } else if (data.feed) {
                return data.feed;
            }
        }
        return null;
    } catch (error) {
        console.log(`  ❌ Error fetching feed: ${error.message}`);
        return null;
    }
}

async function getEpisodesByFeedId(feedId, maxEpisodes = 1000) {
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
        console.log(`  ❌ Error fetching episodes: ${error.message}`);
        return [];
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveIAMTracks() {
    console.log('🎵 Properly Resolving IAM Playlist Tracks\n');
    console.log('=' .repeat(50) + '\n');
    
    // Load music tracks
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));
    
    // Create backup
    const backupPath = musicTracksPath + `.backup-proper-resolve-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);
    
    // Find IAM tracks that need resolution
    const tracksToResolve = musicData.musicTracks.filter(track => 
        track.source === 'IAM Playlist Import' &&
        track.needsResolution === true &&
        track.feedGuid && 
        track.itemGuid
    );
    
    console.log(`Found ${tracksToResolve.length} IAM tracks to resolve\n`);
    
    if (tracksToResolve.length === 0) {
        console.log('✅ No IAM tracks need resolution');
        return;
    }
    
    // Group tracks by feed GUID
    const feedGroups = {};
    tracksToResolve.forEach(track => {
        if (!feedGroups[track.feedGuid]) {
            feedGroups[track.feedGuid] = [];
        }
        feedGroups[track.feedGuid].push(track);
    });
    
    const uniqueFeeds = Object.keys(feedGroups).length;
    console.log(`📊 Grouped into ${uniqueFeeds} unique feeds\n`);
    console.log('=' .repeat(50) + '\n');
    
    let resolvedCount = 0;
    let partialCount = 0;
    let failedCount = 0;
    let feedIndex = 0;
    
    // Cache for feed data
    const feedCache = {};
    const episodeCache = {};
    
    // Process each feed group
    for (const [feedGuid, tracks] of Object.entries(feedGroups)) {
        feedIndex++;
        console.log(`📁 [${feedIndex}/${uniqueFeeds}] Processing Feed GUID: ${feedGuid}`);
        console.log(`   Tracks to resolve: ${tracks.length}`);
        
        let feed = null;
        let episodes = [];
        
        // Check if we've already fetched this feed
        if (feedCache[feedGuid]) {
            feed = feedCache[feedGuid];
            episodes = episodeCache[feedGuid] || [];
            console.log(`   ✨ Using cached feed data: ${feed.title || 'Unknown'}`);
        } else {
            // Fetch feed information
            console.log('   🔍 Looking up feed...');
            feed = await getFeedByGuid(feedGuid);
            
            if (feed) {
                feedCache[feedGuid] = feed;
                console.log(`   ✅ Found feed: "${feed.title || 'Unknown'}" by ${feed.author || 'Unknown'}`);
                console.log(`   📝 Feed ID: ${feed.id}`);
                
                // Fetch episodes for this feed
                if (feed.id) {
                    console.log('   📚 Fetching episodes...');
                    episodes = await getEpisodesByFeedId(feed.id);
                    episodeCache[feedGuid] = episodes;
                    console.log(`   ✅ Retrieved ${episodes.length} episodes`);
                }
            } else {
                console.log('   ❌ Feed not found in Podcast Index');
            }
        }
        
        // Process each track in this feed group
        for (const track of tracks) {
            const itemGuid = track.itemGuid;
            console.log(`\n   🎵 Resolving item GUID: ${itemGuid}`);
            
            if (feed && episodes.length > 0) {
                // Find the specific episode
                const episode = episodes.find(ep => 
                    ep.guid === itemGuid ||
                    ep.id === itemGuid ||
                    (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                );
                
                if (episode) {
                    // Update track with full metadata
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
                    track.episodeType = episode.episodeType;
                    
                    // Value block (V4V info)
                    if (episode.value) {
                        track.value = episode.value;
                    }
                    
                    // Remove resolution flags
                    delete track.needsResolution;
                    delete track.resolutionFailed;
                    
                    console.log(`      ✅ Fully resolved: "${track.title}" by ${track.artist}`);
                    resolvedCount++;
                } else {
                    // Episode not found, use feed data only
                    track.artist = feed.author || 'Unknown Artist';
                    track.album = feed.title || 'Unknown Album';
                    track.artwork = feed.image || feed.artwork || track.artwork;
                    track.feedId = feed.id;
                    track.feedTitle = feed.title;
                    track.feedUrl = feed.url;
                    track.feedAuthor = feed.author;
                    track.description = feed.description || track.description;
                    
                    // Mark as partially resolved
                    track.partiallyResolved = true;
                    delete track.needsResolution;
                    delete track.resolutionFailed;
                    
                    console.log(`      ⚠️  Partially resolved (episode not found in feed)`);
                    partialCount++;
                }
            } else {
                // No feed data available
                track.resolutionFailed = true;
                delete track.needsResolution;
                console.log(`      ❌ Could not resolve (feed not found)`);
                failedCount++;
            }
        }
        
        // Save progress after each feed
        musicData.metadata.lastUpdated = new Date().toISOString();
        fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
        
        // Rate limiting between feeds
        if (feedIndex < uniqueFeeds) {
            console.log('\n   ⏳ Waiting before next feed...\n');
            await delay(500);
        }
    }
    
    // Final save with summary
    musicData.metadata.lastResolution = {
        date: new Date().toISOString(),
        fullyResolved: resolvedCount,
        partiallyResolved: partialCount,
        failed: failedCount,
        source: 'IAM Playlist Proper Resolution'
    };
    
    fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));
    
    console.log('\n' + '=' .repeat(50));
    console.log('📊 Resolution Summary:');
    console.log(`  ✅ Fully resolved: ${resolvedCount} tracks`);
    console.log(`  ⚠️  Partially resolved: ${partialCount} tracks`);
    console.log(`  ❌ Failed: ${failedCount} tracks`);
    console.log(`  📚 Total tracks in database: ${musicData.musicTracks.length}`);
    
    const successRate = ((resolvedCount + partialCount) / tracksToResolve.length * 100).toFixed(1);
    console.log(`\n  📈 Success rate: ${successRate}%`);
    
    if (failedCount > 0) {
        console.log('\n💡 Failed tracks may be from:');
        console.log('  - Private or unlisted feeds');
        console.log('  - Feeds not yet indexed');
        console.log('  - Invalid or changed GUIDs');
    }
    
    if (partialCount > 0) {
        console.log('\n📝 Partially resolved tracks have feed info but missing episode.');
        console.log('   The episode GUIDs may have changed or been removed.');
    }
    
    console.log('\n✨ Resolution complete!');
}

// Run the resolution
resolveIAMTracks().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});