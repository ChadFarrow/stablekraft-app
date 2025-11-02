# Troubleshooting Guide

This guide covers common issues and their solutions for the podcast music site.

## Common Issues

### 1. Missing Audio Player on Album Pages

**Symptoms:**
- Album pages like https://re.podtards.com/album/stay-awhile show no audio player/play bar
- Tracks are listed but no way to play them
- No play controls visible at the bottom of the page

**Cause:** The local audio player was disabled in favor of a non-existent GlobalAudioPlayer component.

**Solution:**
```bash
npm run build
```

The audio player has been re-enabled in the AlbumDetailClient component. The fix:
- Re-enabled the local audio player that was commented out
- Audio player now shows when an album has tracks
- Includes play/pause controls, progress bar, and volume control
- Works on both mobile and desktop

### 2. Audio Playback Errors

**Symptoms:**
```
⚠️ Shuffle attempt 1 failed: DOMException: The fetching process for the media resource was aborted by the user agent at the user's request.
🚫 Audio format not supported
Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource
```

**Cause:** Multiple issues including:
- Service worker interfering with audio requests
- CORS issues with direct audio URLs
- Audio caching causing playback conflicts
- Service worker updates during playback

**Solution:**
```bash
npm run clear-sw-cache
```

The audio playback has been improved with:
- **NetworkFirst caching** for audio files instead of CacheFirst
- **Better error handling** for aborted requests and CORS issues
- **Automatic cache clearing** when audio errors occur
- **Improved retry logic** with delays between attempts
- **Enhanced proxy-audio** route with proper CORS headers

### 3. Missing Progress Bar on Main Screen

**Symptoms:**
- Now playing bar shows but no progress bar is visible
- No time display (current time / total duration)
- Can't click to seek through audio tracks

**Cause:** Progress bar component was not implemented in the main page now playing bar.

**Solution:**
```bash
npm run build
```

The progress bar has been added with:
- **Real-time progress tracking** with `timeupdate` event listener
- **Clickable seek functionality** to jump to any position
- **Time display** showing current time and total duration
- **Visual progress indicator** with blue progress bar
- **Hover effects** for better user interaction

### 3. Audio Not Continuing Across Page Navigation

**Symptoms:**
- Audio stops playing when navigating to different pages.
- No persistent audio player across the application.
- Loss of playback state when moving between album pages and main page.

**Cause:**
- Audio state was managed locally within individual page components.
- No global audio context to maintain playback state across navigation.
- Audio element was recreated on each page, causing playback interruption.

**Solution:**
- Created a global `AudioContext` (`contexts/AudioContext.tsx`) to manage audio state across all pages.
- Implemented `AudioProvider` wrapper in the root layout (`app/layout.tsx`) to provide global audio context.
- Created `GlobalNowPlayingBar` component (`components/GlobalNowPlayingBar.tsx`) that persists across all pages.
- Added localStorage persistence to maintain audio state even after page refreshes.
- Moved all audio playback logic from individual pages to the global context.
- Updated the main page (`app/page.tsx`) to use the global audio context instead of local state.
- Integrated the global now playing bar into the root layout for consistent display across all pages.

### 4. RSC Payload Fetch Failures

**Symptoms:**
```
Failed to fetch RSC payload for https://re.podtards.com/album/[album-name]. 
Falling back to browser navigation. 
TypeError: NetworkError when attempting to fetch resource.
```

**Cause:** Service worker is incorrectly caching React Server Component (RSC) payloads, causing network errors.

**Solution:**
```bash
npm run clear-sw-cache
```

This script:
- Removes the `.next` directory to clear all cached files
- Removes the service worker file to force regeneration
- Rebuilds the application with updated service worker configuration
- Excludes RSC payloads from service worker caching

### 5. Corrupted Image Errors

**Symptoms:**
```
Image corrupt or truncated. [filename].png
```

**Cause:** Image files may be corrupted during upload or processing.

**Solution:**
```bash
npm run fix-images
```

This script:
- Validates all images in the `data/optimized-images` directory
- Creates placeholder images for corrupted files
- Ensures all images are properly formatted

### 6. Service Worker Update Issues

**Symptoms:**
```
🔄 New service worker found
Service Worker registered successfully
```

But the service worker doesn't activate properly.

**Solution:**
```bash
npm run clear-sw-cache
```

Then hard refresh your browser (Ctrl+Shift+R or Cmd+Shift+R).

### 7. Comprehensive Fix

For multiple issues or when unsure of the specific problem:

```bash
npm run fix-all
```

This comprehensive script:
1. Checks and fixes corrupted images
2. Clears service worker cache and rebuilds
3. Provides browser cache clearing instructions
4. Verifies all fixes were applied successfully

## Browser Cache Clearing

After running fixes, you may need to clear your browser cache:

### Desktop Browsers
- **Hard Refresh:** Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
- **Developer Tools:** Open DevTools → Application → Storage → Clear storage

### Mobile Browsers
- **Safari:** Settings → Safari → Clear History and Website Data
- **Chrome:** Settings → Privacy and Security → Clear browsing data

## Prevention

To prevent these issues:

1. **Regular Maintenance:** Run `npm run fix-all` periodically
2. **Image Validation:** Use `npm run fix-images` after adding new images
3. **Service Worker Updates:** Clear cache after major updates with `npm run clear-sw-cache`
4. **Browser Testing:** Test in multiple browsers and clear cache when issues arise

## Configuration Changes

The following configuration changes were made to prevent these issues:

### Next.js Configuration (`next.config.js`)
- Added exclusions for RSC payloads in service worker configuration
- Added NetworkFirst caching strategy for critical Next.js files
- Improved service worker update handling

### Service Worker Registration (`components/ServiceWorkerRegistration.tsx`)
- Added `updateViaCache: 'none'` to prevent caching the service worker itself
- Added RSC fetch failure detection and automatic cache clearing
- Improved error handling for network issues

## Scripts Reference

| Script | Purpose | Command |
|--------|---------|---------|
| `fix-all` | Comprehensive fix for all issues | `npm run fix-all` |
| `fix-images` | Fix corrupted images only | `npm run fix-images` |
| `clear-sw-cache` | Clear service worker cache and rebuild | `npm run clear-sw-cache` |
| `build` | Build application after code changes | `npm run build` |

## Monitoring

Check the browser console for these indicators:

- ✅ `Service Worker registered successfully` - Service worker working
- 🔄 `New service worker found` - Update available
- ❌ `Failed to fetch RSC payload` - RSC caching issue
- ⚠️ `Image corrupt or truncated` - Image loading issue

## Support

If issues persist after running these fixes:

1. Check browser console for specific error messages
2. Try clearing browser cache completely
3. Test in an incognito/private browsing window
4. Check network connectivity and CDN status
5. Verify the application is properly deployed 