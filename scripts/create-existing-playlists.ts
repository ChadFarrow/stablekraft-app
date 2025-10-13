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
  source?: string;
  image?: string;
  duration?: number;
}

async function createExistingPlaylists() {
  console.log('🎵 Creating playlists from existing tagged data...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    console.log(`📋 Found ${musicTracks.length} total tracks in JSON`);
    
    // Define playlists to create
    const playlistConfigs = [
      {
        name: 'UpBeats Music Playlist',
        description: 'Every music reference from UpBEATs',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('UpBEATs')
      },
      {
        name: 'Behind the Sch3m3s Music Playlist', 
        description: 'Curated playlist from Behind the Sch3m3s podcast featuring independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/b4ts-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('BTS')
      }
    ];
    
    for (const config of playlistConfigs) {
      console.log(`\n🎵 Creating ${config.name}...`);
      
      // Filter tracks for this playlist
      const playlistTracks = musicTracks.filter(config.filter);
      console.log(`📊 Found ${playlistTracks.length} tracks for ${config.name}`);
      
      // Check if playlist already exists
      const existingPlaylist = await prisma.userPlaylist.findFirst({
        where: { name: config.name }
      });
      
      if (existingPlaylist) {
        console.log(`⚠️  Playlist "${config.name}" already exists, skipping...`);
        continue;
      }
      
      // Create the playlist
      const playlist = await prisma.userPlaylist.create({
        data: {
          id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: config.name,
          description: config.description,
          isPublic: true,
          createdBy: 'system',
          image: config.image,
          updatedAt: new Date()
        }
      });
      
      console.log(`✅ Created playlist: ${playlist.name} (ID: ${playlist.id})`);
      
      // Match tracks to database entries and add to playlist
      let addedCount = 0;
      let notFoundCount = 0;
      
      for (let i = 0; i < playlistTracks.length; i++) {
        const jsonTrack = playlistTracks[i];
        
        try {
          // Try to find matching track in database
          const dbTrack = await prisma.track.findFirst({
            where: {
              OR: [
                { title: jsonTrack.title },
                { audioUrl: jsonTrack.audioUrl || jsonTrack.enclosureUrl || '' }
              ].filter((condition) => {
                // Remove empty string conditions
                if (condition.audioUrl !== undefined) {
                  return condition.audioUrl !== '';
                }
                return true;
              })
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
              
              if (addedCount % 50 === 0) {
                console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
              }
            }
          } else {
            notFoundCount++;
            if (notFoundCount <= 5) {
              console.log(`⚠️  Track not found in DB: "${jsonTrack.title}"`);
            }
          }
        } catch (error) {
          console.warn(`⚠️  Error processing track "${jsonTrack.title}": ${error}`);
        }
      }
      
      console.log(`✅ ${config.name} created successfully!`);
      console.log(`📊 Summary:`);
      console.log(`   - ${playlistTracks.length} tracks in JSON source`);
      console.log(`   - ${addedCount} tracks added to playlist`);
      console.log(`   - ${notFoundCount} tracks not found in database`);
      
      // Get final track count
      const finalPlaylist = await prisma.userPlaylist.findUnique({
        where: { id: playlist.id },
        include: {
          _count: {
            select: { PlaylistTrack: true }
          }
        }
      });
      
      console.log(`🎵 Final playlist has ${finalPlaylist?._count.PlaylistTrack || 0} tracks`);
    }
    
    // Final summary
    const allPlaylists = await prisma.userPlaylist.findMany({
      include: {
        _count: {
          select: { PlaylistTrack: true }
        }
      }
    });
    
    console.log('\n✨ All playlists created successfully!');
    console.log('📊 Final playlist summary:');
    for (const playlist of allPlaylists) {
      console.log(`   - ${playlist.name}: ${playlist._count.PlaylistTrack} tracks`);
    }
    
  } catch (error) {
    console.error('❌ Failed to create playlists:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createExistingPlaylists().catch(console.error);
}

export default createExistingPlaylists;