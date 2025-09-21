'use client';

import Link from 'next/link';
import Image from 'next/image';

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b backdrop-blur-sm bg-black/30 pt-safe-plus pt-12" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
        <div className="container mx-auto px-6 py-4">
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
                This is a demo app I built for the "StableKraft" project to see what we could do with RSS feeds and music. All data here comes from RSS feeds on{' '}
                <a href="https://podcastindex.org/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                  podcastindex.org
                </a>. This is also a demo of a site for The Doerfels that I added other music I like also and some stuff to help test.
              </p>
              <p className="text-gray-400 text-right">-ChadF</p>
            </div>

            {/* ChadF Support Section */}
            <div className="bg-gradient-to-br from-blue-900/30 to-green-900/30 rounded-lg p-8 mb-8 border border-blue-500/20">
              <h2 className="text-2xl font-bold mb-6 text-center">Support ChadF</h2>
              <p className="text-gray-300 text-center mb-8">
                This site is a passion project for me but if you want to help me cover the cost any help is appreciated.
              </p>

              <div className="flex justify-center">
                <a
                  href="https://www.paypal.com/donate/?business=NYCRNVFP4X3DY&no_recurring=0&currency_code=USD"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8.32 21.97a.546.546 0 0 1-.26-.32c-.03-.15-.06.11.6-8.89.66-9.28.66-9.29.81-9.45a.75.75 0 0 1 .7-.36c.73.05 2.38.43 3.3.78a6.64 6.64 0 0 1 2.84 2.18c.45.57.78 1.16.94 1.69.18.58.2 1.56.05 2.2a5.4 5.4 0 0 1-.85 1.84c-.4.52-1.15 1.24-1.69 1.6a6.13 6.13 0 0 1-2.4 1.03c-.88.19-1.12.2-2.3.2H8.89l-.37 5.18c-.27 3.85-.39 5.2-.44 5.25-.08.08-.4.1-.75.04a.81.81 0 0 1-.33-.11zm4.48-11.42c1.42-.1 2.05-.33 2.62-.9.58-.59.86-1.25.9-2.1.02-.42 0-.6-.1-.95-.33-1.17-1.15-1.84-2.54-2.07-.43-.07-1.53-.11-1.74-.06-.15.04-.17.27-.33 2.33-.18 2.44-.18 2.3 0 2.5.1.1.14.12.54.31.53.26 1.33.45 2.06.48.33.01.73 0 .87-.03h-.28z"/>
                  </svg>
                  Donate via PayPal
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
                  <h3 className="text-lg font-semibold mb-3">Music Discovery</h3>
                  <p className="text-gray-400">
                    Explore albums and tracks from independent artists.
                    Stream music directly from RSS feeds with seamless playback.
                  </p>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-3">RSS Integration</h3>
                  <p className="text-gray-400">
                    Built on open standards using RSS feeds and the Podcast Index API.
                    Add your own RSS feeds to discover new content.
                  </p>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-3">Open Ecosystem</h3>
                  <p className="text-gray-400">
                    Supporting Podcasting 2.0 features and value-for-value content.
                    Built for creators and listeners alike.
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
                  <h3 className="text-lg font-semibold mb-4 text-center">Podcast Index</h3>
                  <ul className="space-y-2 text-center">
                    <li>
                      <a href="https://podcastindex.org/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        Podcast Index Website
                      </a>
                    </li>
                    <li>
                      <a href="https://www.paypal.com/donate?token=5IhXgt0XwBEHolJXARM9gmAoTXWkftjA3uCLayf_msLtycZ5pYnk2ZSe7FoG6rOFtvv2qjUuvOz1ZeV1" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                        Support Podcast Index
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
  );
}