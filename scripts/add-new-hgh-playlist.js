#!/usr/bin/env node

/**
 * Add the new HGH playlist from the updated XML source
 * https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml
 */

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
        'User-Agent': 'FUCKIT-HGH-Playlist-Import/1.0'
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

async function addNewHghPlaylist() {
    console.log('🎵 Adding New HGH Music Playlist\n');
    console.log('=' .repeat(60) + '\n');

    // Load music tracks
    const musicTracksPath = path.join(__dirname, '..', 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicTracksPath, 'utf8'));

    // Create backup
    const backupPath = musicTracksPath + `.backup-new-hgh-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(musicTracksPath, backupPath);

    // Fetch the new playlist XML
    console.log('📥 Fetching HGH playlist from GitHub...\n');

    const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

    try {
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlContent = await response.text();
        console.log(`✅ Downloaded XML content (${xmlContent.length} characters)\n`);

        // Parse XML
        const { XMLParser } = require('fast-xml-parser');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            isArray: (name) => name === 'podcast:remoteItem'
        });

        const parsedXml = parser.parse(xmlContent);

        // Extract playlist metadata
        const channel = parsedXml?.rss?.channel;
        const playlistTitle = channel?.title || 'Homegrown Hits Music Playlist';
        const playlistAuthor = channel?.['itunes:author'] || channel?.author || 'ChadF';
        const playlistGuid = channel?.guid || 'unknown';

        console.log(`📋 Playlist Info:`);
        console.log(`   Title: ${playlistTitle}`);
        console.log(`   Author: ${playlistAuthor}`);
        console.log(`   GUID: ${playlistGuid}\n`);

        // Extract remote items
        let remoteItems = channel?.['podcast:remoteItem'] || [];

        if (!Array.isArray(remoteItems)) {
            remoteItems = [remoteItems];
        }

        console.log(`🔍 Found ${remoteItems.length} remote items to process\n`);

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
        let processedFeeds = 0;

        // Group by feedGuid for efficient processing
        const feedGroups = {};
        remoteItems.forEach((item, index) => {
            const feedGuid = item['@_feedGuid'];
            const itemGuid = item['@_itemGuid'];

            if (!feedGuid || !itemGuid) {
                console.log(`⚠️ Skipping item ${index + 1}: missing feedGuid or itemGuid`);
                return;
            }

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
        console.log(`📊 Processing ${uniqueFeeds.length} unique feeds containing ${remoteItems.length - duplicateCount} new items`);
        console.log(`🔄 Skipping ${duplicateCount} duplicate items\n`);

        // Process each feed
        for (const [feedIndex, feedGuid] of uniqueFeeds.entries()) {
            const items = feedGroups[feedGuid];
            processedFeeds++;

            console.log(`🔍 [${feedIndex + 1}/${uniqueFeeds.length}] Processing feed: ${feedGuid.substring(0, 8)}...${feedGuid.substring(feedGuid.length - 8)}`);
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
                    ep.id.toString() === itemGuid ||
                    (ep.enclosureUrl && ep.enclosureUrl.includes(itemGuid))
                );

                if (episode) {
                    // Create resolved track
                    const newTrack = {
                        id: `hgh_new_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        feedGuid: feedGuid,
                        itemGuid: itemGuid,
                        title: episode.title || feed.title || `Track ${index + 1}`,
                        artist: feed.author || episode.feedAuthor || 'Independent Artist',
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
                        episodeTitle: episode.title,
                        episodeDate: episode.datePublished ? new Date(episode.datePublished * 1000) : new Date(),

                        // V4V data if available
                        ...(episode.value && { value: episode.value }),

                        // Timing information (for HGH playlist, these are individual tracks)
                        startTime: 0,
                        endTime: episode.duration || 5999,

                        // Source metadata
                        source: 'HGH New Playlist',
                        originalPlaylist: playlistTitle,
                        playlistAuthor: playlistAuthor,
                        playlistGuid: playlistGuid,
                        feedUrl: feed.url,
                        discoveredAt: new Date(),
                        resolvedDate: new Date().toISOString(),
                        resolutionMethod: 'New HGH Playlist Import'
                    };

                    musicData.musicTracks.push(newTrack);
                    existingGuids.add(`${feedGuid}:${itemGuid}`);
                    resolvedCount++;

                    const durationStr = newTrack.duration && newTrack.duration < 5999
                        ? `${Math.floor(newTrack.duration / 60)}:${String(newTrack.duration % 60).padStart(2, '0')}`
                        : 'Unknown';

                    console.log(`      ✅ Resolved: "${newTrack.title}" - ${durationStr}`);
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
        musicData.metadata.lastHghNewPlaylistImport = {
            date: new Date().toISOString(),
            sourceUrl: playlistUrl,
            playlistTitle: playlistTitle,
            playlistAuthor: playlistAuthor,
            playlistGuid: playlistGuid,
            feedsProcessed: processedFeeds,
            itemsProcessed: remoteItems.length - duplicateCount,
            resolved: resolvedCount,
            failed: failedCount,
            duplicatesSkipped: duplicateCount,
            method: 'New HGH Playlist Import'
        };

        // Final save
        fs.writeFileSync(musicTracksPath, JSON.stringify(musicData, null, 2));

        console.log('\n' + '=' .repeat(60));
        console.log('📊 New HGH Playlist Import Summary:');
        console.log(`  🎵 Remote items processed: ${remoteItems.length - duplicateCount}`);
        console.log(`  ✅ Successfully resolved: ${resolvedCount}`);
        console.log(`  ❌ Failed to resolve: ${failedCount}`);
        console.log(`  🔄 Duplicates skipped: ${duplicateCount}`);
        console.log(`  📈 Resolution rate: ${((resolvedCount / (remoteItems.length - duplicateCount)) * 100).toFixed(1)}%`);
        console.log(`  📈 New database total: ${musicData.musicTracks.length}`);

        console.log('\n✨ New HGH playlist import complete!');
        if (resolvedCount > 0) {
            console.log(`🎵 Successfully added ${resolvedCount} tracks from the updated Homegrown Hits playlist.`);
        }

    } catch (error) {
        console.error('❌ Error importing new HGH playlist:', error.message);
        process.exit(1);
    }
}

// Run the import
addNewHghPlaylist();