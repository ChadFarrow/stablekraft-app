#!/usr/bin/env node

/**
 * Add ITDV music playlist tracks to the database
 * Plus add complete albums that playlist tracks belong to
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function addITDVPlaylistComplete() {
    console.log('🎵 Adding ITDV Playlist Tracks + Complete Albums\n');
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
        
        // Parse playlist tracks
        const itemMatches = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];
        console.log(`📋 Found ${itemMatches.length} playlist items\n`);
        
        const playlistTracks = [];
        const feedUrlsToFetch = new Set();
        
        // Extract playlist tracks and identify feeds to fetch
        itemMatches.forEach((item, index) => {
            const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
            const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
            const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
            const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
            const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
            const imageMatch = item.match(/<itunes:image href="(.*?)"/);
            const authorMatch = item.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
            const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
            
            // Extract podcast namespace data
            const feedGuidMatch = item.match(/<podcast:remoteItem feedGuid="(.*?)"/);
            const feedUrlMatch = item.match(/<podcast:remoteItem.*?feedUrl="(.*?)"/);
            const itemGuidMatch = item.match(/<podcast:remoteItem.*?itemGuid="(.*?)"/);
            const mediumMatch = item.match(/<podcast:remoteItem.*?medium="(.*?)"/);
            
            if (titleMatch) {
                const track = {
                    title: cleanText(titleMatch[1]),
                    enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                    guid: guidMatch ? cleanText(guidMatch[1]) : generateGuid(`itdv-playlist-${index}-${titleMatch[1]}`),
                    duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                    description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                    image: imageMatch ? imageMatch[1] : '',
                    artist: cleanText(authorMatch ? authorMatch[1] : ''),
                    pubDate: pubDateMatch ? pubDateMatch[1] : '',
                    feedGuid: feedGuidMatch ? feedGuidMatch[1] : null,
                    feedUrl: feedUrlMatch ? feedUrlMatch[1] : null,
                    itemGuid: itemGuidMatch ? itemGuidMatch[1] : null,
                    medium: mediumMatch ? mediumMatch[1] : 'music',
                    datePublished: pubDateMatch ? Math.floor(new Date(pubDateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
                    explicit: false,
                    source: 'ITDV Playlist Track'
                };
                
                playlistTracks.push(track);
                console.log(`${index + 1}. "${track.title}" by ${track.artist || 'Unknown Artist'}`);
                
                // If this track has a feed URL, add it to our list to fetch
                if (track.feedUrl) {
                    feedUrlsToFetch.add(track.feedUrl);
                    console.log(`   → Will fetch complete album from: ${track.feedUrl}`);
                }
            }
        });
        
        console.log(`\n✅ Parsed ${playlistTracks.length} playlist tracks`);
        console.log(`🎵 Found ${feedUrlsToFetch.size} unique album feeds to fetch\n`);
        
        // Fetch complete albums from each feed
        const allAlbumTracks = [];
        let albumCount = 0;
        
        for (const feedUrl of feedUrlsToFetch) {
            try {
                albumCount++;
                console.log(`\n📡 Fetching album ${albumCount}/${feedUrlsToFetch.size}: ${feedUrl}`);
                
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
                const albumImageMatch = albumXml.match(/<itunes:image href="(.*?)"/);
                const albumAuthorMatch = albumXml.match(/<itunes:author>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/itunes:author>/);
                const albumGuidMatch = albumXml.match(/<podcast:guid>(.*?)<\/podcast:guid>/);
                
                const albumTitle = cleanText(albumTitleMatch ? albumTitleMatch[1] : 'Unknown Album');
                const albumImage = albumImageMatch ? albumImageMatch[1] : '';
                const albumArtist = cleanText(albumAuthorMatch ? albumAuthorMatch[1] : '');
                const albumGuid = albumGuidMatch ? albumGuidMatch[1] : generateGuid(feedUrl);
                
                console.log(`  Album: "${albumTitle}" by ${albumArtist}`);
                
                // Extract all tracks from this album
                const albumItemMatches = albumXml.match(/<item>[\s\S]*?<\/item>/g) || [];
                console.log(`  📋 Found ${albumItemMatches.length} tracks in album`);
                
                albumItemMatches.forEach((item, trackIndex) => {
                    const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                    const enclosureMatch = item.match(/<enclosure url="(.*?)".*?\/>/);
                    const guidMatch = item.match(/<guid.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/guid>/);
                    const durationMatch = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/);
                    const descriptionMatch = item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/s);
                    const imageMatch = item.match(/<itunes:image href="(.*?)"/);
                    const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
                    
                    if (titleMatch) {
                        const albumTrack = {
                            title: cleanText(titleMatch[1]),
                            feedTitle: albumTitle,
                            feedArtist: albumArtist,
                            feedUrl: feedUrl,
                            feedGuid: albumGuid,
                            feedImage: albumImage,
                            guid: guidMatch ? cleanText(guidMatch[1]) : generateGuid(`album-${albumGuid}-track-${trackIndex}`),
                            enclosureUrl: enclosureMatch ? enclosureMatch[1] : '',
                            duration: durationMatch ? parseDuration(durationMatch[1]) : 180,
                            description: descriptionMatch ? cleanText(descriptionMatch[1]) : '',
                            image: imageMatch ? imageMatch[1] : albumImage,
                            datePublished: pubDateMatch ? Math.floor(new Date(pubDateMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
                            explicit: false,
                            source: 'ITDV Complete Album'
                        };
                        
                        allAlbumTracks.push(albumTrack);
                        console.log(`    ${trackIndex + 1}. "${albumTrack.title}" (${formatDuration(albumTrack.duration)})`);
                    }
                });
                
                // Small delay between requests
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`  ❌ Error fetching ${feedUrl}: ${error.message}`);
            }
        }
        
        console.log(`\n✅ Fetched ${allAlbumTracks.length} tracks from ${albumCount} albums`);
        
        // Convert playlist tracks to database format
        const playlistDbTracks = playlistTracks.map(track => ({
            title: track.title,
            feedTitle: track.title, // For playlist tracks, use track title as album
            feedArtist: track.artist || 'Unknown Artist',
            feedUrl: track.feedUrl || '',
            feedGuid: track.feedGuid || generateGuid(`playlist-${track.title}`),
            feedImage: track.image,
            guid: track.itemGuid || track.guid,
            enclosureUrl: track.enclosureUrl || '',
            duration: track.duration,
            description: track.description,
            image: track.image,
            datePublished: track.datePublished,
            explicit: track.explicit,
            source: 'ITDV Playlist Track'
        }));
        
        // Combine all tracks
        const allDbTracks = [...playlistDbTracks, ...allAlbumTracks];
        
        console.log(`\n📦 Total tracks to add:`);
        console.log(`  Playlist tracks: ${playlistDbTracks.length}`);
        console.log(`  Album tracks: ${allAlbumTracks.length}`);
        console.log(`  Total: ${allDbTracks.length}`);
        
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
        musicData.musicTracks.push(...allDbTracks);
        
        console.log(`➕ Added ${allDbTracks.length} ITDV tracks`);
        console.log(`📊 New total: ${musicData.musicTracks.length} tracks`);
        
        // Update metadata
        musicData.metadata = {
            ...musicData.metadata,
            lastUpdated: new Date().toISOString(),
            itdvPlaylistCompleteImport: {
                date: new Date().toISOString(),
                sourceUrl: playlistUrl,
                playlistTracks: playlistDbTracks.length,
                albumTracks: allAlbumTracks.length,
                totalTracks: allDbTracks.length,
                albumsProcessed: feedUrlsToFetch.size,
                note: 'Added ITDV playlist tracks plus complete albums they belong to'
            }
        };
        
        // Create backup
        const backupPath = path.join(process.cwd(), 'data', `music-tracks-backup-itdv-complete-${Date.now()}.json`);
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
        
        console.log('\n✅ ITDV playlist + albums import complete!');
        console.log(`📊 Final Summary:`);
        console.log(`  Playlist tracks added: ${playlistDbTracks.length}`);
        console.log(`  Album tracks added: ${allAlbumTracks.length}`);
        console.log(`  Albums processed: ${feedUrlsToFetch.size}`);
        console.log(`  Total new tracks: ${allDbTracks.length}`);
        
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

addITDVPlaylistComplete();