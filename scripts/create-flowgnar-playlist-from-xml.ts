import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import { parseStringPromise } from 'xml2js';

const prisma = new PrismaClient();

interface RemoteItem {
  feedGuid: string;
  itemGuid: string;
}

async function createFlowgnarPlaylistFromXML() {
  console.log('🎵 Creating Flowgnar playlist from XML...');
  
  try {
    // Read the XML file
    const xmlPath = path.join(process.cwd(), 'data', 'flowgnar-playlist.xml');
    const xmlContent = await fs.readFile(xmlPath, 'utf-8');
    
    // Parse XML
    const result = await parseStringPromise(xmlContent);
    const channel = result.rss.channel[0];
    
    console.log(`📋 Playlist: ${channel.title[0]}`);
    console.log(`📄 Description: ${channel.description[0]}`);
    
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
    
    // Create the playlist
    const playlist = await prisma.userPlaylist.create({
      data: {
        name: channel.title[0],
        description: channel.description[0],
        isPublic: true,
        createdBy: 'system',
        image: channel.image?.[0]?.url?.[0] || 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp'
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
          include: { feed: true }
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
                playlistId: playlist.id,
                trackId: dbTrack.id,
                position: i + 1,
                addedBy: 'system'
              }
            });
            addedCount++;
            
            if (addedCount % 50 === 0) {
              console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
            }
          }
        } else {
          notFoundCount++;
          console.log(`⚠️  Track not found in DB: feedGuid=${remoteItem.feedGuid.slice(0, 8)}... itemGuid=${remoteItem.itemGuid.slice(0, 8)}...`);
        }
      } catch (error) {
        console.warn(`⚠️  Error processing remote item: ${error}`);
      }
    }
    
    console.log(`✅ Flowgnar playlist created successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - ${remoteItems.length} remote items in XML`);
    console.log(`   - ${addedCount} tracks added to playlist`);
    console.log(`   - ${notFoundCount} tracks not found in database`);
    
    // Get final playlist with track count
    const finalPlaylist = await prisma.userPlaylist.findUnique({
      where: { id: playlist.id },
      include: {
        _count: {
          select: { tracks: true }
        }
      }
    });
    
    console.log(`🎵 Final playlist has ${finalPlaylist?._count.tracks || 0} tracks`);
    
    return finalPlaylist;
    
  } catch (error) {
    console.error('❌ Failed to create Flowgnar playlist:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createFlowgnarPlaylistFromXML().catch(console.error);
}

export default createFlowgnarPlaylistFromXML;