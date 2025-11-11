import { NextResponse } from 'next/server';
import { playlistCache } from '@/lib/playlist-cache';

const PLAYLIST_BASE_URL = 'https://raw.githubusercontent.com/ChadFarrow/chadf-musicl-playlists/refs/heads/main/docs';

interface PlaylistConfig {
  name: string;
  url: string;
  cacheId: string;
}

const PLAYLISTS: PlaylistConfig[] = [
  {
    name: 'HGH',
    url: `${PLAYLIST_BASE_URL}/HGH-music-playlist.xml`,
    cacheId: 'hgh-playlist'
  },
  {
    name: 'ITDV',
    url: `${PLAYLIST_BASE_URL}/ITDV-music-playlist.xml`,
    cacheId: 'itdv-playlist'
  },
  {
    name: 'IAM',
    url: `${PLAYLIST_BASE_URL}/IAM-music-playlist.xml`,
    cacheId: 'iam-playlist'
  },
  {
    name: 'MMM',
    url: `${PLAYLIST_BASE_URL}/MMM-music-playlist.xml`,
    cacheId: 'mmm-playlist'
  },
  {
    name: 'Upbeats',
    url: `${PLAYLIST_BASE_URL}/Upbeats-music-playlist.xml`,
    cacheId: 'upbeats-playlist'
  },
  {
    name: 'B4TS',
    url: `${PLAYLIST_BASE_URL}/b4ts-music-playlist.xml`,
    cacheId: 'b4ts-playlist'
  },
  {
    name: 'MMT',
    url: `${PLAYLIST_BASE_URL}/MMT-music-playlist.xml`,
    cacheId: 'mmt-playlist'
  },
  {
    name: 'SAS',
    url: `${PLAYLIST_BASE_URL}/SAS-music-playlist.xml`,
    cacheId: 'sas-playlist'
  }
];

function parseLastBuildDate(xmlText: string): Date | null {
  // Try to find lastBuildDate
  const lastBuildDateMatch = xmlText.match(/<lastBuildDate>(.*?)<\/lastBuildDate>/i);
  if (lastBuildDateMatch) {
    const dateStr = lastBuildDateMatch[1].trim();
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try to find pubDate
  const pubDateMatch = xmlText.match(/<pubDate>(.*?)<\/pubDate>/i);
  if (pubDateMatch) {
    const dateStr = pubDateMatch[1].trim();
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  return null;
}

export async function GET(request: Request) {
  try {
    console.log('🔍 Checking playlist freshness...');
    
    const results = [];
    
    for (const playlist of PLAYLISTS) {
      try {
        // Fetch the XML file
        const response = await fetch(playlist.url, {
          headers: {
            'User-Agent': 'StableKraft-Playlist-Checker/1.0'
          }
        });
        
        if (!response.ok) {
          results.push({
            playlist: playlist.name,
            cacheId: playlist.cacheId,
            needsRefresh: false,
            error: `Failed to fetch XML: ${response.status}`
          });
          continue;
        }
        
        const xmlText = await response.text();
        const xmlDate = parseLastBuildDate(xmlText);
        
        // Get cache metadata
        const cacheStats = playlistCache.getCacheStats();
        const cacheMeta = cacheStats.find(stat => stat.playlistId === playlist.cacheId);
        
        let needsRefresh = false;
        let reason = '';
        
        if (!cacheMeta) {
          // No cache exists, needs refresh
          needsRefresh = true;
          reason = 'No cache exists';
        } else if (xmlDate) {
          // Compare dates
          const cacheDate = new Date(cacheMeta.timestamp);
          if (xmlDate > cacheDate) {
            needsRefresh = true;
            reason = `XML updated (${xmlDate.toISOString()}) is newer than cache (${cacheDate.toISOString()})`;
          } else {
            reason = `Cache is up to date (XML: ${xmlDate.toISOString()}, Cache: ${cacheDate.toISOString()})`;
          }
        } else {
          // Can't determine date, check cache age
          const cacheAge = Date.now() - cacheMeta.timestamp;
          const maxAge = 1000 * 60 * 60 * 24 * 90; // 90 days
          if (cacheAge > maxAge) {
            needsRefresh = true;
            reason = `Cache is older than 90 days`;
          } else {
            reason = `Cache age: ${Math.floor(cacheAge / (1000 * 60 * 60 * 24))} days`;
          }
        }
        
        results.push({
          playlist: playlist.name,
          cacheId: playlist.cacheId,
          needsRefresh,
          reason,
          xmlDate: xmlDate?.toISOString() || null,
          cacheDate: cacheMeta ? new Date(cacheMeta.timestamp).toISOString() : null,
          cacheAge: cacheMeta ? Date.now() - cacheMeta.timestamp : null
        });
        
      } catch (error) {
        results.push({
          playlist: playlist.name,
          cacheId: playlist.cacheId,
          needsRefresh: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    const needsRefreshCount = results.filter(r => r.needsRefresh).length;
    
    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      totalPlaylists: PLAYLISTS.length,
      needsRefresh: needsRefreshCount,
      playlists: results,
      summary: {
        needsRefresh: results.filter(r => r.needsRefresh).map(r => r.playlist),
        upToDate: results.filter(r => !r.needsRefresh).map(r => r.playlist)
      }
    });
    
  } catch (error) {
    console.error('❌ Error checking playlist freshness:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

