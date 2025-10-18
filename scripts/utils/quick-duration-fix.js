const fs = require('fs');

async function getAudioDuration(audioUrl) {
  try {
    const response = await fetch(audioUrl, { method: 'HEAD' });
    if (!response.ok) return null;
    
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    if (contentLength && contentType && contentType.includes('audio')) {
      const fileSizeKB = parseInt(contentLength) / 1024;
      let estimatedDuration = null;
      
      if (contentType.includes('mpeg') || contentType.includes('mp3')) {
        estimatedDuration = Math.round(fileSizeKB * 0.062);
      } else if (contentType.includes('m4a') || contentType.includes('mp4')) {
        estimatedDuration = Math.round(fileSizeKB * 0.055);
      } else if (contentType.includes('wav')) {
        estimatedDuration = Math.round(fileSizeKB * 0.006);
      } else if (contentType.includes('ogg') || contentType.includes('vorbis')) {
        estimatedDuration = Math.round(fileSizeKB * 0.065);
      }
      
      if (estimatedDuration && estimatedDuration >= 15 && estimatedDuration <= 1200) {
        return estimatedDuration;
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function quickDurationFix() {
  console.log('⏱️ Quick Duration Fix - Process 150 tracks efficiently');
  console.log('=' .repeat(50));
  
  const hghSongs = JSON.parse(fs.readFileSync('./data/hgh-resolved-songs.json', 'utf8'));
  
  let audioUrlMap = {};
  try {
    const audioModule = fs.readFileSync('./data/hgh-audio-urls.ts', 'utf8');
    const audioMatch = audioModule.match(/export const HGH_AUDIO_URL_MAP[^{]*{([^}]*)}/s);
    if (audioMatch) {
      const entries = audioMatch[1].match(/"([^"]+)":\s*"([^"]+)"/g);
      if (entries) {
        entries.forEach(entry => {
          const [, title, url] = entry.match(/"([^"]+)":\s*"([^"]+)"/);
          audioUrlMap[title] = url;
        });
      }
    }
  } catch (error) {
    console.log('❌ Could not load audio URL map');
    return;
  }
  
  // Find tracks with 180 second duration that have audio URLs
  const placeholderDurationTracks = hghSongs.filter(track => 
    track.duration === 180 && 
    audioUrlMap[track.title] &&
    !track.title.startsWith('Track ') &&
    track.title !== 'Unknown Feed'
  );
  
  console.log(`📊 Found ${placeholderDurationTracks.length} tracks with 3:00 placeholder`);
  
  let fixedCount = 0;
  const updatedSongs = [...hghSongs];
  
  // Process only first 150 tracks to stay within time limits
  const targetCount = Math.min(150, placeholderDurationTracks.length);
  console.log(`\n🔍 Processing first ${targetCount} tracks...`);
  
  for (let i = 0; i < targetCount; i++) {
    const track = placeholderDurationTracks[i];
    const audioUrl = audioUrlMap[track.title];
    
    if (i % 10 === 0) {
      console.log(`   Processing ${i + 1}-${Math.min(i + 10, targetCount)}...`);
    }
    
    const globalIndex = updatedSongs.findIndex(s => 
      s.title === track.title && 
      s.feedGuid === track.feedGuid &&
      s.itemGuid === track.itemGuid
    );
    
    if (globalIndex === -1) continue;
    
    const realDuration = await getAudioDuration(audioUrl);
    
    if (realDuration && realDuration !== 180) {
      updatedSongs[globalIndex].duration = realDuration;
      const minutes = Math.floor(realDuration / 60);
      const seconds = realDuration % 60;
      console.log(`   ✅ "${track.title}": ${minutes}:${seconds.toString().padStart(2, '0')}`);
      fixedCount++;
    }
    
    // Quick rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Save immediately
  console.log('\n💾 Saving updated durations...');
  fs.writeFileSync('./data/hgh-resolved-songs.json', JSON.stringify(updatedSongs, null, 2));
  
  console.log(`\n🎉 Quick Duration Fix Complete!`);
  console.log(`✅ Fixed ${fixedCount} out of ${targetCount} tracks processed`);
  
  const finalPlaceholder180 = updatedSongs.filter(t => t.duration === 180).length;
  const totalTracks = updatedSongs.length;
  const realDurations = totalTracks - finalPlaceholder180;
  
  console.log(`📊 Updated statistics:`);
  console.log(`   Total tracks: ${totalTracks}`);
  console.log(`   Real durations: ${realDurations} (${((realDurations / totalTracks) * 100).toFixed(1)}%)`);
  console.log(`   Remaining 3:00: ${finalPlaceholder180} (${((finalPlaceholder180 / totalTracks) * 100).toFixed(1)}%)`);
}

quickDurationFix().catch(console.error);