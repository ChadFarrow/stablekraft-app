#!/usr/bin/env node

/**
 * Automated playlist feed discovery
 * This script should be run periodically to discover new feeds from all playlists
 * and add them to the feeds.json for comprehensive parsing
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration - All 9 playlist XML files from https://github.com/ChadFarrow/chadf-musicl-playlists
const PLAYLISTS = [
    {
        name: 'MMM Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMM-music-playlist.xml',
        source: 'MMM Playlist'
    },
    {
        name: 'HGH Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml',
        source: 'HGH Playlist'
    },
    {
        name: 'IAM Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/IAM-music-playlist.xml',
        source: 'IAM Playlist'
    },
    {
        name: 'ITDV Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml',
        source: 'ITDV Playlist'
    },
    {
        name: 'B4TS Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/b4ts-music-playlist.xml',
        source: 'B4TS Playlist'
    },
    {
        name: 'Upbeats Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/upbeats-music-playlist.xml',
        source: 'Upbeats Playlist'
    },
    {
        name: 'MMT Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/MMT-muic-playlist.xml',
        source: 'MMT Playlist'
    },
    {
        name: 'SAS Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/SAS-music-playlist.xml',
        source: 'SAS Playlist'
    },
    {
        name: 'Flowgnar Music Playlist',
        url: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/flowgnar-music-playlist.xml',
        source: 'Flowgnar Playlist'
    }
];

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
        'User-Agent': 'StableKraft-Auto-Playlist-Discovery/1.0'
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateFeedId(title, author) {
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const cleanAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `${cleanAuthor}-${cleanTitle}`.substring(0, 50);
}

async function extractFeedGuidsFromPlaylist(playlistUrl) {
    try {
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlContent = await response.text();

        // Parse XML to extract unique feed GUIDs
        const { XMLParser } = require('fast-xml-parser');
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            isArray: (name) => name === 'podcast:remoteItem'
        });

        const parsedXml = parser.parse(xmlContent);
        const channel = parsedXml?.rss?.channel;
        let remoteItems = channel?.['podcast:remoteItem'] || [];

        if (!Array.isArray(remoteItems)) {
            remoteItems = [remoteItems];
        }

        const uniqueFeedGuids = new Set();
        remoteItems.forEach(item => {
            const feedGuid = item['@_feedGuid'];
            if (feedGuid) {
                uniqueFeedGuids.add(feedGuid);
            }
        });

        return Array.from(uniqueFeedGuids);
    } catch (error) {
        console.error(`❌ Error parsing playlist ${playlistUrl}:`, error.message);
        return [];
    }
}

async function processFeedsInParallel(feedGuids, source, existingFeedGuids) {
    const BATCH_SIZE = 10;
    const newFeeds = [];

    // Filter out existing feeds
    const feedsToProcess = feedGuids.filter(guid => !existingFeedGuids.has(guid));

    if (feedsToProcess.length === 0) {
        console.log(`   ✅ All ${feedGuids.length} feeds already in database`);
        return [];
    }

    console.log(`   🔄 Processing ${feedsToProcess.length} new feeds (${feedGuids.length - feedsToProcess.length} already exist)...`);

    // Create batches
    const batches = [];
    for (let i = 0; i < feedsToProcess.length; i += BATCH_SIZE) {
        batches.push(feedsToProcess.slice(i, i + BATCH_SIZE));
    }

    async function processFeed(feedGuid) {
        try {
            const feedInfo = await getFeedByGuid(feedGuid);
            if (!feedInfo) {
                return null;
            }

            return {
                id: generateFeedId(feedInfo.title, feedInfo.author || 'unknown'),
                title: feedInfo.title,
                artist: feedInfo.author || 'Unknown Artist',
                description: feedInfo.description || '',
                image: feedInfo.artwork || feedInfo.image || '/placeholder-podcast.jpg',
                originalUrl: feedInfo.url,
                feedGuid: feedGuid,
                guid: feedGuid,
                priority: 100,
                status: 'active',
                type: feedInfo.medium === 'music' ? 'album' : 'podcast',
                explicit: feedInfo.explicit || false,
                language: feedInfo.language || 'en',
                podcastIndexId: feedInfo.id,
                medium: feedInfo.medium || 'podcast',
                categories: feedInfo.categories || [],
                discoveredVia: source,
                discoveredAt: new Date().toISOString(),
                lastFetched: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                ...(feedInfo.locked && { locked: feedInfo.locked }),
                ...(feedInfo.fundingUrl && { fundingUrl: feedInfo.fundingUrl }),
                ...(feedInfo.value && { value: feedInfo.value }),
                ...(feedInfo.newestItemPubdate && { newestItemPubdate: feedInfo.newestItemPubdate }),
                ...(feedInfo.episodeCount && { episodeCount: feedInfo.episodeCount })
            };
        } catch (error) {
            return null;
        }
    }

    // Process batches
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const promises = batch.map(processFeed);
        const results = await Promise.all(promises);
        const successfulFeeds = results.filter(feed => feed !== null);
        newFeeds.push(...successfulFeeds);

        // Progress indicator
        const processed = Math.min((i + 1) * BATCH_SIZE, feedsToProcess.length);
        console.log(`   📊 Processed ${processed}/${feedsToProcess.length} feeds (${successfulFeeds.length} successful)`);

        // Small delay between batches
        if (i < batches.length - 1) {
            await delay(150);
        }
    }

    return newFeeds;
}

async function autoDiscoverPlaylistFeeds() {
    console.log('🤖 Automated Playlist Feed Discovery\n');
    console.log('=' .repeat(60) + '\n');

    // Load existing feeds database
    const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
    const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

    // Create backup
    const backupPath = feedsPath + `.backup-auto-discovery-${Date.now()}`;
    console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
    fs.copyFileSync(feedsPath, backupPath);

    // Build set of existing feed GUIDs
    const existingFeedGuids = new Set();
    feedsData.feeds.forEach(feed => {
        if (feed.feedGuid) existingFeedGuids.add(feed.feedGuid);
        if (feed.guid) existingFeedGuids.add(feed.guid);
    });

    let totalNewFeeds = 0;
    const discoveryResults = {};

    // Process each playlist
    for (const playlist of PLAYLISTS) {
        console.log(`🎵 Processing ${playlist.name}...`);
        console.log(`   📡 Fetching: ${playlist.url}`);

        const feedGuids = await extractFeedGuidsFromPlaylist(playlist.url);
        console.log(`   📋 Found ${feedGuids.length} unique feeds`);

        if (feedGuids.length === 0) {
            console.log(`   ⚠️ No feeds found in playlist\n`);
            continue;
        }

        const newFeeds = await processFeedsInParallel(feedGuids, playlist.source, existingFeedGuids);

        if (newFeeds.length > 0) {
            feedsData.feeds.push(...newFeeds);
            // Update existing set to prevent duplicates across playlists
            newFeeds.forEach(feed => existingFeedGuids.add(feed.feedGuid));
        }

        discoveryResults[playlist.name] = {
            totalFeeds: feedGuids.length,
            newFeeds: newFeeds.length,
            skipped: feedGuids.length - newFeeds.length
        };

        totalNewFeeds += newFeeds.length;
        console.log(`   ✅ Added ${newFeeds.length} new feeds\n`);
    }

    // Update metadata and save
    if (totalNewFeeds > 0) {
        feedsData.metadata = feedsData.metadata || {};
        feedsData.metadata.lastAutoPlaylistDiscovery = {
            date: new Date().toISOString(),
            results: discoveryResults,
            totalNewFeeds: totalNewFeeds,
            totalFeeds: feedsData.feeds.length
        };
        feedsData.metadata.lastUpdated = new Date().toISOString();

        fs.writeFileSync(feedsPath, JSON.stringify(feedsData, null, 2));
        console.log(`💾 Saved ${totalNewFeeds} new feeds to feeds.json\n`);
    }

    // Summary
    console.log('=' .repeat(60));
    console.log('📊 Auto-Discovery Summary:');
    Object.entries(discoveryResults).forEach(([name, result]) => {
        console.log(`  ${name}:`);
        console.log(`    🔍 Total feeds: ${result.totalFeeds}`);
        console.log(`    ✅ New feeds: ${result.newFeeds}`);
        console.log(`    ⚠️ Skipped: ${result.skipped}`);
    });
    console.log(`  📈 Total new feeds added: ${totalNewFeeds}`);
    console.log(`  📈 Total feeds in database: ${feedsData.feeds.length}`);

    // Also export all unique feedGuids to /tmp/feeds-to-add.json for database import
    const allFeedGuids = [];
    feedsData.feeds.forEach(feed => {
        if (feed.feedGuid) allFeedGuids.push(feed.feedGuid);
        else if (feed.guid) allFeedGuids.push(feed.guid);
    });
    const uniqueFeedGuids = [...new Set(allFeedGuids)];
    fs.writeFileSync('/tmp/feeds-to-add.json', JSON.stringify(uniqueFeedGuids, null, 2));
    console.log(`\n📤 Exported ${uniqueFeedGuids.length} unique feedGuids to /tmp/feeds-to-add.json`);

    if (totalNewFeeds > 0) {
        console.log('\n✨ Auto-discovery complete!');
        console.log('🚀 Run add-missing-playlist-feeds.js to import to database:');
        console.log('   Command: node scripts/add-missing-playlist-feeds.js');
    } else {
        console.log('\n✨ No new feeds discovered - all playlists up to date!');
        console.log('🚀 Run add-missing-playlist-feeds.js to import any missing feeds to database:');
        console.log('   Command: node scripts/add-missing-playlist-feeds.js');
    }
}

// Run the auto-discovery
autoDiscoverPlaylistFeeds().catch(error => {
    console.error('❌ Auto-discovery failed:', error.message);
    process.exit(1);
});