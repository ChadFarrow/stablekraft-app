#!/usr/bin/env node

/**
 * Add ITDV music playlist tracks to the database
 * This playlist uses podcast:remoteItem format - fetch the actual tracks from their feeds
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function addITDVPlaylistRemotes() {
    console.log('🎵 Adding ITDV Playlist Remote Tracks + Complete Albums\n');
    console.log('=' .repeat(60));
    
    try {
        // Fetch the playlist XML
        const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';
        console.log(`📡 Fetching playlist: ${playlistUrl}`);
        
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const xmlText = await response.text();
        console.log(`📊 XML size: ${Math.round(xmlText.length / 1024)}KB`);
        
        // Parse remoteItem references
        const remoteItemMatches = xmlText.match(/<podcast:remoteItem[^>]*\/>/g) || [];
        console.log(`📋 Found ${remoteItemMatches.length} remote item references\n`);
        
        const remoteItems = [];
        const feedGuidsToFetch = new Set();
        
        // Extract remote item info
        remoteItemMatches.forEach((remoteItem, index) => {
            const feedGuidMatch = remoteItem.match(/feedGuid="([^"]+)"/);
            const itemGuidMatch = remoteItem.match(/itemGuid="([^"]+)"/);
            const feedUrlMatch = remoteItem.match(/feedUrl="([^"]+)"/);
            
            if (feedGuidMatch && itemGuidMatch) {
                const item = {
                    feedGuid: feedGuidMatch[1],
                    itemGuid: itemGuidMatch[1],
                    feedUrl: feedUrlMatch ? feedUrlMatch[1] : null
                };
                
                remoteItems.push(item);
                feedGuidsToFetch.add(item.feedGuid);
                
                console.log(`${index + 1}. FeedGUID: ${item.feedGuid.substring(0, 12)}...`);
                console.log(`   ItemGUID: ${item.itemGuid.substring(0, 12)}...`);
                if (item.feedUrl) console.log(`   FeedURL: ${item.feedUrl}`);
            }
        });
        
        console.log(`\n✅ Parsed ${remoteItems.length} remote items`);
        console.log(`🎵 Found ${feedGuidsToFetch.size} unique feed GUIDs to fetch\n`);
        
        // We need to resolve feedGuids to feedUrls using the Podcast Index API
        console.log('🔍 Resolving feed GUIDs to URLs using Podcast Index API...');
        
        const { podcastIndexLookup } = require('./podcast-index-utils');
        const feedUrlMap = new Map();
        
        let resolvedCount = 0;
        for (const feedGuid of feedGuidsToFetch) {
            try {
                const feedInfo = await podcastIndexLookup(feedGuid);
                if (feedInfo && feedInfo.url) {
                    feedUrlMap.set(feedGuid, feedInfo.url);
                    resolvedCount++;
                    console.log(`✅ ${feedGuid.substring(0, 12)}... → ${feedInfo.url}`);
                    
                    // Add delay between API calls
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                    console.log(`❌ ${feedGuid.substring(0, 12)}... → Not found`);
                }
            } catch (error) {
                console.log(`❌ ${feedGuid.substring(0, 12)}... → Error: ${error.message}`);
            }
        }
        
        console.log(`\n📊 Resolved ${resolvedCount}/${feedGuidsToFetch.size} feed GUIDs to URLs`);
        
        // Now fetch complete albums from resolved feeds
        const allTracks = [];
        let albumCount = 0;
        
        for (const [feedGuid, feedUrl] of feedUrlMap) {
            try {
                albumCount++;
                console.log(`\n📡 Fetching album ${albumCount}/${feedUrlMap.size}: ${feedUrl}`);
                
                const albumResponse = await fetch(feedUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MusicSiteParser/1.0)' },
                    timeout: 15000
                });
                
                if (!albumResponse.ok) {
                    console.log(`  ⚠️ HTTP ${albumResponse.status} - skipping`);
                    continue;
                }
                
                const albumXml = await albumResponse.text();
                console.log(`  📊 Feed size: ${Math.round(albumXml.length / 1024)}KB`);
                
                // Extract album metadata
                const albumTitleMatch = albumXml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                const albumImageMatch = albumXml.match(/<itunes:image href="([^"]+)"/);
                const albumAuthorMatch = albumXml.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
                
                const albumTitle = cleanText(albumTitleMatch ? albumTitleMatch[1] : 'Unknown Album');
                const albumImage = albumImageMatch ? albumImageMatch[1] : '';
                const albumArtist = cleanText(albumAuthorMatch ? albumAuthorMatch[1] : '');
                
                console.log(`  Album: "${albumTitle}" by ${albumArtist}`);
                
                // Extract all tracks from this album
                const albumItemMatches = albumXml.match(/<item>[\s\S]*?<\/item>/g) || [];
                console.log(`  📋 Found ${albumItemMatches.length} tracks in album`);
                
                // Find which items from this feed are in our playlist
                const playlistItemsFromThisFeed = remoteItems.filter(item => item.feedGuid === feedGuid);
                console.log(`  📌 ${playlistItemsFromThisFeed.length} playlist tracks from this feed`);
                
                albumItemMatches.forEach((item, trackIndex) => {
                    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                    const enclosureMatch = item.match(/<enclosure url="([^"]+)"[^>]*\/>/);
                    const guidMatch = item.match(/<guid[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
                    const durationMatch = item.match(/<itunes:duration>([^<]+)<\/itunes:duration>/);
                    const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                    const imageMatch = item.match(/<itunes:image href="([^"]+)"/);
                    const pubDateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);
                    
                    if (titleMatch) {
                        const trackGuid = guidMatch ? cleanText(guidMatch[1]) : '';
                        
                        // Mark if this track is in the playlist
                        const isPlaylistTrack = playlistItemsFromThisFeed.some(pItem => pItem.itemGuid === trackGuid);
                        
                        const albumTrack = {
                            title: cleanText(titleMatch[1]),
                            feedTitle: albumTitle,
                            feedArtist: albumArtist,
                            feedUrl: feedUrl,
                            feedGuid: feedGuid,
                            feedImage: albumImage,
                            guid: trackGuid,
                            enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                            duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                            description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                            image: imageMatch ? imageMatch[1] : albumImage,
                            datePublished: pubDateMatch ? Math.floor(new Date(pubDateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
                            explicit: false,
                            source: isPlaylistTrack ? 'ITDV Playlist Track' : 'ITDV Complete Album'
                        };
                        
                        allTracks.push(albumTrack);
                        
                        const marker = isPlaylistTrack ? '⭐' : '  ';
                        console.log(`    ${marker} ${trackIndex + 1}. "${albumTrack.title}" (${formatDuration(albumTrack.duration)})`);
                    }
                });
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`  ❌ Error fetching album: ${error.message}`);
            }
        }
        
        console.log(`\n✅ Fetched ${allTracks.length} total tracks from ${feedUrlMap.size} albums`);
        
        const playlistTracks = allTracks.filter(track => track.source === 'ITDV Playlist Track');
        const albumTracks = allTracks.filter(track => track.source === 'ITDV Complete Album');
        
        console.log(`📊 Breakdown:`);
        console.log(`  Playlist tracks: ${playlistTracks.length}`);
        console.log(`  Additional album tracks: ${albumTracks.length}`);
        
        // Load existing database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        console.log(`\n📊 Current database: ${musicData.musicTracks.length} tracks`);
        
        // Remove existing ITDV tracks
        const existingITDVTracks = musicData.musicTracks.filter(track => 
            track.source === 'ITDV Playlist Track' || track.source === 'ITDV Complete Album'
        );
        
        if (existingITDVTracks.length > 0) {
            console.log(`⚠️ Removing ${existingITDVTracks.length} existing ITDV tracks`);
            musicData.musicTracks = musicData.musicTracks.filter(track => 
                track.source !== 'ITDV Playlist Track' && track.source !== 'ITDV Complete Album'
            );
        }
        
        // Add new tracks
        musicData.musicTracks.push(...allTracks);
        
        console.log(`➕ Added ${allTracks.length} ITDV tracks`);
        console.log(`📊 New total: ${musicData.musicTracks.length} tracks`);
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            itdvPlaylistRemoteImport: {
                date: new Date().toISOString(),
                sourceUrl: playlistUrl,
                remoteItems: remoteItems.length,
                resolvedFeeds: feedUrlMap.size,
                playlistTracks: playlistTracks.length,
                albumTracks: albumTracks.length,
                totalTracks: allTracks.length,
                note: 'Added ITDV playlist remote tracks plus complete albums'
            }
        };
        
        // Create backup
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-itdv-remote-${Date.now()}.json`);
        const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`\n📋 Backup created: ${path.basename(backupPath)}`);
        
        // Save updated database
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        console.log(`💾 Database saved: ${musicData.musicTracks.length} total tracks`);
        
        // Regenerate optimized cache
        console.log('\n🔄 Regenerating optimized cache...');
        const { execSync } = require('child_process');
        try {
            execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
            console.log('✅ Optimized cache regenerated');
        } catch (error) {
            console.log('⚠️ Please manually regenerate cache');
        }
        
        console.log('\n✅ ITDV playlist remote import complete!');
        console.log(`📊 Final Summary:`);
        console.log(`  Remote items processed: ${remoteItems.length}`);
        console.log(`  Feeds resolved: ${feedUrlMap.size}`);
        console.log(`  Playlist tracks added: ${playlistTracks.length}`);
        console.log(`  Album tracks added: ${albumTracks.length}`);
        console.log(`  Total new tracks: ${allTracks.length}`);
        
    } catch (error) {
        console.error('❌ Error importing ITDV playlist:', error);
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
    } else {
        return parseInt(durationString) || 180;
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
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

addITDVPlaylistRemotes();