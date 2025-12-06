/**
 * Generate a clean URL-friendly slug from a title
 * Preserves more information to avoid collisions
 */
export function generateAlbumSlug(title: string): string {
  // Special case handling for known problematic titles
  const specialCases: { [key: string]: string } = {
    'music from the doerfel-verse': 'music-from-the-doerfel-verse',
    'bloodshot lies - the album': 'bloodshot-lies',
    'dead time(live 2016)': 'dead-timelive-2016',
    'let go (what\'s holding you back)': 'let-go-whats-holding-you-back',
    'they don\'t know': 'they-dont-know',
    'underwater - single': 'underwater-single',
    'unsound existence (self-hosted version)': 'unsound-existence-self-hosted-version',
    'you feel like home(single)': 'you-feel-like-homesingle',
    'the kid, the dad, the mom & the tiny window': 'the-kid-the-dad-the-mom-and-the-tiny-window',
    'don\'t worry, you still have time to ruin it - demo': 'dont-worry-you-still-have-time-to-ruin-it-demo',
    'fake love - demo': 'fake-love-demo',
    'roommates - demo': 'roommates-demo',
    'orange pill, pink pill, white pill - demo': 'orange-pill-pink-pill-white-pill-demo',
    'strangers to lovers - live from sloe flower studio': 'strangers-to-lovers-live-from-sloe-flower-studio',
    'can\'t promise you the world - live from sloe flower studio': 'cant-promise-you-the-world-live-from-sloe-flower-studio',
    'heycitizen\'s lo-fi hip-hop beats to study and relax to': 'heycitizens-lo-fi-hip-hop-beats-to-study-and-relax-to',
    'fountain artist takeover - nate johnivan': 'fountain-artist-takeover-nate-johnivan',
    'rock\'n\'roll breakheart': 'rocknroll-breakheart',
    'thankful (feat. witt lowry)': 'thankful-feat-witt-lowry',
    'aged friends & old whiskey': 'aged-friends-and-old-whiskey'
  };
  
  const lowerTitle = title.toLowerCase().trim();
  if (specialCases[lowerTitle]) {
    return specialCases[lowerTitle];
  }
  
  // First, normalize the title
  let slug = title
    .toLowerCase()
    .trim()
    // Replace common special characters with their word equivalents
    .replace(/&/g, 'and')
    .replace(/\+/g, 'plus')
    .replace(/@/g, 'at')
    // Keep alphanumeric, spaces, and hyphens
    .replace(/[^a-z0-9\s-]/g, '')
    // Replace multiple spaces with single space
    .replace(/\s+/g, ' ')
    // Replace spaces with hyphens
    .replace(/\s/g, '-')
    // Replace multiple hyphens with single hyphen
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-|-$/g, '');
  
  // If the slug is empty after processing, use a fallback
  if (!slug) {
    slug = 'album-' + Date.now();
  }
  
  return slug;
}

/**
 * Generate album URL path
 */
export function generateAlbumUrl(title: string): string {
  return `/album/${generateAlbumSlug(title)}`;
}

/**
 * Generate a clean publisher slug from publisher info
 * Uses title/artist name if available, otherwise falls back to a shortened ID
 */
export function generatePublisherSlug(publisherInfo: { title?: string; artist?: string; feedGuid?: string }): string {
  // Try to use title or artist name first
  const name = publisherInfo.title || publisherInfo.artist;
  if (name) {
    return generateAlbumSlug(name);
  }
  
  // Fall back to a shortened version of the feedGuid
  if (publisherInfo.feedGuid) {
    return publisherInfo.feedGuid.split('-')[0]; // Use first part of UUID
  }
  
  // Last resort: use the full feedGuid
  return publisherInfo.feedGuid || 'unknown';
}

/**
 * Generate publisher URL path
 */
export function generatePublisherUrl(publisherInfo: { title?: string; artist?: string; feedGuid?: string }): string {
  return `/publisher/${generatePublisherSlug(publisherInfo)}`;
}

/**
 * Create a mapping of clean slugs to feedGuids for publisher routing
 * This allows us to use clean URLs while still being able to look up the original feedGuid
 */
