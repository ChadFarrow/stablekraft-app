import { permanentRedirect } from 'next/navigation';

/**
 * The old Top 100 page (2025-08). It asked for `/api/playlist/top100-music`, a route
 * that never existed, so every visit showed "Error Loading Playlist — Failed to load
 * tracks: 404". `/playlist/top100` (2025-11) replaced it and is the one the playlist
 * index links to. Old links and search results land there instead (HTTP 308).
 */
export default function Top100MusicPage() {
  permanentRedirect('/playlist/top100');
}
