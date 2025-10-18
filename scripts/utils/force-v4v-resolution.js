// Force V4V re-resolution with updated resolver
const { V4VResolver } = require('./lib/v4v-resolver.ts');

async function forceResolveV4V() {
  console.log('🔄 Starting forced V4V re-resolution...');
  
  // Clear the cache first
  V4VResolver.clearCache();
  console.log('🗑️ V4V cache cleared');
  
  // Test the updated resolver with Episode 56 tracks
  const testTracks = [
    { feedGuid: '3ae285ab-434c-59d8-aa2f-59c6129afb92', itemGuid: 'd8145cb6-97d9-4358-895b-2bf055d169aa', title: 'Neon Hawk' },
    { feedGuid: '6fc2ad98-d4a8-5d70-9c68-62e9efc1209c', itemGuid: 'aad6e3b1-6589-4e22-b8ca-521f3d888263', title: 'Grey\'s Birthday' },
    { feedGuid: 'dea01a9d-a024-5b13-84aa-b157304cd3bc', itemGuid: '52007112-2772-42f9-957a-a93eaeedb222', title: 'Smokestacks' },
    { feedGuid: '95e5f7a9-d88e-5e51-b2ae-f4b1865d19c4', itemGuid: 'd79f242f-0651-4b12-be79-c2bac234cfde', title: 'Hit the Target' }
  ];
  
  for (const track of testTracks) {
    try {
      console.log(`\n🔍 Resolving: ${track.title}`);
      const result = await V4VResolver.resolve(track.feedGuid, track.itemGuid);
      
      if (result.success) {
        console.log(`✅ ${track.title}:`);
        console.log(`   Title: ${result.title}`);
        console.log(`   Artist: ${result.artist}`);
        console.log(`   Audio URL: ${result.audioUrl?.substring(0, 60)}...`);
      } else {
        console.log(`❌ ${track.title}: ${result.error}`);
      }
    } catch (error) {
      console.error(`❌ ${track.title}: ${error.message}`);
    }
  }
  
  console.log('\n🔄 Forced resolution complete! Now trigger a database update...');
}

forceResolveV4V().catch(console.error);