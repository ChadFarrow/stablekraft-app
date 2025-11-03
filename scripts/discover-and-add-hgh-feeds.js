#!/usr/bin/env node

/**
 * Discover and add all feeds referenced in HGH playlist
 * This script analyzes the HGH playlist, finds all unique feeds, and adds them to feeds.json
 * for comprehensive parsing by the existing feed infrastructure
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
        'User-Agent': 'StableKraft-HGH-Feed-Discovery/1.0'
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
        console.error(`Error fetching feed ${feedGuid}:`, error.message);
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

async function discoverHghFeeds() {
    console.log('🔍 HGH Playlist Feed Discovery\n');
    console.log('=' .repeat(60) + '\n');

    // Fetch the HGH playlist XML
    console.log('📥 Fetching HGH playlist from GitHub...\n');
    const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';

    try {
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlContent = await response.text();
        console.log(`✅ Downloaded XML content (${xmlContent.length} characters)\n`);

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

        console.log(`📋 Found ${remoteItems.length} remote items in playlist\n`);

        // Extract unique feed GUIDs
        const uniqueFeedGuids = new Set();
        remoteItems.forEach(item => {
            const feedGuid = item['@_feedGuid'];
            if (feedGuid) {
                uniqueFeedGuids.add(feedGuid);
            }
        });

        console.log(`🔍 Discovered ${uniqueFeedGuids.size} unique feeds to process\n`);

        // Load existing feeds database
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        // Create backup
        const backupPath = feedsPath + `.backup-hgh-discovery-${Date.now()}`;
        console.log(`📦 Creating backup at ${path.basename(backupPath)}\n`);
        fs.copyFileSync(feedsPath, backupPath);

        // Check which feeds are already in the database
        const existingFeedGuids = new Set();
        feedsData.feeds.forEach(feed => {
            if (feed.feedGuid) {
                existingFeedGuids.add(feed.feedGuid);
            }
            if (feed.guid) {
                existingFeedGuids.add(feed.guid);
            }
        });

        const newFeeds = [];
        const skippedFeeds = [];

        // Filter out feeds that already exist
        const feedsToProcess = Array.from(uniqueFeedGuids).filter(feedGuid => {
            if (existingFeedGuids.has(feedGuid)) {
                skippedFeeds.push(feedGuid);
                return false;
            }
            return true;
        });

        console.log(`🔄 Processing ${feedsToProcess.length} new feeds (${skippedFeeds.length} already exist)...\n`);

        // Process feeds in parallel batches
        const BATCH_SIZE = 10; // Process 10 feeds at once
        const batches = [];
        for (let i = 0; i < feedsToProcess.length; i += BATCH_SIZE) {
            batches.push(feedsToProcess.slice(i, i + BATCH_SIZE));
        }

        async function processFeed(feedGuid, index, total) {
            try {
                // Fetch feed information from Podcast Index
                const feedInfo = await getFeedByGuid(feedGuid);

                if (!feedInfo) {
                    console.log(`[${index + 1}/${total}] ❌ Feed ${feedGuid.substring(0, 8)}...${feedGuid.substring(feedGuid.length - 8)} not found`);
                    return null;
                }

                console.log(`[${index + 1}/${total}] ✅ "${feedInfo.title}" by ${feedInfo.author || 'Unknown'} (${feedInfo.medium || 'podcast'})`);

                // Create feed entry for feeds.json
                const newFeed = {
                    id: generateFeedId(feedInfo.title, feedInfo.author || 'unknown'),
                    title: feedInfo.title,
                    artist: feedInfo.author || 'Unknown Artist',
                    description: feedInfo.description || '',
                    image: feedInfo.artwork || feedInfo.image || '/placeholder-podcast.jpg',
                    originalUrl: feedInfo.url,
                    feedGuid: feedGuid,
                    guid: feedGuid, // Also set as guid for compatibility
                    priority: 100, // Lower priority for playlist-discovered feeds
                    status: 'active',
                    type: feedInfo.medium === 'music' ? 'album' : 'podcast',
                    explicit: feedInfo.explicit || false,
                    language: feedInfo.language || 'en',

                    // Metadata
                    podcastIndexId: feedInfo.id,
                    medium: feedInfo.medium || 'podcast',
                    categories: feedInfo.categories || [],

                    // Discovery info
                    discoveredVia: 'HGH Playlist',
                    discoveredAt: new Date().toISOString(),
                    lastFetched: null,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),

                    // Podcast Index specific fields
                    ...(feedInfo.locked && { locked: feedInfo.locked }),
                    ...(feedInfo.fundingUrl && { fundingUrl: feedInfo.fundingUrl }),
                    ...(feedInfo.value && { value: feedInfo.value }),
                    ...(feedInfo.newestItemPubdate && { newestItemPubdate: feedInfo.newestItemPubdate }),
                    ...(feedInfo.episodeCount && { episodeCount: feedInfo.episodeCount })
                };

                return newFeed;
            } catch (error) {
                console.log(`[${index + 1}/${total}] ❌ Error processing ${feedGuid.substring(0, 8)}...${feedGuid.substring(feedGuid.length - 8)}: ${error.message}`);
                return null;
            }
        }

        // Process batches sequentially, but feeds within each batch in parallel
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            console.log(`\n📦 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} feeds)...`);

            const promises = batch.map((feedGuid, index) =>
                processFeed(feedGuid, batchIndex * BATCH_SIZE + index, feedsToProcess.length)
            );

            const results = await Promise.all(promises);
            const successfulFeeds = results.filter(feed => feed !== null);
            newFeeds.push(...successfulFeeds);

            // Small delay between batches to be respectful to the API
            if (batchIndex < batches.length - 1) {
                await delay(200); // Much shorter delay
            }
        }

        // Add new feeds to the database
        if (newFeeds.length > 0) {
            feedsData.feeds.push(...newFeeds);

            // Update metadata
            feedsData.metadata = feedsData.metadata || {};
            feedsData.metadata.lastHghFeedDiscovery = {
                date: new Date().toISOString(),
                sourceUrl: playlistUrl,
                feedsDiscovered: uniqueFeedGuids.size,
                feedsAdded: newFeeds.length,
                feedsSkipped: skippedFeeds.length,
                totalFeeds: feedsData.feeds.length
            };
            feedsData.metadata.lastUpdated = new Date().toISOString();

            // Save updated feeds database
            fs.writeFileSync(feedsPath, JSON.stringify(feedsData, null, 2));
            console.log(`💾 Saved ${newFeeds.length} new feeds to feeds.json\n`);
        }

        console.log('=' .repeat(60));
        console.log('📊 HGH Feed Discovery Summary:');
        console.log(`  🔍 Unique feeds discovered: ${uniqueFeedGuids.size}`);
        console.log(`  ✅ New feeds added: ${newFeeds.length}`);
        console.log(`  ⚠️ Feeds already in database: ${skippedFeeds.length}`);
        console.log(`  📈 Total feeds in database: ${feedsData.feeds.length}`);

        if (newFeeds.length > 0) {
            console.log('\n🎵 New feeds added:');
            newFeeds.forEach((feed, index) => {
                console.log(`  ${index + 1}. "${feed.title}" by ${feed.artist}`);
                console.log(`     Type: ${feed.type} | Medium: ${feed.medium}`);
            });

            console.log('\n✨ Feed discovery complete!');
            console.log('🚀 Run the main feed parser to import tracks from these feeds.');
            console.log('   Command: npm run parse-feeds');
        } else {
            console.log('\n✨ No new feeds to add - all feeds already discovered!');
        }

    } catch (error) {
        console.error('❌ Error during feed discovery:', error.message);
        process.exit(1);
    }
}

// Run the discovery
discoverHghFeeds();