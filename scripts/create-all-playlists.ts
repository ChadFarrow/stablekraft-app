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

async function createAllPlaylists() {
  console.log('🎵 Creating/refreshing ALL playlists from existing tagged data...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    console.log(`📋 Found ${musicTracks.length} total tracks in JSON`);
    
    // Define all 9 playlists
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
      },
      {
        name: 'Flowgnar Music Playlist',
        description: 'Underground and experimental tracks from Flowgnar',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('Flowgnar')
      },
      {
        name: 'HGH Music Playlist',
        description: 'Homegrown Hits - Independent music from around the world',
        image: 'https://homegrownhits.xyz/images/hgh-cover.jpg',
        filter: (track: MusicTrack) => track.source && track.source.includes('HGH')
      },
      {
        name: 'ITDV Music Playlist',
        description: 'Into the Digital Vortex music collection',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/itdv-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('ITDV')
      },
      {
        name: 'IAM Music Playlist',
        description: 'Independent Artist Music playlist',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/iam-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('IAM')
      },
      {
        name: 'MMM Music Playlist',
        description: 'Music collection from MMM podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/mmm-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('MMM')
      },
      {
        name: 'MMT Music Playlist',
        description: 'Music collection from MMT podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/mmt-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('MMT')
      },
      {
        name: 'SAS Music Playlist',
        description: 'Songs and Stories music playlist',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/sas-playlist-art.webp',
        filter: (track: MusicTrack) => track.source && track.source.includes('SAS')
      }
    ];
    
    for (const config of playlistConfigs) {
      console.log(`\n🎵 Processing ${config.name}...`);
      
      // Filter tracks for this playlist
      const playlistTracks = musicTracks.filter(config.filter);
      console.log(`📊 Found ${playlistTracks.length} tracks for ${config.name}`);
      
      if (playlistTracks.length === 0) {
        console.log(`⚠️  No tracks found for ${config.name}, skipping...`);
        continue;
      }
      
      // Check if playlist exists
      let playlist = await prisma.userPlaylist.findFirst({
        where: { name: config.name }
      });
      
      if (playlist) {
        console.log(`✅ Playlist already exists, refreshing tracks...`);
        // Clear existing tracks
        await prisma.playlistTrack.deleteMany({
          where: { playlistId: playlist.id }
        });
        console.log(`🧹 Cleared existing tracks from playlist`);
      } else {
        // Create new playlist
        playlist = await prisma.userPlaylist.create({
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
        console.log(`✅ Created new playlist: ${playlist.name}`);
      }
      
      // Add tracks to playlist
      let addedCount = 0;
      let notFoundCount = 0;
      let duplicateCount = 0;
      const notFoundTracks: string[] = [];
      const addedTrackIds = new Set<string>();
      
      for (let i = 0; i < playlistTracks.length; i++) {
        const jsonTrack = playlistTracks[i];
        
        try {
          // Try to find matching track in database with flexible matching
          const dbTrack = await prisma.track.findFirst({
            where: {
              OR: [
                { 
                  title: {
                    equals: jsonTrack.title,
                    mode: 'insensitive'
                  }
                },
                { 
                  title: {
                    contains: jsonTrack.title.replace(/[^\w\s]/g, ''),
                    mode: 'insensitive'
                  }
                },
                ...(jsonTrack.audioUrl ? [{ audioUrl: jsonTrack.audioUrl }] : []),
                ...(jsonTrack.enclosureUrl ? [{ audioUrl: jsonTrack.enclosureUrl }] : [])
              ]
            }
          });
          
          if (dbTrack) {
            // Check if we already added this track (avoid duplicates)
            if (!addedTrackIds.has(dbTrack.id)) {
              await prisma.playlistTrack.create({
                data: {
                  id: `pt-${playlist.id}-${dbTrack.id}-${Date.now()}-${i}`,
                  playlistId: playlist.id,
                  trackId: dbTrack.id,
                  position: addedCount + 1,
                  addedBy: 'system'
                }
              });
              addedTrackIds.add(dbTrack.id);
              addedCount++;
              
              if (addedCount % 50 === 0) {
                console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
              }
            } else {
              duplicateCount++;
            }
          } else {
            notFoundCount++;
            notFoundTracks.push(jsonTrack.title);
          }
        } catch (error: any) {
          if (error.message?.includes('Unique constraint failed')) {
            duplicateCount++;
          } else {
            console.warn(`⚠️  Error processing track "${jsonTrack.title}": ${error.message}`);
          }
        }
      }
      
      console.log(`✅ ${config.name} processed successfully!`);
      console.log(`📊 Summary:`);
      console.log(`   - ${playlistTracks.length} tracks in JSON source`);
      console.log(`   - ${addedCount} tracks added to playlist`);
      console.log(`   - ${duplicateCount} duplicate tracks skipped`);
      console.log(`   - ${notFoundCount} tracks not found in database`);
      
      if (notFoundCount > 0 && notFoundCount <= 10) {
        console.log(`\n⚠️  Tracks not found:`);
        notFoundTracks.forEach(title => {
          console.log(`   - ${title}`);
        });
      } else if (notFoundCount > 10) {
        console.log(`\n⚠️  First 10 tracks not found:`);
        notFoundTracks.slice(0, 10).forEach(title => {
          console.log(`   - ${title}`);
        });
      }
    }
    
    // Final summary
    const allPlaylists = await prisma.userPlaylist.findMany({
      include: {
        _count: {
          select: {
            PlaylistTrack: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    console.log('\n✨ All playlists processed successfully!');
    console.log('📊 Final playlist summary:');
    for (const playlist of allPlaylists) {
      console.log(`   - ${playlist.name}: ${playlist._count.PlaylistTrack} tracks`);
    }
    
  } catch (error) {
    console.error('❌ Failed to create/refresh playlists:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createAllPlaylists().catch(console.error);
}

export default createAllPlaylists;