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
  guid?: string;
  itemGuid?: string | { _: string };
  feedTitle?: string;
  albumTitle?: string;
  duration?: number;
  image?: string;
  imageUrl?: string;
  artworkUrl?: string;
}

async function fixMissingData() {
  console.log('🔧 Starting database data repair...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    console.log(`📋 Found ${musicTracks.length} tracks in JSON file`);
    
    // Create lookup map by title for faster searching
    const trackLookup = new Map<string, MusicTrack[]>();
    for (const track of musicTracks) {
      if (!trackLookup.has(track.title)) {
        trackLookup.set(track.title, []);
      }
      trackLookup.get(track.title)!.push(track);
    }
    
    console.log('🔍 Finding tracks with missing artist data...');
    
    // Fix missing artist data
    const tracksWithoutArtist = await prisma.track.findMany({
      where: {
        OR: [
          { artist: null },
          { artist: '' },
          { artist: 'Unknown Artist' }
        ]
      },
      select: {
        id: true,
        title: true,
        artist: true,
        album: true
      }
    });
    
    console.log(`📝 Found ${tracksWithoutArtist.length} tracks missing artist data`);
    
    let artistFixCount = 0;
    for (const dbTrack of tracksWithoutArtist) {
      const possibleMatches = trackLookup.get(dbTrack.title);
      if (possibleMatches && possibleMatches.length > 0) {
        const match = possibleMatches[0];
        const artist = match.artist || match.feedArtist;
        const album = match.albumTitle || match.feedTitle;
        
        if (artist) {
          await prisma.track.update({
            where: { id: dbTrack.id },
            data: {
              artist: artist,
              ...(album && !dbTrack.album ? { album: album } : {})
            }
          });
          artistFixCount++;
          
          if (artistFixCount % 100 === 0) {
            console.log(`  ✅ Fixed ${artistFixCount} artists so far...`);
          }
        }
      }
    }
    
    console.log(`✅ Fixed ${artistFixCount} tracks with missing artist data`);
    
    console.log('🔍 Finding tracks with missing or empty audio URLs...');
    
    // Fix missing audio URLs
    const tracksWithoutAudio = await prisma.track.findMany({
      where: {
        audioUrl: ''
      },
      select: {
        id: true,
        title: true,
        audioUrl: true,
        guid: true
      }
    });
    
    console.log(`📝 Found ${tracksWithoutAudio.length} tracks missing audio URLs`);
    
    let audioFixCount = 0;
    for (const dbTrack of tracksWithoutAudio) {
      const possibleMatches = trackLookup.get(dbTrack.title);
      if (possibleMatches && possibleMatches.length > 0) {
        for (const match of possibleMatches) {
          const audioUrl = match.audioUrl || match.enclosureUrl;
          if (audioUrl) {
            await prisma.track.update({
              where: { id: dbTrack.id },
              data: { audioUrl: audioUrl }
            });
            audioFixCount++;
            break;
          }
        }
      }
    }
    
    console.log(`✅ Fixed ${audioFixCount} tracks with missing audio URLs`);
    
    // Fix GUID protocol errors by deleting invalid feeds
    console.log('🔍 Finding feeds with GUID protocol errors...');
    
    const guidFeeds = await prisma.feed.findMany({
      where: {
        originalUrl: {
          startsWith: 'guid:'
        }
      },
      select: {
        id: true,
        originalUrl: true,
        title: true,
        _count: {
          select: { Track: true }
        }
      }
    });
    
    console.log(`📝 Found ${guidFeeds.length} feeds with GUID URLs`);
    
    // Delete these invalid feeds and their tracks
    for (const feed of guidFeeds) {
      console.log(`🗑️  Deleting invalid feed: ${feed.title} (${feed._count.Track} tracks)`);
      await prisma.feed.delete({
        where: { id: feed.id }
      });
    }
    
    console.log(`✅ Removed ${guidFeeds.length} invalid GUID feeds`);
    
    // Summary
    const finalFeedCount = await prisma.feed.count();
    const finalTrackCount = await prisma.track.count();
    const errorFeedCount = await prisma.feed.count({ where: { status: 'error' } });
    const missingArtistCount = await prisma.track.count({
      where: {
        OR: [
          { artist: null },
          { artist: '' },
          { artist: 'Unknown Artist' }
        ]
      }
    });
    const missingAudioCount = await prisma.track.count({
      where: {
        audioUrl: ''
      }
    });
    
    console.log('\n✨ Database repair completed!');
    console.log(`📊 Final statistics:`);
    console.log(`   - ${finalFeedCount} total feeds`);
    console.log(`   - ${finalTrackCount} total tracks`);
    console.log(`   - ${errorFeedCount} feeds with errors`);
    console.log(`   - ${missingArtistCount} tracks missing artist`);
    console.log(`   - ${missingAudioCount} tracks missing audio URL`);
    
    console.log('\n🔧 Repairs made:');
    console.log(`   - Fixed ${artistFixCount} missing artists`);
    console.log(`   - Fixed ${audioFixCount} missing audio URLs`);
    console.log(`   - Removed ${guidFeeds.length} invalid feeds`);
    
  } catch (error) {
    console.error('❌ Database repair failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run repair if called directly
if (require.main === module) {
  fixMissingData().catch(console.error);
}

export default fixMissingData;