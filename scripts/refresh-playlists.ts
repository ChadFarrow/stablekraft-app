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

async function refreshPlaylists() {
  console.log('🎵 Refreshing playlists from existing tagged data...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    console.log(`📋 Found ${musicTracks.length} total tracks in JSON`);
    
    // Define playlists to refresh
    const playlistConfigs = [
      {
        name: 'UpBeats Music Playlist',
        filter: (track: MusicTrack) => track.source && track.source.includes('UpBEATs')
      },
      {
        name: 'Behind the Sch3m3s Music Playlist', 
        filter: (track: MusicTrack) => track.source && track.source.includes('BTS')
      },
      {
        name: 'Flowgnar Music Playlist',
        filter: (track: MusicTrack) => track.source && track.source.includes('Flowgnar')
      }
    ];
    
    for (const config of playlistConfigs) {
      console.log(`\n🎵 Refreshing ${config.name}...`);
      
      // Filter tracks for this playlist
      const playlistTracks = musicTracks.filter(config.filter);
      console.log(`📊 Found ${playlistTracks.length} tracks for ${config.name}`);
      
      // Find existing playlist
      const playlist = await prisma.userPlaylist.findFirst({
        where: { name: config.name }
      });
      
      if (!playlist) {
        console.log(`⚠️  Playlist "${config.name}" not found, skipping...`);
        continue;
      }
      
      // Clear existing tracks
      await prisma.playlistTrack.deleteMany({
        where: { playlistId: playlist.id }
      });
      console.log(`🧹 Cleared existing tracks from playlist`);
      
      // Match tracks to database entries and add to playlist
      let addedCount = 0;
      let notFoundCount = 0;
      const notFoundTracks: string[] = [];
      
      for (let i = 0; i < playlistTracks.length; i++) {
        const jsonTrack = playlistTracks[i];
        
        try {
          // Try to find matching track in database - more flexible matching
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
                    contains: jsonTrack.title,
                    mode: 'insensitive'
                  }
                },
                ...(jsonTrack.audioUrl ? [{ audioUrl: jsonTrack.audioUrl }] : []),
                ...(jsonTrack.enclosureUrl ? [{ audioUrl: jsonTrack.enclosureUrl }] : [])
              ]
            },
            include: { feed: true }
          });
          
          if (dbTrack) {
            await prisma.playlistTrack.create({
              data: {
                id: `playlist-track-${playlist.id}-${dbTrack.id}-${Date.now()}-${i}`,
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
          } else {
            notFoundCount++;
            notFoundTracks.push(jsonTrack.title);
            if (notFoundCount <= 5) {
              console.log(`⚠️  Track not found in DB: "${jsonTrack.title}"`);
            }
          }
        } catch (error) {
          console.warn(`⚠️  Error processing track "${jsonTrack.title}": ${error}`);
        }
      }
      
      console.log(`✅ ${config.name} refreshed successfully!`);
      console.log(`📊 Summary:`);
      console.log(`   - ${playlistTracks.length} tracks in JSON source`);
      console.log(`   - ${addedCount} tracks added to playlist`);
      console.log(`   - ${notFoundCount} tracks not found in database`);
      
      if (notFoundCount > 5) {
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
            tracks: true
          }
        }
      }
    });
    
    console.log('\n✨ All playlists refreshed successfully!');
    console.log('📊 Final playlist summary:');
    for (const playlist of allPlaylists) {
      console.log(`   - ${playlist.name}: ${playlist._count.tracks} tracks`);
    }
    
  } catch (error) {
    console.error('❌ Failed to refresh playlists:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  refreshPlaylists().catch(console.error);
}

export default refreshPlaylists;