'use client';

import { useEffect, useRef, useState } from 'react';

interface UseScrollDetectionResult {
  isScrolling: boolean;
  handleTouchStart: (e: TouchEvent | React.TouchEvent) => void;
  handleTouchMove: (e: TouchEvent | React.TouchEvent) => void;
  handleTouchEnd: (e: TouchEvent | React.TouchEvent) => void;
  shouldPreventClick: () => boolean;
}

export function useScrollDetection(): UseScrollDetectionResult {
  const [isScrolling, setIsScrolling] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  
  const handleTouchStart = (e: TouchEvent | React.TouchEvent) => {
    const touch = ('touches' in e && e.touches.length > 0) ? e.touches[0] : 
                  ('changedTouches' in e && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
    if (!touch) return;
    
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
  };

  const handleTouchMove = (e: TouchEvent | React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = ('touches' in e && e.touches.length > 0) ? e.touches[0] : 
                  ('changedTouches' in e && e.changedTouches.length > 0) ? e.changedTouches[0] : null;
    if (!touch) return;
    const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
    const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);
    
    // If moved more than 20px, consider it scrolling (increased sensitivity)
    if (deltaX > 20 || deltaY > 20) {
      setIsScrolling(true);
      
      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Reset scrolling state after 300ms of no movement (increased timeout)
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 300);
    }
  };

  const handleTouchEnd = () => {
    // Keep scrolling state for a longer time to prevent immediate clicks after scrolling
    if (isScrolling) {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 250);
    }
    touchStartRef.current = null;
  };

  const shouldPreventClick = () => {
    if (!touchStartRef.current) return false;
    
    const timeSinceStart = Date.now() - touchStartRef.current.time;
    // Prevent clicks that happen too quickly (likely accidental taps) - increased threshold
    return isScrolling || timeSinceStart < 200;
  };

  // Global scroll detection
  useEffect(() => {
    let scrollTimeout: NodeJS.Timeout;
    
    const handleScroll = () => {
      setIsScrolling(true);
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        setIsScrolling(false);
      }, 300);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      window.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return {
    isScrolling,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    shouldPreventClick
  };
}