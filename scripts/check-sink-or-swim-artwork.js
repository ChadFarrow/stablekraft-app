#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function checkSinkOrSwimArtwork() {
    console.log('🎨 Checking Sink or Swim EP artwork...\n');
    
    try {
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Find all Sink or Swim EP tracks
        const sinkSwimTracks = musicData.musicTracks.filter(track => 
            track.feedTitle === 'Sink or Swim (EP)'
        );
        
        console.log(`📀 Found ${sinkSwimTracks.length} tracks in Sink or Swim EP:\n`);
        
        let hasImageIssue = false;
        
        for (let i = 0; i < sinkSwimTracks.length; i++) {
            const track = sinkSwimTracks[i];
            const hasImage = track.image && track.image.length > 0 && !track.image.includes('placeholder');
            
            console.log(`${i + 1}. "${track.title}"`);
            console.log(`   Image: ${track.image || 'MISSING'}`);
            
            if (!hasImage) {
                console.log(`   ❌ NO PROPER IMAGE`);
                hasImageIssue = true;
            } else {
                // Test image URL
                try {
                    const response = await fetch(track.image);
                    if (response.ok) {
                        console.log(`   ✅ Image accessible (${response.status})`);
                    } else {
                        console.log(`   ⚠️ Image not accessible (${response.status})`);
                        hasImageIssue = true;
                    }
                } catch (error) {
                    console.log(`   ❌ Image error: ${error.message}`);
                    hasImageIssue = true;
                }
            }
            console.log();
        }
        
        if (hasImageIssue) {
            console.log('🔧 Found image issues. Let me refresh the artwork from RSS feed...\n');
            
            const feedUrl = sinkSwimTracks[0].feedUrl;
            console.log(`📡 Fetching: ${feedUrl}`);
            
            const response = await fetch(feedUrl);
            if (!response.ok) {
                console.log(`❌ Failed to fetch RSS feed: ${response.status}`);
                return;
            }
            
            const xmlText = await response.text();
            console.log(`📊 RSS feed size: ${Math.round(xmlText.length / 1024)}KB`);
            
            // Extract album image
            const imageMatch = xmlText.match(/<itunes:image href="([^"]+)"/);
            const channelImageMatch = xmlText.match(/<channel>[\s\S]*?<itunes:image href="([^"]+)"/);
            
            const albumImage = imageMatch ? imageMatch[1] : (channelImageMatch ? channelImageMatch[1] : null);
            
            if (albumImage) {
                console.log(`🎨 Found album artwork: ${albumImage}`);
                
                // Test new image
                try {
                    const imageResponse = await fetch(albumImage);
                    if (imageResponse.ok) {
                        console.log('✅ Album artwork is accessible');
                        
                        let updatedCount = 0;
                        
                        // Update all tracks with missing/broken images
                        sinkSwimTracks.forEach(track => {
                            const needsUpdate = !track.image || track.image.includes('placeholder') || track.image.length === 0;
                            if (needsUpdate) {
                                track.image = albumImage;
                                track.feedImage = albumImage;
                                updatedCount++;
                            }
                        });
                        
                        if (updatedCount > 0) {
                            // Create backup
                            const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-sink-swim-artwork-${Date.now()}.json`);
                            fs.writeFileSync(backupPath, JSON.stringify(musicData, null, 2));
                            
                            // Save updated database
                            fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
                            
                            console.log(`💾 Updated ${updatedCount} tracks with proper artwork`);
                            console.log(`📋 Backup: ${path.basename(backupPath)}`);
                            
                            // Regenerate cache
                            console.log('\n🔄 Regenerating optimized cache...');
                            const { execSync } = require('child_process');
                            execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
                            console.log('✅ Cache regenerated');
                        } else {
                            console.log('✅ All tracks already have proper artwork');
                        }
                        
                    } else {
                        console.log(`❌ Album artwork not accessible: ${imageResponse.status}`);
                    }
                } catch (error) {
                    console.log(`❌ Error testing album image: ${error.message}`);
                }
                
            } else {
                console.log('❌ No album artwork found in RSS feed');
            }
        } else {
            console.log('✅ All tracks have proper artwork URLs');
            console.log('\n💡 If placeholder still appears on main page, try:');
            console.log('   • Hard refresh (Ctrl+F5)');
            console.log('   • Clear browser cache');
            console.log('   • Try incognito/private mode');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

checkSinkOrSwimArtwork();