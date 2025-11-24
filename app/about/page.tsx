'use client';

import Link from 'next/link';
import Image from 'next/image';
import AppLayout from '@/components/AppLayout';

export default function AboutPage() {
  return (
    <AppLayout>
      <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b backdrop-blur-sm bg-black/30 pt-safe-plus pt-12" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
        <div className="container mx-auto pl-6 pr-32 sm:pr-48 py-4">
          <div className="flex items-center gap-4 mb-8">
            <Link href="/" className="flex items-center gap-4 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 relative border border-gray-700 rounded-lg overflow-hidden">
                <Image
                  src="/logo.webp"
                  alt="VALUE Logo"
                  width={40}
                  height={40}
                  className="object-cover"
                  priority
                />
              </div>
              <h1 className="text-4xl font-bold">Project StableKraft</h1>
            </Link>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-8 text-center">
              About Project StableKraft
            </h1>

            {/* Main Description - moved from banner */}
            <div className="bg-gray-900/50 rounded-lg p-8 mb-8">
              <p className="text-lg leading-relaxed mb-4">
                Project StableKraft is a RSS first music app where all the data comes from RSS feeds on{' '}
                <a href="https://podcastindex.org/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                  podcastindex.org
                </a>.
              </p>
              <p className="text-gray-400 text-right">-ChadF</p>
            </div>

            {/* Follow Me Section */}
            <div className="bg-gray-900/50 rounded-lg p-8 mb-8">
              <h2 className="text-2xl font-bold mb-6 text-center">Follow Me</h2>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <a
                  href="https://podcastindex.social/@ChadF"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.193 7.879c0-5.206-3.411-6.732-3.411-6.732C18.062.357 15.108.025 12.041 0h-.076c-3.068.025-6.02.357-7.74 1.147 0 0-3.411 1.526-3.411 6.732 0 1.192-.023 2.618.015 4.129.124 5.092.934 10.109 5.641 11.355 2.17.574 4.034.695 5.535.612 2.722-.15 4.25-.972 4.25-.972l-.09-1.975s-1.945.613-4.129.539c-2.165-.074-4.449-.233-4.799-2.891a5.499 5.499 0 0 1-.048-.745s2.125.52 4.817.643c1.646.075 3.19-.097 4.758-.283 3.007-.359 5.625-2.212 5.954-3.905.517-2.665.475-6.507.475-6.507zm-4.024 6.709h-2.497V8.469c0-1.29-.543-1.943-1.628-1.943-1.2 0-1.801.776-1.801 2.312v3.349h-2.483v-3.35c0-1.536-.601-2.311-1.801-2.311-1.085 0-1.628.653-1.628 1.943v6.119H4.834V8.284c0-1.289.328-2.313.987-3.07.679-.757 1.568-1.146 2.673-1.146 1.278 0 2.246.491 2.886 1.474l.622 1.043.622-1.043c.64-.983 1.608-1.474 2.886-1.474 1.104 0 1.994.389 2.673 1.146.659.757.987 1.781.987 3.07v6.304z"/>
                  </svg>
                  Mastodon
                </a>
                <a
                  href="https://njump.me/npub177fz5zkm87jdmf0we2nz7mm7uc2e7l64uzqrv6rvdrsg8qkrg7yqx0aaq7"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <Image
                    src="/nostr-logo.png"
                    alt="Nostr"
                    width={20}
                    height={20}
                    className="w-5 h-5"
                  />
                  Nostr
                </a>
              </div>
            </div>

            {/* ChadF Support Section */}
            <div className="bg-gradient-to-br from-blue-900/30 to-green-900/30 rounded-lg p-8 mb-8 border border-blue-500/20">
              <h2 className="text-2xl font-bold mb-6 text-center">Support ChadF</h2>
              <p className="text-gray-300 text-center mb-8">
                This site is a passion project for me but if you want to help me cover the cost any help is appreciated.
              </p>

              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <a
                  href="https://www.paypal.com/donate/?business=NYCRNVFP4X3DY&no_recurring=0&currency_code=USD"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8.32 21.97a.546.546 0 0 1-.26-.32c-.03-.15-.06.11.6-8.89.66-9.28.66-9.29.81-9.45a.75.75 0 0 1 .7-.36c.73.05 2.38.43 3.3.78a6.64 6.64 0 0 1 2.84 2.18c.45.57.78 1.16.94 1.69.18.58.2 1.56.05 2.2a5.4 5.4 0 0 1-.85 1.84c-.4.52-1.15 1.24-1.69 1.6a6.13 6.13 0 0 1-2.4 1.03c-.88.19-1.12.2-2.3.2H8.89l-.37 5.18c-.27 3.85-.39 5.2-.44 5.25-.08.08-.4.1-.75.04a.81.81 0 0 1-.33-.11zm4.48-11.42c1.42-.1 2.05-.33 2.62-.9.58-.59.86-1.25.9-2.1.02-.42 0-.6-.1-.95-.33-1.17-1.15-1.84-2.54-2.07-.43-.07-1.53-.11-1.74-.06-.15.04-.17.27-.33 2.33-.18 2.44-.18 2.3 0 2.5.1.1.14.12.54.31.53.26 1.33.45 2.06.48.33.01.73 0 .87-.03h-.28z"/>
                  </svg>
                  Donate via PayPal
                </a>
                <a
                  href="https://getalby.com/p/chadf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>
                  </svg>
                  Support via Alby
                </a>
              </div>
            </div>

            {/* PodcastIndex Support Section */}
            <div className="bg-gradient-to-br from-purple-900/30 to-blue-900/30 rounded-lg p-8 mb-8 border border-purple-500/20">
              <h2 className="text-2xl font-bold mb-6 text-center">Support PodcastIndex</h2>
              <p className="text-gray-300 text-center mb-8">
                Support the open podcast ecosystem that powers this platform.
              </p>

              <div className="flex justify-center">
                <a
                  href="https://www.paypal.com/donate?token=5IhXgt0XwBEHolJXARM9gmAoTXWkftjA3uCLayf_msLtycZ5pYnk2ZSe7FoG6rOFtvv2qjUuvOz1ZeV1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8.32 21.97a.546.546 0 0 1-.26-.32c-.03-.15-.06.11.6-8.89.66-9.28.66-9.29.81-9.45a.75.75 0 0 1 .7-.36c.73.05 2.38.43 3.3.78a6.64 6.64 0 0 1 2.84 2.18c.45.57.78 1.16.94 1.69.18.58.2 1.56.05 2.2a5.4 5.4 0 0 1-.85 1.84c-.4.52-1.15 1.24-1.69 1.6a6.13 6.13 0 0 1-2.4 1.03c-.88.19-1.12.2-2.3.2H8.89l-.37 5.18c-.27 3.85-.39 5.2-.44 5.25-.08.08-.4.1-.75.04a.81.81 0 0 1-.33-.11zm4.48-11.42c1.42-.1 2.05-.33 2.62-.9.58-.59.86-1.25.9-2.1.02-.42 0-.6-.1-.95-.33-1.17-1.15-1.84-2.54-2.07-.43-.07-1.53-.11-1.74-.06-.15.04-.17.27-.33 2.33-.18 2.44-.18 2.3 0 2.5.1.1.14.12.54.31.53.26 1.33.45 2.06.48.33.01.73 0 .87-.03h-.28z"/>
                  </svg>
                  Donate via PayPal
                </a>
              </div>
            </div>

            <div className="bg-gray-900/50 rounded-lg p-8 mb-12">
              <h2 className="text-2xl font-semibold mb-6">
                Features
              </h2>
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-lg font-semibold mb-3">Music Playback & Streaming</h3>
                  <p className="text-gray-400">
                    Stream music from RSS feeds with full player controls, background playback, and seamless track transitions.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Value-for-Value Lightning Payments</h3>
                  <p className="text-gray-400">
                    Send Bitcoin Lightning donations directly to artists with automatic payment splits. Support creators in real-time as you listen.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Nostr Social Integration</h3>
                  <p className="text-gray-400">
                    Login with Nostr to sync your favorites across devices, share what you&apos;re listening to, and connect with the music community.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">RSS-First Architecture</h3>
                  <p className="text-gray-400">
                    All content comes from RSS feeds via Podcast Index, supporting an open and decentralized ecosystem for independent artists.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Favorites & Playlists</h3>
                  <p className="text-gray-400">
                    Save your favorite tracks, albums, and artists. Browse curated playlists or shuffle through the entire music library.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">Progressive Web App (PWA)</h3>
                  <p className="text-gray-400">
                    Install on any device and use like a native app with home screen access.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-900/50 rounded-lg p-8 mb-12">
              <h2 className="text-2xl font-semibold mb-6">
                Links & Resources
              </h2>
              <div className="flex justify-center">
                <div className="max-w-md">
                  <h3 className="text-xl font-semibold mb-4 text-center">Podcasting 2.0 Resources</h3>
                  <ul className="space-y-2 text-center mb-6">
                    <li>
                      <a href="https://podcastindex.org/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        Podcast Index Website
                      </a>
                    </li>
                    <li>
                      <a href="https://podcasting2.org/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        podcasting2.org
                      </a>
                    </li>
                    <li>
                      <a href="https://github.com/Podcastindex-org/podcast-namespace" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        Podcasting 2.0 namespace (GitHub)
                      </a>
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-4 text-center">Music Hosting & Tools</h3>
                  <ul className="space-y-2 text-center mb-6">
                    <li>
                      <a href="https://github.com/de-mu/demu-feed-template" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        Demu Template
                      </a>
                    </li>
                    <li>
                      <a href="https://musicsideproject.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        musicsideproject.com
                      </a>
                    </li>
                    <li>
                      <a href="https://sovereignfeeds.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        sovereignfeeds.com
                      </a>
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-4 text-center">Music Apps</h3>
                  <ul className="space-y-2 text-center mb-6">
                    <li>
                      <a href="https://lnbeats.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        lnbeats.com
                      </a>
                    </li>
                    <li>
                      <a href="https://v4vmusic.com/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        v4vmusic.com
                      </a>
                    </li>
                  </ul>

                  <h3 className="text-xl font-semibold mb-4 text-center">Community</h3>
                  <ul className="space-y-2 text-center">
                    <li>
                      <a href="https://t.me/v4v_music" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        V4V Music Telegram
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="text-center">
              <Link
                href="/"
                className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-8 py-4 rounded-lg transition-colors font-medium text-lg"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Music
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
    </AppLayout>
  );
}