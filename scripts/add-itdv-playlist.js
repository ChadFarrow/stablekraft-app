#!/usr/bin/env node

/**
 * Add ITDV music playlist tracks to the database
 * Plus add complete albums that playlist tracks belong to
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function addITDVPlaylist() {
    console.log('🎵 Adding ITDV Music Playlist Tracks\n');
    console.log('=' .repeat(50));
    
    try {
        // Fetch the playlist XML
        const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/ITDV-music-playlist.xml';
        console.log(`📡 Fetching: ${playlistUrl}`);
        
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const xmlText = await response.text();
        console.log(`📊 XML size: ${Math.round(xmlText.length / 1024)}KB`);
        
        // Parse the XML to extract tracks
        const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
        console.log(`📋 Found ${itemMatches.length} items in playlist\n`);
        
        const tracks = [];
        
        itemMatches.forEach((item, index) => {
            // Extract track information
            const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
            const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
            const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
            const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
            const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
            const imageMatch = item.match(/<itunes:image href="(.*?)"/);
            const authorMatch = item.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
            const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
            
            // Extract podcast namespace data
            const podcastPersonMatch = item.match(/<podcast:person.*?>(.*?)<\/podcast:person>/);
            const podcastValueMatch = item.match(/<podcast:value[\s\S]*?<\/podcast:value>/);
            const feedGuidMatch = item.match(/<podcast:remoteItem feedGuid="(.*?)"/);
            const feedUrlMatch = item.match(/<podcast:remoteItem.*?feedUrl="(.*?)"/);
            const itemGuidMatch = item.match(/<podcast:remoteItem.*?itemGuid="(.*?)"/);
            const mediumMatch = item.match(/<podcast:remoteItem.*?medium="(.*?)"/);
            
            if (titleMatch) {
                const track = {
                    title: cleanText(titleMatch[1]),
                    enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                    guid: guidMatch ? cleanText(guidMatch[1]) : generateGuid(`itdv-${index}-${titleMatch[1]}`),
                    duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                    description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                    image: imageMatch ? imageMatch[1] : '',
                    artist: cleanText(authorMatch ? authorMatch[1] : (podcastPersonMatch ? podcastPersonMatch[1] : '')),
                    pubDate: pubDateMatch ? pubDateMatch[1] : '',
                    
                    // Podcast namespace data
                    feedGuid: feedGuidMatch ? feedGuidMatch[1] : null,
                    feedUrl: feedUrlMatch ? feedUrlMatch[1] : null,
                    itemGuid: itemGuidMatch ? itemGuidMatch[1] : null,
                    medium: mediumMatch ? mediumMatch[1] : 'music',
                    
                    // Additional metadata
                    source: 'ITDV Playlist Import',
                    datePublished: pubDateMatch ? Math.floor(new Date(pubDateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
                    explicit: false
                };
                
                tracks.push(track);
                console.log(`${index + 1}. "${track.title}" by ${track.artist || 'Unknown Artist'}`);
                console.log(`   Feed GUID: ${track.feedGuid || 'None'}`);
                console.log(`   Audio URL: ${track.enclosureUrl ? 'Yes' : 'No'}`);
                console.log(`   Duration: ${formatDuration(track.duration)}`);
            }
        });
        
        console.log(`\n✅ Extracted ${tracks.length} tracks from ITDV playlist`);
        
        // Group tracks by feedGuid to identify albums/EPs
        const feedGroups = new Map();
        const singleTracks = [];
        
        tracks.forEach(track => {
            if (track.feedGuid) {
                if (!feedGroups.has(track.feedGuid)) {
                    feedGroups.set(track.feedGuid, []);
                }
                feedGroups.get(track.feedGuid).push(track);
            } else {
                singleTracks.push(track);
            }
        });
        
        console.log(`\n📊 Analysis:`);
        console.log(`  Tracks with feedGuids: ${tracks.length - singleTracks.length}`);
        console.log(`  Single tracks: ${singleTracks.length}`);
        console.log(`  Unique feed GUIDs: ${feedGroups.size}`);
        
        // Identify albums/EPs (feedGuids with multiple tracks)
        const albumFeeds = Array.from(feedGroups.entries()).filter(([guid, tracks]) => tracks.length > 1);
        const singleTrackFeeds = Array.from(feedGroups.entries()).filter(([guid, tracks]) => tracks.length === 1);
        
        console.log(`  Albums/EPs (multiple tracks): ${albumFeeds.length}`);
        console.log(`  Single track feeds: ${singleTrackFeeds.length}`);
        
        if (albumFeeds.length > 0) {
            console.log(`\n🎵 Albums/EPs identified:`);
            albumFeeds.forEach(([feedGuid, albumTracks]) => {
                const firstTrack = albumTracks[0];
                console.log(`  • ${feedGuid.substring(0, 8)}... : ${albumTracks.length} tracks`);
                console.log(`    First track: "${firstTrack.title}" by ${firstTrack.artist}`);
            });
        }
        
        // Load existing database
        const musicDbPath = path.join(process.cwd(), 'data', 'music-tracks.json');
        const musicData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        
        console.log(`\n📊 Current database has ${musicData.musicTracks.length} tracks`);
        
        // Convert tracks to database format
        const dbTracks = [];
        
        // Process album/EP tracks
        for (const [feedGuid, albumTracks] of albumFeeds) {
            // Try to get album info from the feed
            let albumInfo = null;
            if (albumTracks[0].feedUrl) {
                try {
                    console.log(`\n🔍 Fetching album info for feed: ${albumTracks[0].feedUrl}`);
                    const feedResponse = await fetch(albumTracks[0].feedUrl, { timeout: 10000 });
                    if (feedResponse.ok) {
                        const feedXml = await feedResponse.text();
                        
                        // Extract album-level metadata
                        const albumTitleMatch = feedXml.match(/<channel>[\s\S]*?<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                        const albumImageMatch = feedXml.match(/<itunes:image href="(.*?)"/);
                        const albumAuthorMatch = feedXml.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
                        
                        albumInfo = {
                            title: albumTitleMatch ? cleanText(albumTitleMatch[1]) : albumTracks[0].title,
                            image: albumImageMatch ? albumImageMatch[1] : albumTracks[0].image,
                            artist: albumAuthorMatch ? cleanText(albumAuthorMatch[1]) : albumTracks[0].artist
                        };
                        
                        console.log(`  Album: "${albumInfo.title}" by ${albumInfo.artist}`);
                    }
                } catch (error) {
                    console.log(`  ⚠️ Failed to fetch album info: ${error.message}`);
                }
            }
            
            // Create database tracks for this album
            albumTracks.forEach(track => {
                const dbTrack = {
                    title: track.title,
                    feedTitle: albumInfo ? albumInfo.title : track.title,
                    feedArtist: albumInfo ? albumInfo.artist : track.artist || 'Unknown Artist',
                    feedUrl: track.feedUrl || '',
                    feedGuid: feedGuid,
                    feedImage: albumInfo ? albumInfo.image : track.image,
                    guid: track.itemGuid || track.guid,
                    enclosureUrl: track.enclosureUrl || '',
                    duration: track.duration,
                    description: track.description,
                    image: track.image || (albumInfo ? albumInfo.image : ''),
                    datePublished: track.datePublished,
                    explicit: track.explicit,
                    source: 'ITDV Playlist Import'
                };
                
                dbTracks.push(dbTrack);
            });
        }
        
        // Process single track feeds and standalone tracks
        [...singleTrackFeeds.map(([, tracks]) => tracks[0]), ...singleTracks].forEach(track => {
            const dbTrack = {
                title: track.title,
                feedTitle: track.title, // Use track title as album title for singles
                feedArtist: track.artist || 'Unknown Artist',
                feedUrl: track.feedUrl || '',
                feedGuid: track.feedGuid || generateGuid(`itdv-single-${track.title}`),
                feedImage: track.image,
                guid: track.itemGuid || track.guid,
                enclosureUrl: track.enclosureUrl || '',
                duration: track.duration,
                description: track.description,
                image: track.image,
                datePublished: track.datePublished,
                explicit: track.explicit,
                source: 'ITDV Playlist Import'
            };
            
            dbTracks.push(dbTrack);
        });
        
        console.log(`\n📦 Created ${dbTracks.length} database tracks`);
        
        // Check for existing ITDV tracks to avoid duplicates
        const existingITDVTracks = musicData.musicTracks.filter(track => 
            track.source === 'ITDV Playlist Import'
        );
        
        if (existingITDVTracks.length > 0) {
            console.log(`⚠️ Found ${existingITDVTracks.length} existing ITDV tracks - removing them first`);
            musicData.musicTracks = musicData.musicTracks.filter(track => 
                track.source !== 'ITDV Playlist Import'
            );
        }
        
        // Add new tracks
        musicData.musicTracks.push(...dbTracks);
        
        console.log(`➕ Added ${dbTracks.length} ITDV tracks to database`);
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            itdvPlaylistImport: {
                date: new Date().toISOString(),
                sourceUrl: playlistUrl,
                tracksAdded: dbTracks.length,
                albumsAdded: albumFeeds.length,
                singlesAdded: singleTrackFeeds.length + singleTracks.length,
                note: 'Added tracks from ITDV music playlist'
            }
        };
        
        // Create backup
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-itdv-playlist-${Date.now()}.json`);
        const backupData = JSON.parse(fs.readFileSync(musicDbPath, 'utf8'));
        fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
        console.log(`\n📋 Backup created: ${path.basename(backupPath)}`);
        
        // Save updated database
        fs.writeFileSync(musicDbPath, JSON.stringify(musicData, null, 2));
        console.log(`💾 Database updated: ${musicData.musicTracks.length} total tracks`);
        
        // Regenerate optimized cache
        console.log('\n🔄 Regenerating optimized cache...');
        const { execSync } = require('child_process');
        try {
            execSync('node scripts/create-optimized-cache.js', { stdio: 'pipe' });
            console.log('✅ Optimized cache regenerated');
        } catch (error) {
            console.log('⚠️ Please manually regenerate cache');
        }
        
        console.log('\n✅ ITDV playlist import complete!');
        console.log(`📊 Summary:`);
        console.log(`  Total tracks added: ${dbTracks.length}`);
        console.log(`  Albums/EPs: ${albumFeeds.length}`);
        console.log(`  Singles: ${singleTrackFeeds.length + singleTracks.length}`);
        
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
    // Parse HH:MM:SS or MM:SS format
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

addITDVPlaylist();