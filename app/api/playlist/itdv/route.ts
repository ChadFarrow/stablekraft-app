import { createPlaylistHandler, PLAYLIST_CONFIGS } from '@/lib/playlist';

export const maxDuration = 300;

export const GET = createPlaylistHandler(PLAYLIST_CONFIGS.itdv);
