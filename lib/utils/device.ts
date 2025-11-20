/**
 * Device detection utilities
 * Detects Android devices and app runtime environment
 */

/**
 * Check if the current device is Android
 * @returns true if running on Android device
 */
export function isAndroid(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
  return /android/i.test(userAgent);
}

/**
 * Check if the current device is iOS (iPhone, iPad, iPod)
 * @returns true if running on iOS device
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;

  // Check for iOS devices
  const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent) && !(window as any).MSStream;

  // Check for iPad on iOS 13+ which reports as Mac
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return isIOSDevice || isIPadOS;
}

/**
 * Check if running in a Trusted Web Activity (TWA)
 * @returns true if running in TWA
 */
export function isTWA(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // TWA detection: check for display-mode or referrer
  const displayMode = (window.matchMedia('(display-mode: standalone)').matches) ||
                      (window.matchMedia('(display-mode: fullscreen)').matches);
  
  // Check for TWA-specific indicators
  const isTWA = displayMode && isAndroid();
  
  return isTWA;
}

/**
 * Check if running in Capacitor
 * @returns true if running in Capacitor
 */
export function isCapacitor(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return !!(window as any).Capacitor;
}

/**
 * Check if running as a PWA
 * @returns true if running as installed PWA
 */
export function isPWA(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // Check if running in standalone mode (installed PWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       (window.navigator as any).standalone ||
                       document.referrer.includes('android-app://');

  return isStandalone;
}

/**
 * Get device information
 * @returns Object with device information
 */
export function getDeviceInfo() {
  return {
    isAndroid: isAndroid(),
    isIOS: isIOS(),
    isTWA: isTWA(),
    isCapacitor: isCapacitor(),
    isPWA: isPWA(),
    userAgent: typeof window !== 'undefined' ? navigator.userAgent : '',
    platform: typeof window !== 'undefined' ? navigator.platform : '',
  };
}

