const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  console.log('Checking complete data for newly added track...\n');

  // Get the Once Upon A Time track
  const track = await prisma.track.findFirst({
    where: {
      Feed: { id: '47a27ba4-5351-5896-9bb1-10e606937070' }
    },
    include: {
      Feed: true
    }
  });

  if (track) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  NEWLY ADDED TRACK: COMPLETE DATA VERIFICATION');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📋 BASIC METADATA:');
    console.log('  Track ID:', track.id);
    console.log('  GUID:', track.guid || '❌ MISSING');
    console.log('  Title:', track.title);
    console.log('  Artist:', track.artist || '❌ MISSING');
    console.log('  Album:', track.album || '(uses feed title)');
    console.log('  Description:', track.description ? '✓ Present (' + track.description.length + ' chars)' : '❌ MISSING');
    console.log();

    console.log('🎵 AUDIO DATA:');
    console.log('  Audio URL:', track.audioUrl ? '✓ ' + track.audioUrl.slice(0, 60) + '...' : '❌ MISSING');
    console.log('  Duration:', track.duration ? track.duration + ' seconds' : '❌ MISSING');
    console.log('  Start Time:', track.startTime !== null ? track.startTime : 'null (OK for full tracks)');
    console.log('  End Time:', track.endTime !== null ? track.endTime : 'null (OK for full tracks)');
    console.log();

    console.log('🎨 VISUAL DATA:');
    console.log('  Track Image:', track.image ? '✓ ' + track.image.slice(0, 60) + '...' : '❌ MISSING');
    console.log('  Feed Image:', track.Feed.image ? '✓ ' + track.Feed.image.slice(0, 60) + '...' : '❌ MISSING');
    console.log();

    console.log('📅 DATES & ORDERING:');
    console.log('  Published At:', track.publishedAt ? track.publishedAt.toISOString() : '❌ MISSING');
    console.log('  Created At:', track.createdAt.toISOString());
    console.log('  Updated At:', track.updatedAt.toISOString());
    console.log('  Track Order:', track.trackOrder !== null ? track.trackOrder : '❌ MISSING');
    console.log();

    console.log('⚡ LIGHTNING PAYMENT (V4V) DATA:');
    if (track.v4vValue) {
      const v4v = typeof track.v4vValue === 'string' ? JSON.parse(track.v4vValue) : track.v4vValue;
      const recipients = v4v.recipients || v4v.destinations || [];
      console.log('  ✅ V4V Data Present');
      console.log('  Type:', v4v.type || 'lightning');
      console.log('  Method:', v4v.method || 'keysend');
      console.log('  Recipients:', recipients.length);
      console.log();
      recipients.forEach((r, i) => {
        console.log(`  Recipient ${i+1}:`);
        console.log('    Name:', r.name || 'Unknown');
        console.log('    Address:', r.address ? r.address.slice(0, 40) + '...' : r.customKey);
        console.log('    Split:', r.split + '%');
        console.log('    Type:', r.type || 'node');
        if (r.fee !== undefined) console.log('    Fee:', r.fee);
      });
    } else {
      console.log('  ❌ No V4V data');
    }
    console.log();

    console.log('📂 FEED DATA:');
    console.log('  Feed Title:', track.Feed.title);
    console.log('  Feed Artist:', track.Feed.artist || '(not set)');
    console.log('  Feed URL:', track.Feed.originalUrl);
    console.log('  Feed Type:', track.Feed.type);
    console.log();

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ COMPLETENESS CHECK:\n');

    const checks = [
      { name: 'Track ID', value: track.id },
      { name: 'GUID', value: track.guid },
      { name: 'Title', value: track.title },
      { name: 'Audio URL', value: track.audioUrl },
      { name: 'Duration', value: track.duration },
      { name: 'Image', value: track.image },
      { name: 'Published Date', value: track.publishedAt },
      { name: 'Track Order', value: track.trackOrder !== null },
      { name: 'V4V Payment Data', value: track.v4vValue },
      { name: 'Feed Association', value: track.feedId }
    ];

    const passed = checks.filter(c => c.value).length;
    const total = checks.length;

    console.log(`  Score: ${passed}/${total} fields present (${((passed/total)*100).toFixed(0)}%)`);
    console.log();

    checks.forEach(c => {
      console.log(`  ${c.value ? '✅' : '❌'} ${c.name}`);
    });

    console.log();
    if (passed === total) {
      console.log('🎉 PERFECT! All critical fields are present and correct.\n');
    } else {
      console.log('⚠️  Some fields are missing (may be normal for some feeds).\n');
    }
    console.log('═══════════════════════════════════════════════════════════════\n');
  }

  await prisma.$disconnect();
})();
