#!/usr/bin/env node

/**
 * Targeted feed refresh for specific problematic feeds
 * Focuses on feeds known to have issues like missing tracks or duplicates
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { USER_AGENT } = require('../lib/user-agent');

// Known problematic feeds to refresh
const PRIORITY_FEEDS = [
    'https://www.doerfelverse.com/feeds/dfbv2.xml', // DFB Volume 2 - missing tracks
    'https://deathdreams.com/podcast.xml', // Deathdreams - missing tracks
    'https://feeds.rssblue.com/haflina', // RSSSBlue feeds often problematic
    'https://feeds.rssblue.com/maniac-on-mute',
    'https://feeds.rssblue.com/fighting-uphill'
];

// Simple RSS parser with retry logic
async function parseRSSFeed(feedUrl, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`  📡 Fetching: ${feedUrl} (attempt ${attempt})`);
            const response = await fetch(feedUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': USER_AGENT
                }
            });
            
            if (!response.ok) {
                if (response.status === 429 && attempt < retries) {
                    console.log(`  ⚠️ Rate limited, waiting ${attempt * 5}s...`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 5000));
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const xmlText = await response.text();
            
            // Extract feed metadata
            const feedTitleMatch = xmlText.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
            const feedImageMatch = xmlText.match(/<itunes:image href="(.*?)"/);
            const feedGuidMatch = xmlText.match(/<podcast:guid>(.*?)<\/podcast:guid>/);
            const feedAuthorMatch = xmlText.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
            
            const feedData = {
                url: feedUrl,
                title: cleanText(feedTitleMatch ? feedTitleMatch[1] : ''),
                image: feedImageMatch ? feedImageMatch[1] : '',
                guid: feedGuidMatch ? feedGuidMatch[1] : generateGuid(feedUrl),
                author: cleanText(feedAuthorMatch ? feedAuthorMatch[1] : ''),
                tracks: []
            };
            
            // Parse items
            const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
            
            itemMatches.forEach(item => {
                const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
                const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
                const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
                const imageMatch = item.match(/<itunes:image href="(.*?)"/);
                const artistMatch = item.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
                
                if (titleMatch && enclosureMatch) {
                    feedData.tracks.push({
                        title: cleanText(titleMatch[1]),
                        enclosureUrl: enclosureMatch[1],
                        guid: guidMatch ? cleanText(guidMatch[1]) : '',
                        duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                        image: imageMatch ? imageMatch[1] : feedData.image,
                        artist: cleanText(artistMatch ? artistMatch[1] : feedData.author)
                    });
                }
            });
            
            console.log(`  ✅ Found ${feedData.tracks.length} tracks`);
            return feedData;
            
        } catch (error) {
            console.log(`  ❌ Attempt ${attempt} failed: ${error.message}`);
            if (attempt === retries) {
                return null;
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
    return null;
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

function generateGuid(input) {
    const hash = crypto.createHash('sha256').update(input).digest('hex');
    return [
        hash.substring(0, 8),
        hash.substring(8, 12),
        '5' + hash.substring(13, 16),
        ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20),
        hash.substring(20, 32)
    ].join('-');
}

async function targetedFeedRefresh() {
    try {
        console.log('🎯 Targeted Feed Refresh\n');
        console.log('=' .repeat(50));
        
        // Load current database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const currentData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        console.log(`📊 Current database: ${currentData.musicTracks.length} tracks\n`);
        
        // Get all feed URLs from database
        const allFeedUrls = new Set();
        currentData.musicTracks.forEach(track => {
            if (track.feedUrl) {
                allFeedUrls.add(track.feedUrl);
            }
        });
        
        // Start with priority feeds
        const feedsToProcess = [...PRIORITY_FEEDS];
        
        // Add feeds that have duplicate issues
        const duplicateFeeds = findFeedsWithDuplicates(currentData);
        feedsToProcess.push(...duplicateFeeds);
        
        // Add feeds with missing tracks (single track albums might indicate missing tracks)
        const singleTrackFeeds = findSingleTrackFeeds(currentData, allFeedUrls);
        feedsToProcess.push(...singleTrackFeeds.slice(0, 10)); // Limit to 10 for now
        
        const uniqueFeeds = [...new Set(feedsToProcess)];
        console.log(`🔄 Processing ${uniqueFeeds.length} targeted feeds:\n`);
        
        const results = {
            updated: [],
            failed: [],
            noChanges: []
        };
        
        for (const feedUrl of uniqueFeeds) {
            console.log(`Processing: ${feedUrl}`);
            
            const feedData = await parseRSSFeed(feedUrl);
            
            if (feedData && feedData.tracks.length > 0) {
                const updated = await updateFeedInDatabase(feedUrl, feedData, currentData);
                if (updated) {
                    results.updated.push({
                        url: feedUrl,
                        tracks: feedData.tracks.length,
                        title: feedData.title
                    });
                } else {
                    results.noChanges.push(feedUrl);
                }
            } else {
                results.failed.push(feedUrl);
            }
            
            // Delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        console.log('\n' + '=' .repeat(50));
        console.log('📊 Results:');
        console.log(`  ✅ Updated: ${results.updated.length} feeds`);
        console.log(`  ❌ Failed: ${results.failed.length} feeds`);
        console.log(`  ➡️ No changes: ${results.noChanges.length} feeds`);
        
        if (results.updated.length > 0) {
            // Create backup
            const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-targeted-refresh-${Date.now()}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(currentData, null, 2));
            console.log(`📋 Backup created: ${path.basename(backupPath)}`);
            
            // Save updated database
            currentData.metadata = {
                ...currentData.metadata,
                lastUpdated: new Date().toISOString(),
                targetedRefresh: {
                    date: new Date().toISOString(),
                    feedsProcessed: uniqueFeeds.length,
                    feedsUpdated: results.updated.length,
                    feedsFailed: results.failed.length,
                    note: 'Targeted refresh of problematic feeds'
                }
            };
            
            fs.writeFileSync(musicDbPath, JSON.stringify(currentData, null, 2));
            console.log(`✅ Database updated with ${results.updated.length} refreshed feeds`);
        }
        
        console.log('\n🎯 Targeted refresh completed!');
        
    } catch (error) {
        console.error('❌ Error in targeted refresh:', error);
    }
}

function findFeedsWithDuplicates(currentData) {
    const feedGroups = new Map();
    
    currentData.musicTracks.forEach(track => {
        const key = track.feedUrl || 'unknown';
        if (!feedGroups.has(key)) {
            feedGroups.set(key, []);
        }
        feedGroups.get(key).push(track);
    });
    
    const duplicateFeeds = [];
    feedGroups.forEach((tracks, feedUrl) => {
        const titleCounts = {};
        tracks.forEach(track => {
            titleCounts[track.title] = (titleCounts[track.title] || 0) + 1;
        });
        
        const hasDuplicates = Object.values(titleCounts).some(count => count > 1);
        if (hasDuplicates && feedUrl !== 'unknown') {
            duplicateFeeds.push(feedUrl);
        }
    });
    
    return duplicateFeeds;
}

function findSingleTrackFeeds(currentData, allFeedUrls) {
    const feedGroups = new Map();
    
    currentData.musicTracks.forEach(track => {
        const key = track.feedUrl || 'unknown';
        if (!feedGroups.has(key)) {
            feedGroups.set(key, 0);
        }
        feedGroups.set(key, feedGroups.get(key) + 1);
    });
    
    const singleTrackFeeds = [];
    feedGroups.forEach((count, feedUrl) => {
        if (count === 1 && feedUrl !== 'unknown' && allFeedUrls.has(feedUrl)) {
            singleTrackFeeds.push(feedUrl);
        }
    });
    
    return singleTrackFeeds;
}

async function updateFeedInDatabase(feedUrl, feedData, currentData) {
    // Remove existing tracks for this feed
    const originalCount = currentData.musicTracks.length;
    currentData.musicTracks = currentData.musicTracks.filter(track => 
        track.feedUrl !== feedUrl
    );
    const removedCount = originalCount - currentData.musicTracks.length;
    
    // Add new tracks
    feedData.tracks.forEach(track => {
        currentData.musicTracks.push({
            title: track.title,
            feedTitle: feedData.title || 'Unknown Album',
            feedArtist: track.artist || feedData.author || 'Unknown Artist',
            feedUrl: feedUrl,
            feedGuid: feedData.guid,
            feedImage: feedData.image,
            guid: track.guid || generateGuid(`${feedUrl}|${track.title}`),
            enclosureUrl: track.enclosureUrl,
            duration: track.duration,
            image: track.image,
            datePublished: Math.floor(Date.now() / 1000),
            explicit: false,
            source: 'Targeted Feed Refresh'
        });
    });
    
    const addedCount = feedData.tracks.length;
    console.log(`  📊 ${feedData.title}: ${removedCount} removed → ${addedCount} added`);
    
    return removedCount > 0 || addedCount > 0;
}

// Run the targeted refresh
targetedFeedRefresh();