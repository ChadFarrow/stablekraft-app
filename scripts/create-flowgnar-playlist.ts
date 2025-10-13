import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

interface MusicTrack {
  title: string;
  artist?: string;
  feedArtist?: string;
  audioUrl?: string;
  enclosureUrl?: string;
  duration?: number;
  source?: string;
  feedTitle?: string;
  albumTitle?: string;
  image?: string;
  imageUrl?: string;
  artworkUrl?: string;
}

async function createFlowgnarPlaylist() {
  console.log('🎵 Creating Flowgnar playlist...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    // Filter Flowgnar tracks
    const flowgnarTracks = musicTracks.filter(track => 
      track.source && track.source.includes('Flowgnar')
    );
    
    console.log(`📋 Found ${flowgnarTracks.length} Flowgnar tracks in JSON`);
    
    // Create the playlist
    const playlist = await prisma.userPlaylist.create({
      data: {
        id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: 'Flowgnar',
        description: 'Curated music playlist featuring independent artists and unique tracks from the Flowgnar collection.',
        isPublic: true,
        createdBy: 'system',
        image: 'https://via.placeholder.com/400x400/6366f1/ffffff?text=Flowgnar',
        updatedAt: new Date()
      }
    });
    
    console.log(`✅ Created playlist: ${playlist.name} (ID: ${playlist.id})`);
    
    // Match tracks to database entries
    let matchedCount = 0;
    let addedCount = 0;
    
    for (let i = 0; i < flowgnarTracks.length; i++) {
      const jsonTrack = flowgnarTracks[i];
      
      try {
        // Try to find matching track in database
        const dbTrack = await prisma.track.findFirst({
          where: {
            OR: [
              { title: jsonTrack.title },
              { audioUrl: jsonTrack.audioUrl || jsonTrack.enclosureUrl }
            ].filter(Boolean)
          },
          include: { Feed: true }
        });
        
        if (dbTrack) {
          matchedCount++;
          
          // Add to playlist
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
          
          if (addedCount % 100 === 0) {
            console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
          }
        }
      } catch (error) {
        // Skip duplicates or errors
        console.warn(`⚠️  Skipping track "${jsonTrack.title}": ${error}`);
      }
    }
    
    console.log(`✅ Playlist created successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - ${flowgnarTracks.length} tracks in JSON source`);
    console.log(`   - ${matchedCount} tracks matched in database`);
    console.log(`   - ${addedCount} tracks added to playlist`);
    
    // Update playlist with final count
    const finalPlaylist = await prisma.userPlaylist.update({
      where: { id: playlist.id },
      data: {
        updatedAt: new Date()
      },
      include: {
        _count: {
          select: { PlaylistTrack: true }
        }
      }
    });
    
    console.log(`🎵 Final playlist has ${finalPlaylist._count.PlaylistTrack} tracks`);
    
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
  createFlowgnarPlaylist().catch(console.error);
}

export default createFlowgnarPlaylist;