#!/usr/bin/env node

/**
 * Parse HGH feeds directly to database using Prisma
 * This bypasses the complex RSS parser and directly adds tracks to the database
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
function loadEnvFile() {
    const envPath = path.join(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            if (line.includes('=') && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    let value = valueParts.join('=').trim();
                    // Remove quotes if present
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    process.env[key.trim()] = value;
                }
            }
        });
    }
}

loadEnvFile();

// Debug: Check if DATABASE_URL is loaded
console.log('🔗 DATABASE_URL loaded:', process.env.DATABASE_URL ? 'Yes' : 'No');
if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not found in environment variables');
    process.exit(1);
}

async function parseHghFeedsToDatabase() {
    console.log('🎵 Parsing HGH Feeds to Database\n');
    console.log('=' .repeat(60) + '\n');

    try {
        // Import Prisma client
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();

        // Load feeds data
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        // Get unparsed HGH feeds (start with small batch for testing)
        const allHghFeeds = feedsData.feeds.filter(feed =>
            feed.discoveredVia === 'HGH Playlist' &&
            !feed.lastFetched &&
            (feed.type === 'album' || feed.medium === 'music')
        );

        // Process all HGH feeds
        const hghFeeds = allHghFeeds;

        console.log(`🎯 Found ${hghFeeds.length} unparsed HGH music feeds\n`);

        if (hghFeeds.length === 0) {
            console.log('✅ All HGH feeds have been parsed!');
            await prisma.$disconnect();
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        let totalTracks = 0;
        const errors = [];

        // Process feeds in larger batches for efficiency
        const BATCH_SIZE = 10;

        async function parseFeedToDatabase(feedData, index, total) {
            try {
                console.log(`[${index + 1}/${total}] Processing: "${feedData.title}"`);
                console.log(`   📡 URL: ${feedData.originalUrl}`);

                // Fetch the RSS feed
                const response = await fetch(feedData.originalUrl, {
                    headers: { 'User-Agent': 'FUCKIT-HGH-Parser/1.0' },
                    timeout: 15000
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const xmlText = await response.text();
                console.log(`   📄 Fetched ${xmlText.length} characters`);

                // Parse RSS using simple XML parsing
                const RSSParser = (await import('rss-parser')).default;
                const parser = new RSSParser({
                    customFields: {
                        item: ['enclosure', 'itunes:duration', 'itunes:author', 'itunes:image']
                    }
                });

                const feed = await parser.parseString(xmlText);
                console.log(`   📊 Found ${feed.items.length} items`);

                if (feed.items.length === 0) {
                    console.log(`   ⚠️ No items in feed, skipping\n`);
                    return { success: false, reason: 'no_items' };
                }

                // Create or find feed in database
                let dbFeed = await prisma.feed.findFirst({
                    where: {
                        OR: [
                            { originalUrl: feedData.originalUrl },
                            { id: feedData.id }
                        ]
                    }
                });

                if (!dbFeed) {
                    console.log(`   📝 Creating new feed in database...`);
                    dbFeed = await prisma.feed.create({
                        data: {
                            id: feedData.id,
                            title: feed.title || feedData.title,
                            artist: feed.itunes?.author || feedData.artist || 'Unknown Artist',
                            description: feed.description || feedData.description || '',
                            image: feed.itunes?.image || feed.image?.url || feedData.image || '/placeholder-podcast.jpg',
                            originalUrl: feedData.originalUrl,
                            status: 'active',
                            type: 'album',
                            explicit: false,
                            priority: '100',
                            language: 'en',
                            lastFetched: new Date(),
                            createdAt: new Date(),
                            updatedAt: new Date()
                        }
                    });
                } else {
                    console.log(`   ✅ Feed exists in database, updating...`);
                    await prisma.feed.update({
                        where: { id: dbFeed.id },
                        data: {
                            lastFetched: new Date(),
                            updatedAt: new Date()
                        }
                    });
                }

                // Process each track
                let trackCount = 0;
                for (const [itemIndex, item] of feed.items.entries()) {
                    try {
                        // Skip items without audio
                        const audioUrl = item.enclosure?.url || item.url || '';
                        if (!audioUrl || !audioUrl.match(/\.(mp3|m4a|wav|flac|ogg)(\?|$)/i)) {
                            continue;
                        }

                        // Parse duration
                        let duration = 0;
                        if (item['itunes:duration']) {
                            const durationStr = item['itunes:duration'];
                            const parts = durationStr.split(':').map(p => parseInt(p) || 0);
                            if (parts.length === 3) {
                                duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
                            } else if (parts.length === 2) {
                                duration = parts[0] * 60 + parts[1];
                            } else {
                                duration = parts[0] || 0;
                            }
                        }

                        // Check if track already exists
                        const existingTrack = await prisma.track.findFirst({
                            where: {
                                feedId: dbFeed.id,
                                audioUrl: audioUrl
                            }
                        });

                        if (existingTrack) {
                            continue; // Skip duplicates
                        }

                        // Extract image URL properly
                        let imageUrl = '/placeholder-podcast.jpg';
                        if (item['itunes:image']) {
                            if (typeof item['itunes:image'] === 'string') {
                                imageUrl = item['itunes:image'];
                            } else if (item['itunes:image']?.$ && item['itunes:image'].$.href) {
                                imageUrl = item['itunes:image'].$.href;
                            }
                        } else if (feed.itunes?.image) {
                            if (typeof feed.itunes.image === 'string') {
                                imageUrl = feed.itunes.image;
                            } else if (feed.itunes.image?.$ && feed.itunes.image.$.href) {
                                imageUrl = feed.itunes.image.$.href;
                            }
                        } else if (feedData.image) {
                            imageUrl = feedData.image;
                        }

                        // Create track
                        await prisma.track.create({
                            data: {
                                id: `${dbFeed.id}-track-${itemIndex + 1}`,
                                title: item.title || `Track ${itemIndex + 1}`,
                                artist: item['itunes:author'] || feed.itunes?.author || feedData.artist || 'Unknown Artist',
                                audioUrl: audioUrl,
                                duration: duration,
                                trackOrder: itemIndex + 1,
                                image: imageUrl,
                                description: item.contentSnippet || item.content || '',
                                explicit: false,
                                guid: item.guid || `${dbFeed.id}-${itemIndex + 1}`,
                                publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
                                createdAt: new Date(),
                                updatedAt: new Date(),
                                feedId: dbFeed.id
                            }
                        });

                        trackCount++;
                    } catch (trackError) {
                        console.log(`     ⚠️ Error creating track ${itemIndex + 1}: ${trackError.message}`);
                    }
                }

                // Update feed data lastFetched
                feedData.lastFetched = new Date().toISOString();

                console.log(`   ✅ Successfully added ${trackCount} tracks\n`);
                totalTracks += trackCount;
                return { success: true, tracks: trackCount };

            } catch (error) {
                console.log(`   ❌ Error: ${error.message}\n`);
                errors.push({
                    feed: feedData.title,
                    url: feedData.originalUrl,
                    error: error.message
                });
                return { success: false, error: error.message };
            }
        }

        // Process feeds in batches
        for (let i = 0; i < hghFeeds.length; i += BATCH_SIZE) {
            const batch = hghFeeds.slice(i, i + BATCH_SIZE);
            console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(hghFeeds.length / BATCH_SIZE)}...\n`);

            const results = await Promise.allSettled(
                batch.map((feed, batchIndex) =>
                    parseFeedToDatabase(feed, i + batchIndex, hghFeeds.length)
                )
            );

            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value.success) {
                    successCount++;
                } else {
                    errorCount++;
                }
            });

            // Save progress
            fs.writeFileSync(feedsPath, JSON.stringify(feedsData, null, 2));

            // Small delay between batches
            if (i + BATCH_SIZE < hghFeeds.length) {
                console.log('⏱️ Pausing between batches...\n');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        await prisma.$disconnect();

        // Summary
        console.log('=' .repeat(60));
        console.log('📊 HGH Feed Parsing Summary:');
        console.log(`  ✅ Successfully parsed: ${successCount} feeds`);
        console.log(`  ❌ Failed to parse: ${errorCount} feeds`);
        console.log(`  🎵 Total tracks added: ${totalTracks}`);
        console.log(`  📈 Success rate: ${((successCount / (successCount + errorCount)) * 100).toFixed(1)}%`);

        if (errors.length > 0) {
            console.log('\n🚨 Top parsing errors:');
            errors.slice(0, 5).forEach((error, index) => {
                console.log(`  ${index + 1}. "${error.feed}": ${error.error}`);
            });
        }

        if (successCount > 0) {
            console.log('\n✨ HGH feed parsing complete!');
            console.log('🔄 Test the HGH playlist to see improved resolution rates.');
        }

    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

parseHghFeedsToDatabase();