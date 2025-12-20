import { createPlaylistHandler, PLAYLIST_CONFIGS } from '@/lib/playlist';

// Database-only queries are fast, reduced timeout
export const maxDuration = 60;

export const GET = createPlaylistHandler(PLAYLIST_CONFIGS.mmm);
