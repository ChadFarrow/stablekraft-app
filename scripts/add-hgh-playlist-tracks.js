#!/usr/bin/env node

const path = require('path');
const { XMLParser } = require('fast-xml-parser');

async function addHghPlaylistTracks() {
    console.log('🎵 Adding HGH Music Playlist Remote Items\n');
    console.log('=' .repeat(60) + '\n');
    
    // All data is now stored in Prisma database
    // No JSON file operations needed
    
    // Fetch the HGH playlist XML
    const playlistUrl = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs/HGH-music-playlist.xml';
    console.log(`📥 Fetching HGH playlist from: ${playlistUrl}\n`);
    
    try {
        const response = await fetch(playlistUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const xmlContent = await response.text();
        console.log(`📄 Downloaded ${Math.round(xmlContent.length / 1024)}KB of XML data\n`);
        
        // Parse XML
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });
        
        const parsedXml = parser.parse(xmlContent);
        
        // Navigate to remote items
        const remoteItems = parsedXml?.rss?.channel?.item || [];
        console.log(`🔍 Found ${remoteItems.length} items in HGH playlist\n`);
        
        if (!Array.isArray(remoteItems)) {
            console.log('⚠️  Expected array of remote items, but got single item or unexpected structure');
            return;
        }
        
        // Extract remote item references
        let addedCount = 0;
        let skippedCount = 0;
        let duplicateCount = 0;
        
        // Check existing tracks in Prisma database
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        const existingGuids = new Set();
        try {
            // Get all existing tracks with V4V data to check for duplicates
            const existingTracks = await prisma.track.findMany({
                where: {
                    v4vValue: { not: null }
                },
                select: {
                    v4vValue: true
                }
            });
            
            existingTracks.forEach(track => {
                if (track.v4vValue && typeof track.v4vValue === 'object') {
                    const v4v = track.v4vValue as any;
                    if (v4v.feedGuid && v4v.itemGuid) {
                        const combinedGuid = `${v4v.feedGuid}:${v4v.itemGuid}`;
                        existingGuids.add(combinedGuid);
                    }
                }
            });
            
            console.log(`📊 Existing tracks in Prisma database: ${existingTracks.length}`);
            console.log(`📊 Unique existing GUIDs: ${existingGuids.size}\n`);
        } catch (error) {
            console.warn(`⚠️  Could not check existing tracks: ${error.message}`);
        }
        
        for (const [index, item] of remoteItems.entries()) {
            // Look for podcast:remoteItem in the item
            let remoteItemRef = null;
            
            // Check various possible locations for remoteItem
            if (item['podcast:remoteItem']) {
                remoteItemRef = item['podcast:remoteItem'];
            } else if (item.remoteItem) {
                remoteItemRef = item.remoteItem;
            } else {
                // Look in the item description or other fields for remoteItem data
                console.log(`   ⚠️  No remoteItem found in item ${index + 1}, skipping`);
                skippedCount++;
                continue;
            }
            
            // Handle array of remoteItems or single remoteItem
            const remoteItemArray = Array.isArray(remoteItemRef) ? remoteItemRef : [remoteItemRef];
            
            for (const remoteItem of remoteItemArray) {
                const feedGuid = remoteItem['@_feedGuid'];
                const itemGuid = remoteItem['@_itemGuid'];
                
                if (!feedGuid || !itemGuid) {
                    console.log(`   ⚠️  Missing feedGuid or itemGuid in remote item, skipping`);
                    skippedCount++;
                    continue;
                }
                
                // Check for duplicates
                const combinedGuid = `${feedGuid}:${itemGuid}`;
                if (existingGuids.has(combinedGuid)) {
                    console.log(`   🔄 Duplicate: ${feedGuid}:${itemGuid.substring(0, 8)}... (skipping)`);
                    duplicateCount++;
                    continue;
                }
                
                // Add new track to Prisma database
                try {
                    const trackId = `hgh-${feedGuid.substring(0, 8)}-${itemGuid.substring(0, 8)}-${Date.now()}`;
                    
                    // Find or create feed (using Podcast Index feed URL pattern)
                    const feedUrl = `https://podcastindex.org/podcast/${feedGuid}`;
                    let feed = await prisma.feed.findFirst({
                        where: { originalUrl: feedUrl }
                    });
                    
                    if (!feed) {
                        feed = await prisma.feed.create({
                            data: {
                                id: `hgh-feed-${feedGuid.substring(0, 8)}`,
                                title: 'HGH Playlist Import',
                                artist: 'Unknown Artist',
                                originalUrl: feedUrl,
                                type: 'album',
                                status: 'active',
                                image: '/stablekraft-rocket.png',
                                updatedAt: new Date()
                            }
                        });
                    }
                    
                    // Check if track already exists
                    const existing = await prisma.track.findUnique({ where: { id: trackId } });
                    
                    if (!existing) {
                        await prisma.track.create({
                            data: {
                                id: trackId,
                                guid: itemGuid,
                                title: `Track ${addedCount + 1}`, // Will be resolved later
                                artist: 'Unknown Artist',
                                album: 'HGH Playlist Import',
                                audioUrl: '', // Will be resolved later
                                duration: 5999, // Placeholder 99:99
                                image: '/stablekraft-rocket.png',
                                feedId: feed.id,
                                v4vValue: {
                                    feedGuid: feedGuid,
                                    itemGuid: itemGuid,
                                    needsResolution: true,
                                    source: 'HGH Playlist Import'
                                },
                                publishedAt: new Date(),
                                updatedAt: new Date()
                            }
                        });
                        addedCount++;
                        console.log(`✅ Added to Prisma: ${feedGuid.substring(0, 8)}... : ${itemGuid.substring(0, 8)}...`);
                    } else {
                        duplicateCount++;
                        console.log(`🔄 Duplicate (already in Prisma): ${feedGuid.substring(0, 8)}...`);
                    }
                } catch (error) {
                    console.warn(`⚠️  Failed to add track to Prisma: ${error.message}`);
                }
                
                existingGuids.add(combinedGuid);
            }
        }
        
        // Close Prisma connection
        await prisma.$disconnect();
        
        // Get final track count from Prisma
        let totalTracks = 0;
        try {
            const { PrismaClient } = require('@prisma/client');
            const prismaFinal = new PrismaClient();
            totalTracks = await prismaFinal.track.count();
            await prismaFinal.$disconnect();
        } catch (error) {
            console.warn(`⚠️  Could not get final track count: ${error.message}`);
        }
        
        console.log('\n' + '=' .repeat(60));
        console.log('📊 HGH Import Summary:');
        console.log(`  📥 Items in playlist: ${remoteItems.length}`);
        console.log(`  ✅ Tracks added: ${addedCount}`);
        console.log(`  🔄 Duplicates skipped: ${duplicateCount}`);
        console.log(`  ⚠️  Items skipped: ${skippedCount}`);
        console.log(`  📈 Total tracks in database: ${totalTracks}`);
        
        console.log('\n🎯 Next Steps:');
        console.log('1. Run comprehensive-music-discovery.js to resolve metadata');
        console.log('2. Use remove-placeholder-tracks.js to clean up unresolved items');
        console.log('3. All new tracks have 99:99 duration and main page artwork placeholders');
        
        console.log('\n✨ HGH playlist import complete!');
        
    } catch (error) {
        console.error('❌ Error importing HGH playlist:', error.message);
        process.exit(1);
    }
}

// Run the import
addHghPlaylistTracks();