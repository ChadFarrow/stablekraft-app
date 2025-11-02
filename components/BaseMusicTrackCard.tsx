'use client';

import { useState } from 'react';
import { formatTime, formatDate } from '@/lib/utils';
import {
  Play,
  Zap,
  Clock,
  Calendar,
  Mic,
  Radio,
  ExternalLink,
  Copy,
  Check,
  Heart,
  Share2
} from 'lucide-react';
import type { MusicTrackCardProps, V4VMusicTrack } from '@/types/music-track';
import { BoostButton } from '@/components/Lightning/BoostButton';
import FavoriteButton from '@/components/favorites/FavoriteButton';

export default function BaseMusicTrackCard({
  track,
  variant = 'standard',
  selected = false,
  showV4VBadge = true,
  actions,
  className = '',
  onPlay,
  onViewDetails,
  onFavorite,
  onShare
}: MusicTrackCardProps) {
  const [imageError, setImageError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isFavorited, setIsFavorited] = useState(false);

  const isV4VTrack = (track: any): track is V4VMusicTrack => {
    return 'valueForValue' in track;
  };

  const handlePlay = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onPlay) {
      onPlay(track);
    }
  };

  const handleCardClick = () => {
    if (onViewDetails) {
      onViewDetails(track);
    }
  };

  const handleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFavorited(!isFavorited);
    if (onFavorite) {
      onFavorite(track);
    }
  };

  const handleShare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onShare) {
      onShare(track);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  };

  const getSourceColor = (source?: string) => {
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

  const getDisplayTitle = () => {
    if (isV4VTrack(track) && track.valueForValue?.resolvedTitle) {
      return track.valueForValue.resolvedTitle;
    }
    return track.title;
  };

  const getDisplayArtist = () => {
    if (isV4VTrack(track) && track.valueForValue?.resolvedArtist) {
      return track.valueForValue.resolvedArtist;
    }
    return track.artist;
  };

  const getAudioUrl = () => {
    if (isV4VTrack(track) && track.valueForValue?.resolvedAudioUrl) {
      return track.valueForValue.resolvedAudioUrl;
    }
    return track.audioUrl;
  };

  const getDuration = () => {
    if (isV4VTrack(track) && track.valueForValue?.resolvedDuration) {
      return track.valueForValue.resolvedDuration;
    }
    return track.duration;
  };

  const hasV4VData = isV4VTrack(track) && track.valueForValue;
  const isResolved = hasV4VData && track.valueForValue?.resolved;

  if (variant === 'compact') {
    return (
      <div
        className={`
          flex items-center gap-3 p-3 rounded-lg transition-all duration-200
          bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50
          ${selected ? 'ring-2 ring-blue-500/50 bg-blue-900/20' : ''}
          ${className}
        `}
        onClick={handleCardClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Play Button */}
        <button
          onClick={handlePlay}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 hover:bg-green-500 flex items-center justify-center transition-colors"
          disabled={!getAudioUrl()}
        >
          <Play className="w-4 h-4 text-white ml-0.5" />
        </button>

        {/* Track Info */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white truncate text-sm">
            {getDisplayTitle()}
          </div>
          <div className="text-xs text-gray-400 truncate">
            {getDisplayArtist()}
          </div>
        </div>

        {/* Duration */}
        {getDuration() && (
          <div className="text-xs text-gray-400">
            {formatTime(getDuration()!)}
          </div>
        )}

        {/* V4V Badge */}
        {hasV4VData && showV4VBadge && (
          <div className={`px-2 py-1 rounded-full text-xs font-medium border ${
            isResolved
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
          }`}>
            <Zap className="w-3 h-3 inline mr-1" />
            V4V
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`
        group relative bg-gray-800/60 backdrop-blur-sm rounded-xl border border-gray-700/50
        hover:border-gray-600/50 transition-all duration-300 overflow-hidden
        ${selected ? 'ring-2 ring-blue-500/50 bg-blue-900/20' : ''}
        ${isHovered ? 'transform hover:scale-[1.02] shadow-lg shadow-black/20' : ''}
        ${className}
      `}
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image */}
      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl">
        {track.image && !imageError ? (
          <img
            src={track.image}
            alt={`${getDisplayTitle()} artwork`}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
            <Mic className="w-12 h-12 text-gray-500" />
          </div>
        )}

        {/* Play Button Overlay */}
        <div
          className={`
            absolute inset-0 bg-black/40 backdrop-blur-sm
            flex items-center justify-center transition-opacity duration-300
            ${isHovered ? 'opacity-100' : 'opacity-0'}
          `}
        >
          <button
            onClick={handlePlay}
            className={`
              w-16 h-16 rounded-full bg-green-600 hover:bg-green-500
              flex items-center justify-center transition-all duration-200
              transform hover:scale-110 shadow-lg
              ${!getAudioUrl() ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            disabled={!getAudioUrl()}
          >
            <Play className="w-6 h-6 text-white ml-1" />
          </button>
        </div>

        {/* V4V Badge */}
        {hasV4VData && showV4VBadge && (
          <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium border backdrop-blur-sm ${
            isResolved
              ? 'bg-green-500/20 text-green-300 border-green-500/30'
              : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
          }`}>
            <Zap className="w-3 h-3 inline mr-1" />
            V4V {isResolved ? '✓' : '?'}
          </div>
        )}

        {/* Source Badge */}
        {track.source && (
          <div className={`absolute top-2 left-2 px-2 py-1 rounded-full text-xs font-medium border backdrop-blur-sm ${getSourceColor(track.source)}`}>
            {track.source}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Title and Artist */}
        <div className="mb-3">
          <h3 className="font-semibold text-white mb-1 line-clamp-2 group-hover:text-blue-300 transition-colors">
            {getDisplayTitle()}
          </h3>
          <p className="text-gray-400 text-sm truncate">
            {getDisplayArtist()}
          </p>
        </div>

        {/* Episode Info */}
        {track.episodeTitle && (
          <div className="text-xs text-gray-500 mb-2 truncate">
            <Radio className="w-3 h-3 inline mr-1" />
            {track.episodeTitle}
          </div>
        )}

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
          {getDuration() && (
            <div className="flex items-center">
              <Clock className="w-3 h-3 mr-1" />
              {formatTime(getDuration()!)}
            </div>
          )}

          {(track.pubDate || track.createdAt) && (
            <div className="flex items-center">
              <Calendar className="w-3 h-3 mr-1" />
              {formatDate(track.pubDate || track.createdAt!)}
            </div>
          )}
        </div>

        {/* V4V Details for V4V variant */}
        {variant === 'v4v' && hasV4VData && (
          <div className="mb-3 p-2 bg-gray-900/50 rounded border border-gray-700/50">
            <div className="text-xs text-gray-400 mb-1">V4V Details:</div>
            <div className="text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Feed GUID:</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(track.valueForValue!.feedGuid, 'feedGuid');
                  }}
                  className="flex items-center text-blue-400 hover:text-blue-300"
                >
                  <span className="max-w-20 truncate">{track.valueForValue!.feedGuid}</span>
                  {copiedField === 'feedGuid' ? (
                    <Check className="w-3 h-3 ml-1" />
                  ) : (
                    <Copy className="w-3 h-3 ml-1" />
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Item GUID:</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(track.valueForValue!.itemGuid, 'itemGuid');
                  }}
                  className="flex items-center text-blue-400 hover:text-blue-300"
                >
                  <span className="max-w-20 truncate">{track.valueForValue!.itemGuid}</span>
                  {copiedField === 'itemGuid' ? (
                    <Check className="w-3 h-3 ml-1" />
                  ) : (
                    <Copy className="w-3 h-3 ml-1" />
                  )}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Remote %:</span>
                <span className="text-green-400">{track.valueForValue!.remotePercentage}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Play Button */}
            <button
              onClick={handlePlay}
              className={`
                px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg
                text-white text-sm font-medium transition-colors flex items-center gap-1
                ${!getAudioUrl() ? 'opacity-50 cursor-not-allowed' : ''}
              `}
              disabled={!getAudioUrl()}
            >
              <Play className="w-4 h-4" />
              Play
            </button>

            {/* Lightning Boost Button for V4V tracks */}
            {variant === 'v4v' && isV4VTrack(track) && track.valueForValue && (
              <BoostButton
                trackId={track.id}
                feedId={track.feedUrl}
                trackTitle={track.title}
                artistName={track.artist}
                className="text-sm"
              />
            )}

            {/* Additional Actions */}
            {variant === 'v4v' && (
              <>
                {/* Favorite Button */}
                {(track.id || track.guid || track.trackId) && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <FavoriteButton
                      trackId={track.id || track.guid || track.trackId}
                      size={18}
                      className="text-white"
                    />
                  </div>
                )}

                <button
                  onClick={handleShare}
                  className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-400 hover:text-white transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          {/* Custom Actions */}
          {actions && (
            <div className="flex items-center gap-1">
              {actions}
            </div>
          )}

          {/* Details Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCardClick();
            }}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}