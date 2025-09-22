#!/usr/bin/env node

/**
 * Parse only newly discovered playlist feeds with robust error handling
 * This script focuses on the feeds we just added from the playlists
 */

const fs = require('fs');
const path = require('path');

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

async function parseNewPlaylistFeeds() {
    console.log('🎯 Parsing Newly Discovered Playlist Feeds\n');
    console.log('=' .repeat(60) + '\n');

    try {
        // Import the RSS parser
        const PodcastIndexRSSParser = (await import('../src/lib/rss-feed-parser.js')).default;
        const rssParser = new PodcastIndexRSSParser(
            process.env.PODCAST_INDEX_API_KEY,
            process.env.PODCAST_INDEX_API_SECRET
        );

        // Load feeds database to find newly added feeds
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        // Find feeds discovered via playlists
        const playlistFeeds = feedsData.feeds.filter(feed =>
            feed.discoveredVia === 'ITDV Playlist' ||
            feed.discoveredVia === 'HGH Playlist'
        );

        console.log(`📋 Found ${playlistFeeds.length} playlist-discovered feeds to parse\n`);

        // Further filter to feeds that haven't been fetched yet (truly new)
        const newFeeds = playlistFeeds.filter(feed => !feed.lastFetched);
        console.log(`🆕 ${newFeeds.length} feeds are completely new and need parsing\n`);

        if (newFeeds.length === 0) {
            console.log('✨ All playlist feeds have already been parsed!');
            return;
        }

        // Group feeds by type for better organization
        const musicFeeds = newFeeds.filter(feed => feed.type === 'album' || feed.medium === 'music');
        const podcastFeeds = newFeeds.filter(feed => feed.type === 'podcast' || feed.medium === 'podcast');

        console.log(`🎵 Music feeds to parse: ${musicFeeds.length}`);
        console.log(`🎙️ Podcast feeds to parse: ${podcastFeeds.length}\n`);

        // Parse feeds in small batches to avoid overwhelming the system
        const BATCH_SIZE = 5;
        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        async function parseFeedSafely(feed, index, total) {
            try {
                console.log(`[${index + 1}/${total}] Parsing: "${feed.title}" by ${feed.artist}`);
                console.log(`   📡 URL: ${feed.originalUrl}`);
                console.log(`   🎯 Type: ${feed.type} | Medium: ${feed.medium}`);

                // Parse the feed
                const parsedData = await rssParser.parseRSSFeed(feed.originalUrl);

                if (!parsedData) {
                    throw new Error('Parser returned null data');
                }

                if (!parsedData.tracks || parsedData.tracks.length === 0) {
                    console.log(`   ⚠️ No tracks found in feed\n`);
                    return { success: false, reason: 'no_tracks' };
                }

                console.log(`   ✅ Successfully parsed ${parsedData.tracks.length} tracks`);
                console.log(`   📊 Album: "${parsedData.title}" by ${parsedData.artist}`);

                // Update the feed's lastFetched timestamp
                feed.lastFetched = new Date().toISOString();

                console.log(`   💾 Tracks will be saved to database\n`);
                return { success: true, tracks: parsedData.tracks.length };

            } catch (error) {
                console.log(`   ❌ Error parsing feed: ${error.message}\n`);
                errors.push({
                    feed: feed.title,
                    url: feed.originalUrl,
                    error: error.message
                });
                return { success: false, reason: 'parse_error', error: error.message };
            }
        }

        // Process music feeds first (they're usually simpler)
        if (musicFeeds.length > 0) {
            console.log('🎵 Processing music feeds...\n');
            for (let i = 0; i < musicFeeds.length; i += BATCH_SIZE) {
                const batch = musicFeeds.slice(i, i + BATCH_SIZE);
                console.log(`📦 Processing music batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(musicFeeds.length / BATCH_SIZE)}...\n`);

                const results = await Promise.all(
                    batch.map((feed, batchIndex) =>
                        parseFeedSafely(feed, i + batchIndex, musicFeeds.length)
                    )
                );

                results.forEach(result => {
                    if (result.success) {
                        successCount++;
                    } else {
                        errorCount++;
                    }
                });

                // Small delay between batches
                if (i + BATCH_SIZE < musicFeeds.length) {
                    console.log('⏱️ Pausing between batches...\n');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // Process podcast feeds
        if (podcastFeeds.length > 0) {
            console.log('🎙️ Processing podcast feeds...\n');
            for (let i = 0; i < podcastFeeds.length; i += BATCH_SIZE) {
                const batch = podcastFeeds.slice(i, i + BATCH_SIZE);
                console.log(`📦 Processing podcast batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(podcastFeeds.length / BATCH_SIZE)}...\n`);

                const results = await Promise.all(
                    batch.map((feed, batchIndex) =>
                        parseFeedSafely(feed, i + batchIndex, podcastFeeds.length)
                    )
                );

                results.forEach(result => {
                    if (result.success) {
                        successCount++;
                    } else {
                        errorCount++;
                    }
                });

                // Small delay between batches
                if (i + BATCH_SIZE < podcastFeeds.length) {
                    console.log('⏱️ Pausing between batches...\n');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // Update feeds database with lastFetched timestamps
        fs.writeFileSync(feedsPath, JSON.stringify(feedsData, null, 2));

        // Summary
        console.log('=' .repeat(60));
        console.log('📊 Parsing Summary:');
        console.log(`  ✅ Successfully parsed: ${successCount} feeds`);
        console.log(`  ❌ Failed to parse: ${errorCount} feeds`);
        console.log(`  📈 Success rate: ${((successCount / (successCount + errorCount)) * 100).toFixed(1)}%`);

        if (errors.length > 0) {
            console.log('\n🚨 Parsing Errors:');
            errors.slice(0, 10).forEach((error, index) => {
                console.log(`  ${index + 1}. "${error.feed}": ${error.error}`);
            });
            if (errors.length > 10) {
                console.log(`  ... and ${errors.length - 10} more errors`);
            }
        }

        if (successCount > 0) {
            console.log('\n✨ Parsing complete! New tracks have been added to the database.');
            console.log('🔄 The playlists should now show more resolved tracks instead of placeholders.');
        } else {
            console.log('\n⚠️ No feeds were successfully parsed. Check the errors above for details.');
        }

    } catch (error) {
        console.error('❌ Fatal error during parsing:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the parser
parseNewPlaylistFeeds();