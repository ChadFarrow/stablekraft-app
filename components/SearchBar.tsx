'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, generatePublisherSlug } from '@/lib/url-utils';

interface SearchResult {
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    album?: string;
    image?: string;
    audioUrl: string;
    feedTitle: string;
  }>;
  albums: Array<{
    id: string;
    title: string;
    artist: string;
    coverArt?: string;
    totalTracks: number;
  }>;
  artists: Array<{
    name: string;
    image?: string;
    albumCount: number;
    feedGuid: string;
  }>;
}

interface SearchBarProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export default function SearchBar({
  onSearch,
  placeholder = 'Search tracks, albums, artists...',
  autoFocus = false,
  className = ''
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceTimer = useRef<NodeJS.Timeout>();

  // Debounced search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=5`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setResults(data.results);
          setIsOpen(true);
        }
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Handle input change with debouncing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setSelectedIndex(-1);

    // Clear previous timer
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Set new timer
    if (value.length >= 2) {
      debounceTimer.current = setTimeout(() => {
        performSearch(value);
      }, 300); // 300ms debounce
    } else {
      setResults(null);
      setIsOpen(false);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!results || !isOpen) return;

    const totalResults =
      (results.tracks?.length || 0) +
      (results.albums?.length || 0) +
      (results.artists?.length || 0);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < totalResults - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          // Navigate to selected result
          navigateToResult(selectedIndex);
        } else if (query.length >= 2) {
          // Navigate to full search results page
          router.push(`/search?q=${encodeURIComponent(query)}`);
          setIsOpen(false);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        // Only collapse on mobile
        if (window.innerWidth < 640) {
          setIsExpanded(false);
        }
        inputRef.current?.blur();
        break;
    }
  };

  // Navigate to selected result
  const navigateToResult = (index: number) => {
    if (!results) return;

    let currentIndex = 0;

    // Check tracks
    if (results.tracks && index < results.tracks.length) {
      const track = results.tracks[index];
      router.push(`/album/${track.feedTitle}`);
      setIsOpen(false);
      return;
    }
    currentIndex += results.tracks?.length || 0;

    // Check albums
    if (results.albums && index < currentIndex + results.albums.length) {
      const album = results.albums[index - currentIndex];
      router.push(generateAlbumUrl(album.title));
      setIsOpen(false);
      return;
    }
    currentIndex += results.albums?.length || 0;

    // Check artists
    if (results.artists && index < currentIndex + results.artists.length) {
      const artist = results.artists[index - currentIndex];
      router.push(`/publisher/${generatePublisherSlug({ title: artist.name, feedGuid: artist.feedGuid })}`);
      setIsOpen(false);
      return;
    }
  };

  // Click outside to close dropdown and collapse on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Only collapse on mobile (window width < 640px, which is sm: breakpoint)
        if (window.innerWidth < 640) {
          setIsExpanded(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const hasResults = results && (
    (results.tracks?.length || 0) > 0 ||
    (results.albums?.length || 0) > 0 ||
    (results.artists?.length || 0) > 0
  );

  return (
    <div ref={searchRef} className={`relative z-50 ${className}`}>
      {/* Mobile: Collapsed - Search Button (hidden on desktop) */}
      <button
        onClick={() => {
          setIsExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 100);
        }}
        className={`p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 transition-colors text-gray-300 hover:text-white sm:hidden ${isExpanded ? 'hidden' : ''}`}
        aria-label="Open search"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>

      {/* Search Input - Always visible on desktop, expandable on mobile */}
      <div className={`relative ${isExpanded ? '' : 'hidden'} sm:block`}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => hasResults && setIsOpen(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full px-4 py-2 pl-10 pr-10 bg-gray-800/50 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-stablekraft-teal focus:border-transparent transition-all"
        />

        {/* Search Icon */}
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Loading Spinner or Clear Button */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {isLoading ? (
            <div className="w-5 h-5 border-2 border-gray-600 border-t-stablekraft-teal rounded-full animate-spin"></div>
          ) : query.length > 0 ? (
            <button
              onClick={() => {
                setQuery('');
                setResults(null);
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Search Results Dropdown */}
      {isOpen && hasResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl max-h-96 overflow-y-auto z-[100]">
          {/* Tracks */}
          {results.tracks && results.tracks.length > 0 && (
            <div className="p-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Tracks</h3>
              {results.tracks.map((track, index) => (
                <Link
                  key={track.id}
                  href={`/album/${track.feedTitle}`}
                  onClick={() => setIsOpen(false)}
                  className={`flex items-center gap-3 p-2 rounded hover:bg-gray-800/50 transition-colors ${
                    selectedIndex === index ? 'bg-gray-800/50' : ''
                  }`}
                >
                  <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-gray-800">
                    <Image
                      src={getAlbumArtworkUrl(track.image || '', 'thumbnail')}
                      alt={track.title}
                      width={40}
                      height={40}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = getPlaceholderImageUrl('thumbnail');
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{track.title}</p>
                    <p className="text-xs text-gray-400 truncate">{track.artist}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Albums */}
          {results.albums && results.albums.length > 0 && (
            <div className="p-2 border-t border-gray-800">
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Albums</h3>
              {results.albums.map((album, index) => {
                const globalIndex = (results.tracks?.length || 0) + index;
                return (
                  <Link
                    key={album.id}
                    href={generateAlbumUrl(album.title)}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 p-2 rounded hover:bg-gray-800/50 transition-colors ${
                      selectedIndex === globalIndex ? 'bg-gray-800/50' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-gray-800">
                      <Image
                        src={getAlbumArtworkUrl(album.coverArt || '', 'thumbnail')}
                        alt={album.title}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = getPlaceholderImageUrl('thumbnail');
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{album.title}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {album.artist} • {album.totalTracks} tracks
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* Artists */}
          {results.artists && results.artists.length > 0 && (
            <div className="p-2 border-t border-gray-800">
              <h3 className="text-xs font-semibold text-gray-400 uppercase px-2 py-1">Publishers</h3>
              {results.artists.map((artist, index) => {
                const globalIndex = (results.tracks?.length || 0) + (results.albums?.length || 0) + index;
                return (
                  <Link
                    key={artist.feedGuid}
                    href={`/publisher/${generatePublisherSlug({ title: artist.name, feedGuid: artist.feedGuid })}`}
                    onClick={() => setIsOpen(false)}
                    className={`flex items-center gap-3 p-2 rounded hover:bg-gray-800/50 transition-colors ${
                      selectedIndex === globalIndex ? 'bg-gray-800/50' : ''
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 bg-gray-800">
                      <Image
                        src={getAlbumArtworkUrl(artist.image || '', 'thumbnail')}
                        alt={artist.name}
                        width={40}
                        height={40}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = getPlaceholderImageUrl('thumbnail');
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{artist.name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {artist.albumCount} releases
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* View All Results Link */}
          <div className="p-2 border-t border-gray-800">
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center gap-2 p-2 text-sm text-stablekraft-teal hover:text-stablekraft-orange transition-colors"
            >
              <span>View all results for &quot;{query}&quot;</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* No Results Message */}
      {isOpen && !isLoading && query.length >= 2 && !hasResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl p-4 z-[100]">
          <p className="text-center text-gray-400">No results found for &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  );
}
