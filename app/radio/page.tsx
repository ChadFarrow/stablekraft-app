import RadioClient from './RadioClient';

async function getAlbums() {
  try {
    // Use internal URL for server-side fetch
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://stablekraft.app';
    const res = await fetch(`${baseUrl}/api/albums?limit=0`, {
      next: { revalidate: 300 } // Cache for 5 minutes
    });

    if (!res.ok) {
      console.warn(`Albums API returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    return data.albums || [];
  } catch (error) {
    console.error('Failed to fetch albums for radio:', error);
    return [];
  }
}

export default async function RadioPage() {
  const albums = await getAlbums();
  return <RadioClient initialAlbums={albums} />;
}
