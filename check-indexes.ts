import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkIndexes() {
  try {
    // Query to get all indexes for our tables
    const indexes = await prisma.$queryRaw<any[]>`
      SELECT
        t.tablename,
        i.indexname,
        i.indexdef
      FROM pg_indexes i
      JOIN pg_tables t ON i.tablename = t.tablename
      WHERE t.schemaname = 'public'
        AND t.tablename IN ('Track', 'Feed', 'FavoriteTrack', 'FavoriteAlbum', 'User', 'BoostEvent', 'NostrPost')
      ORDER BY t.tablename, i.indexname;
    `;

    console.log('\n=== DATABASE INDEXES ===\n');

    let currentTable = '';
    for (const idx of indexes) {
      if (idx.tablename !== currentTable) {
        currentTable = idx.tablename;
        console.log(`\n📋 ${currentTable}:`);
      }
      console.log(`  - ${idx.indexname}`);
      if (process.env.VERBOSE) {
        console.log(`    ${idx.indexdef}`);
      }
    }

    // Check for missing indexes on commonly queried fields
    console.log('\n\n=== MISSING INDEX ANALYSIS ===\n');

    // Check if audioUrl has an index (it's queried in favorites API)
    const audioUrlIndex = indexes.find(i =>
      i.tablename === 'Track' && i.indexname.includes('audioUrl')
    );
    if (!audioUrlIndex) {
      console.log('⚠️  Track.audioUrl: NO INDEX (queried in favorites API by audioUrl)');
    } else {
      console.log('✅ Track.audioUrl: indexed');
    }

    // Check if v4vValue has an index
    const v4vValueIndex = indexes.find(i =>
      i.tablename === 'Track' && i.indexname.includes('v4vValue')
    );
    if (!v4vValueIndex) {
      console.log('⚠️  Track.v4vValue: NO INDEX (filtered by IS NOT NULL in tracks API)');
    } else {
      console.log('✅ Track.v4vValue: indexed');
    }

    // Check for GIN index on searchVector
    const searchVectorIndex = indexes.find(i =>
      i.tablename === 'Track' && (i.indexname.includes('searchVector') || i.indexdef?.includes('gin'))
    );
    if (!searchVectorIndex) {
      console.log('⚠️  Track.searchVector: NO GIN INDEX (full-text search)');
    } else {
      console.log('✅ Track.searchVector: has GIN index for full-text search');
    }

    // Check Track table specifically
    console.log('\n=== TRACK TABLE COVERAGE ===');
    const trackIndexes = indexes.filter(i => i.tablename === 'Track');
    console.log(`Total indexes on Track table: ${trackIndexes.length}`);

    const indexedFields = new Set<string>();
    trackIndexes.forEach(idx => {
      // Extract field names from index definition
      const match = idx.indexdef?.match(/\(([^)]+)\)/);
      if (match) {
        const fields = match[1].split(',').map((f: string) => f.trim().replace(/"/g, ''));
        fields.forEach((f: string) => indexedFields.add(f));
      }
    });

    console.log('Indexed fields:', Array.from(indexedFields).sort().join(', '));

  } catch (error) {
    console.error('Error checking indexes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkIndexes();
