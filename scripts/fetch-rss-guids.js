#!/usr/bin/env node

/**
 * Fetch original GUIDs by parsing RSS feeds directly
 */

const fs = require('fs');
const path = require('path');

// Simple RSS parser using built-in XML parsing
const { DOMParser } = require('@xmldom/xmldom');

async function parseRSSFeed(feedUrl) {
    try {
        const response = await fetch(feedUrl);
        const xmlText = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        const items = xmlDoc.getElementsByTagName('item');
        const tracks = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            
            const title = item.getElementsByTagName('title')[0]?.textContent?.trim();
            const guid = item.getElementsByTagName('guid')[0]?.textContent?.trim();
            
            // Try to get artist from various fields
            let artist = '';
            const itunesAuthor = item.getElementsByTagName('itunes:author')[0]?.textContent?.trim();
            const creator = item.getElementsByTagName('dc:creator')[0]?.textContent?.trim();
            
            if (itunesAuthor) artist = itunesAuthor;
            else if (creator) artist = creator;
            
            if (title && guid) {
                tracks.push({ title, guid, artist });
            }
        }
        
        return { tracks };
    } catch (error) {
        throw new Error(`Failed to parse RSS feed: ${error.message}`);
    }
}

async function fetchRssGuids() {
    try {
        console.log('🔍 Fetching original GUIDs from RSS feeds...\n');
        
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Get tracks that still have generated GUIDs
        const tracksNeedingGuids = musicData.musicTracks.filter(t => t.guidGenerated);
        console.log(`📊 Tracks needing original GUIDs: ${tracksNeedingGuids.length}`);
        
        if (tracksNeedingGuids.length === 0) {
            console.log('✅ All tracks already have original GUIDs');
            return;
        }
        
        // Group by feed URL to minimize requests
        const feedGroups = new Map();
        tracksNeedingGuids.forEach((track, index) => {
            const feedUrl = track.feedUrl;
            if (!feedGroups.has(feedUrl)) {
                feedGroups.set(feedUrl, []);
            }
            feedGroups.get(feedUrl).push({
                track,
                originalIndex: musicData.musicTracks.indexOf(track)
            });
        });
        
        console.log(`📊 Unique feeds to parse: ${feedGroups.size}`);
        console.log();
        
        console.log('🔄 Using direct RSS parsing...');
        
        let processedFeeds = 0;
        let foundGuidsCount = 0;
        const restoredTracks = [];
        
        // Process feeds in small batches to avoid rate limiting
        const feedEntries = [...feedGroups.entries()];
        
        for (let i = 0; i < Math.min(feedEntries.length, 10); i++) { // Limit to 10 feeds for now
            const [feedUrl, trackGroup] = feedEntries[i];
            
            try {
                console.log(`🔄 Processing feed ${i+1}/${Math.min(feedEntries.length, 10)}: ${new URL(feedUrl).hostname}`);
                
                // Parse the RSS feed
                const albumData = await parseRSSFeed(feedUrl);
                
                if (!albumData || !albumData.tracks) {
                    console.log(`  ❌ Could not parse feed or no tracks found`);
                    continue;
                }
                
                console.log(`  📊 Found ${albumData.tracks.length} tracks in feed`);
                
                // Match tracks by title and artist
                let matchedCount = 0;
                trackGroup.forEach(({ track, originalIndex }) => {
                    const feedTrack = albumData.tracks.find(ft => 
                        ft.title?.toLowerCase().trim() === track.title?.toLowerCase().trim() &&
                        (ft.artist?.toLowerCase().trim() === track.feedArtist?.toLowerCase().trim() ||
                         ft.feedArtist?.toLowerCase().trim() === track.feedArtist?.toLowerCase().trim())
                    );
                    
                    if (feedTrack && feedTrack.guid) {
                        // Restore original GUID
                        musicData.musicTracks[originalIndex] = {
                            ...track,
                            guid: feedTrack.guid,
                            guidGenerated: false,
                            guidGeneratedAt: undefined,
                            guidGeneratedMethod: undefined,
                            guidRestored: true,
                            guidRestoredAt: new Date().toISOString(),
                            guidRestoredFrom: 'rss-direct-parse',
                            originalGeneratedGuid: track.guid
                        };
                        
                        restoredTracks.push({
                            title: track.title,
                            generatedGuid: track.guid,
                            originalGuid: feedTrack.guid
                        });
                        
                        matchedCount++;
                        foundGuidsCount++;
                    }
                });
                
                console.log(`  ✅ Restored GUIDs for ${matchedCount}/${trackGroup.length} tracks`);
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.log(`  ❌ Error processing feed: ${error.message}`);
            }
            
            processedFeeds++;
        }
        
        console.log('\n✅ RSS GUID fetching results:');
        console.log(`  Processed feeds: ${processedFeeds}/${feedGroups.size}`);
        console.log(`  Found original GUIDs: ${foundGuidsCount}`);
        console.log();
        
        if (restoredTracks.length > 0) {
            // Create backup
            const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-rss-guid-restore-${Date.now()}.json`);
            const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
            fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
            console.log(`📋 Backup created: ${path.basename(backupPath)}`);
            
            // Update metadata
            musicData.metadata = {
                ...musicData.metadata,
                lastUpdated: new Date().toISOString(),
                rssGuidRestoration: {
                    date: new Date().toISOString(),
                    processedFeeds,
                    restoredCount: foundGuidsCount,
                    source: 'rss-direct-parse',
                    note: 'Restored GUIDs by parsing RSS feeds directly'
                }
            };
            
            // Save updated database
            fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
            console.log('✅ Database updated with RSS-restored GUIDs');
            
            // Show samples
            console.log('\n📋 Sample RSS GUID restorations:');
            restoredTracks.slice(0, 5).forEach((track, i) => {
                console.log(`  ${i+1}. "${track.title}"`);
                console.log(`      Generated: ${track.generatedGuid.substring(0, 25)}...`);
                console.log(`      Original:  ${track.originalGuid}`);
                console.log();
            });
        }
        
        // Final statistics
        const finalStats = {
            total: musicData.musicTracks.length,
            withGuids: musicData.musicTracks.filter(t => t.guid).length,
            original: musicData.musicTracks.filter(t => !t.guidGenerated).length,
            generated: musicData.musicTracks.filter(t => t.guidGenerated).length,
            restored: musicData.musicTracks.filter(t => t.guidRestored).length
        };
        
        console.log('📊 Updated GUID Statistics:');
        console.log(`  Total tracks: ${finalStats.total}`);
        console.log(`  Original GUIDs: ${finalStats.original}`);
        console.log(`  Generated GUIDs: ${finalStats.generated}`);
        console.log(`  Restored GUIDs: ${finalStats.restored}`);
        
        const remainingGenerated = finalStats.generated;
        if (remainingGenerated > 0) {
            console.log(`\n💡 ${remainingGenerated} tracks still have generated GUIDs`);
            console.log('   These are likely HGH reference tracks or feeds that no longer exist');
            console.log('   Generated GUIDs provide stable identifiers for these tracks');
        }
        
        console.log('\n🎯 RSS GUID fetching completed!');
        
    } catch (error) {
        console.error('❌ Error fetching RSS GUIDs:', error);
    }
}

// Run the RSS GUID fetching
fetchRssGuids();