export function createPublisherSlugMap(publishers: Array<{ title?: string; artist?: string; feedGuid?: string }>): Map<string, string> {
  const slugMap = new Map<string, string>();
  
  publishers.forEach(publisher => {
    if (publisher.feedGuid) {
      const slug = generatePublisherSlug(publisher);
      slugMap.set(slug, publisher.feedGuid);
    }
  });
  
  return slugMap;
}

/**
 * Extract a clean slug from a URL path
 */
export function extractSlugFromPath(path: string): string {
  return path.split('/').pop() || '';
}

/**
 * Generate a more readable URL for any entity
 */
export function generateCleanUrl(type: 'album' | 'publisher', identifier: string | { title?: string; artist?: string; feedGuid?: string }): string {
  if (type === 'album') {
    return generateAlbumUrl(identifier as string);
  } else {
    return generatePublisherUrl(identifier as { title?: string; artist?: string; feedGuid?: string });
  }
}

/**
 * Known publisher mappings for routing
 * Maps clean slugs to their corresponding feed URLs
 */
export const KNOWN_PUBLISHERS: { [slug: string]: { feedGuid: string; feedUrl: string; name?: string } } = {
  // The Doerfels - Family band from Buffalo, NY
  'the-doerfels': {
    feedGuid: 'doerfels-publisher-special',
    feedUrl: 'https://stablekraft.app/api/feeds/doerfels-pubfeed',
    name: 'The Doerfels'
  },
  'doerfels': {
    feedGuid: 'doerfels-publisher-special',
    feedUrl: 'https://stablekraft.app/api/feeds/doerfels-pubfeed',
    name: 'The Doerfels'
  },
  
  // IROH - Heavy Hazy Rock
  'iroh': {
    feedGuid: '8a9c2e54-785a-4128-9412-737610f5d00a',
    feedUrl: 'https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a',
    name: 'IROH'
  },
  
  // Joe Martin - Independent singer songwriter
  'joe-martin': {
    feedGuid: '18bcbf10-6701-4ffb-b255-bc057390d738',
    feedUrl: 'https://wavlake.com/feed/artist/18bcbf10-6701-4ffb-b255-bc057390d738',
    name: 'Joe Martin'
  },
  
  // My Friend Jimi
  'my-friend-jimi': {
    feedGuid: '0ea699be-e985-4aa1-8c00-43542e4b9e0d',
    feedUrl: 'https://wavlake.com/feed/artist/0ea699be-e985-4aa1-8c00-43542e4b9e0d',
    name: 'My Friend Jimi'
  },
  
  // Ollie
  'ollie': {
    feedGuid: 'd2f43e9f-adfc-4811-b9c1-58d5ea383275',
    feedUrl: 'https://wavlake.com/feed/artist/d2f43e9f-adfc-4811-b9c1-58d5ea383275',
    name: 'Ollie'
  },
  
  // Red Arrow Highway
  'red-arrow-highway': {
    feedGuid: '09465303-930a-4ee6-a18d-063cdc7fe3c9',
    feedUrl: 'https://wavlake.com/feed/artist/09465303-930a-4ee6-a18d-063cdc7fe3c9',
    name: 'Red Arrow Highway'
  },
  
  // Drawing Monsters
  'drawing-monsters': {
    feedGuid: 'cbcb895d-9a01-465f-af7b-9a09ffbc29f5',
    feedUrl: 'https://wavlake.com/feed/artist/cbcb895d-9a01-465f-af7b-9a09ffbc29f5',
    name: 'Drawing Monsters'
  },
  
  // Death by Lions
  'death-by-lions': {
    feedGuid: 'wavlake-publisher-1e7f8807',
    feedUrl: 'https://wavlake.com/feed/artist/1e7f8807-31a7-454c-b612-f2563ba4cf67',
    name: 'Death by Lions'
  },
  'wavlake-publisher-1e7f8807': {
    feedGuid: 'wavlake-publisher-1e7f8807',
    feedUrl: 'https://wavlake.com/feed/artist/1e7f8807-31a7-454c-b612-f2563ba4cf67',
    name: 'Death by Lions'
  },
  
  // Wavlake Publisher (generic)
  'wavlake-publisher': {
    feedGuid: 'aa909244-7555-4b52-ad88-7233860c6fb4',
    feedUrl: 'https://wavlake.com/feed/artist/aa909244-7555-4b52-ad88-7233860c6fb4',
    name: 'Wavlake Publisher'
  },
  'nate-johnivan': {
    feedGuid: 'aa909244-7555-4b52-ad88-7233860c6fb4',
    feedUrl: 'https://wavlake.com/feed/artist/aa909244-7555-4b52-ad88-7233860c6fb4',
    name: 'Nate Johnivan'
  },
  
  // Fallback for UUID-based URLs (backward compatibility)
  '18bcbf10': {
    feedGuid: '18bcbf10-6701-4ffb-b255-bc057390d738',
    feedUrl: 'https://wavlake.com/feed/artist/18bcbf10-6701-4ffb-b255-bc057390d738',
    name: 'Joe Martin'
  },
  '0ea699be': {
    feedGuid: '0ea699be-e985-4aa1-8c00-43542e4b9e0d',
    feedUrl: 'https://wavlake.com/feed/artist/0ea699be-e985-4aa1-8c00-43542e4b9e0d',
    name: 'My Friend Jimi'
  },
  'aa909244': {
    feedGuid: 'aa909244-7555-4b52-ad88-7233860c6fb4',
    feedUrl: 'https://wavlake.com/feed/artist/aa909244-7555-4b52-ad88-7233860c6fb4',
    name: 'Nate Johnivan'
  },
  '8a9c2e54': {
    feedGuid: '8a9c2e54-785a-4128-9412-737610f5d00a',
    feedUrl: 'https://wavlake.com/feed/artist/8a9c2e54-785a-4128-9412-737610f5d00a',
    name: 'IROH'
  },
  'd2f43e9f': {
    feedGuid: 'd2f43e9f-adfc-4811-b9c1-58d5ea383275',
    feedUrl: 'https://wavlake.com/feed/artist/d2f43e9f-adfc-4811-b9c1-58d5ea383275',
    name: 'Ollie'
  },
  '09465303': {
    feedGuid: '09465303-930a-4ee6-a18d-063cdc7fe3c9',
    feedUrl: 'https://wavlake.com/feed/artist/09465303-930a-4ee6-a18d-063cdc7fe3c9',
    name: 'Red Arrow Highway'
  },
  'cbcb895d': {
    feedGuid: 'cbcb895d-9a01-465f-af7b-9a09ffbc29f5',
    feedUrl: 'https://wavlake.com/feed/artist/cbcb895d-9a01-465f-af7b-9a09ffbc29f5',
    name: 'Drawing Monsters'
  },
  '1e7f8807': {
    feedGuid: 'wavlake-publisher-1e7f8807',
    feedUrl: 'https://wavlake.com/feed/artist/1e7f8807-31a7-454c-b612-f2563ba4cf67',
    name: 'Death by Lions'
  },
  
  // Additional Wavlake Publishers
  'bennyjeans': {
    feedGuid: 'wavlake-publisher-4e33ca0c',
    feedUrl: 'https://wavlake.com/feed/artist/4e33ca0c-bd98-4f98-9284-e8073046c049',
    name: 'bennyjeans'
  },
  'wavlake-publisher-4e33ca0c': {
    feedGuid: 'wavlake-publisher-4e33ca0c',
    feedUrl: 'https://wavlake.com/feed/artist/4e33ca0c-bd98-4f98-9284-e8073046c049',
    name: 'bennyjeans'
  },
  '4e33ca0c': {
    feedGuid: 'wavlake-publisher-4e33ca0c',
    feedUrl: 'https://wavlake.com/feed/artist/4e33ca0c-bd98-4f98-9284-e8073046c049',
    name: 'bennyjeans'
  },
  'big-awesome': {
    feedGuid: 'wavlake-publisher-93fbacab',
    feedUrl: 'https://wavlake.com/feed/artist/93fbacab-bbbb-4de4-863a-8adeb9fc4782',
    name: 'Big Awesome'
  },
  'wavlake-publisher-93fbacab': {
    feedGuid: 'wavlake-publisher-93fbacab',
    feedUrl: 'https://wavlake.com/feed/artist/93fbacab-bbbb-4de4-863a-8adeb9fc4782',
    name: 'Big Awesome'
  },
  '93fbacab': {
    feedGuid: 'wavlake-publisher-93fbacab',
    feedUrl: 'https://wavlake.com/feed/artist/93fbacab-bbbb-4de4-863a-8adeb9fc4782',
    name: 'Big Awesome'
  },
  'charlie-crown': {
    feedGuid: 'wavlake-publisher-707bc821',
    feedUrl: 'https://wavlake.com/feed/artist/707bc821-489e-46b2-8b51-d0aaad856f20',
    name: 'Charlie Crown'
  },
  'wavlake-publisher-707bc821': {
    feedGuid: 'wavlake-publisher-707bc821',
    feedUrl: 'https://wavlake.com/feed/artist/707bc821-489e-46b2-8b51-d0aaad856f20',
    name: 'Charlie Crown'
  },
  '707bc821': {
    feedGuid: 'wavlake-publisher-707bc821',
    feedUrl: 'https://wavlake.com/feed/artist/707bc821-489e-46b2-8b51-d0aaad856f20',
    name: 'Charlie Crown'
  },
  'cole-hansen': {
    feedGuid: 'wavlake-publisher-cc63b375',
    feedUrl: 'https://wavlake.com/feed/artist/cc63b375-8977-4048-9aee-99a500fb6108',
    name: 'Cole Hansen'
  },
  'wavlake-publisher-cc63b375': {
    feedGuid: 'wavlake-publisher-cc63b375',
    feedUrl: 'https://wavlake.com/feed/artist/cc63b375-8977-4048-9aee-99a500fb6108',
    name: 'Cole Hansen'
  },
  'cc63b375': {
    feedGuid: 'wavlake-publisher-cc63b375',
    feedUrl: 'https://wavlake.com/feed/artist/cc63b375-8977-4048-9aee-99a500fb6108',
    name: 'Cole Hansen'
  },
  'herbivore': {
    feedGuid: 'wavlake-publisher-eea2d330',
    feedUrl: 'https://wavlake.com/feed/artist/eea2d330-fc71-4e90-81de-3de819728c9d',
    name: 'Herbivore'
  },
  'wavlake-publisher-eea2d330': {
    feedGuid: 'wavlake-publisher-eea2d330',
    feedUrl: 'https://wavlake.com/feed/artist/eea2d330-fc71-4e90-81de-3de819728c9d',
    name: 'Herbivore'
  },
  'eea2d330': {
    feedGuid: 'wavlake-publisher-eea2d330',
    feedUrl: 'https://wavlake.com/feed/artist/eea2d330-fc71-4e90-81de-3de819728c9d',
    name: 'Herbivore'
  },
  'jessica-lynne-witty': {
    feedGuid: 'wavlake-publisher-6fa983b3',
    feedUrl: 'https://wavlake.com/feed/artist/6fa983b3-9aa2-4331-b22f-5f6d8dcdf3f2',
    name: 'Jessica Lynne Witty'
  },
  'wavlake-publisher-6fa983b3': {
    feedGuid: 'wavlake-publisher-6fa983b3',
    feedUrl: 'https://wavlake.com/feed/artist/6fa983b3-9aa2-4331-b22f-5f6d8dcdf3f2',
    name: 'Jessica Lynne Witty'
  },
  '6fa983b3': {
    feedGuid: 'wavlake-publisher-6fa983b3',
    feedUrl: 'https://wavlake.com/feed/artist/6fa983b3-9aa2-4331-b22f-5f6d8dcdf3f2',
    name: 'Jessica Lynne Witty'
  },
  'john-depew-trio': {
    feedGuid: 'wavlake-publisher-df5a4722',
    feedUrl: 'https://wavlake.com/feed/artist/df5a4722-cd42-429c-896d-caec1ad39600',
    name: 'John Depew Trio'
  },
  'wavlake-publisher-df5a4722': {
    feedGuid: 'wavlake-publisher-df5a4722',
    feedUrl: 'https://wavlake.com/feed/artist/df5a4722-cd42-429c-896d-caec1ad39600',
    name: 'John Depew Trio'
  },
  'df5a4722': {
    feedGuid: 'wavlake-publisher-df5a4722',
    feedUrl: 'https://wavlake.com/feed/artist/df5a4722-cd42-429c-896d-caec1ad39600',
    name: 'John Depew Trio'
  },
  'lara-j': {
    feedGuid: 'wavlake-publisher-912c0793',
    feedUrl: 'https://wavlake.com/feed/artist/912c0793-92cf-4726-a495-e5b1602693c0',
    name: 'Lara J'
  },
  'wavlake-publisher-912c0793': {
    feedGuid: 'wavlake-publisher-912c0793',
    feedUrl: 'https://wavlake.com/feed/artist/912c0793-92cf-4726-a495-e5b1602693c0',
    name: 'Lara J'
  },
  '912c0793': {
    feedGuid: 'wavlake-publisher-912c0793',
    feedUrl: 'https://wavlake.com/feed/artist/912c0793-92cf-4726-a495-e5b1602693c0',
    name: 'Lara J'
  },
  'late-night-special': {
    feedGuid: 'wavlake-publisher-bfb52718',
    feedUrl: 'https://wavlake.com/feed/artist/bfb52718-dcfd-44d6-af94-d05559be2f21',
    name: 'Late Night Special'
  },
  'wavlake-publisher-bfb52718': {
    feedGuid: 'wavlake-publisher-bfb52718',
    feedUrl: 'https://wavlake.com/feed/artist/bfb52718-dcfd-44d6-af94-d05559be2f21',
    name: 'Late Night Special'
  },
  'bfb52718': {
    feedGuid: 'wavlake-publisher-bfb52718',
    feedUrl: 'https://wavlake.com/feed/artist/bfb52718-dcfd-44d6-af94-d05559be2f21',
    name: 'Late Night Special'
  },
  'matt-johner': {
    feedGuid: 'wavlake-publisher-7ca38fae',
    feedUrl: 'https://wavlake.com/feed/artist/7ca38fae-f142-4ceb-ab0f-b17d92374315',
    name: 'Matt Johner'
  },
  'wavlake-publisher-7ca38fae': {
    feedGuid: 'wavlake-publisher-7ca38fae',
    feedUrl: 'https://wavlake.com/feed/artist/7ca38fae-f142-4ceb-ab0f-b17d92374315',
    name: 'Matt Johner'
  },
  '7ca38fae': {
    feedGuid: 'wavlake-publisher-7ca38fae',
    feedUrl: 'https://wavlake.com/feed/artist/7ca38fae-f142-4ceb-ab0f-b17d92374315',
    name: 'Matt Johner'
  },
  'ro-shapiro': {
    feedGuid: 'wavlake-publisher-299267e2',
    feedUrl: 'https://wavlake.com/feed/artist/299267e2-9309-4276-a22d-70b44f0be754',
    name: 'R.O. Shapiro'
  },
  'r-o-shapiro': {
    feedGuid: 'wavlake-publisher-299267e2',
    feedUrl: 'https://wavlake.com/feed/artist/299267e2-9309-4276-a22d-70b44f0be754',
    name: 'R.O. Shapiro'
  },
  'wavlake-publisher-299267e2': {
    feedGuid: 'wavlake-publisher-299267e2',
    feedUrl: 'https://wavlake.com/feed/artist/299267e2-9309-4276-a22d-70b44f0be754',
    name: 'R.O. Shapiro'
  },
  '299267e2': {
    feedGuid: 'wavlake-publisher-299267e2',
    feedUrl: 'https://wavlake.com/feed/artist/299267e2-9309-4276-a22d-70b44f0be754',
    name: 'R.O. Shapiro'
  },
  'ryan-fonda': {
    feedGuid: 'wavlake-publisher-d4c49f2e',
    feedUrl: 'https://wavlake.com/feed/artist/d4c49f2e-0b50-4a5e-8101-7543d68e032f',
    name: 'Ryan Fonda'
  },
  'wavlake-publisher-d4c49f2e': {
    feedGuid: 'wavlake-publisher-d4c49f2e',
    feedUrl: 'https://wavlake.com/feed/artist/d4c49f2e-0b50-4a5e-8101-7543d68e032f',
    name: 'Ryan Fonda'
  },
  'd4c49f2e': {
    feedGuid: 'wavlake-publisher-d4c49f2e',
    feedUrl: 'https://wavlake.com/feed/artist/d4c49f2e-0b50-4a5e-8101-7543d68e032f',
    name: 'Ryan Fonda'
  },
  'sara-jade': {
    feedGuid: 'wavlake-publisher-a8ad6318',
    feedUrl: 'https://wavlake.com/feed/artist/a8ad6318-7312-4f77-adbf-80b54944c8da',
    name: 'Sara Jade'
  },
  'wavlake-publisher-a8ad6318': {
    feedGuid: 'wavlake-publisher-a8ad6318',
    feedUrl: 'https://wavlake.com/feed/artist/a8ad6318-7312-4f77-adbf-80b54944c8da',
    name: 'Sara Jade'
  },
  'a8ad6318': {
    feedGuid: 'wavlake-publisher-a8ad6318',
    feedUrl: 'https://wavlake.com/feed/artist/a8ad6318-7312-4f77-adbf-80b54944c8da',
    name: 'Sara Jade'
  },
  'seth-fonda': {
    feedGuid: 'wavlake-publisher-d5067e8a',
    feedUrl: 'https://wavlake.com/feed/artist/d5067e8a-e2a2-47d7-a80c-b1a13def9a8d',
    name: 'Seth Fonda'
  },
  'wavlake-publisher-d5067e8a': {
    feedGuid: 'wavlake-publisher-d5067e8a',
    feedUrl: 'https://wavlake.com/feed/artist/d5067e8a-e2a2-47d7-a80c-b1a13def9a8d',
    name: 'Seth Fonda'
  },
  'd5067e8a': {
    feedGuid: 'wavlake-publisher-d5067e8a',
    feedUrl: 'https://wavlake.com/feed/artist/d5067e8a-e2a2-47d7-a80c-b1a13def9a8d',
    name: 'Seth Fonda'
  },
  'the-greensands': {
    feedGuid: 'wavlake-publisher-a8586318',
    feedUrl: 'https://wavlake.com/feed/artist/a8586318-c588-46ad-a769-ffb7e9c27b2c',
    name: 'The Greensands'
  },
  'wavlake-publisher-a8586318': {
    feedGuid: 'wavlake-publisher-a8586318',
    feedUrl: 'https://wavlake.com/feed/artist/a8586318-c588-46ad-a769-ffb7e9c27b2c',
    name: 'The Greensands'
  },
  'a8586318': {
    feedGuid: 'wavlake-publisher-a8586318',
    feedUrl: 'https://wavlake.com/feed/artist/a8586318-c588-46ad-a769-ffb7e9c27b2c',
    name: 'The Greensands'
  },
  'the-johner-boys': {
    feedGuid: 'wavlake-publisher-bd040774',
    feedUrl: 'https://wavlake.com/feed/artist/bd040774-1dd6-42c6-98ce-01d327697a1d',
    name: 'The Johner Boys'
  },
  'wavlake-publisher-bd040774': {
    feedGuid: 'wavlake-publisher-bd040774',
    feedUrl: 'https://wavlake.com/feed/artist/bd040774-1dd6-42c6-98ce-01d327697a1d',
    name: 'The Johner Boys'
  },
  'bd040774': {
    feedGuid: 'wavlake-publisher-bd040774',
    feedUrl: 'https://wavlake.com/feed/artist/bd040774-1dd6-42c6-98ce-01d327697a1d',
    name: 'The Johner Boys'
  },
  'theo-katzman': {
    feedGuid: 'wavlake-publisher-09954f14',
    feedUrl: 'https://wavlake.com/feed/artist/09954f14-c5a7-4680-90f4-0869243b9c26',
    name: 'Theo Katzman'
  },
  'wavlake-publisher-09954f14': {
    feedGuid: 'wavlake-publisher-09954f14',
    feedUrl: 'https://wavlake.com/feed/artist/09954f14-c5a7-4680-90f4-0869243b9c26',
    name: 'Theo Katzman'
  },
  '09954f14': {
    feedGuid: 'wavlake-publisher-09954f14',
    feedUrl: 'https://wavlake.com/feed/artist/09954f14-c5a7-4680-90f4-0869243b9c26',
    name: 'Theo Katzman'
  },
  'vertigo-kidd': {
    feedGuid: 'wavlake-publisher-eff27dd6',
    feedUrl: 'https://wavlake.com/feed/artist/eff27dd6-764c-497e-81fe-3a7e10eb7b3b',
    name: 'Vertigo Kidd'
  },
  'wavlake-publisher-eff27dd6': {
    feedGuid: 'wavlake-publisher-eff27dd6',
    feedUrl: 'https://wavlake.com/feed/artist/eff27dd6-764c-497e-81fe-3a7e10eb7b3b',
    name: 'Vertigo Kidd'
  },
  'eff27dd6': {
    feedGuid: 'wavlake-publisher-eff27dd6',
    feedUrl: 'https://wavlake.com/feed/artist/eff27dd6-764c-497e-81fe-3a7e10eb7b3b',
    name: 'Vertigo Kidd'
  }
};

