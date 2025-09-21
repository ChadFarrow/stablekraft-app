#!/usr/bin/env node

/**
 * Fix Beslan album artwork by refreshing from RSS feed
 */

const fs = require('fs');
const path = require('path');

async function fixBeslanArtwork() {
    console.log('🎨 Checking Beslan album artwork...\n');
    
    try {
        // Load database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Find Beslan track
        const beslanTrack = musicData.musicTracks.find(track => track.feedTitle === 'Beslan');
        
        if (!beslanTrack) {
            console.log('❌ Beslan track not found in database');
            return;
        }
        
        console.log('📀 Found Beslan track:');
        console.log(`   Title: ${beslanTrack.title}`);
        console.log(`   Artist: ${beslanTrack.feedArtist || 'N/A'}`);
        console.log(`   Current image: ${beslanTrack.image || 'None'}`);
        console.log(`   Feed image: ${beslanTrack.feedImage || 'None'}`);
        console.log(`   Feed URL: ${beslanTrack.feedUrl}`);
        
        // Test current image URL
        if (beslanTrack.image) {
            try {
                console.log('\n🔍 Testing current image URL...');
                const response = await fetch(beslanTrack.image);
                console.log(`   Status: ${response.status} ${response.statusText}`);
                console.log(`   Content-Type: ${response.headers.get('content-type')}`);
                console.log(`   Content-Length: ${response.headers.get('content-length')}`);
                
                if (response.ok) {
                    console.log('✅ Current image URL is working fine');
                    console.log('\n🤔 The issue might be:');
                    console.log('   • Browser caching - try hard refresh (Ctrl+F5)');
                    console.log('   • CDN caching delay');
                    console.log('   • Frontend image loading logic');
                    console.log('\n💡 Try visiting the album page directly and checking if image loads there');
                    return;
                }
            } catch (error) {
                console.log(`   ❌ Error testing image: ${error.message}`);
            }
        }
        
        // If image is not working, refresh from RSS feed
        console.log('\n📡 Refreshing artwork from RSS feed...');
        const response = await fetch(beslanTrack.feedUrl);
        
        if (!response.ok) {
            console.log(`❌ Failed to fetch RSS feed: ${response.status}`);
            return;
        }
        
        const xmlText = await response.text();
        console.log(`📊 RSS feed size: ${Math.round(xmlText.length / 1024)}KB`);
        
        // Extract updated image
        const imageMatch = xmlText.match(/<itunes:image href="([^"]+)"/);
        const channelImageMatch = xmlText.match(/<channel>[\s\S]*?<itunes:image href="([^"]+)"/);
        
        const newImage = imageMatch ? imageMatch[1] : (channelImageMatch ? channelImageMatch[1] : null);
        
        if (newImage && newImage !== beslanTrack.image) {
            console.log(`🎨 Found updated image: ${newImage}`);
            
            // Test new image
            try {
                const imageResponse = await fetch(newImage);
                if (imageResponse.ok) {
                    console.log('✅ New image URL works');
                    
                    // Update track
                    beslanTrack.image = newImage;
                    beslanTrack.feedImage = newImage;
                    
                    // Create backup
                    const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-beslan-artwork-${Date.now()}.json`);
                    fs.writeFileSync(backupPath, JSON.stringify(musicData, null, 2));
                    
                    // Save updated database
                    fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
                    
                    console.log(`💾 Updated Beslan artwork in database`);
                    console.log(`📋 Backup: ${path.basename(backupPath)}`);
                    
                    // Regenerate cache
                    console.log('\n🔄 Regenerating cache...');
                    const { execSync } = require('child_process');
                    execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
                    console.log('✅ Cache regenerated');
                    
                } else {
                    console.log(`❌ New image URL not accessible: ${imageResponse.status}`);
                }
            } catch (error) {
                console.log(`❌ Error testing new image: ${error.message}`);
            }
            
        } else if (newImage === beslanTrack.image) {
            console.log('✅ RSS feed has same image URL - no update needed');
        } else {
            console.log('❌ No image found in RSS feed');
        }
        
        console.log('\n📋 Summary:');
        console.log(`   Database image: ${beslanTrack.image}`);
        console.log(`   RSS feed image: ${newImage || 'Not found'}`);
        console.log('\n💡 If placeholder still appears on main page:');
        console.log('   1. Clear browser cache (Ctrl+Shift+Delete)');
        console.log('   2. Try incognito/private mode');
        console.log('   3. Check browser console for image loading errors');
        
    } catch (error) {
        console.error('❌ Error fixing Beslan artwork:', error);
    }
}

fixBeslanArtwork();