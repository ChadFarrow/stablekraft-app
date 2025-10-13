import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { parseStringPromise } from 'xml2js';

const prisma = new PrismaClient();

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function createPlaylistFromXML(xmlFilename: string) {
  console.log(`🎵 Creating playlist from ${xmlFilename}...`);
  
  try {
    // Read the XML file
    const xmlPath = path.join(process.cwd(), 'data', xmlFilename);
    const xmlContent = await fs.readFile(xmlPath, 'utf-8');
    
    // Parse XML
    const result = await parseStringPromise(xmlContent);
    const channel = result.rss.channel[0];
    
    const playlistName = channel.title[0];
    const playlistDescription = channel.description[0];
    const playlistImage = channel.image?.[0]?.url?.[0] || '';
    
    console.log(`📋 Playlist: ${playlistName}`);
    console.log(`📄 Description: ${playlistDescription}`);
    console.log(`🖼️  Image: ${playlistImage}`);
    
    // Extract remote items
    const remoteItems: RemoteItem[] = [];
    if (channel['podcast:remoteItem']) {
      for (const item of channel['podcast:remoteItem']) {
        remoteItems.push({
          feedGuid: item.$.feedGuid,
          itemGuid: item.$.itemGuid
        });
      }
    }
    
    console.log(`📊 Found ${remoteItems.length} remote items in playlist`);
    
    // Check if playlist already exists
    const existingPlaylist = await prisma.userPlaylist.findFirst({
      where: { name: playlistName }
    });
    
    if (existingPlaylist) {
      console.log(`⚠️  Playlist "${playlistName}" already exists, skipping...`);
      return existingPlaylist;
    }
    
    // Create the playlist
    const playlist = await prisma.userPlaylist.create({
      data: {
        id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: playlistName,
        description: playlistDescription,
        isPublic: true,
        createdBy: 'system',
        image: playlistImage,
        updatedAt: new Date()
      }
    });
    
    console.log(`✅ Created playlist: ${playlist.name} (ID: ${playlist.id})`);
    
    // Find matching tracks in database by GUID
    let addedCount = 0;
    let notFoundCount = 0;
    
    for (let i = 0; i < remoteItems.length; i++) {
      const remoteItem = remoteItems[i];
      
      try {
        // Try to find the track by GUID
        const dbTrack = await prisma.track.findFirst({
          where: {
            guid: remoteItem.itemGuid
          },
          include: { Feed: true }
        });
        
        if (dbTrack) {
          // Check if already added to avoid duplicates
          const existing = await prisma.playlistTrack.findFirst({
            where: {
              playlistId: playlist.id,
              trackId: dbTrack.id
            }
          });
          
          if (!existing) {
            await prisma.playlistTrack.create({
              data: {
                id: `playlist-track-${playlist.id}-${dbTrack.id}-${i + 1}`,
                playlistId: playlist.id,
                trackId: dbTrack.id,
                position: i + 1,
                addedBy: 'system'
              }
            });
            addedCount++;
            
            if (addedCount % 25 === 0) {
              console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
            }
          }
        } else {
          notFoundCount++;
          if (notFoundCount <= 10) { // Only show first 10 to avoid spam
            console.log(`⚠️  Track not found: itemGuid=${remoteItem.itemGuid.slice(0, 8)}...`);
          }
        }
      } catch (error) {
        console.warn(`⚠️  Error processing remote item: ${error}`);
      }
    }
    
    console.log(`✅ ${playlistName} playlist created successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - ${remoteItems.length} remote items in XML`);
    console.log(`   - ${addedCount} tracks added to playlist`);
    console.log(`   - ${notFoundCount} tracks not found in database`);
    
    // Get final playlist with track count
    const finalPlaylist = await prisma.userPlaylist.findUnique({
      where: { id: playlist.id },
      include: {
        _count: {
          select: { PlaylistTrack: true }
        }
      }
    });
    
    console.log(`🎵 Final playlist has ${finalPlaylist?._count.PlaylistTrack || 0} tracks`);
    
    return finalPlaylist;
    
  } catch (error) {
    console.error(`❌ Failed to create playlist from ${xmlFilename}:`, error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  const xmlFile = process.argv[2];
  if (!xmlFile) {
    console.error('Please provide XML filename as argument');
    process.exit(1);
  }
  createPlaylistFromXML(xmlFile).catch(console.error);
}

export default createPlaylistFromXML;