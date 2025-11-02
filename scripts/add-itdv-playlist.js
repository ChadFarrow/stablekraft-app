#!/usr/bin/env node

/**
 * Add ITDV music playlist tracks to the database
 * Plus add complete albums that playlist tracks belong to
 */

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
        
        // All data is now stored in Prisma database
        // Get current track count from database
        let currentTrackCount = 0;
        try {
            const { PrismaClient } = require('@prisma/client');
            const prismaCheck = new PrismaClient();
            currentTrackCount = await prismaCheck.track.count();
            await prismaCheck.$disconnect();
            console.log(`\n📊 Current database has ${currentTrackCount} tracks`);
        } catch (error) {
            console.log(`\n📊 Checking current database...`);
        }
        
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
        
        console.log(`\n💾 Adding ${dbTracks.length} ITDV tracks to Prisma database...`);
        
        // Convert dbTracks to Prisma format and add to database
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        let addedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;
        
        try {
            for (const dbTrack of dbTracks) {
                try {
                    // Find or create feed
                    let feed = await prisma.feed.findFirst({
                        where: { originalUrl: dbTrack.feedUrl }
                    });
                    
                    if (!feed && dbTrack.feedUrl) {
                        feed = await prisma.feed.create({
                            data: {
                                id: `feed-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                                title: dbTrack.feedTitle || 'ITDV Playlist Feed',
                                artist: dbTrack.feedArtist || null,
                                originalUrl: dbTrack.feedUrl,
                                type: 'album',
                                status: 'active',
                                image: dbTrack.feedImage || null,
                                updatedAt: new Date()
                            }
                        });
                    }
                    
                    if (!feed) {
                        throw new Error('Could not create feed');
                    }
                    
                    // Generate track ID
                    const trackId = dbTrack.guid || 
                        `itdv-${feed.id}-${dbTrack.title.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
                    
                    // Check if track exists
                    const existing = await prisma.track.findUnique({ where: { id: trackId } });
                    
                    const trackData = {
                        id: trackId,
                        guid: dbTrack.guid || trackId,
                        title: dbTrack.title,
                        artist: dbTrack.feedArtist || null,
                        album: dbTrack.feedTitle || null,
                        audioUrl: dbTrack.enclosureUrl || '',
                        duration: dbTrack.duration ? Math.round(dbTrack.duration) : null,
                        image: dbTrack.image || dbTrack.feedImage || null,
                        description: dbTrack.description || null,
                        feedId: feed.id,
                        publishedAt: dbTrack.datePublished ? new Date(dbTrack.datePublished) : new Date(),
                        updatedAt: new Date()
                    };
                    
                    if (existing) {
                        await prisma.track.update({
                            where: { id: trackId },
                            data: trackData
                        });
                        updatedCount++;
                    } else {
                        await prisma.track.create({ data: trackData });
                        addedCount++;
                    }
                } catch (error) {
                    errorCount++;
                    console.warn(`⚠️  Failed to add track "${dbTrack.title}": ${error.message}`);
                }
            }
            
            console.log(`✅ Added ${addedCount} new tracks, updated ${updatedCount} existing tracks`);
            if (errorCount > 0) {
                console.log(`⚠️  ${errorCount} tracks failed to add`);
            }
            
        } finally {
            await prisma.$disconnect();
        }
        
        
        console.log('\n✅ ITDV playlist import complete!');
        console.log(`📊 Summary:`);
        console.log(`  Total tracks processed: ${dbTracks.length}`);
        console.log(`  New tracks added to Prisma: ${addedCount}`);
        console.log(`  Existing tracks updated: ${updatedCount}`);
        if (errorCount > 0) {
            console.log(`  Errors: ${errorCount}`);
        }
        console.log(`  Albums/EPs: ${albumFeeds.length}`);
        console.log(`  Singles: ${singleTrackFeeds.length + singleTracks.length}`);
        console.log(`\n💾 All data saved to Prisma database (PostgreSQL)`);
        
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