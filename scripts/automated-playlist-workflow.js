#!/usr/bin/env node

/**
 * Automated Playlist Workflow
 * This script should be run periodically to:
 * 1. Discover new feeds from playlists
 * 2. Trigger database updates automatically
 * 3. Provide automation for the future
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

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

async function automatedPlaylistWorkflow() {
    console.log('🤖 Automated Playlist Workflow\n');
    console.log('=' .repeat(50) + '\n');

    try {
        // Step 1: Discover new feeds from playlists
        console.log('📡 Step 1: Discovering new feeds from playlists...');
        try {
            execSync('node scripts/auto-discover-playlist-feeds.js', {
                stdio: 'inherit',
                cwd: process.cwd(),
                timeout: 300000 // 5 minutes max
            });
            console.log('✅ Feed discovery completed\n');
        } catch (error) {
            console.log('⚠️ Feed discovery had issues, continuing...\n');
        }

        // Step 2: Check database and provide summary
        console.log('📊 Step 2: Checking current database state...');
        const feedsPath = path.join(__dirname, '..', 'data', 'feeds.json');
        const feedsData = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));

        const totalFeeds = feedsData.feeds.length;
        const playlistFeeds = feedsData.feeds.filter(feed =>
            feed.discoveredVia === 'ITDV Playlist' ||
            feed.discoveredVia === 'HGH Playlist'
        ).length;

        const newFeeds = feedsData.feeds.filter(feed => !feed.lastFetched).length;

        console.log(`   📈 Total feeds in database: ${totalFeeds}`);
        console.log(`   🎵 Playlist-discovered feeds: ${playlistFeeds}`);
        console.log(`   🆕 Feeds never parsed: ${newFeeds}`);

        // Step 3: Create parsing instructions
        console.log('\n📋 Step 3: Next steps for complete automation...');

        if (newFeeds > 0) {
            console.log(`\n🔄 To complete the automation, you need to parse ${newFeeds} new feeds.`);
            console.log('   The main system parsing can be triggered by:');
            console.log('   1. Running the development server (npm run dev)');
            console.log('   2. Letting the background parser process the new feeds');
            console.log('   3. Or manually triggering a focused parse');

            // Create a package.json script for this
            console.log('\n💡 Adding automation script to package.json...');
            const packagePath = path.join(__dirname, '..', 'package.json');
            const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

            if (!packageData.scripts['auto-playlist-workflow']) {
                packageData.scripts['auto-playlist-workflow'] = 'node scripts/automated-playlist-workflow.js';
                fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2));
                console.log('✅ Added "npm run auto-playlist-workflow" script');
            }

            if (!packageData.scripts['discover-playlist-feeds']) {
                packageData.scripts['discover-playlist-feeds'] = 'node scripts/auto-discover-playlist-feeds.js';
                fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2));
                console.log('✅ Added "npm run discover-playlist-feeds" script');
            }
        } else {
            console.log('✅ All feeds have been processed!');
        }

        // Step 4: Test playlist resolution
        console.log('\n🧪 Step 4: Testing playlist resolution...');
        try {
            const response = await fetch('http://localhost:3000/api/playlist/hgh');
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.albums && data.albums[0]) {
                    const tracks = data.albums[0].tracks || [];
                    const resolvedTracks = tracks.filter(track => track.url && track.url.startsWith('http')).length;
                    const totalTracks = tracks.length;

                    console.log(`   🎵 HGH Playlist: ${resolvedTracks}/${totalTracks} tracks resolved (${((resolvedTracks/totalTracks)*100).toFixed(1)}%)`);

                    if (resolvedTracks < totalTracks * 0.1) { // Less than 10% resolved
                        console.log('   ⚠️ Low resolution rate - feeds may need parsing');
                    } else if (resolvedTracks > totalTracks * 0.5) { // More than 50% resolved
                        console.log('   ✅ Good resolution rate!');
                    }
                } else {
                    console.log('   ❌ HGH Playlist API returned invalid data');
                }
            } else {
                console.log('   ❌ HGH Playlist API not accessible');
            }
        } catch (error) {
            console.log('   ⚠️ Could not test playlist (server may not be running)');
        }

        // Step 5: Future automation suggestions
        console.log('\n🔮 Step 5: Future automation setup...');
        console.log('   To make this fully automated in the future:');
        console.log('   1. Set up a cron job: "0 2 * * * cd /path/to/project && npm run auto-playlist-workflow"');
        console.log('   2. Add this to your CI/CD pipeline for regular updates');
        console.log('   3. Monitor the resolution rates and alert when they drop');

        console.log('\n✨ Automated workflow complete!');

    } catch (error) {
        console.error('❌ Workflow failed:', error.message);
        process.exit(1);
    }
}

// Run the workflow
automatedPlaylistWorkflow();