'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Music, Disc, Calendar, Clock, ExternalLink } from 'lucide-react';
import { RSSAlbum, RSSPublisherItem } from '@/lib/rss-parser';
import { getAlbumArtworkUrl, getPlaceholderImageUrl } from '@/lib/cdn-utils';
import { generateAlbumUrl, getPublisherInfo } from '@/lib/url-utils';
import ControlsBar, { FilterType, ViewType, SortType } from '@/components/ControlsBar';
// Removed CDNImage import for performance - using Next.js Image instead
import { useAudio } from '@/contexts/AudioContext';
import { toast } from '@/components/Toast';
import dataService from '@/lib/data-service';
import BackButton from '@/components/BackButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';

interface PublisherDetailClientProps {
  publisherId: string;
  initialData?: {
    publisherInfo: any;
    publisherItems: any[];
    albums?: any[]; // Combined albums for backwards compatibility
    officialAlbums?: any[]; // GUID-matched albums (Official Releases)
    artistMatchedAlbums?: any[]; // Artist-only albums (More from Artist)
    feedId: string;
  } | null;
}


export default function PublisherDetailClient({ publisherId, initialData }: PublisherDetailClientProps) {
  console.log('🎯 PublisherDetailClient component loaded with publisherId:', publisherId);
  console.log('🎯 Initial data received:', initialData);
  
  const [isLoading, setIsLoading] = useState(!initialData);

  // Helper to transform server albums to RSSAlbum format
  const transformServerAlbums = (serverAlbums: any[]): RSSAlbum[] => {
    return serverAlbums.map((album: any) => ({
      id: album.id,
      feedId: album.id,
      title: album.title,
      artist: album.artist,
      description: album.description,
      coverArt: album.coverArt,
      releaseDate: album.releaseDate || new Date().toISOString(),
      tracks: album.tracks && album.tracks.length > 0
        ? album.tracks.map((track: any) => {
            const formatDuration = (dur: string | number | null | undefined): string => {
              if (!dur) return '0:00';
              if (typeof dur === 'number') {
                const mins = Math.floor(dur / 60);
                const secs = Math.floor(dur % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              }
              if (typeof dur === 'string' && dur.includes(':')) {
                return dur;
              }
              const num = parseFloat(String(dur));
              if (!isNaN(num)) {
                const mins = Math.floor(num / 60);
                const secs = Math.floor(num % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              }
              return '0:00';
            };
            return {
              id: track.id,
              title: track.title,
              duration: formatDuration(track.duration),
              url: track.url || track.audioUrl || '',
              trackNumber: track.trackNumber || track.trackOrder || 0
            };
          })
        : Array(album.trackCount || 0).fill(null).map((_, i) => ({
            id: `track-${i}-${album.id}`,
            title: `${album.title} - Track ${i + 1}`,
            duration: '0:00',
            url: album.feedUrl || ''
          })),
      link: album.feedUrl || '',
      feedUrl: album.feedUrl || ''
    }));
  };

  // Official albums (GUID-matched from publisher feed)
  const [officialAlbums, setOfficialAlbums] = useState<RSSAlbum[]>(() => {
    if (initialData?.officialAlbums && initialData.officialAlbums.length > 0) {
      console.log('🎯 Using official albums from server:', initialData.officialAlbums.length);
      return transformServerAlbums(initialData.officialAlbums);
    }
    return [];
  });

  // Artist-matched albums (additional albums not linked via GUID)
  const [artistMatchedAlbums, setArtistMatchedAlbums] = useState<RSSAlbum[]>(() => {
    if (initialData?.artistMatchedAlbums && initialData.artistMatchedAlbums.length > 0) {
      console.log('🎯 Using artist-matched albums from server:', initialData.artistMatchedAlbums.length);
      return transformServerAlbums(initialData.artistMatchedAlbums);
    }
    return [];
  });

  // Combined albums for backwards compatibility
  const [albums, setAlbums] = useState<RSSAlbum[]>(() => {
    // First priority: use pre-fetched albums from server if available
    if (initialData?.albums && initialData.albums.length > 0) {
      console.log('🎯 Using pre-fetched albums from server:', initialData.albums.length);
      return transformServerAlbums(initialData.albums);
    }

    // Fallback: Initialize albums from publisher items if available
    if (initialData?.publisherItems && initialData.publisherItems.length > 0) {
      const validItems = initialData.publisherItems.filter((item: any) =>
        item.title && item.title.trim() !== ''
      );
      return validItems.map((item: any) => ({
        id: item.id || item.feedGuid || `album-${Math.random()}`,
        feedId: item.id || item.feedGuid || `album-${Math.random()}`,
        title: item.title,
        artist: item.artist,
        description: item.description,
        coverArt: item.coverArt || item.image,
        tracks: Array(item.trackCount || 0).fill(null).map((_, i) => ({
          id: `track-${i}`,
          title: `${item.title} - Track ${i + 1}`,
          duration: '0:00',
          url: item.feedUrl || item.link
        })),
        releaseDate: item.releaseDate || new Date().toISOString(),
        link: item.feedUrl || item.link,
        feedUrl: item.feedUrl || item.link
      }));
    }
    return [];
  });
  const [publisherItems, setPublisherItems] = useState<RSSPublisherItem[]>(initialData?.publisherItems || []);
  const [error, setError] = useState<string | null>(null);
  const [publisherInfo, setPublisherInfo] = useState<{ title?: string; description?: string; artist?: string; coverArt?: string; avatarArt?: string; publisherFeedImage?: string } | null>(
    initialData?.publisherInfo ? {
      title: initialData.publisherInfo.name || initialData.publisherInfo.title,
      description: initialData.publisherInfo.description,
      artist: initialData.publisherInfo.name,
      coverArt: initialData.publisherInfo.publisherFeedImage || initialData.publisherInfo.image, // Use publisher feed image for background
      avatarArt: initialData.publisherInfo.newestAlbumImage || initialData.publisherInfo.image, // Use newest album for hero
      publisherFeedImage: initialData.publisherInfo.publisherFeedImage || initialData.publisherInfo.image
    } : null
  );
  const [backgroundImageLoaded, setBackgroundImageLoaded] = useState(false);
  const [backgroundImageError, setBackgroundImageError] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [sortType, setSortType] = useState<SortType>('year'); // Default to newest first
  
  // Global audio context for shuffle functionality
  const { shuffleAllTracks } = useAudio();
  
  // Shuffle functionality for publisher albums
  const handleShuffle = async () => {
    try {
      console.log('🎲 Shuffle button clicked - starting shuffle for publisher albums');
      await shuffleAllTracks();
    } catch (error) {
      console.error('Error starting shuffle:', error);
    }
  };

  // Simplified album fetching using data service
  const fetchPublisherAlbums = async () => {
    console.log('🚀 fetchPublisherAlbums function called!');
    console.log('🚀 This should appear in the browser console!');

    if (!publisherInfo?.artist && !publisherId) {
      console.log('⚠️ No artist name or publisherId available');
      setAlbumsLoading(false);
      return;
    }

    try {
      console.log(`🔍 Fetching albums for publisher: ${publisherId}`);

      // Use the new publisher parameter to filter albums directly on the server
      // Use a high limit to get all albums (most publishers have < 100 albums)
      const response = await fetch(`/api/albums?publisher=${encodeURIComponent(publisherId)}&limit=100`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log(`📋 Total albums fetched for publisher "${publisherId}":`, data.albums.length);

      console.log(`🎵 Found ${data.albums.length} albums for publisher "${publisherId}":`, data.albums);
      setAlbums(data.albums);

    } catch (error) {
      console.error('❌ Error fetching publisher albums:', error);
      setError('Failed to load publisher albums');
    } finally {
      setAlbumsLoading(false);
    }
  };

  useEffect(() => {
    console.log('🎯 PublisherDetailClient useEffect triggered');
    console.log('🎯 This should appear in the browser console!');
    console.log('📋 initialData:', initialData);
    console.log('📋 Current albums.length:', albums.length);
    console.log('📋 Current albumsLoading:', albumsLoading);

    // Prevent infinite loops by checking if we already have albums loaded
    if (albums.length > 0 && !albumsLoading) {
      console.log('🎯 Already have albums, skipping useEffect');
      return;
    }

    // Also prevent execution if we're already loading albums
    if (albumsLoading) {
      console.log('🎯 Already loading albums, skipping useEffect');
      return;
    }
    
    // If we have initial data, use it
    if (initialData) {
      console.log('📋 Using initial data for publisher');
      console.log('📋 Server-provided albums count:', initialData.albums?.length);
      console.log('📋 Publisher items count:', initialData.publisherItems?.length);
      console.log('📋 Publisher info:', initialData.publisherInfo);
      
      // Set publisher info from initial data if available (update even if already set)
      if (initialData.publisherInfo) {
        console.log('📋 Setting publisher info from initial data:', initialData.publisherInfo);
        setPublisherInfo({
          title: initialData.publisherInfo.name || initialData.publisherInfo.title || publisherId,
          description: initialData.publisherInfo.description || '',
          artist: initialData.publisherInfo.name || initialData.publisherInfo.artist || publisherId,
          coverArt: initialData.publisherInfo.publisherFeedImage || initialData.publisherInfo.image, // Publisher feed image for background
          avatarArt: initialData.publisherInfo.newestAlbumImage || initialData.publisherInfo.image, // Newest album for hero
          publisherFeedImage: initialData.publisherInfo.publisherFeedImage || initialData.publisherInfo.image
        });
        setIsLoading(false);
      }
      
      // PRIORITY 1: Use albums from server-side (already fetched and optimized)
      if (initialData.albums && initialData.albums.length > 0) {
        console.log(`✅ Using ${initialData.albums.length} albums from server-side data`);
        // Convert server albums to RSSAlbum format
        // Use actual tracks if provided, otherwise create placeholders
        const formattedAlbums = initialData.albums.map((album: any) => ({
          id: album.id,
          title: album.title,
          artist: album.artist,
          description: album.description,
          coverArt: album.coverArt,
          releaseDate: album.releaseDate || new Date().toISOString(),
          tracks: album.tracks && album.tracks.length > 0
            ? album.tracks.map((track: any) => ({
                id: track.id,
                title: track.title,
                duration: track.duration || '0:00',
                url: track.url || track.audioUrl || '',
                trackNumber: track.trackNumber || track.trackOrder || 0
              }))
            : Array(album.trackCount || 0).fill(null).map((_, i) => ({
                id: `track-${i}-${album.id}`,
                title: `${album.title} - Track ${i + 1}`,
                duration: '0:00',
                url: album.feedUrl || ''
              })),
          link: album.feedUrl || '',
          feedUrl: album.feedUrl || ''
        }));
        setAlbums(formattedAlbums);
        setIsLoading(false);
        return;
      }
      
      // PRIORITY 2: Convert publisher items to album format for display
      if (initialData.publisherItems && initialData.publisherItems.length > 0) {
          // Check if these are remoteItems (which only have feedGuid/feedUrl) or regular publisherItems
          console.log('🔍 Checking remoteItems condition for each item:');
          initialData.publisherItems.forEach((item, index) => {
            console.log(`  Item ${index}: feedGuid=${!!item.feedGuid}, feedUrl=${!!item.feedUrl}, !title=${!item.title}, title="${item.title}"`);
          });
          
          const isRemoteItems = initialData.publisherItems.every((item: any) => {
            const condition = item.feedGuid && item.feedUrl && !item.title;
            console.log(`  Checking item: feedGuid=${!!item.feedGuid}, feedUrl=${!!item.feedUrl}, !title=${!item.title}, condition=${condition}`);
            return condition;
          });
          
          console.log('🔍 Checking if items are remoteItems:', isRemoteItems);
          console.log('📋 Sample item:', initialData.publisherItems[0]);
          
          if (isRemoteItems) {
            // If remoteItems but we have server albums, use those instead
            if (initialData.albums && initialData.albums.length > 0) {
              console.log(`✅ Using ${initialData.albums.length} server-provided albums for remoteItems`);
              const formattedAlbums = initialData.albums.map((album: any) => ({
                id: album.id,
                title: album.title,
                artist: album.artist,
                description: album.description,
                coverArt: album.coverArt,
                releaseDate: album.releaseDate || new Date().toISOString(),
                tracks: Array(album.trackCount || 0).fill(null).map((_, i) => ({
                  id: `track-${i}-${album.id}`,
                  title: `${album.title} - Track ${i + 1}`,
                  duration: '0:00',
                  url: album.feedUrl || ''
                })),
                link: album.feedUrl || '',
                feedUrl: album.feedUrl || ''
              }));
              setAlbums(formattedAlbums);
              setIsLoading(false);
              return;
            }
            
            console.log('📋 Detected remoteItems - need to fetch actual album data');
            // For remoteItems, we need to fetch the actual album data using the feedGuids
            setAlbumsLoading(true);
            console.log('🎯 About to call fetchPublisherAlbums()');
            fetchPublisherAlbums();
          } else {
            // Filter out items with empty or missing titles, as they won't render properly
            const validItems = initialData.publisherItems.filter((item: any) =>
              item.title && item.title.trim() !== ''
            );

            // Check if any items have zero tracks - these need to be fetched from the main albums API
            const itemsHaveTracks = validItems.some((item: any) => (item.trackCount || 0) > 0);

            if (validItems.length > 0 && itemsHaveTracks) {
              console.log(`🏢 Processing ${validItems.length} valid items with tracks:`, validItems);
              const albumsFromItems = validItems.map((item: any) => ({
                id: item.id || item.feedGuid || `album-${Math.random()}`,
                feedId: item.id || item.feedGuid || `album-${Math.random()}`, // Add feedId for favorite button
                title: item.title,
                artist: item.artist,
                description: item.description,
                coverArt: item.coverArt || item.image,
                tracks: Array(item.trackCount || 0).fill(null).map((_, i) => ({
                  id: `track-${i}`,
                  title: `${item.title} - Track ${i + 1}`,
                  duration: '0:00',
                  url: item.feedUrl || item.link
                })),
                releaseDate: item.releaseDate || new Date().toISOString(),
                link: item.feedUrl || item.link,
                feedUrl: item.feedUrl || item.link
              }));

              console.log(`🏢 Setting ${albumsFromItems.length} albums from initial data (filtered from ${initialData.publisherItems.length} items)`);
              console.log(`🏢 First album:`, albumsFromItems[0]);
              setAlbums(albumsFromItems);
              console.log(`🏢 Albums state should now be set to ${albumsFromItems.length} albums`);
            } else {
              // If no valid items but we have server albums, use those instead
              if (initialData.albums && initialData.albums.length > 0) {
                console.log(`✅ Using ${initialData.albums.length} server-provided albums instead of fetching`);
                const formattedAlbums = initialData.albums.map((album: any) => ({
                  id: album.id,
                  feedId: album.id, // Add feedId for favorite button
                  title: album.title,
                  artist: album.artist,
                  description: album.description,
                  coverArt: album.coverArt,
                  releaseDate: album.releaseDate || new Date().toISOString(),
                  tracks: Array(album.trackCount || 0).fill(null).map((_, i) => ({
                    id: `track-${i}-${album.id}`,
                    title: `${album.title} - Track ${i + 1}`,
                    duration: '0:00',
                    url: album.feedUrl || ''
                  })),
                  link: album.feedUrl || '',
                  feedUrl: album.feedUrl || ''
                }));
                setAlbums(formattedAlbums);
                setIsLoading(false);
                return;
              }
              
              console.log(`⚠️ No valid albums found or items have zero tracks - fetching from main albums API`);
              // For publishers with empty titles or zero tracks, we need to fetch the actual album data
              setAlbumsLoading(true);
              fetchPublisherAlbums();
            }
          }
        } else {
          // If no publisher items but we have server albums, don't fetch again
          if (initialData.albums && initialData.albums.length > 0) {
            console.log('✅ Using server-provided albums, no need to fetch');
            setIsLoading(false);
            return;
          }
          
          // Only fetch if we truly have no data
          console.log('⚠️ No publisher items found and no server albums - fetching from API');
          setAlbumsLoading(true);
          fetchPublisherAlbums();
        }
        
        // Set loading to false since we have data
        setIsLoading(false);
        return;
      }
    
    const loadPublisher = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        console.log(`🏢 Loading publisher: ${publisherId}`);
        
        // Try to find the feed URL for this publisher
        // First check known publishers, but if not found, try API lookup
        let publisherInfo = getPublisherInfo(publisherId);
        
        // If not in known publishers, try fetching from API
        if (!publisherInfo) {
          console.log(`🔍 Publisher "${publisherId}" not in known list, trying API lookup...`);
          try {
            const response = await fetch(`/api/publishers/${encodeURIComponent(publisherId)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.publisherInfo) {
                publisherInfo = {
                  feedGuid: data.publisherInfo.feedGuid || publisherId,
                  feedUrl: data.publisherInfo.feedUrl || '',
                  name: data.publisherInfo.name || data.publisherInfo.title || publisherId
                };
                console.log(`✅ Found publisher via API:`, publisherInfo);
              }
            }
          } catch (apiError) {
            console.error('❌ API lookup failed:', apiError);
          }
        }
        
        if (!publisherInfo) {
          console.error(`❌ Publisher not found: ${publisherId}`);
          setError(`Publisher "${publisherId}" not found. This publisher might not exist or has been removed from our catalog.`);
          return;
        }
        
        const feedUrl = publisherInfo.feedUrl;
        console.log(`🏢 Publisher info found:`, publisherInfo);
        console.log(`🏢 Loading publisher feed: ${feedUrl}`);
        
        // Set publisher info immediately using the known publisher data
        // Preserve existing coverArt/avatarArt from initialData if available
        setPublisherInfo(prev => ({
          title: publisherInfo.name || prev?.title || `Artist: ${publisherId}`,
          description: prev?.description || 'Independent artist and music creator',
          artist: publisherInfo.name || prev?.artist,
          coverArt: prev?.coverArt, // Preserve existing image from initialData
          avatarArt: prev?.avatarArt, // Preserve existing image from initialData
          publisherFeedImage: prev?.publisherFeedImage
        }));
        
        // Stop loading immediately since we have publisher info
        setIsLoading(false);

        // Load publisher feed data to get the publisher's own image and items
        console.log(`🏢 Loading publisher feed data...`);
        
        try {
          // Load parsed feeds data directly to get publisher feed information
          const parsedFeedsResponse = await fetch('/api/parsed-feeds');
          
          if (parsedFeedsResponse.ok) {
            const parsedFeedsData = await parsedFeedsResponse.json();
            const feeds = parsedFeedsData.feeds || [];
            
            // Find the publisher feed for this publisher
            const publisherFeed = feeds.find((feed: any) => {
              if (feed.type === 'publisher') {
                // Check if this feed matches our publisher
                if (feed.originalUrl === feedUrl) return true;
                if (feed.id && typeof feed.id === 'string' && feed.id.includes(publisherId)) return true;
                if (feed.parsedData?.publisherInfo?.artist === publisherInfo.name) return true;
                return false;
              }
              return false;
            });
            
            console.log(`🏢 Found publisher feed:`, publisherFeed);
            
            // Extract publisher info from the feed data
            if (publisherFeed?.parsedData?.publisherInfo) {
              const feedInfo = publisherFeed.parsedData.publisherInfo;
              console.log(`🏢 Publisher feed info:`, feedInfo);
              
              // Find the last remote item's artwork for avatar
              let lastItemAvatarArt = null;
              if (feedInfo.remoteItems && feedInfo.remoteItems.length > 0) {
                const lastItem = feedInfo.remoteItems[feedInfo.remoteItems.length - 1]; // Last item
                console.log(`🎨 Last remote item:`, lastItem);
                
                // Find the corresponding album in our parsed data
                console.log(`🔍 Looking for feed with URL: "${lastItem.feedUrl}" or GUID: "${lastItem.feedGuid}"`);
                console.log(`🔍 Available feeds:`, feeds.map((f: any) => ({ id: f.id, url: f.originalUrl, guid: f.parsedData?.album?.feedGuid })));
                
                const matchingFeed = feeds.find((feed: any) => {
                  const urlMatch = feed.originalUrl === lastItem.feedUrl;
                  const guidMatch = feed.parsedData?.album?.feedGuid === lastItem.feedGuid;
                  console.log(`🔍 Checking feed ${feed.id}: urlMatch=${urlMatch} (${feed.originalUrl} vs ${lastItem.feedUrl}), guidMatch=${guidMatch} (${feed.parsedData?.album?.feedGuid} vs ${lastItem.feedGuid})`);
                  return urlMatch || guidMatch;
                });
                
                if (matchingFeed?.parsedData?.album?.coverArt) {
                  lastItemAvatarArt = matchingFeed.parsedData.album.coverArt;
                  console.log(`🎨 Found last item artwork:`, lastItemAvatarArt);
                }
              }
              
              setPublisherInfo(prev => ({
                title: feedInfo.artist || feedInfo.title || publisherInfo.name || prev?.title || `Artist: ${publisherId}`,
                description: feedInfo.description || prev?.description || 'Independent artist and music creator',
                artist: feedInfo.artist || publisherInfo.name || prev?.artist,
                coverArt: feedInfo.coverArt || prev?.coverArt, // Prefer parsed feed image, fallback to existing
                avatarArt: lastItemAvatarArt || feedInfo.coverArt || prev?.avatarArt, // Use last item's art for avatar, fallback to publisher art
                publisherFeedImage: feedInfo.coverArt || prev?.publisherFeedImage
              }));
            }
            
            // Extract publisher items from the feed data
            if (publisherFeed?.parsedData?.publisherItems || publisherFeed?.parsedData?.remoteItems) {
              const items = publisherFeed.parsedData.publisherItems || publisherFeed.parsedData.remoteItems;
              console.log(`🏢 Found ${items.length} publisher items`);
              
              // For remoteItems, we need to find the actual album data using feedGuid
              if (publisherFeed.parsedData.remoteItems) {
                console.log(`🏢 Processing remoteItems to find actual album data`);
                
                // Find all feeds that match the remoteItems feedGuids
                const matchingFeeds = feeds.filter((feed: any) => {
                  if (feed.type !== 'album' || feed.parseStatus !== 'success') return false;
                  
                  return items.some((remoteItem: any) => {
                    const urlMatch = feed.originalUrl === remoteItem.feedUrl;
                    const guidMatch = feed.parsedData?.album?.feedGuid === remoteItem.feedGuid;
                    return urlMatch || guidMatch;
                  });
                });
                
                console.log(`🏢 Found ${matchingFeeds.length} matching album feeds for remoteItems`);
                
                // Convert matching feeds to album format
                const albumsFromFeeds = matchingFeeds.map((feed: any) => {
                  const albumData = feed.parsedData.album;
                  return {
                    id: feed.id,
                    feedId: feed.id, // Add feedId for favorite button
                    title: albumData.title || feed.title || 'Unknown Album',
                    artist: albumData.artist || publisherInfo.name || 'Unknown Artist',
                    description: albumData.description || albumData.summary || 'Album from publisher',
                    coverArt: albumData.coverArt,
                    tracks: albumData.tracks || [],
                    releaseDate: albumData.releaseDate || albumData.pubDate || new Date().toISOString(),
                    link: albumData.link || feed.originalUrl,
                    feedUrl: feed.originalUrl,
                    explicit: albumData.explicit || false
                  };
                });
                
                console.log(`🏢 Setting ${albumsFromFeeds.length} albums from matching feeds`);
                setAlbums(albumsFromFeeds);
                setPublisherItems(items);
              } else {
                // For regular publisherItems, convert directly to album format
                const albumsFromItems = items.map((item: any) => ({
                  id: item.id || `album-${Math.random()}`,
                  feedId: item.id || `album-${Math.random()}`, // Add feedId for favorite button
                  title: item.title || item.feedUrl?.split('/').pop()?.replace('.xml', '') || 'Unknown Album',
                  artist: item.artist || publisherInfo.name || 'Unknown Artist',
                  description: item.description || 'Album from publisher',
                  coverArt: item.coverArt,
                  tracks: Array(item.trackCount || 1).fill(null).map((_, i) => ({
                    id: `track-${i}`,
                    title: `${item.title || 'Track'} - Track ${i + 1}`,
                    duration: '0:00',
                    url: item.link || item.feedUrl
                  })),
                  releaseDate: item.releaseDate || new Date().toISOString(),
                  link: item.link || item.feedUrl,
                  feedUrl: item.link || item.feedUrl
                }));
                
                console.log(`🏢 Setting ${albumsFromItems.length} albums from publisher items`);
                setAlbums(albumsFromItems);
                setPublisherItems(items);
              }
            }
          }
        } catch (feedError) {
          console.error(`❌ Error loading publisher feed data:`, feedError);
          // Continue with album-based fallback
        }

        // Load pre-parsed album data to get publisher info as fallback
        console.log(`🏢 Loading publisher info from pre-parsed data...`);
        
        // Load pre-parsed album data to get publisher info
        const response = await fetch('/api/albums');
        
        if (!response.ok) {
          throw new Error(`Failed to fetch albums: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        const allAlbums = data.albums || [];
        
        // Find albums from this publisher
        const publisherAlbums = allAlbums.filter((album: any) => {
          if (!album.publisher) return false;

          // Check if this album belongs to the publisher
          if (album.publisher.feedUrl === feedUrl) return true;
          if (album.publisher.feedGuid && typeof album.publisher.feedGuid === 'string' && album.publisher.feedGuid.includes(publisherId)) return true;

          // Special case: doerfels-publisher-direct should match albums with feedGuid 'the-doerfels'
          if (publisherId === 'doerfels-publisher-direct' && album.publisher.feedGuid === 'the-doerfels') return true;

          return false;
        });
        
        console.log(`🏢 Found ${publisherAlbums.length} albums for publisher`);
        
        // If we don't have publisher feed info, extract from albums as fallback
        if (publisherAlbums.length > 0) {
          // Sort albums by date (newest first) to get the most recent release
          const sortedAlbums = [...publisherAlbums].sort((a, b) => {
            const dateA = new Date(a.pubDate || a.date || 0);
            const dateB = new Date(b.pubDate || b.date || 0);
            return dateB.getTime() - dateA.getTime(); // Newest first
          });
          
          const newestAlbum = sortedAlbums[0];
          const albumPublisherInfo = {
            title: newestAlbum.publisher?.title || newestAlbum.artist,
            artist: newestAlbum.artist,
            description: newestAlbum.publisher?.description || 'Independent artist and music creator',
            coverArt: newestAlbum.publisher?.coverArt || newestAlbum.coverArt
          };
          
          console.log(`🏢 Album-based publisher info:`, albumPublisherInfo);
          
          // Update with album-based info as fallback
          setPublisherInfo(prev => ({
            ...prev,
            title: albumPublisherInfo.artist || albumPublisherInfo.title || prev?.title,
            description: albumPublisherInfo.description || prev?.description,
            artist: albumPublisherInfo.artist || prev?.artist,
            coverArt: prev?.coverArt || albumPublisherInfo.coverArt, // Keep existing coverArt if we have it from publisher feed
            avatarArt: prev?.avatarArt || prev?.coverArt || albumPublisherInfo.coverArt // Keep existing avatarArt, fallback to coverArt
          }));
          
          // Always update albums with the publisher album data we found
          console.log(`🏢 Setting ${publisherAlbums.length} publisher albums from album data`);
          setAlbums(publisherAlbums);
        }
        
        // Stop loading state early so page shows content
        setIsLoading(false);
        
        // Load publisher items and albums in background
        setAlbumsLoading(true);
        
        try {
          // For publisher items, we can use the albums data
          if (!publisherItems.length) {
            setPublisherItems(publisherAlbums.map((album: any) => ({
              title: album.title,
              description: album.description || album.summary,
              url: album.link,
              image: album.coverArt
            })));
          }
          
        } catch (albumError) {
          console.error(`❌ Error loading publisher albums:`, albumError);
          // Don't set error here - we still have publisher info
        } finally {
          setAlbumsLoading(false);
        }
        
      } catch (error) {
        console.error(`❌ Error loading publisher:`, error);
        setError(error instanceof Error ? error.message : 'Failed to load publisher');
        setIsLoading(false);
        setAlbumsLoading(false);
      }
    };

    loadPublisher();
    
  }, [publisherId]); // Remove initialData from dependencies to prevent infinite loops

  // Sort albums: Pin "Stay Awhile" first, then "Bloodshot Lies", then by artist/title
  const sortAlbums = (albums: RSSAlbum[]) => {
    return albums.sort((a, b) => {
      // Check if either album is "Stay Awhile" (case-insensitive)
      const aIsStayAwhile = a.title && typeof a.title === 'string' && a.title.toLowerCase().includes('stay awhile');
      const bIsStayAwhile = b.title && typeof b.title === 'string' && b.title.toLowerCase().includes('stay awhile');
      
      if (aIsStayAwhile && !bIsStayAwhile) return -1; // a comes first
      if (!aIsStayAwhile && bIsStayAwhile) return 1; // b comes first
      
      // Check if either album is "Bloodshot Lies" (case-insensitive)
      const aIsBloodshot = a.title && typeof a.title === 'string' && a.title.toLowerCase().includes('bloodshot lie');
      const bIsBloodshot = b.title && typeof b.title === 'string' && b.title.toLowerCase().includes('bloodshot lie');
      
      if (aIsBloodshot && !bIsBloodshot) return -1; // a comes first
      if (!aIsBloodshot && bIsBloodshot) return 1; // b comes first
      
      // For all other albums, sort by artist then title
      const artistCompare = a.artist.toLowerCase().localeCompare(b.artist.toLowerCase());
      if (artistCompare !== 0) return artistCompare;
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
  };

  // Sort EPs and Singles
  const sortEpsAndSingles = (albums: RSSAlbum[]) => {
    return albums.sort((a, b) => {
      // First sort by type: EPs (2-6 tracks) before Singles (1 track)
      const aIsSingle = (a.tracks?.length || 0) === 1;
      const bIsSingle = (b.tracks?.length || 0) === 1;
      
      if (aIsSingle && !bIsSingle) return 1; // b (EP) comes first
      if (!aIsSingle && bIsSingle) return -1; // a (EP) comes first
      
      // Then sort by artist
      const artistCompare = a.artist.toLowerCase().localeCompare(b.artist.toLowerCase());
      if (artistCompare !== 0) return artistCompare;
      
      // Finally sort by title
      return a.title.toLowerCase().localeCompare(b.title.toLowerCase());
    });
  };

  // Sort all albums by release date (newest first) BEFORE separating by type
  const albumsSortedByDate = [...albums].sort((a, b) => {
    const dateA = new Date(a.releaseDate || 0);
    const dateB = new Date(b.releaseDate || 0);
    return dateB.getTime() - dateA.getTime(); // Newest first
  });

  // Separate albums from EPs/singles (6 tracks or less) - maintaining date sort
  const albumsWithMultipleTracks = albumsSortedByDate.filter(album => (album.tracks?.length || 0) > 6);
  const epsAndSingles = albumsSortedByDate.filter(album => (album.tracks?.length || 0) <= 6);

  if (isLoading && !publisherInfo?.title && !publisherInfo?.artist) {
    return (
      <div className="min-h-screen text-white relative">
        {/* Fallback background - use artist image or gradient */}
        {publisherInfo?.coverArt ? (
          <div className="fixed inset-0 z-0">
            <Image 
              src={getAlbumArtworkUrl(publisherInfo.coverArt, 'large')} 
              alt={publisherInfo.title || 'Artist background'}
              width={1920}
              height={1080}
              className="w-full h-full object-cover"
              priority
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = getPlaceholderImageUrl('large');
              }}
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-black/70"></div>
          </div>
        ) : (
          /* Fallback gradient background */
          <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-0" />
        )}
        
        {/* Content */}
        <div className="relative z-10 container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-400">
              Loading publisher...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen text-white relative">
        {/* Fallback background - use artist image or gradient */}
        {publisherInfo?.coverArt ? (
          <div className="fixed inset-0 z-0">
            <Image 
              src={getAlbumArtworkUrl(publisherInfo.coverArt, 'large')} 
              alt={publisherInfo.title || 'Artist background'}
              width={1920}
              height={1080}
              className="w-full h-full object-cover"
              priority
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = getPlaceholderImageUrl('large');
              }}
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-black/70"></div>
          </div>
        ) : (
          /* Fallback gradient background */
          <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 z-0" />
        )}
        
        {/* Content */}
        <div className="relative z-10 container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <Music className="w-16 h-16 text-gray-400 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold mb-4">Publisher Not Found</h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/" className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                ← Back to Home
              </Link>
              <Link href="/search" className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors">
                🔍 Search Music
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Helper function to parse duration from string (MM:SS) or number (seconds)
  const parseDurationToSeconds = (duration: string | number | null | undefined): number => {
    if (!duration) return 0;
    
    // If it's already a number, return it
    if (typeof duration === 'number') {
      return Math.floor(duration);
    }
    
    // If it's a string, try to parse it
    if (typeof duration === 'string') {
      // Handle MM:SS or HH:MM:SS format
      if (duration.includes(':')) {
        const parts = duration.split(':').map(Number);
        if (parts.length === 2) {
          // MM:SS format
          return (parts[0] || 0) * 60 + (parts[1] || 0);
        } else if (parts.length === 3) {
          // HH:MM:SS format
          return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
        }
      }
      // Try parsing as a number string
      const num = parseFloat(duration);
      if (!isNaN(num)) {
        return Math.floor(num);
      }
    }
    
    return 0;
  };

  // Calculate statistics
  const totalTracks = albums.reduce((sum, album) => sum + (album.tracks?.length || 0), 0);
  const totalDuration = albums.reduce((sum, album) => {
    return sum + (album.tracks || []).reduce((trackSum, track) => {
      return trackSum + parseDurationToSeconds(track.duration);
    }, 0);
  }, 0);
  const avgYear = albums.length > 0 ? Math.floor(albums.reduce((sum, album) => sum + new Date(album.releaseDate).getFullYear(), 0) / albums.length) : 0;

  // Format duration helper
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  // Filter albums (they're already sorted by date)
  const getFilteredAlbums = () => {
    let filtered = albums;

    switch (activeFilter) {
      case 'albums':
        filtered = albumsWithMultipleTracks;
        break;
      case 'eps':
        filtered = epsAndSingles.filter(album => (album.tracks?.length || 0) > 1);
        break;
      case 'singles':
        filtered = epsAndSingles.filter(album => (album.tracks?.length || 0) === 1);
        break;
      default: // 'all'
        // For "All", show all albums in date order (already sorted)
        filtered = albumsSortedByDate;
    }

    // Apply additional sorting if user changes sort type
    if (sortType === 'name') {
      return [...filtered].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
    } else if (sortType === 'tracks') {
      return [...filtered].sort((a, b) => (b.tracks?.length || 0) - (a.tracks?.length || 0));
    }

    // Default is 'year' - already sorted by date, just return filtered
    return filtered;
  };

  const filteredAlbums = getFilteredAlbums();

  // Create ID sets for separating official vs artist-matched albums
  const officialAlbumIds = new Set(officialAlbums.map(a => a.id));
  const artistMatchedAlbumIds = new Set(artistMatchedAlbums.map(a => a.id));

  // Split filtered albums into official and artist-matched
  const filteredOfficialAlbums = filteredAlbums.filter(a => officialAlbumIds.has(a.id));
  const filteredArtistMatchedAlbums = filteredAlbums.filter(a => artistMatchedAlbumIds.has(a.id));

  // Helper to render album grid
  const renderAlbumGrid = (albumsToRender: RSSAlbum[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
      {albumsToRender.map((album, index) => (
        <Link
          key={`${album.title}-${index}`}
          href={generateAlbumUrl(album.title)}
          className="group bg-white/5 backdrop-blur-sm rounded-xl overflow-hidden hover:bg-white/10 transition-all duration-300 border border-white/10 hover:border-white/20 shadow-lg hover:shadow-xl hover:scale-105"
        >
          <div className="relative aspect-square">
            {album.coverArt ? (
              <Image
                src={getAlbumArtworkUrl(album.coverArt, 'medium')}
                alt={album.title}
                width={300}
                height={300}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = getPlaceholderImageUrl('medium');
                }}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                <Music className="w-12 h-12 text-white/80" />
              </div>
            )}

            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300 flex items-center justify-center">
              <div className="bg-white/90 hover:bg-white text-black rounded-full p-3 transform scale-0 group-hover:scale-100 transition-all duration-200 shadow-xl">
                <Play className="w-6 h-6" />
              </div>
            </div>

            <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full">
              {album.tracks?.length || 0} tracks
            </div>

            {(album.id || album.feedId) && (
              <div
                className="absolute bottom-3 right-3 z-20"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              >
                <div className="bg-black/60 backdrop-blur-sm rounded-full w-8 h-8 flex items-center justify-center pointer-events-auto touch-manipulation hover:bg-black/80 transition-colors">
                  <FavoriteButton feedId={album.feedId || album.id} size={18} className="text-white" />
                </div>
              </div>
            )}
          </div>

          <div className="p-4">
            <h3 className="font-bold text-lg mb-1 group-hover:text-blue-400 transition-colors line-clamp-1">
              {album.title}
            </h3>
            <p className="text-gray-400 text-sm mb-3 line-clamp-1">{album.artist}</p>

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{new Date(album.releaseDate).getFullYear()}</span>
              <div className="flex items-center gap-2">
                {album.explicit && (
                  <span className="bg-red-500 text-white px-1.5 py-0.5 rounded text-xs font-bold">E</span>
                )}
                <span className="bg-white/10 px-2 py-0.5 rounded">
                  {album.tracks.length <= 6 ? (album.tracks.length === 1 ? 'Single' : 'EP') : 'Album'}
                </span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );

  // Helper to render album list
  const renderAlbumList = (albumsToRender: RSSAlbum[]) => (
    <div className="space-y-2">
      {albumsToRender.map((album, index) => (
        <Link
          key={`${album.title}-${index}`}
          href={generateAlbumUrl(album.title)}
          className="group flex items-center gap-4 p-4 bg-white/5 backdrop-blur-sm rounded-xl hover:bg-white/10 transition-all duration-200 border border-white/10 hover:border-white/20"
        >
          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
            {album.coverArt ? (
              <Image
                src={getAlbumArtworkUrl(album.coverArt, 'thumbnail')}
                alt={album.title}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = getPlaceholderImageUrl('thumbnail');
                }}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center">
                <Music className="w-6 h-6 text-white/80" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg group-hover:text-blue-400 transition-colors truncate">
              {album.title}
            </h3>
            <p className="text-gray-400 text-sm truncate">{album.artist}</p>
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-400">
            <span>{new Date(album.releaseDate).getFullYear()}</span>
            <span>{album.tracks.length} tracks</span>
            <span className="px-2 py-1 bg-white/10 rounded text-xs">
              {album.tracks.length <= 6 ? (album.tracks.length === 1 ? 'Single' : 'EP') : 'Album'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {(album.id || album.feedId) && (
              <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <FavoriteButton feedId={album.feedId || album.id} size={18} className="text-white" />
              </div>
            )}
            <Play className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
          </div>
        </Link>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen text-white relative">
      {/* Enhanced Background */}
      {(publisherInfo?.coverArt || publisherInfo?.avatarArt) && !backgroundImageError ? (
        <div className="fixed inset-0 z-0">
          <Image
            src={getAlbumArtworkUrl(publisherInfo.coverArt || publisherInfo.avatarArt || '', 'large', true)}
            alt={publisherInfo.title || "Publisher background"}
            width={1920}
            height={1080}
            className={`w-full h-full object-cover transition-opacity duration-500 ${
              backgroundImageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            priority
            onLoad={() => {
              setBackgroundImageLoaded(true);
              setBackgroundImageError(false);
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              if (!backgroundImageError) {
                // Try fallback to newest album image if publisher feed image fails
                if (publisherInfo.coverArt && publisherInfo.avatarArt && publisherInfo.coverArt !== publisherInfo.avatarArt) {
                  target.src = getAlbumArtworkUrl(publisherInfo.avatarArt, 'large', true);
                  return;
                }
                setBackgroundImageError(true);
                setBackgroundImageLoaded(true);
              }
            }}
            placeholder="empty"
          />
          {/* Gradient overlay for better readability */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/70 to-black/90"></div>
        </div>
      ) : (
        <div className="fixed inset-0 bg-gradient-to-br from-purple-900 via-gray-900 to-black z-0" />
      )}
      
      {/* Content */}
      <div className="relative z-10">
        {/* Navigation */}
        <div className="container mx-auto px-4 pt-8">
          <div className="mb-6">
            <BackButton label="Back" />
          </div>
        </div>

        {/* Hero Section */}
        <div className="container mx-auto px-4 pb-8">
          <div className="flex flex-col lg:flex-row items-start lg:items-end gap-8 mb-12">
            {/* Artist Avatar - Use newest album's artwork */}
            <div className="flex-shrink-0">
              {albumsSortedByDate.length > 0 && albumsSortedByDate[0].coverArt ? (
                // Use newest album's artwork for avatar
                <div className="w-48 h-48 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/20">
                  <Image
                    src={getAlbumArtworkUrl(albumsSortedByDate[0].coverArt, 'xl')}
                    alt={albumsSortedByDate[0].title || "Latest Release"}
                    width={256}
                    height={256}
                    className="w-full h-full object-cover"
                    unoptimized
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = getPlaceholderImageUrl('large');
                    }}
                  />
                </div>
              ) : publisherInfo?.avatarArt ? (
                // Fallback to publisher avatar art
                <div className="w-48 h-48 rounded-2xl overflow-hidden shadow-2xl ring-4 ring-white/20">
                  <Image
                    src={getAlbumArtworkUrl(publisherInfo.avatarArt, 'xl')}
                    alt={publisherInfo.title || "Artist"}
                    width={256}
                    height={256}
                    className="w-full h-full object-cover"
                    unoptimized
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = getPlaceholderImageUrl('large');
                    }}
                  />
                </div>
              ) : (
                // Final fallback to gradient
                <div className="w-48 h-48 rounded-2xl bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-2xl ring-4 ring-white/20">
                  <Music className="w-20 h-20 text-white/80" />
                </div>
              )}
            </div>

            {/* Artist Information */}
            <div className="flex-1 lg:mb-4">
              <div className="flex items-center gap-3 mb-4">
                <span className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full text-sm font-medium">
                  <Music className="w-4 h-4 inline mr-1" />
                  Artist
                </span>
              </div>
              
              <h1 className="text-4xl lg:text-6xl font-black mb-4 tracking-tight">
                {publisherInfo?.title || publisherId}
              </h1>
              
              {publisherInfo?.description && (
                <p className="text-gray-300 text-lg mb-6 max-w-2xl leading-relaxed">
                  {publisherInfo.description.replace(/<[^>]*>/g, '')}
                </p>
              )}

              {/* Statistics */}
              <div className="flex flex-wrap gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <Disc className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold">{albums.length}</span>
                  <span className="text-gray-400">Releases</span>
                </div>
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-green-400" />
                  <span className="font-semibold">{totalTracks}</span>
                  <span className="text-gray-400">Tracks</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-400" />
                  <span className="font-semibold">{formatDuration(totalDuration)}</span>
                  <span className="text-gray-400">Total Duration</span>
                </div>
                {avgYear > 0 && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-orange-400" />
                    <span className="font-semibold">{avgYear}</span>
                    <span className="text-gray-400">Avg. Year</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div className="bg-black/20 backdrop-blur-sm min-h-screen">
          <div className="container mx-auto px-4 py-8 pb-28">
            {albumsLoading ? (
              <div className="text-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-6"></div>
                <p className="text-xl text-gray-400">Loading albums...</p>
              </div>
            ) : albums.length > 0 ? (
              <>
                {/* Controls Bar */}
                <ControlsBar
                  activeFilter={activeFilter}
                  onFilterChange={setActiveFilter}
                  filterOptions={[
                    { value: 'all', label: 'All' },
                    { value: 'albums', label: 'Albums' },
                    { value: 'eps', label: 'EPs' },
                    { value: 'singles', label: 'Singles' },
                  ]}
                  sortType={sortType}
                  onSortChange={setSortType}
                  showSort={true}
                  viewType={viewType}
                  onViewChange={setViewType}
                  showShuffle={true}
                  onShuffle={handleShuffle}
                  resultCount={filteredAlbums.length}
                  resultLabel={activeFilter === 'all' ? 'Releases' :
                    activeFilter === 'albums' ? 'Albums' :
                    activeFilter === 'eps' ? 'EPs' : 'Singles'}
                  className="mb-8"
                />

                {/* Official Releases Section */}
                {filteredOfficialAlbums.length > 0 && (
                  <div className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                      <Disc className="w-6 h-6 text-blue-400" />
                      Official Releases
                      <span className="text-sm font-normal text-gray-400 ml-2">
                        ({filteredOfficialAlbums.length})
                      </span>
                    </h2>
                    {viewType === 'grid' ? renderAlbumGrid(filteredOfficialAlbums) : renderAlbumList(filteredOfficialAlbums)}
                  </div>
                )}

                {/* More from Artist Section */}
                {filteredArtistMatchedAlbums.length > 0 && (
                  <div className="mb-12">
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                      <Music className="w-6 h-6 text-purple-400" />
                      More from {publisherInfo?.artist || publisherId}
                      <span className="text-sm font-normal text-gray-400 ml-2">
                        ({filteredArtistMatchedAlbums.length})
                      </span>
                    </h2>
                    {viewType === 'grid' ? renderAlbumGrid(filteredArtistMatchedAlbums) : renderAlbumList(filteredArtistMatchedAlbums)}
                  </div>
                )}

                {/* Fallback: Show all albums if no separation (backwards compatibility) */}
                {filteredOfficialAlbums.length === 0 && filteredArtistMatchedAlbums.length === 0 && filteredAlbums.length > 0 && (
                  <div>
                    {viewType === 'grid' ? renderAlbumGrid(filteredAlbums) : renderAlbumList(filteredAlbums)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20">
                <Music className="w-16 h-16 text-gray-400 mx-auto mb-6" />
                <h2 className="text-2xl font-semibold mb-4">No Albums Available</h2>
                <p className="text-gray-400 text-lg mb-4">
                  This artist&apos;s albums haven&apos;t been indexed yet.
                </p>
                {publisherInfo?.description && publisherInfo.description !== 'Independent artist and music creator' && (
                  <div className="max-w-md mx-auto bg-white/5 backdrop-blur-sm rounded-lg p-6 border border-white/10">
                    <p className="text-sm text-gray-300 mb-4">
                      <strong className="text-white">About:</strong> {publisherInfo.description.replace(/<[^>]*>/g, '')}
                    </p>
                    <p className="text-xs text-gray-400">
                      Albums from external music feeds will be added soon.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}