'use client';

import { useState } from 'react';
import { MusicTrack } from '@/lib/music-track-parser';
import { formatTime, formatDate } from '@/lib/utils';
import { 
  Play, 
  Pause, 
  Heart, 
  Share2, 
  ExternalLink, 
  Clock, 
  Calendar, 
  Mic, 
  Radio,
  Zap,
  Copy,
  Check,
  X,
  ArrowLeft
} from 'lucide-react';
import { BoostButton } from '@/components/Lightning/BoostButton';

interface MusicTrackDetailProps {
  track: MusicTrack;
  relatedTracks?: MusicTrack[];
  onPlay?: (track: MusicTrack) => void;
  onClose?: () => void;
  onNavigateBack?: () => void;
}

export default function MusicTrackDetail({ 
  track, 
  relatedTracks = [], 
  onPlay, 
  onClose,
  onNavigateBack 
}: MusicTrackDetailProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  const handlePlay = () => {
    setIsPlaying(!isPlaying);
    if (onPlay) {
      onPlay(track);
    }
  };

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'chapter':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'value-split':
        return 'bg-green-500/20 text-green-300 border-green-500/30';
      case 'description':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'external-feed':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      default:
        return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'chapter':
        return <Clock className="w-4 h-4" />;
      case 'value-split':
        return <Zap className="w-4 h-4" />;
      case 'description':
        return <Mic className="w-4 h-4" />;
      case 'external-feed':
        return <Radio className="w-4 h-4" />;
      default:
        return <Radio className="w-4 h-4" />;
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white/5 backdrop-blur-sm rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          {onNavigateBack && (
            <button
              onClick={onNavigateBack}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              title="Back to list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <h2 className="text-xl font-semibold">Track Details</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="p-6">
        {/* Main Track Info */}
        <div className="flex flex-col lg:flex-row gap-6 mb-8">
          {/* Track Image */}
          <div className="flex-shrink-0">
            <div className="w-48 h-48 rounded-xl overflow-hidden bg-gradient-to-br from-purple-500/20 to-blue-500/20">
              {track.image && !imageError ? (
                <img
                  src={track.image}
                  alt={track.title}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-16 h-16 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          {/* Track Details */}
          <div className="flex-1">
            <div className="mb-4">
              <h1 className="text-3xl font-bold mb-2">{track.title}</h1>
              <h2 className="text-xl text-gray-300 mb-3">{track.artist}</h2>
              
              <div className="flex items-center gap-2 mb-4">
                <span className={`px-3 py-1 text-sm font-medium rounded-full border flex items-center gap-2 ${getSourceColor(track.source)}`}>
                  {getSourceIcon(track.source)}
                  {track.source}
                </span>
                {track.valueForValue && (
                  <span className="px-3 py-1 text-sm font-medium rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex items-center gap-1">
                    <Zap className="w-4 h-4" />
                    V4V
                  </span>
                )}
              </div>
            </div>

            {/* Play Controls */}
            <div className="flex items-center gap-4 mb-6">
              <button
                onClick={handlePlay}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              
              <button
                onClick={() => setIsFavorited(!isFavorited)}
                className={`p-3 rounded-lg transition-colors ${
                  isFavorited 
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                    : 'bg-white/10 hover:bg-white/20'
                }`}
                title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Heart className={`w-5 h-5 ${isFavorited ? 'fill-current' : ''}`} />
              </button>
              
              <button
                onClick={() => handleCopy(window.location.href, 'url')}
                className="p-3 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                title="Share track"
              >
                {copiedField === 'url' ? <Check className="w-5 h-5 text-green-400" /> : <Share2 className="w-5 h-5" />}
              </button>
            </div>

            {/* Track Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-400">
                <Calendar className="w-4 h-4" />
                <span>Released: {formatDate(track.episodeDate)}</span>
              </div>
              
              {track.startTime > 0 && (
                <div className="flex items-center gap-2 text-gray-400">
                  <Clock className="w-4 h-4" />
                  <span>Start: {formatTime(track.startTime)}</span>
                </div>
              )}
              
              {track.duration > 0 && (
                <div className="flex items-center gap-2 text-gray-400">
                  <Clock className="w-4 h-4" />
                  <span>Duration: {formatTime(track.duration)}</span>
                </div>
              )}
              
              <div className="flex items-center gap-2 text-gray-400">
                <Radio className="w-4 h-4" />
                <span>From: {track.episodeTitle}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Episode Information */}
        <div className="bg-white/5 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <Radio className="w-5 h-5" />
            Episode Information
          </h3>
          <div className="space-y-2 text-sm text-gray-300">
            <div>
              <span className="font-medium">Episode:</span> {track.episodeTitle}
            </div>
            <div>
              <span className="font-medium">Published:</span> {formatDate(track.episodeDate)}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium">Feed:</span>
              <button
                onClick={() => handleCopy(track.feedUrl, 'feed')}
                className="flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
              >
                {new URL(track.feedUrl).hostname}
                {copiedField === 'feed' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
            {track.audioUrl && (
              <div className="flex items-center gap-2">
                <span className="font-medium">Audio:</span>
                <a
                  href={track.audioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Source
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Value for Value Section */}
        {track.valueForValue && (
          <div className="bg-gradient-to-r from-green-500/10 to-yellow-500/10 border border-green-500/20 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2 text-green-300">
              <Zap className="w-5 h-5" />
              Value for Value (V4V)
            </h3>
            <div className="space-y-2 text-sm">
              {track.valueForValue.lightningAddress && (
                <div className="flex items-center gap-2">
                  <span className="font-medium">Lightning Address:</span>
                  <button
                    onClick={() => handleCopy(track.valueForValue!.lightningAddress, 'lightning')}
                    className="flex items-center gap-1 px-2 py-1 bg-green-500/20 hover:bg-green-500/30 rounded font-mono text-xs transition-colors"
                  >
                    {track.valueForValue.lightningAddress}
                    {copiedField === 'lightning' ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
              {track.valueForValue.suggestedAmount > 0 && (
                <div>
                  <span className="font-medium">Suggested Amount:</span> {track.valueForValue.suggestedAmount} sats
                </div>
              )}
              {track.valueForValue.customKey && (
                <div>
                  <span className="font-medium">{track.valueForValue.customKey}:</span> {track.valueForValue.customValue}
                </div>
              )}
            </div>
            
            <div className="mt-4 pt-3 border-t border-green-500/20">
              <BoostButton
                trackId={track.id}
                feedId={track.feedUrl}
                trackTitle={track.title}
                artistName={track.artist}
                className="w-full"
              />
            </div>
          </div>
        )}

        {/* Additional Details */}
        {track.description && (
          <div className="bg-white/5 rounded-lg p-4 mb-6">
            <h3 className="font-semibold mb-2">Description</h3>
            <p className="text-sm text-gray-300">{track.description}</p>
          </div>
        )}

        {/* Related Tracks */}
        {relatedTracks.length > 0 && (
          <div>
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Radio className="w-5 h-5" />
              Related Tracks
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {relatedTracks.slice(0, 6).map((relatedTrack) => (
                <div
                  key={relatedTrack.id}
                  className="bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-colors cursor-pointer"
                  onClick={() => onPlay && onPlay(relatedTrack)}
                >
                  <div className="font-medium text-sm mb-1 truncate">{relatedTrack.title}</div>
                  <div className="text-xs text-gray-400 truncate">{relatedTrack.artist}</div>
                  <div className="text-xs text-gray-500 mt-1">{formatDate(relatedTrack.episodeDate)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}