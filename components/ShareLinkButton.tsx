'use client';

import React, { useState } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from './Toast';

export default function ShareLinkButton() {
  const [isCopying, setIsCopying] = useState(false);

  const handleShare = async () => {
    try {
      setIsCopying(true);

      // Get full URL including search params
      const url = window.location.href;

      // Copy to clipboard
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          console.error('Failed to copy link');
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying to clipboard:', error);
      toast.error('Failed to copy link. Please try again.');
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <button
      onClick={handleShare}
      disabled={isCopying}
      className="fixed bottom-4 left-4 z-[60] bg-stablekraft-teal/90 hover:bg-stablekraft-teal text-white p-3 rounded-full shadow-2xl hover:shadow-2xl transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-white/20"
      title="Share this page"
      aria-label="Copy page link to clipboard"
      style={{ 
        marginBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0px)',
        minWidth: '48px',
        minHeight: '48px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Share2 className="w-5 h-5" />
    </button>
  );
}

