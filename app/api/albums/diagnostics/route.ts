import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    console.log('🔍 Starting album diagnostics...');
    
    const musicTracksPath = path.join(process.cwd(), 'data', 'music-tracks.json');
    
    if (!fs.existsSync(musicTracksPath)) {
      return NextResponse.json({ 
        error: 'Music tracks data not found',
        issues: []
      }, { status: 404 });
    }

    const fileContent = fs.readFileSync(musicTracksPath, 'utf-8');
    const musicTracksParsed = JSON.parse(fileContent);
    const musicTracks = musicTracksParsed.musicTracks || [];
    
    console.log(`📊 Analyzing ${musicTracks.length} music tracks...`);
    
    // Group tracks by album (feedGuid)
    const albumGroups = new Map<string, any>();
    
    musicTracks.forEach((track: any) => {
      const key = track.feedGuid || 'unknown';
      if (!albumGroups.has(key)) {
        albumGroups.set(key, {
          feedGuid: track.feedGuid,
          feedTitle: track.feedTitle,
          feedImage: track.FeedImage || track.image,
          feedUrl: track.feedUrl,
          tracks: []
        });
      }
      albumGroups.get(key).tracks.push(track);
    });
    
    const issues: any[] = [];
    const stats = {
      totalAlbums: albumGroups.size,
      albumsWithDuplicates: 0,
      albumsWithManyTracks: 0,
      albumsWithSuspiciousPatterns: 0,
      albumsWithMissingMetadata: 0,
      totalDuplicatesRemoved: 0
    };
    
    // Analyze each album for issues
    const albumGroupsArray = Array.from(albumGroups.entries());
    for (const [feedGuid, group] of albumGroupsArray) {
      const albumTitle = group.feedTitle || 'Unknown Album';
      const originalTrackCount = group.tracks.length;
      
      // Skip single tracks (likely not albums)
      if (originalTrackCount <= 1) continue;
      
      // Issue 1: Check for duplicate track titles
      const trackTitles = group.tracks.map((t: any) => (t.title || 'Untitled').toLowerCase().trim());
      const uniqueTitles = new Set(trackTitles);
      const duplicateCount = originalTrackCount - uniqueTitles.size;
      
      if (duplicateCount > 0) {
        stats.albumsWithDuplicates++;
        stats.totalDuplicatesRemoved += duplicateCount;
        
        // Find which titles are duplicated
        const titleCounts = new Map<string, number>();
        trackTitles.forEach((title: string) => {
          titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
        });
        
        const duplicatedTitles = Array.from(titleCounts.entries())
          .filter(([title, count]) => count > 1)
          .map(([title, count]) => `"${title}" (${count}x)`);
        
        issues.push({
          type: 'duplicate_tracks',
          severity: duplicateCount > 5 ? 'high' : duplicateCount > 2 ? 'medium' : 'low',
          album: albumTitle,
          feedGuid: feedGuid,
          originalTracks: originalTrackCount,
          duplicateCount: duplicateCount,
          deduplicatedTracks: uniqueTitles.size,
          duplicatedTitles: duplicatedTitles.slice(0, 5), // Show first 5 duplicates
          description: `Album has ${duplicateCount} duplicate tracks that will be automatically removed`
        });
      }
      
      // Issue 2: Albums with unusually many tracks (possible compilation or error)
      // Skip known compilations
      const knownCompilations = [
        'Music From The Doerfel-Verse',
        'The Satellite Skirmish'
      ];
      
      if (originalTrackCount > 25 && !knownCompilations.includes(albumTitle)) {
        stats.albumsWithManyTracks++;
        issues.push({
          type: 'excessive_tracks',
          severity: originalTrackCount > 50 ? 'high' : 'medium',
          album: albumTitle,
          feedGuid: feedGuid,
          trackCount: originalTrackCount,
          description: `Album has ${originalTrackCount} tracks, which is unusually high - may be a compilation or data error`
        });
      }
      
      // Issue 3: Suspicious patterns (same track repeated with numbers)
      const suspiciousPatterns = trackTitles.filter((title: string) => {
        // Look for tracks with numbers at the end that might be duplicates
        const baseTitle = title.replace(/\s*\d+$/, '').trim();
        const matches = trackTitles.filter((t: string) => t.startsWith(baseTitle));
        return matches.length > 2; // More than 2 tracks with similar base names
      });
      
      if (suspiciousPatterns.length > 0) {
        stats.albumsWithSuspiciousPatterns++;
        issues.push({
          type: 'suspicious_patterns',
          severity: 'medium',
          album: albumTitle,
          feedGuid: feedGuid,
          suspiciousCount: suspiciousPatterns.length,
          examples: Array.from(new Set(suspiciousPatterns)).slice(0, 3),
          description: `Album has tracks with suspicious naming patterns that might indicate duplicates`
        });
      }
      
      // Issue 4: Missing metadata
      const tracksWithoutUrls = group.tracks.filter((t: any) => !t.enclosureUrl || t.enclosureUrl.trim() === '');
      const tracksWithoutTitles = group.tracks.filter((t: any) => !t.title || t.title.trim() === '');
      
      if (tracksWithoutUrls.length > 0 || tracksWithoutTitles.length > 0) {
        stats.albumsWithMissingMetadata++;
        issues.push({
          type: 'missing_metadata',
          severity: tracksWithoutUrls.length > originalTrackCount / 2 ? 'high' : 'low',
          album: albumTitle,
          feedGuid: feedGuid,
          tracksWithoutUrls: tracksWithoutUrls.length,
          tracksWithoutTitles: tracksWithoutTitles.length,
          totalTracks: originalTrackCount,
          description: `Album has ${tracksWithoutUrls.length} tracks without URLs and ${tracksWithoutTitles.length} tracks without titles`
        });
      }
    }
    
    // Sort issues by severity and track count
    issues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      const severityA = severityOrder[a.severity as keyof typeof severityOrder] || 0;
      const severityB = severityOrder[b.severity as keyof typeof severityOrder] || 0;
      
      if (severityA !== severityB) return severityB - severityA;
      return (b.originalTracks || b.trackCount || 0) - (a.originalTracks || a.trackCount || 0);
    });
    
    console.log(`✅ Diagnostics complete: Found ${issues.length} issues across ${stats.totalAlbums} albums`);
    
    return NextResponse.json({
      stats,
      issues: issues.slice(0, 50), // Limit to top 50 issues
      summary: {
        mostProblematicAlbums: issues.slice(0, 10).map(issue => ({
          album: issue.album,
          type: issue.type,
          severity: issue.severity,
          description: issue.description
        })),
        recommendations: [
          stats.totalDuplicatesRemoved > 0 ? "Deduplication system is active and will automatically fix duplicate tracks" : null,
          stats.albumsWithManyTracks > 0 ? `${stats.albumsWithManyTracks} albums have unusually high track counts - review for compilations` : null,
          stats.albumsWithMissingMetadata > 0 ? `${stats.albumsWithMissingMetadata} albums have missing metadata - may need data source fixes` : null
        ].filter(Boolean)
      },
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ Error in album diagnostics:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      issues: []
    }, { status: 500 });
  }
}