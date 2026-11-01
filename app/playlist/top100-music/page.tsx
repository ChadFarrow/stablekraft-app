import { redirect } from 'next/navigation';

/**
 * The 2025-08 Top 100 page, replaced by /playlist/top100 in 2025-11 — and that one
 * is gone too (2026-11-01; see app/playlist/top100/page.tsx). Straight to the
 * playlists tab rather than through a second redirect.
 */
export default function Top100MusicPage() {
  redirect('/?filter=playlist');
}
