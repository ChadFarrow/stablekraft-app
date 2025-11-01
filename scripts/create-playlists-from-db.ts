import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createPlaylistsFromDatabase() {
  console.log('🎵 Creating/refreshing playlists from Prisma database only...');
  
  try {
    // Define all 9 playlists with their database source criteria
    const playlistConfigs = [
      {
        name: 'UpBeats Music Playlist',
        description: 'Every music reference from UpBEATs',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/UpBEATs-music-playlist.webp',
        sourceFilter: ['UpBEATs', 'upbeats'] // feed titles or descriptions containing these
      },
      {
        name: 'Behind the Sch3m3s Music Playlist',
        description: 'Curated playlist from Behind the Sch3m3s podcast featuring independent artists',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/b4ts-playlist-art.webp',
        sourceFilter: ['Behind the Sch3m3s', 'BTS', 'sch3m3s']
      },
      {
        name: 'Flowgnar Music Playlist',
        description: 'Underground and experimental tracks from Flowgnar',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/flowgnar-playlist-art.webp',
        sourceFilter: ['Flowgnar', 'flowgnar']
      },
      {
        name: 'HGH Music Playlist',
        description: 'Homegrown Hits - Independent music from around the world',
        image: 'https://homegrownhits.xyz/images/hgh-cover.jpg',
        sourceFilter: ['Homegrown', 'HGH', 'homegrownhits'] 
      },
      {
        name: 'ITDV Music Playlist',
        description: 'Into the Digital Vortex music collection',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/itdv-playlist-art.webp',
        sourceFilter: ['ITDV', 'Digital Vortex']
      },
      {
        name: 'IAM Music Playlist',
        description: 'Independent Artist Music playlist',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/iam-playlist-art.webp',
        sourceFilter: ['IAM', 'Independent Artist']
      },
      {
        name: 'MMM Music Playlist',
        description: 'Music collection from MMM podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/mmm-playlist-art.webp',
        sourceFilter: ['MMM']
      },
      {
        name: 'MMT Music Playlist',
        description: 'Music collection from MMT podcast',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/mmt-playlist-art.webp',
        sourceFilter: ['MMT']
      },
      {
        name: 'SAS Music Playlist',
        description: 'Songs and Stories music playlist',
        image: 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/main/docs/sas-playlist-art.webp',
        sourceFilter: ['SAS', 'Songs and Stories']
      }
    ];
    
    for (const config of playlistConfigs) {
      console.log(`\n🎵 Processing ${config.name}...`);
      
      // Get all music tracks from database (marked as 'album' type)
      const allTracks = await prisma.track.findMany({
        where: {
          feed: {
            type: 'album'
          }
        },
        include: {
          feed: true
        }
      });
      
      console.log(`📊 Found ${allTracks.length} total music tracks in database`);
      
      // For now, assign tracks based on a simple approach
      // This would need to be refined based on your actual track categorization logic
      let playlistTracks = allTracks;
      
      // Basic filtering - you'd replace this with your actual logic
      if (config.name.includes('HGH')) {
        // For HGH, get tracks that were recently imported (last 24 hours) as a proxy
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        playlistTracks = allTracks.filter(track => 
          track.createdAt > yesterday ||
          config.sourceFilter.some(filter => 
            track.feed.title.toLowerCase().includes(filter.toLowerCase()) ||
            track.feed.description?.toLowerCase().includes(filter.toLowerCase())
          )
        );
      } else {
        // For other playlists, use feed-based filtering
        playlistTracks = allTracks.filter(track =>
          config.sourceFilter.some(filter => 
            track.feed.title.toLowerCase().includes(filter.toLowerCase()) ||
            track.feed.description?.toLowerCase().includes(filter.toLowerCase()) ||
            track.title.toLowerCase().includes(filter.toLowerCase())
          )
        );
      }
      
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
      let duplicateCount = 0;
      const addedTrackIds = new Set<string>();
      
      for (let i = 0; i < playlistTracks.length; i++) {
        const track = playlistTracks[i];
        
        try {
          // Check if we already added this track (avoid duplicates)
          if (!addedTrackIds.has(track.id)) {
            await prisma.playlistTrack.create({
              data: {
                id: `pt-${playlist.id}-${track.id}-${Date.now()}-${i}`,
                playlistId: playlist.id,
                trackId: track.id,
                position: addedCount + 1,
                addedBy: 'system'
              }
            });
            addedTrackIds.add(track.id);
            addedCount++;
            
            if (addedCount % 50 === 0) {
              console.log(`  ✅ Added ${addedCount} tracks to playlist so far...`);
            }
          } else {
            duplicateCount++;
          }
        } catch (error: any) {
          if (error.message?.includes('Unique constraint failed')) {
            duplicateCount++;
          } else {
            console.warn(`⚠️  Error processing track "${track.title}": ${error.message}`);
          }
        }
      }
      
      console.log(`✅ ${config.name} processed successfully!`);
      console.log(`📊 Summary:`);
      console.log(`   - ${playlistTracks.length} tracks from database`);
      console.log(`   - ${addedCount} tracks added to playlist`);
      console.log(`   - ${duplicateCount} duplicate tracks skipped`);
    }
    
    // Final summary
    const allPlaylists = await prisma.userPlaylist.findMany({
      include: {
        _count: {
          select: {
            tracks: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    console.log('\n✨ All playlists processed successfully!');
    console.log('📊 Final playlist summary (using Prisma database only):');
    for (const playlist of allPlaylists) {
      console.log(`   - ${playlist.name}: ${playlist._count.tracks} tracks`);
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
  createPlaylistsFromDatabase().catch(console.error);
}

export default createPlaylistsFromDatabase;