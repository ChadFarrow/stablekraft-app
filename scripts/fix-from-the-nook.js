#!/usr/bin/env node

/**
 * Fix missing tracks in "From The Nook" album (9/10 tracks missing)
 */

const fs = require('fs');
const path = require('path');
const { USER_AGENT } = require('../lib/user-agent');

async function fixFromTheNookAlbum() {
    try {
        console.log('🔄 Fixing "From The Nook" album missing tracks...\n');
        
        const feedUrl = 'https://wavlake.com/feed/music/1557b2d7-04b4-47d8-9c83-cc7aed721cd5';
        console.log(`📡 Fetching: ${feedUrl}`);
        
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
        
        // Extract feed metadata
        const feedTitleMatch = xmlText.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
        const feedImageMatch = xmlText.match(/<itunes:image href="(.*?)"/);
        const feedAuthorMatch = xmlText.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
        
        const feedTitle = cleanText(feedTitleMatch ? feedTitleMatch[1] : 'From The Nook');
        const feedImage = feedImageMatch ? feedImageMatch[1] : '';
        const feedAuthor = cleanText(feedAuthorMatch ? feedAuthorMatch[1] : '');
        
        console.log(`Feed title: "${feedTitle}"`);
        console.log(`Feed author: "${feedAuthor}"`);
        console.log(`Feed image: ${feedImage}`);
        
        const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g);
        if (!itemMatches) {
            console.log('❌ No items found in RSS feed');
            return;
        }
        
        console.log(`📊 Found ${itemMatches.length} items in RSS feed\n`);
        
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
                    feedGuid: '', // Will be set from existing
                    feedImage: feedImage,
                    guid: guidMatch ? cleanText(guidMatch[1]) : '',
                    enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                    duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                    description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                    image: imageMatch ? imageMatch[1] : feedImage,
                    datePublished: Math.floor(Date.now() / 1000),
                    explicit: false,
                    source: 'From The Nook RSS Refresh'
                };
                
                tracks.push(track);
                console.log(`${index + 1}. "${track.title}" (${formatDuration(track.duration)}) [${track.enclosureUrl ? 'Has Audio' : 'No Audio'}]`);
            }
        });
        
        console.log(`\n✅ Extracted ${tracks.length} tracks from RSS feed`);
        
        // Load database and update
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        // Find existing tracks to get feedGuid
        const existingTracks = musicData.musicTracks.filter(track => track.feedUrl === feedUrl);
        const feedGuid = existingTracks.length > 0 ? existingTracks[0].feedGuid : generateGuid(feedUrl);
        
        tracks.forEach(track => {
            track.feedGuid = feedGuid;
        });
        
        // Remove old tracks and add new ones
        const originalCount = musicData.musicTracks.length;
        musicData.musicTracks = musicData.musicTracks.filter(track => track.feedUrl !== feedUrl);
        const removedCount = originalCount - musicData.musicTracks.length;
        
        musicData.musicTracks.push(...tracks);
        
        console.log(`🗑️ Removed ${removedCount} old tracks`);
        console.log(`➕ Added ${tracks.length} new tracks`);
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            fromTheNookRefresh: {
                date: new Date().toISOString(),
                feedUrl,
                removedTracks: removedCount,
                addedTracks: tracks.length,
                note: 'Fixed "From The Nook" album missing 9/10 tracks'
            }
        };
        
        // Backup and save
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-from-the-nook-${Date.now()}.json`);
        const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`📋 Backup created: ${path.basename(backupPath)}`);
        
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        console.log(`✅ Database updated: ${originalCount} → ${musicData.musicTracks.length} tracks`);
        
        // Regenerate cache
        console.log('\n🔄 Regenerating optimized cache...');
        const { execSync } = require('child_process');
        try {
            execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
            console.log('✅ Cache regenerated');
        } catch (error) {
            console.log('⚠️ Please regenerate cache manually');
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
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
    const parts = durationString.split(':').map(Number);
    if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    }
    return 180;
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

fixFromTheNookAlbum();