/**
 * Get publisher info from a slug (clean URL or UUID)
 */
export function getPublisherInfo(slug: string): { feedGuid: string; feedUrl: string; name?: string } | null {
  // First try exact match
  if (KNOWN_PUBLISHERS[slug]) {
    return KNOWN_PUBLISHERS[slug];
  }
  
  // Try without -publisher suffix (e.g., "ollie-publisher" -> "ollie")
  const normalizedSlug = slug.replace(/-publisher$/, '');
  if (normalizedSlug !== slug && KNOWN_PUBLISHERS[normalizedSlug]) {
    return KNOWN_PUBLISHERS[normalizedSlug];
  }
  
  // Try to find by partial UUID match
  for (const [, publisher] of Object.entries(KNOWN_PUBLISHERS)) {
    if (publisher.feedGuid.startsWith(slug) || slug.startsWith(publisher.feedGuid.split('-')[0])) {
      return publisher;
    }
    // Also try normalized slug
    if (publisher.feedGuid.startsWith(normalizedSlug) || normalizedSlug.startsWith(publisher.feedGuid.split('-')[0])) {
      return publisher;
    }
  }
  
  return null;
}

/**
 * Validate that a string is a valid URL
 * Returns true if valid, false otherwise
 */
export function isValidUrl(urlString: string | null | undefined): boolean {
  if (!urlString || typeof urlString !== 'string') {
    return false;
  }

  try {
    const url = new URL(urlString);
    // Must be http or https protocol
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a feed URL specifically
 * Checks for valid URL structure and common RSS/XML feed patterns
 */
export function isValidFeedUrl(urlString: string | null | undefined): boolean {
  if (!isValidUrl(urlString)) {
    return false;
  }

  try {
    const url = new URL(urlString!);

    // Block obviously invalid hosts
    if (!url.hostname || url.hostname === 'localhost' && process.env.NODE_ENV === 'production') {
      return false;
    }

    // Must have a proper domain (at least one dot for TLD, unless localhost in dev)
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a URL for consistent storage
 * - Removes trailing slashes
 * - Decodes URL-encoded characters where safe
 * - Ensures https when possible
 */
export function normalizeUrl(urlString: string): string {
  try {
    const url = new URL(urlString);

    // Upgrade http to https for known secure hosts
    const secureHosts = ['wavlake.com', 'podcastindex.org', 'api.podcastindex.org', 'feeds.fountain.fm'];
    if (url.protocol === 'http:' && secureHosts.some(host => url.hostname.endsWith(host))) {
      url.protocol = 'https:';
    }

    // Remove trailing slash from pathname (except for root)
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    // If URL parsing fails, return as-is
    return urlString;
  }
} 