const fs = require('fs');

async function fixDaneRayColeman() {
  console.log('🎸 Fixing Dane Ray Coleman tracks specifically');
  console.log('=' .repeat(50));
  
  const hghSongs = JSON.parse(fs.readFileSync('./data/hgh-resolved-songs.json', 'utf8'));
  
  // Find tracks with Dane Ray Coleman's correct GUID but still unresolved
  const daneTracks = hghSongs.filter(track => 
    track.feedGuid === '3d92b2f6-4aac-5f24-bffe-2536eb579286' &&
    (track.title === 'Unknown Feed' || track.title.startsWith('Track '))
  );
  
  console.log(`📊 Found ${daneTracks.length} unresolved Dane Ray Coleman tracks:`);
  daneTracks.forEach(track => {
    console.log(`   ${track.title} - Item GUID: ${track.itemGuid}`);
  });
  
  if (daneTracks.length === 0) {
    console.log('✅ No Dane Ray Coleman tracks need fixing');
    return;
  }
  
  let fixedCount = 0;
  const updatedSongs = [...hghSongs];
  
  // Load existing URL maps
  let audioUrlMap = {};
  let artworkUrlMap = {};
  
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
    
    const artworkModule = fs.readFileSync('./data/hgh-artwork-urls.ts', 'utf8');
    const artworkMatch = artworkModule.match(/export const HGH_ARTWORK_URL_MAP[^{]*{([^}]*)}/s);
    if (artworkMatch) {
      const entries = artworkMatch[1].match(/"([^"]+)":\s*"([^"]+)"/g);
      if (entries) {
        entries.forEach(entry => {
          const [, title, url] = entry.match(/"([^"]+)":\s*"([^"]+)"/);
          artworkUrlMap[title] = url;
        });
      }
    }
  } catch (error) {
    console.log('Starting with empty URL maps');
  }
  
  // Fetch the Dane Ray Coleman feed
  console.log('\n📡 Fetching Dane Ray Coleman "Lionhead" feed...');
  
  try {
    const feedUrl = 'https://music.behindthesch3m3s.com/wp-content/uploads/Dane%20Ray%20Coleman/Lionhead/lionhead.xml';
    const response = await fetch(feedUrl);
    
    if (!response.ok) {
      console.log(`❌ HTTP ${response.status}: ${response.statusText}`);
      return;
    }
    
    const xml = await response.text();
    console.log(`✅ Feed fetched successfully`);
    
    // Parse items
    const itemRegex = /<item[^>]*>(.*?)<\/item>/gs;
    const items = xml.match(itemRegex) || [];
    console.log(`📊 Found ${items.length} items in feed`);
    
    // Process each Dane track
    for (const track of daneTracks) {
      console.log(`\n🎯 Processing: ${track.title}`);
      console.log(`   Item GUID: ${track.itemGuid}`);
      
      const globalIndex = updatedSongs.findIndex(s => 
        s.feedGuid === track.feedGuid && 
        s.itemGuid === track.itemGuid &&
        s.title === track.title
      );
      
      if (globalIndex === -1) continue;
      
      // Find matching item in feed
      let found = false;
      for (const item of items) {
        const guidMatch = item.match(/<guid[^>]*>([^<]*)<\/guid>/);
        const guid = guidMatch ? guidMatch[1].trim() : null;
        
        if (guid === track.itemGuid) {
          found = true;
          
          const titleMatch = item.match(/<title>([^<]*)<\/title>/);
          const enclosureMatch = item.match(/<enclosure[^>]*url="([^"]*)"[^>]*>/);
          const imageMatch = item.match(/<itunes:image[^>]*href="([^"]*)"[^>]*>/) || 
                             item.match(/<image[^>]*url="([^"]*)"[^>]*>/);
          
          if (titleMatch) {
            const resolvedTitle = titleMatch[1].trim();
            const audioUrl = enclosureMatch ? enclosureMatch[1] : null;
            const artworkUrl = imageMatch ? imageMatch[1] : null;
            
            // Update the track
            updatedSongs[globalIndex].title = resolvedTitle;
            updatedSongs[globalIndex].artist = 'Dane Ray Coleman';
            updatedSongs[globalIndex].feedTitle = 'Lionhead';
            
            if (audioUrl) audioUrlMap[resolvedTitle] = audioUrl;
            if (artworkUrl) artworkUrlMap[resolvedTitle] = artworkUrl;
            
            console.log(`   ✅ FIXED: "${track.title}" → "${resolvedTitle}"`);
            console.log(`   🎧 Audio: ${audioUrl ? '✅' : '❌'}`);
            console.log(`   🖼️ Artwork: ${artworkUrl ? '✅' : '❌'}`);
            
            fixedCount++;
          }
          break;
        }
      }
      
      if (!found) {
        console.log(`   ❌ Item GUID not found in feed`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Error fetching feed: ${error.message}`);
  }
  
  // Save the updated data
  if (fixedCount > 0) {
    console.log('\n💾 Saving updated data...');
    fs.writeFileSync('./data/hgh-resolved-songs.json', JSON.stringify(updatedSongs, null, 2));
    
    // Update audio URLs
    const audioContent = `import { HGHAudioUrlMap } from '@/types/hgh-types';

// Audio URLs for HGH tracks - Including Dane Ray Coleman fixes
export const HGH_AUDIO_URL_MAP: HGHAudioUrlMap = {
${Object.entries(audioUrlMap).map(([title, url]) => 
  `  "${title}": "${url}"`
).join(',\n')}
};
`;
    
    fs.writeFileSync('./data/hgh-audio-urls.ts', audioContent);
    
    // Update artwork URLs
    const artworkContent = `import { HGHArtworkUrlMap } from '@/types/hgh-types';

// Artwork URLs for HGH tracks - Including Dane Ray Coleman fixes
export const HGH_ARTWORK_URL_MAP: HGHArtworkUrlMap = {
${Object.entries(artworkUrlMap).map(([title, url]) => 
  `  "${title}": "${url}"`
).join(',\n')}
};
`;
    
    fs.writeFileSync('./data/hgh-artwork-urls.ts', artworkContent);
    
    console.log(`\n🎉 Dane Ray Coleman Fix Complete!`);
    console.log(`✅ Fixed ${fixedCount} Dane Ray Coleman tracks`);
    
    // Show updated stats
    const finalPlaceholders = updatedSongs.filter(t => t.title.startsWith('Track ')).length;
    const finalUnknown = updatedSongs.filter(t => t.title === 'Unknown Feed').length;
    const finalResolved = updatedSongs.length - finalPlaceholders - finalUnknown;
    
    console.log(`📊 New statistics:`);
    console.log(`   Total tracks: ${updatedSongs.length}`);
    console.log(`   Resolved tracks: ${finalResolved}`);
    console.log(`   Remaining placeholders: ${finalPlaceholders}`);
    console.log(`   Unknown/corrupted: ${finalUnknown}`);
    console.log(`   Success rate: ${((finalResolved / updatedSongs.length) * 100).toFixed(1)}%`);
  } else {
    console.log('\n❌ No tracks were fixed');
  }
}

fixDaneRayColeman().catch(console.error);