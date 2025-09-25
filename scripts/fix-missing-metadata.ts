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
  guid?: string;
  itemGuid?: string | { _: string };
}

async function fixMissingMetadata() {
  console.log('🔧 Fixing missing metadata from JSON source...');
  
  try {
    // Read music tracks JSON
    const tracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    const tracksContent = await fs.readFile(tracksPath, 'utf-8');
    const tracksData = JSON.parse(tracksContent);
    const musicTracks: MusicTrack[] = tracksData.musicTracks || [];
    
    console.log(`📋 Found ${musicTracks.length} tracks in JSON source`);
    
    // Create lookup maps for faster searching
    const titleLookup = new Map<string, MusicTrack[]>();
    const audioLookup = new Map<string, MusicTrack>();
    
    for (const track of musicTracks) {
      // Title-based lookup
      if (!titleLookup.has(track.title)) {
        titleLookup.set(track.title, []);
      }
      titleLookup.get(track.title)!.push(track);
      
      // Audio URL lookup
      const audioUrl = track.audioUrl || track.enclosureUrl;
      if (audioUrl) {
        audioLookup.set(audioUrl, track);
      }
    }
    
    console.log('🎵 Fixing tracks with missing duration...');
    
    // Fix missing duration data
    const tracksNoDuration = await prisma.track.findMany({
      where: {
        OR: [
          { duration: null },
          { duration: { lte: 0 } }
        ]
      },
      select: { id: true, title: true, audioUrl: true }
    });
    
    console.log(`📝 Found ${tracksNoDuration.length} tracks without duration`);
    
    let durationFixCount = 0;
    for (const dbTrack of tracksNoDuration) {
      // Try audio URL lookup first (more precise)
      let sourceTrack = audioLookup.get(dbTrack.audioUrl);
      
      // Fall back to title lookup
      if (!sourceTrack) {
        const titleMatches = titleLookup.get(dbTrack.title);
        if (titleMatches && titleMatches.length > 0) {
          sourceTrack = titleMatches.find(t => t.duration && t.duration > 0) || titleMatches[0];
        }
      }
      
      if (sourceTrack?.duration && sourceTrack.duration > 0) {
        await prisma.track.update({
          where: { id: dbTrack.id },
          data: { duration: Math.round(sourceTrack.duration) }
        });
        durationFixCount++;
      }
    }
    
    console.log(`✅ Fixed duration for ${durationFixCount} tracks`);
    
    console.log('🎤 Fixing tracks with missing artist data...');
    
    // Fix missing artist data
    const tracksNoArtist = await prisma.track.findMany({
      where: {
        OR: [
          { artist: null },
          { artist: '' },
          { artist: 'Unknown Artist' }
        ]
      },
      select: { id: true, title: true, audioUrl: true, artist: true }
    });
    
    console.log(`📝 Found ${tracksNoArtist.length} tracks without artist`);
    
    let artistFixCount = 0;
    for (const dbTrack of tracksNoArtist) {
      // Try audio URL lookup first
      let sourceTrack = audioLookup.get(dbTrack.audioUrl);
      
      // Fall back to title lookup
      if (!sourceTrack) {
        const titleMatches = titleLookup.get(dbTrack.title);
        if (titleMatches && titleMatches.length > 0) {
          sourceTrack = titleMatches.find(t => t.artist || t.feedArtist) || titleMatches[0];
        }
      }
      
      const artist = sourceTrack?.artist || sourceTrack?.feedArtist;
      if (artist && artist !== 'Unknown Artist') {
        await prisma.track.update({
          where: { id: dbTrack.id },
          data: { artist: artist }
        });
        artistFixCount++;
        
        if (artistFixCount % 100 === 0) {
          console.log(`  ✅ Fixed ${artistFixCount} artists so far...`);
        }
      }
    }
    
    console.log(`✅ Fixed artist for ${artistFixCount} tracks`);
    
    console.log('🔊 Fixing tracks with empty audio URLs...');
    
    // Fix empty audio URLs
    const tracksNoAudio = await prisma.track.findMany({
      where: { audioUrl: '' },
      select: { id: true, title: true, guid: true }
    });
    
    console.log(`📝 Found ${tracksNoAudio.length} tracks with empty audio URLs`);
    
    let audioFixCount = 0;
    for (const dbTrack of tracksNoAudio) {
      const titleMatches = titleLookup.get(dbTrack.title);
      if (titleMatches && titleMatches.length > 0) {
        for (const match of titleMatches) {
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
    
    console.log(`✅ Fixed audio URLs for ${audioFixCount} tracks`);
    
    // Final summary
    const finalStats = await prisma.$queryRaw`
      SELECT 
        (SELECT COUNT(*) FROM "Track") as total_tracks,
        (SELECT COUNT(*) FROM "Track" WHERE duration IS NULL OR duration <= 0) as no_duration,
        (SELECT COUNT(*) FROM "Track" WHERE artist IS NULL OR artist = '' OR artist = 'Unknown Artist') as no_artist,
        (SELECT COUNT(*) FROM "Track" WHERE "audioUrl" = '') as no_audio
    ` as any[];
    
    const stats = finalStats[0];
    
    console.log('\n✨ Metadata cleanup completed!');
    console.log(`📊 Final statistics:`);
    console.log(`   - ${stats.total_tracks} total tracks`);
    console.log(`   - ${stats.no_duration} tracks missing duration`);
    console.log(`   - ${stats.no_artist} tracks missing artist`);
    console.log(`   - ${stats.no_audio} tracks missing audio URL`);
    
    console.log('\n🔧 Repairs made:');
    console.log(`   - Fixed ${durationFixCount} durations`);
    console.log(`   - Fixed ${artistFixCount} artists`);
    console.log(`   - Fixed ${audioFixCount} audio URLs`);
    
  } catch (error) {
    console.error('❌ Metadata repair failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run repair if called directly
if (require.main === module) {
  fixMissingMetadata().catch(console.error);
}

export default fixMissingMetadata;