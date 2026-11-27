#!/usr/bin/env node

/**
 * Update placeholder durations with real durations from RSS feeds
 */

const fs = require('fs');
const path = require('path');
const { USER_AGENT } = require('../lib/user-agent');

async function updatePlaceholderDurations() {
    console.log('🔄 Updating placeholder durations with real data...\n');
    
    const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
    
    // Find tracks with 180-second durations that have audio URLs
    const placeholderTracks = musicData.musicTracks.filter(track => 
        track.duration === 180 && track.enclosureUrl
    );
    
    console.log(`📊 Found ${placeholderTracks.length} tracks with placeholder durations and audio URLs\n`);
    
    // Group by feed URL for efficient processing
    const feedGroups = new Map();
    placeholderTracks.forEach(track => {
        const feedUrl = track.feedUrl;
        if (!feedGroups.has(feedUrl)) {
            feedGroups.set(feedUrl, []);
        }
        feedGroups.get(feedUrl).push(track);
    });
    
    console.log(`🔍 Processing ${feedGroups.size} unique feeds...\n`);
    
    let updatedTracks = 0;
    let failedFeeds = 0;
    const updatedFeedInfo = [];
    
    for (const [feedUrl, tracks] of feedGroups) {
        try {
            console.log(`📡 Processing: ${feedUrl}`);
            console.log(`   Tracks to update: ${tracks.length}`);
            
            const response = await fetch(feedUrl, { 
                timeout: 15000,
                headers: {
                    'User-Agent': USER_AGENT
                }
            });
            
            if (!response.ok) {
                if (response.status === 429) {
                    console.log(`   ⚠️ Rate limited, waiting 5s...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue; // Skip this feed for now
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const xmlText = await response.text();
            
            // Parse all items from the feed
            const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
            const feedTracks = [];
            
            itemMatches.forEach(item => {
                const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
                const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
                
                if (titleMatch && enclosureMatch && durationMatch) {
                    feedTracks.push({
                        title: cleanText(titleMatch[1]),
                        enclosureUrl: enclosureMatch[1],
                        duration: parseDuration(durationMatch[1])
                    });
                }
            });
            
            console.log(`   📋 Found ${feedTracks.length} items with durations in feed`);
            
            // Match tracks and update durations
            let feedUpdatedCount = 0;
            tracks.forEach(dbTrack => {
                // Try to match by title first
                let matchedFeedTrack = feedTracks.find(ft => 
                    ft.title.toLowerCase() === dbTrack.title.toLowerCase()
                );
                
                // If no title match, try by audio URL
                if (!matchedFeedTrack) {
                    matchedFeedTrack = feedTracks.find(ft => 
                        ft.enclosureUrl === dbTrack.enclosureUrl
                    );
                }
                
                if (matchedFeedTrack && matchedFeedTrack.duration > 0) {
                    const oldDuration = dbTrack.duration;
                    dbTrack.duration = matchedFeedTrack.duration;
                    console.log(`   ✅ "${dbTrack.title}": ${oldDuration}s → ${matchedFeedTrack.duration}s`);
                    updatedTracks++;
                    feedUpdatedCount++;
                } else {
                    console.log(`   ⚠️ No duration found for "${dbTrack.title}"`);
                }
            });
            
            updatedFeedInfo.push({
                feedUrl,
                feedTitle: tracks[0].feedTitle,
                totalTracks: tracks.length,
                updatedTracks: feedUpdatedCount
            });
            
            // Small delay between feeds
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            failedFeeds++;
        }
    }
    
    console.log('\n' + '=' .repeat(50));
    console.log('📊 Update Results:');
    console.log(`  ✅ Updated tracks: ${updatedTracks}`);
    console.log(`  ❌ Failed feeds: ${failedFeeds}`);
    console.log(`  📡 Processed feeds: ${feedGroups.size}`);
    
    if (updatedTracks > 0) {
        console.log('\n📋 Updated feeds:');
        updatedFeedInfo.forEach(feed => {
            if (feed.updatedTracks > 0) {
                console.log(`  "${feed.feedTitle}": ${feed.updatedTracks}/${feed.totalTracks} tracks updated`);
            }
        });
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            durationUpdate: {
                date: new Date().toISOString(),
                updatedTracks,
                failedFeeds,
                processedFeeds: feedGroups.size,
                note: 'Updated placeholder 180s durations with real RSS feed data'
            }
        };
        
        // Create backup
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-duration-update-${Date.now()}.json`);
        const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`\n📋 Backup created: ${path.basename(backupPath)}`);
        
        // Save updated database
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        console.log(`💾 Database updated with ${updatedTracks} duration fixes`);
    } else {
        console.log('\n💫 No durations were updated');
    }
    
    console.log('\n✅ Duration update complete!');
}

function cleanText(text) {
    return text
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function parseDuration(durationString) {
    // Parse HH:MM:SS or MM:SS format
    const parts = durationString.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
        return parts[0];
    }
    return 180; // Default fallback
}

updatePlaceholderDurations();