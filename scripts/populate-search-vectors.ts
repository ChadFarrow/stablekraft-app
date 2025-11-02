/**
 * Populate Search Vectors Script
 * 
 * This script populates the searchVector field for all tracks in the database.
 * The searchVector field is used for PostgreSQL full-text search.
 * 
 * Run with: npx tsx scripts/populate-search-vectors.ts
 */

import { PrismaClient } from '@prisma/client';
import { buildSearchVectorContent } from '../lib/search-utils';

const prisma = new PrismaClient();

async function populateSearchVectors() {
  console.log('🚀 Starting search vector population...');
  
  try {
    // Get all tracks
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        subtitle: true,
        description: true,
        itunesKeywords: true,
        itunesCategories: true
      }
    });

    console.log(`📊 Found ${tracks.length} tracks to process`);

    let updated = 0;
    let skipped = 0;

    // Process tracks in batches
    const batchSize = 100;
    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (track) => {
          try {
            const searchVector = buildSearchVectorContent(track);
            
            if (searchVector.trim()) {
              await prisma.track.update({
                where: { id: track.id },
                data: { searchVector }
              });
              updated++;
            } else {
              skipped++;
            }
          } catch (error) {
            console.error(`❌ Error updating track ${track.id}:`, error);
          }
        })
      );

      // Progress update
      const processed = Math.min(i + batchSize, tracks.length);
      console.log(`✅ Processed ${processed}/${tracks.length} tracks (${updated} updated, ${skipped} skipped)`);
    }

    console.log(`\n✨ Search vector population complete!`);
    console.log(`   - Updated: ${updated} tracks`);
    console.log(`   - Skipped: ${skipped} tracks (no searchable content)`);
    
  } catch (error) {
    console.error('❌ Error populating search vectors:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if executed directly
if (require.main === module) {
  populateSearchVectors()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

export { populateSearchVectors };
