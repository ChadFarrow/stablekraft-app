/**
 * Fix Strange Textures Endless album artwork URL
 *
 * This script updates the broken image URL for the Strange Textures "Endless" album
 * to use a placeholder image instead of the 404ing URL.
 */

import fs from 'fs';
import path from 'path';

const FEEDS_FILE = path.join(process.cwd(), 'data', 'archived-json-database', 'feeds.json');
const PLACEHOLDER_IMAGE = '/placeholder-podcast.jpg'; // Use local placeholder

async function fixStrangeTexturesImage() {
  console.log('Reading feeds.json...');

  // Read the feeds file
  const feedsData = JSON.parse(fs.readFileSync(FEEDS_FILE, 'utf-8'));

  // Find the Strange Textures Endless feed
  const feed = feedsData.feeds?.find((f: any) =>
    f.originalUrl === 'https://f.strangetextures.com/@endless/feed.xml'
  );

  if (!feed) {
    console.log('Strange Textures Endless feed not found');
    return;
  }

  console.log('Found feed:', feed.title);
  console.log('Current image:', feed.image);

  // Update the image URL to use placeholder
  feed.image = PLACEHOLDER_IMAGE;
  feed.lastUpdated = new Date().toISOString();

  // Write back to file
  fs.writeFileSync(FEEDS_FILE, JSON.stringify(feedsData, null, 2));

  console.log('✓ Updated image to:', PLACEHOLDER_IMAGE);
}

fixStrangeTexturesImage().catch(console.error);
