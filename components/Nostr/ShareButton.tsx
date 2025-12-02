'use client';

import React from 'react';
import { Share2 } from 'lucide-react';
import { toast } from '../Toast';

interface ShareButtonProps {
  trackId?: string;
  feedId?: string;
  trackTitle?: string;
  albumTitle?: string;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export default function ShareButton({
  trackId,
  feedId,
  className = '',
  variant = 'default',
  size = 'md',
}: ShareButtonProps) {
  const handleShare = async () => {
    try {
      // Construct track URL
      const baseUrl = window.location.origin;
      const url = feedId
        ? `${baseUrl}/album/${feedId}${trackId ? `?track=${trackId}` : ''}`
        : window.location.href;

      await navigator.clipboard.writeText(url);
      toast.success('Link copied!');
    } catch (error) {
      console.error('Failed to copy:', error);
      toast.error('Failed to copy link');
    }
  };

  return (
    <button
      onClick={handleShare}
      className={`rounded-md font-medium transition-colors flex items-center gap-2 ${
        variant === 'outline'
          ? 'border border-gray-300 hover:bg-gray-50'
          : variant === 'ghost'
          ? 'hover:bg-white/10'
          : 'bg-blue-600 text-white hover:bg-blue-700'
      } ${size === 'sm' ? 'px-2 py-1 text-xs' : size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm'} ${className}`}
      title="Copy link to clipboard"
    >
      <Share2 className={size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-6 h-6' : 'w-5 h-5'} />
    </button>
  );
}
