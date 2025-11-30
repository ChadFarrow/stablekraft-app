import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();

  // Get hostname from headers (Vercel uses x-forwarded-host)
  const hostname = request.headers.get('x-forwarded-host')
    || request.headers.get('host')
    || '';

  // Check if this is the radio subdomain
  // Match: radio.stablekraft.app, radio.localhost, radio.localhost:3000
  const isRadioSubdomain = hostname.startsWith('radio.');

  if (isRadioSubdomain) {
    // Rewrite all radio subdomain requests to /radio route
    // This keeps the URL as radio.stablekraft.app but serves /radio page
    url.pathname = '/radio';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Match all paths except static files, api routes, and Next.js internals
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|stablekraft-rocket.png|app-icon-new.png|.*\\.png|.*\\.jpg|.*\\.svg|.*\\.webp|.*\\.ico|.*\\.js|.*\\.css).*)',
  ],
};
