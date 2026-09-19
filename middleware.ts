import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-auth';
import { requiresAdminAuth } from '@/lib/admin-route-policy';

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (requiresAdminAuth(pathname, request.method, searchParams)) {
      const denied = checkAdminAuth(request);
      if (denied) return denied;
    }
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();

  // Get hostname from headers (Vercel uses x-forwarded-host)
  const hostname = request.headers.get('x-forwarded-host')
    || request.headers.get('host')
    || '';

  // Check if this is the radio subdomain
  // Match: radio.stablekraft.app, radio.localhost, radio.localhost:3000
  const isRadioSubdomain = hostname.startsWith('radio.');

  if (isRadioSubdomain) {
    // Rewrite all radio subdomain requests to /radio page
    // This keeps the URL as radio.stablekraft.app but serves /radio page
    url.pathname = '/radio';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

/**
 * Next.js requires this to be a statically analysable literal, so the API
 * entries below are a hand-copy of `ADMIN_GATED_MATCHER` in
 * `lib/admin-route-policy.ts`. `admin-route-policy.test.ts` asserts the two
 * agree — a rule added to the policy but not here would never run, because
 * middleware is not invoked for an unmatched path.
 */
export const config = {
  matcher: [
    // Match all paths except static files, api routes, and Next.js internals
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|stablekraft-rocket.png|app-icon-new.png|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.webp|.*\\.ico|.*\\.js|.*\\.css).*)',
    // Admin-auth-gated API surfaces (requiresAdminAuth decides per method/query)
    '/api/admin/:path*',
    '/api/feeds',
    '/api/feeds/:id/refresh',
    '/api/feeds/:id/process-remote-items',
    '/api/tracks',
    '/api/playlists',
    '/api/artwork-colors',
    '/api/artwork-colors/batch-process',
    '/api/add-playlist-to-database',
    '/api/music-tracks',
    '/api/music-tracks/database',
    '/api/music-tracks/clear-cache',
    '/api/cache',
    '/api/resolve-hgh-tracks',
    '/api/find-missing-feeds',
    '/api/resolve-missing-feeds',
    '/api/parse-feeds',
    '/api/playlist-cache',
    '/api/playlist/:path*',
    '/api/albums-fast',
  ],
};
