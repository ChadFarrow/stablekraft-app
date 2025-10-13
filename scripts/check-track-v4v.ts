#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

async function checkTrackV4V() {
  const track = await prisma.track.findFirst({
    where: {
      title: {
        contains: 'Morristown Blues',
        mode: 'insensitive'
      }
    },
    select: {
      id: true,
      title: true,
      artist: true,
      v4vRecipient: true,
      v4vValue: true,
      Feed: {
        select: {
          title: true,
          artist: true
        }
      }
    }
  });

  console.log('Track V4V Data:');
  console.log(JSON.stringify(track, null, 2));

  await prisma.$disconnect();
}

checkTrackV4V().catch(console.error).finally(() => prisma.$disconnect());
