#!/usr/bin/env node

/**
 * Analyze HGH feeds to see which ones need parsing
 */

const fs = require('fs');
const path = require('path');

async function analyzeHghFeeds() {
    console.log('🔍 Analyzing HGH Feed Status\n');

    try {
        // Load feeds database
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        // Get HGH feeds
        const hghFeeds = feedsData.feeds.filter(feed =>
            feed.discoveredVia === 'HGH Playlist'
        );

        console.log(`📊 Total HGH feeds: ${hghFeeds.length}`);

        // Categorize feeds
        const neverParsed = hghFeeds.filter(feed => !feed.lastFetched);
        const musicFeeds = hghFeeds.filter(feed => feed.type === 'album' || feed.medium === 'music');
        const podcastFeeds = hghFeeds.filter(feed => feed.type === 'podcast' || feed.medium === 'podcast');

        console.log(`🎵 Music feeds: ${musicFeeds.length}`);
        console.log(`🎙️ Podcast feeds: ${podcastFeeds.length}`);
        console.log(`🆕 Never parsed: ${neverParsed.length}`);

        // Sample some feeds that need parsing
        console.log('\n🎯 Sample feeds that need parsing:');
        neverParsed.slice(0, 10).forEach((feed, index) => {
            console.log(`${index + 1}. "${feed.title}" by ${feed.artist}`);
            console.log(`   Type: ${feed.type} | Medium: ${feed.medium}`);
            console.log(`   URL: ${feed.originalUrl}`);
        });

        if (neverParsed.length > 10) {
            console.log(`   ... and ${neverParsed.length - 10} more`);
        }

        // Test current HGH playlist resolution
        console.log('\n🧪 Testing current HGH playlist resolution...');
        try {
            const response = await fetch('http://localhost:3000/api/playlist/hgh');
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.albums && data.albums[0]) {
                    const tracks = data.albums[0].tracks || [];
                    const resolvedTracks = tracks.filter(track => track.url && track.url.startsWith('http'));

                    console.log(`📈 Current resolution: ${resolvedTracks.length}/${tracks.length} tracks (${((resolvedTracks.length/tracks.length)*100).toFixed(1)}%)`);

                    // Show some resolved tracks
                    console.log('\n✅ Sample resolved tracks:');
                    resolvedTracks.slice(0, 5).forEach((track, index) => {
                        console.log(`${index + 1}. "${track.title}" by ${track.subtitle}`);
                    });

                    // Show some unresolved tracks
                    const unresolvedTracks = tracks.filter(track => !track.url || track.url === '');
                    console.log('\n❌ Sample unresolved tracks:');
                    unresolvedTracks.slice(0, 5).forEach((track, index) => {
                        console.log(`${index + 1}. "${track.title}" - ${track.summary}`);
                    });
                }
            } else {
                console.log('❌ Could not fetch HGH playlist');
            }
        } catch (error) {
            console.log('⚠️ Server not running or not accessible');
        }

        console.log(`\n💡 To improve resolution: Parse ${neverParsed.length} remaining feeds`);

    } catch (error) {
        console.error('❌ Analysis failed:', error.message);
    }
}

analyzeHghFeeds();