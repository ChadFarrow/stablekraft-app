#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkTripodacusV4V() {
  try {
    // Find the Tripodacus feed
    const feed = await prisma.feed.findFirst({
      where: {
        OR: [
          { originalUrl: { contains: 'tripodacus' } },
          { title: { contains: 'Tripodacus', mode: 'insensitive' } }
        ]
      }
    });

    if (!feed) {
      console.log('❌ Tripodacus feed not found');
      return;
    }

    console.log(`\n📋 Found feed: ${feed.title} (${feed.id})`);
    console.log(`   URL: ${feed.originalUrl}\n`);

    // Get all tracks for this feed
    const tracks = await prisma.track.findMany({
      where: { feedId: feed.id },
      orderBy: { trackOrder: 'asc' }
    });

    console.log(`🎵 Found ${tracks.length} tracks\n`);

    for (const track of tracks) {
      console.log(`\n📀 ${track.title}`);
      console.log(`   ID: ${track.id}`);
      console.log(`   v4vRecipient: ${track.v4vRecipient || 'null'}`);
      
      if (track.v4vValue) {
        const v4v = typeof track.v4vValue === 'string' 
          ? JSON.parse(track.v4vValue) 
          : track.v4vValue;
        
        console.log(`   v4vValue type: ${v4v.type || 'N/A'}`);
        console.log(`   v4vValue method: ${v4v.method || 'N/A'}`);
        
        if (v4v.recipients && Array.isArray(v4v.recipients)) {
          console.log(`   Recipients (${v4v.recipients.length}):`);
          v4v.recipients.forEach((r: any, i: number) => {
            console.log(`     ${i + 1}. ${r.name || 'Unknown'}`);
            console.log(`        Address: ${r.address?.substring(0, 40)}...`);
            console.log(`        Split: ${r.split}%`);
            console.log(`        Type: ${r.type || 'node'}`);
            if (r.customKey) console.log(`        customKey: ${r.customKey}`);
            if (r.customValue) console.log(`        customValue: ${r.customValue}`);
          });
        } else {
          console.log(`   ⚠️  No recipients array found`);
          console.log(`   v4vValue: ${JSON.stringify(v4v, null, 2)}`);
        }
      } else {
        console.log(`   ⚠️  No v4vValue found`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTripodacusV4V();

