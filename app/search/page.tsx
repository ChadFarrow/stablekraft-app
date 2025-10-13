'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import LoadingSpinner from '@/components/LoadingSpinner';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, generatePublisherSlug } from '@/lib/url-utils';
import { useAudio } from '@/contexts/AudioContext';
import SearchBar from '@/components/SearchBar';

interface SearchResults {
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album?: string;
    image?: string;
    audioUrl: string;
    feedId: string;
    feedTitle: string;
    duration?: number;
    v4vRecipient?: string;
    v4vValue?: any;
  }>;
  albums: Array<{
    id: string;
    title: string;
    artist: string;
    description?: string;
    coverArt?: string;
    totalTracks: number;
    type: string;
    feedUrl: string;
  }>;
  artists: Array<{
    name: string;
    image?: string;
    albumCount: number;
    totalTracks: number;
    feedGuid: string;
  }>;
}

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const query = searchParams?.get('q') || '';
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'tracks' | 'albums' | 'artists'>('all');
  const { playAlbum } = useAudio();

  useEffect(() => {
    if (query.length >= 2) {
      performSearch(query);
    } else {
      setResults(null);
    }
  }, [query]);

  const performSearch = async (searchQuery: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=50`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setResults(data.results);
        } else {
          setError(data.error || 'Search failed');
        }
      } else {
        setError('Failed to fetch search results');
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('An error occurred while searching');
    } finally {
      setIsLoading(false);
    }
  };

  const totalResults = results
    ? (results.tracks?.length || 0) + (results.albums?.length || 0) + (results.artists?.length || 0)
    : 0;

  const filteredTracks = activeTab === 'all' || activeTab === 'tracks' ? results?.tracks || [] : [];
  const filteredAlbums = activeTab === 'all' || activeTab === 'albums' ? results?.albums || [] : [];
  const filteredArtists = activeTab === 'all' || activeTab === 'artists' ? results?.artists || [] : [];

  return (
    <div className="min-h-screen text-white bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="relative z-20">
        {/* Header */}
        <header className="border-b backdrop-blur-sm bg-black/70 pt-safe-plus pt-6" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div className="container mx-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <Link href="/" className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back</span>
              </Link>
              <h1 className="text-2xl font-bold">Search Results</h1>
              <div className="w-20"></div>
            </div>

            {/* Search Bar */}
            <div className="mb-4">
              <SearchBar className="w-full" placeholder="Search for more..." />
            </div>

            {/* Result Count */}
            {query && !isLoading && (
              <div className="text-sm text-gray-400">
                {totalResults > 0 ? (
                  <span>
                    Found {totalResults} result{totalResults !== 1 ? 's' : ''} for &quot;{query}&quot;
                  </span>
                ) : (
                  <span>No results found for &quot;{query}&quot;</span>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <div className="container mx-auto px-6 py-8">
          {!query || query.length < 2 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h2 className="text-2xl font-semibold mb-2 text-gray-300">Start Searching</h2>
              <p className="text-gray-500">Enter at least 2 characters to search</p>
            </div>
          ) : isLoading ? (
            <div className="flex justify-center py-12">
              <LoadingSpinner size="large" text="Searching..." />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <h2 className="text-2xl font-semibold mb-4 text-red-600">Error</h2>
              <p className="text-gray-400">{error}</p>
            </div>
          ) : results && totalResults > 0 ? (
            <>
              {/* Filter Tabs */}
              <div className="flex gap-2 mb-6 overflow-x-auto">
                {[
                  { value: 'all', label: 'All', count: totalResults },
                  { value: 'tracks', label: 'Tracks', count: results.tracks?.length || 0 },
                  { value: 'albums', label: 'Albums', count: results.albums?.length || 0 },
                  { value: 'artists', label: 'Publishers', count: results.artists?.length || 0 }
                ].map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value as any)}
                    className={`px-4 py-2 rounded-lg whitespace-nowrap transition-all ${
                      activeTab === tab.value
                        ? 'bg-stablekraft-teal text-white shadow-sm'
                        : 'bg-gray-800/50 text-gray-300 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {/* Tracks Section */}
              {filteredTracks.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-xl font-bold mb-4 text-white">Tracks</h2>
                  <div className="space-y-2">
                    {filteredTracks.map((track) => (
                      <div
                        key={track.id}
                        className="flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                      >
                        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gray-800">
                          <Image
                            src={getAlbumArtworkUrl(track.image || '', 'thumbnail')}
                            alt={track.title}
                            width={64}
                            height={64}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = getPlaceholderImageUrl('thumbnail');
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-lg text-white truncate">{track.title}</h3>
                          <p className="text-gray-400 text-sm truncate">
                            {track.artist} {track.album && `• ${track.album}`}
                          </p>
                          <p className="text-gray-500 text-xs truncate">From: {track.feedTitle}</p>
                        </div>

                        {track.duration && (
                          <div className="text-sm text-gray-500 hidden sm:block">
                            {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Albums Section */}
              {filteredAlbums.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-xl font-bold mb-4 text-white">Albums</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {filteredAlbums.map((album) => (
                      <Link
                        key={album.id}
                        href={generateAlbumUrl(album.title)}
                        className="group bg-white/5 backdrop-blur-sm rounded-xl p-4 hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                      >
                        <div className="aspect-square rounded-lg overflow-hidden mb-3 bg-gray-800">
                          <Image
                            src={getAlbumArtworkUrl(album.coverArt || '', 'medium')}
                            alt={album.title}
                            width={200}
                            height={200}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = getPlaceholderImageUrl('medium');
                            }}
                          />
                        </div>
                        <h3 className="font-semibold text-sm mb-1 text-white truncate group-hover:text-stablekraft-teal transition-colors">
                          {album.title}
                        </h3>
                        <p className="text-xs text-gray-400 truncate">{album.artist}</p>
                        <p className="text-xs text-gray-500 mt-1">{album.totalTracks} tracks</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Artists/Publishers Section */}
              {filteredArtists.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-xl font-bold mb-4 text-white">Publishers</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {filteredArtists.map((artist) => (
                      <Link
                        key={artist.feedGuid}
                        href={`/publisher/${generatePublisherSlug({ title: artist.name, feedGuid: artist.feedGuid })}`}
                        className="group bg-white/5 backdrop-blur-sm rounded-xl p-4 hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
                      >
                        <div className="aspect-square rounded-full overflow-hidden mb-3 bg-gray-800">
                          <Image
                            src={getAlbumArtworkUrl(artist.image || '', 'medium')}
                            alt={artist.name}
                            width={200}
                            height={200}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = getPlaceholderImageUrl('medium');
                            }}
                          />
                        </div>
                        <h3 className="font-semibold text-sm mb-1 text-white truncate group-hover:text-stablekraft-teal transition-colors text-center">
                          {artist.name}
                        </h3>
                        <p className="text-xs text-gray-500 text-center">{artist.albumCount} releases</p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-2xl font-semibold mb-2 text-gray-300">No Results Found</h2>
              <p className="text-gray-500">Try searching with different keywords</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
        <LoadingSpinner size="large" text="Loading search..." />
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
