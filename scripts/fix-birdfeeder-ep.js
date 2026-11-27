#!/usr/bin/env node

/**
 * Fix missing tracks in Birdfeeder EP
 */

const fs = require('fs');
const path = require('path');
const { USER_AGENT } = require('../lib/user-agent');

async function fixBirdfeederEP() {
    try {
        console.log('🔄 Fixing Birdfeeder EP missing tracks...\n');
        
        const feedUrl = 'https://wavlake.com/feed/music/5a07b3f1-8249-45a1-b40a-630797dc4941';
        console.log(`📡 Fetching: ${feedUrl}`);
        
        // Fetch the RSS feed
        const response = await fetch(feedUrl, {
            headers: {
                'User-Agent': USER_AGENT
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const xmlText = await response.text();
        console.log(`📊 RSS feed size: ${Math.round(xmlText.length / 1024)}KB`);
        
        // Extract feed-level metadata
        const feedTitleMatch = xmlText.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
        const feedImageMatch = xmlText.match(/<itunes:image href="(.*?)"/);
        const feedAuthorMatch = xmlText.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
        
        const feedTitle = cleanText(feedTitleMatch ? feedTitleMatch[1] : 'Birdfeeder (EP)');
        const feedImage = feedImageMatch ? feedImageMatch[1] : '';
        const feedAuthor = cleanText(feedAuthorMatch ? feedAuthorMatch[1] : '');
        
        console.log(`Feed title: "${feedTitle}"`);
        console.log(`Feed author: "${feedAuthor}"`);
        console.log(`Feed image: ${feedImage}`);
        
        // Parse XML to extract items
        const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g);
        
        if (!itemMatches) {
            console.log('❌ No items found in RSS feed');
            return;
        }
        
        console.log(`📊 Found ${itemMatches.length} items in RSS feed\n`);
        
        // Extract track data from each item
        const tracks = [];
        itemMatches.forEach((item, index) => {
            const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
            const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
            const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
            const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
            const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
            const imageMatch = item.match(/<itunes:image href="(.*?)"/);
            const artistMatch = item.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
            
            if (titleMatch) {
                const track = {
                    title: cleanText(titleMatch[1]),
                    feedTitle: feedTitle,
                    feedArtist: cleanText(artistMatch ? artistMatch[1] : feedAuthor),
                    feedUrl: feedUrl,
                    feedGuid: '', // Will be set from existing data
                    feedImage: feedImage,
                    guid: guidMatch ? cleanText(guidMatch[1]) : '',
                    enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                    duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                    description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                    image: imageMatch ? imageMatch[1] : feedImage,
                    datePublished: Math.floor(Date.now() / 1000),
                    explicit: false,
                    source: 'Birdfeeder EP RSS Refresh'
                };
                
                tracks.push(track);
                console.log(`${index + 1}. "${track.title}" (${formatDuration(track.duration)}) [${track.enclosureUrl ? 'Has Audio' : 'No Audio'}]`);
                console.log(`   Artist: ${track.feedArtist}`);
            }
        });
        
        console.log(`\n✅ Extracted ${tracks.length} tracks from RSS feed`);
        
        // Load existing database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        console.log(`📊 Current database has ${musicData.musicTracks.length} tracks`);
        
        // Find existing Birdfeeder tracks to get feedGuid
        const existingBirdfeederTracks = musicData.musicTracks.filter(track => 
            track.feedUrl === feedUrl
        );
        
        const feedGuid = existingBirdfeederTracks.length > 0 ? existingBirdfeederTracks[0].feedGuid : generateGuid(feedUrl);
        
        // Set feedGuid for all new tracks
        tracks.forEach(track => {
            track.feedGuid = feedGuid;
        });
        
        // Remove existing Birdfeeder EP tracks
        const originalCount = musicData.musicTracks.length;
        musicData.musicTracks = musicData.musicTracks.filter(track => 
            track.feedUrl !== feedUrl
        );
        const removedCount = originalCount - musicData.musicTracks.length;
        console.log(`🗑️ Removed ${removedCount} old Birdfeeder EP tracks`);
        
        // Add new tracks
        musicData.musicTracks.push(...tracks);
        console.log(`➕ Added ${tracks.length} new Birdfeeder EP tracks`);
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            birdfeederEPRefresh: {
                date: new Date().toISOString(),
                feedUrl,
                removedTracks: removedCount,
                addedTracks: tracks.length,
                note: 'Refreshed Birdfeeder EP with current RSS feed data'
            }
        };
        
        // Create backup
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-birdfeeder-refresh-${Date.now()}.json`);
        const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`📋 Backup created: ${path.basename(backupPath)}`);
        
        // Save updated database
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        console.log(`✅ Database updated with refreshed Birdfeeder EP tracks`);
        
        console.log(`\n📊 Final database size: ${musicData.musicTracks.length} tracks`);
        
        // Regenerate optimized cache
        console.log('\n🔄 Regenerating optimized cache...');
        const { execSync } = require('child_process');
        try {
            execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
            console.log('✅ Optimized cache regenerated');
        } catch (error) {
            console.log('⚠️ Please manually regenerate cache');
        }
        
    } catch (error) {
        console.error('❌ Error refreshing Birdfeeder EP:', error);
    }
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
    } else {
        return 180; // Default fallback
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function generateGuid(input) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        '5' + hash.substring(13, 16),
        ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20),
        hash.substring(20, 32)
    ].join('-');
}

// Run the refresh
fixBirdfeederEP();