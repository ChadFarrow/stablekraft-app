import { prisma } from '../lib/prisma';

/**
 * Remove Podcastindex.org fee recipients from all v4vValue data in database
 *
 * This script:
 * 1. Finds all Feed records with v4vValue containing fee recipients
 * 2. Finds all Track records with v4vValue containing fee recipients
 * 3. Filters out fee=true recipients from destinations/recipients arrays
 * 4. Updates the database
 */

interface V4VValue {
  type?: string;
  method?: string;
  recipients?: Array<{
    name?: string;
    address?: string;
    type?: string;
    split?: number | string;
    fee?: boolean | string;
    customKey?: string;
    customValue?: string;
  }>;
  destinations?: Array<{
    name?: string;
    address?: string;
    type?: string;
    split?: number | string;
    fee?: boolean | string;
    customKey?: string;
    customValue?: string;
  }>;
}

function filterFeeRecipients(v4vValue: any): V4VValue | null {
  if (!v4vValue || typeof v4vValue !== 'object') {
    return null;
  }

  const filtered: V4VValue = {
    type: v4vValue.type,
    method: v4vValue.method,
  };

  // Filter recipients if they exist
  if (Array.isArray(v4vValue.recipients)) {
    const nonFeeRecipients = v4vValue.recipients.filter(
      (r: any) => r.fee !== 'true' && r.fee !== true
    );
    if (nonFeeRecipients.length > 0) {
      filtered.recipients = nonFeeRecipients;
    }
  }

  // Filter destinations if they exist
  if (Array.isArray(v4vValue.destinations)) {
    const nonFeeDestinations = v4vValue.destinations.filter(
      (d: any) => d.fee !== 'true' && d.fee !== true
    );
    if (nonFeeDestinations.length > 0) {
      filtered.destinations = nonFeeDestinations;
    }
  }

  // If we have at least one non-fee recipient/destination, return the filtered value
  if (filtered.recipients || filtered.destinations) {
    return filtered;
  }

  return null;
}

async function removeFeeRecipientsFromFeeds() {
  console.log('🔍 Finding Feeds with fee recipients...');

  const feeds = await prisma.feed.findMany({
    where: {
      v4vValue: {
        not: null,
      },
    },
    select: {
      id: true,
      title: true,
      v4vValue: true,
    },
  });

  console.log(`📊 Found ${feeds.length} feeds with v4vValue`);

  let updatedCount = 0;
  let removedFeeCount = 0;

  for (const feed of feeds) {
    const v4vValue = feed.v4vValue as any;

    // Check if this feed has any fee recipients
    const hasFeeRecipients =
      (Array.isArray(v4vValue.recipients) &&
        v4vValue.recipients.some((r: any) => r.fee === 'true' || r.fee === true)) ||
      (Array.isArray(v4vValue.destinations) &&
        v4vValue.destinations.some((d: any) => d.fee === 'true' || d.fee === true));

    if (hasFeeRecipients) {
      const originalRecipientCount =
        (v4vValue.recipients?.length || 0) + (v4vValue.destinations?.length || 0);

      const filtered = filterFeeRecipients(v4vValue);

      if (filtered) {
        const newRecipientCount =
          (filtered.recipients?.length || 0) + (filtered.destinations?.length || 0);
        const removedCount = originalRecipientCount - newRecipientCount;

        await prisma.feed.update({
          where: { id: feed.id },
          data: { v4vValue: filtered as any },
        });

        console.log(
          `✅ Feed: ${feed.title} - Removed ${removedCount} fee recipient(s)`
        );
        updatedCount++;
        removedFeeCount += removedCount;
      }
    }
  }

  console.log(`\n📋 Feed Summary:`);
  console.log(`   - Updated: ${updatedCount} feeds`);
  console.log(`   - Removed: ${removedFeeCount} fee recipients\n`);

  return { updatedCount, removedFeeCount };
}

async function removeFeeRecipientsFromTracks() {
  console.log('🔍 Finding Tracks with fee recipients...');

  const tracks = await prisma.track.findMany({
    where: {
      v4vValue: {
        not: null,
      },
    },
    select: {
      id: true,
      title: true,
      artist: true,
      v4vValue: true,
    },
  });

  console.log(`📊 Found ${tracks.length} tracks with v4vValue`);

  let updatedCount = 0;
  let removedFeeCount = 0;

  for (const track of tracks) {
    const v4vValue = track.v4vValue as any;

    // Check if this track has any fee recipients
    const hasFeeRecipients =
      (Array.isArray(v4vValue.recipients) &&
        v4vValue.recipients.some((r: any) => r.fee === 'true' || r.fee === true)) ||
      (Array.isArray(v4vValue.destinations) &&
        v4vValue.destinations.some((d: any) => d.fee === 'true' || d.fee === true));

    if (hasFeeRecipients) {
      const originalRecipientCount =
        (v4vValue.recipients?.length || 0) + (v4vValue.destinations?.length || 0);

      const filtered = filterFeeRecipients(v4vValue);

      if (filtered) {
        const newRecipientCount =
          (filtered.recipients?.length || 0) + (filtered.destinations?.length || 0);
        const removedCount = originalRecipientCount - newRecipientCount;

        await prisma.track.update({
          where: { id: track.id },
          data: { v4vValue: filtered as any },
        });

        console.log(
          `✅ Track: ${track.title} by ${track.artist} - Removed ${removedCount} fee recipient(s)`
        );
        updatedCount++;
        removedFeeCount += removedCount;
      }
    }
  }

  console.log(`\n📋 Track Summary:`);
  console.log(`   - Updated: ${updatedCount} tracks`);
  console.log(`   - Removed: ${removedFeeCount} fee recipients\n`);

  return { updatedCount, removedFeeCount };
}

async function main() {
  console.log('🚀 Starting fee recipient removal...\n');

  try {
    const feedResults = await removeFeeRecipientsFromFeeds();
    const trackResults = await removeFeeRecipientsFromTracks();

    console.log('✅ Complete! Final Summary:');
    console.log(`   - Total Feeds Updated: ${feedResults.updatedCount}`);
    console.log(`   - Total Tracks Updated: ${trackResults.updatedCount}`);
    console.log(
      `   - Total Fee Recipients Removed: ${feedResults.removedFeeCount + trackResults.removedFeeCount}`
    );
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
