#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(process.cwd(), '.env.local') });

const prisma = new PrismaClient();

async function checkDeltaOGV4V() {
  const track = await prisma.track.findFirst({
    where: {
      title: {
        contains: 'The Way She Rolls',
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

  console.log('Track V4V Data for "The Way She Rolls":');
  console.log(JSON.stringify(track, null, 2));

  await prisma.$disconnect();
}

checkDeltaOGV4V().catch(console.error).finally(() => prisma.$disconnect());
