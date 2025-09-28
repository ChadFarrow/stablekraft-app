'use client';

import { useState } from 'react';
import V4VMusicTrackList from '@/components/V4VMusicTrackList';
import ITDVPlaylistAlbum from '@/components/ITDVPlaylistAlbum';
import { MusicTrackRecord } from '@/lib/music-track-schema';
import { useAudio } from '@/contexts/AudioContext';
import { 
  Zap, 
  Database, 
  TrendingUp, 
  Music, 
  Lightbulb,
  ExternalLink,
  Download,
  RefreshCw
} from 'lucide-react';

export default function MusicTracksClient() {
  const [currentSegment, setCurrentSegment] = useState<MusicTrackRecord | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const { playTrack, isPlaying, pause, resume } = useAudio();

  // Unified feed URLs - all segments are V4V-enabled
  const feedUrls = [
    'local://database', // Primary source with 2,640+ segments
    'https://www.doerfelverse.com/feeds/intothedoerfelverse.xml',
    'http://localhost:3000/001-to-060-lightning-thrashes-playlist.xml',
  ];

  const handlePlaySegment = async (segment: MusicTrackRecord) => {
    setCurrentSegment(segment);
    console.log('Playing segment:', segment);
    
    if (segment.audioUrl) {
      try {
        const success = await playTrack(segment.audioUrl, segment.startTime, segment.endTime);
        if (success) {
          console.log('✅ Segment started playing successfully');
        } else {
          console.error('❌ Failed to play segment');
        }
      } catch (error) {
        console.error('❌ Error playing segment:', error);
      }
    } else {
      console.warn('⚠️ No audio URL available for segment');
    }
  };

  const handleExtractSegments = async () => {
    setIsExtracting(true);
    try {
      console.log('Extracting segments from feeds...');
    } catch (error) {
      console.error('Failed to extract segments:', error);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8" suppressHydrationWarning>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-green-500/20 rounded-xl">
            <Zap className="w-8 h-8 text-green-400" />
          </div>
                  <div>
          <h1 className="text-4xl font-bold">Music Discovery</h1>
          <p className="text-green-400 text-lg">Value for Value Music Segments & Remote Items</p>
        </div>
        </div>
        
        <p className="text-gray-400 max-w-4xl mb-6">
          Discover and support music creators through Value for Value (V4V) payments. 
          This platform extracts music segments from podcast RSS feeds and displays 
          Lightning payment information, allowing you to directly support artists 
          while enjoying their music.
        </p>

        {/* Feature Highlights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold">V4V Integration</h3>
            </div>
            <p className="text-sm text-gray-400">
              Direct Lightning payments to artists with one-click support
            </p>
          </div>
          
          <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Database className="w-5 h-5 text-blue-400" />
              <h3 className="font-semibold">Smart Database</h3>
            </div>
            <p className="text-sm text-gray-400">
              Persistent storage with advanced search and filtering
            </p>
          </div>
          
          <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-purple-400" />
              <h3 className="font-semibold">Analytics</h3>
            </div>
            <p className="text-sm text-gray-400">
              Track discovery statistics and V4V payment metrics
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExtractSegments}
            disabled={isExtracting}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors"
          >
            {isExtracting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isExtracting ? 'Extracting...' : 'Extract New Segments'}
          </button>
          
          <button
            onClick={() => window.open('https://lightning.network/', '_blank')}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Learn About Lightning
          </button>
        </div>
      </div>

      {/* ITDV Playlist Album */}
      <div className="mt-12 mb-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Music className="w-6 h-6 text-purple-400" />
          </div>
          <h2 className="text-2xl font-bold">Featured Playlist</h2>
        </div>
        <ITDVPlaylistAlbum />
      </div>

      {/* Unified Music Segment List - Now showing all tracks including remote items */}
      <V4VMusicTrackList 
        initialFeedUrls={feedUrls}
        onPlayTrack={handlePlaySegment}
        showDatabaseStats={true}
        autoExtract={false}
      />

      {/* V4V Information Panel */}
      <div className="mt-12 bg-gradient-to-r from-green-500/10 to-blue-500/10 border border-green-500/20 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lightbulb className="w-6 h-6 text-green-400" />
          <h2 className="text-2xl font-bold">About Value for Value (V4V)</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-semibold mb-2 text-green-300">How It Works</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>• Music segments are extracted from podcast RSS feeds</li>
              <li>• V4V payment information is parsed from feed metadata</li>
              <li>• Lightning addresses and suggested amounts are displayed</li>
              <li>• One-click payments directly support artists</li>
              <li>• All payments are instant and low-fee via Lightning Network</li>
            </ul>
          </div>
          
          <div>
            <h3 className="font-semibold mb-2 text-blue-300">Benefits</h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>• Direct artist support without intermediaries</li>
              <li>• Micro-payments as low as 1 satoshi</li>
              <li>• Instant global payments</li>
              <li>• Transparent payment distribution</li>
              <li>• No subscription fees or ads</li>
            </ul>
          </div>
        </div>
        
        <div className="mt-6 p-4 bg-white/5 rounded-lg">
          <h4 className="font-semibold mb-2 text-yellow-300">Getting Started</h4>
          <p className="text-sm text-gray-300 mb-3">
            To start supporting artists, you&apos;ll need a Lightning wallet. Popular options include:
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="https://getalby.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
            >
              Alby Wallet
            </a>
            <a
              href="https://lightning-wallet.com"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
            >
              Lightning Wallet
            </a>
            <a
              href="https://phoenix.acinq.co"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
            >
              Phoenix Wallet
            </a>
          </div>
        </div>
      </div>

      {/* Current Segment Player */}
      {currentSegment && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-black/90 backdrop-blur-lg border-t border-white/10">
          <div className="container mx-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-lg flex items-center justify-center">
                  <Music className="w-6 h-6 text-white/60" />
                </div>
                <div>
                  <div className="font-medium">{currentSegment.title}</div>
                  <div className="text-sm text-gray-400">{currentSegment.artist}</div>
                  {currentSegment.valueForValue && (
                    <div className="text-xs text-green-400 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      V4V: {currentSegment.valueForValue.suggestedAmount} sats
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setCurrentSegment(null)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
