# Android Debugging Guide

This guide explains how to view console logs and debug the NIP-46 connection on Android devices.

## Method 1: Chrome DevTools Remote Debugging (Recommended for PWAs)

This is the best method for debugging web apps and PWAs on Android.

### Prerequisites
- Android device with USB debugging enabled
- Chrome browser installed on your computer
- USB cable to connect device to computer

### Steps

1. **Enable USB Debugging on Android:**
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times to enable Developer Options
   - Go back to Settings → Developer Options
   - Enable "USB Debugging"
   - Enable "Stay Awake" (optional, keeps screen on while charging)

2. **Connect Device:**
   - Connect your Android device to your computer via USB
   - On your device, allow USB debugging when prompted

3. **Open Chrome DevTools:**
   - On your computer, open Chrome browser
   - Go to `chrome://inspect` or `chrome://inspect/#devices`
   - You should see your device listed under "Remote Target"

4. **Inspect Your App:**
   - Find your app in the list (it may show as the TWA package name or the website URL)
   - Click "Inspect" next to your app
   - A new DevTools window will open showing the console, network, and other debugging tools

5. **View Console Logs:**
   - In the DevTools window, click the "Console" tab
   - All `console.log()`, `console.error()`, etc. from your app will appear here
   - You can filter logs, search, and interact with the page

### Tips
- Keep the DevTools window open while testing
- Use `console.log()` statements in your code to debug
- The Network tab shows all API requests and responses
- You can set breakpoints in the Sources tab

---

## Method 2: ADB Logcat (For Native Android Logs)

Use this if you need to see native Android logs or if Chrome DevTools isn't working.

### Prerequisites
- Android SDK Platform Tools installed (ADB)
- USB debugging enabled on device

### Steps

1. **Connect Device:**
   - Connect Android device via USB
   - Allow USB debugging

2. **Open Terminal/Command Prompt:**
   ```bash
   # Check if device is connected
   adb devices
   
   # View all logs
   adb logcat
   
   # Filter for specific tags (e.g., Chrome/WebView)
   adb logcat | grep -i "chromium\|console\|webview"
   
   # Save logs to file
   adb logcat > android_logs.txt
   ```

3. **Filter for Your App:**
   ```bash
   # Filter by package name (replace with your TWA package name)
   adb logcat | grep "com.yourpackage.name"
   
   # Filter for JavaScript console logs
   adb logcat | grep "console"
   ```

---

## Method 3: Browser Console (If Accessible)

If your app is running in a regular browser (not TWA), you might be able to access the console directly:

1. **Chrome on Android:**
   - Open Chrome
   - Go to `chrome://inspect` on your Android device
   - Tap "Inspect" next to your app

2. **Alternative:**
   - Some browsers allow accessing console via menu
   - Look for "Developer Tools" or "Console" in browser settings

---

## Method 4: Add Visual Debugging to Your App

Since console logs aren't always accessible, you can add a visual debug panel to your app:

### Option A: Debug Panel Component

Add a floating debug panel that shows logs on screen:

```typescript
// components/DebugPanel.tsx
'use client';

import { useState, useEffect } from 'react';

const logs: string[] = [];

// Override console methods to capture logs
if (typeof window !== 'undefined') {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...args: any[]) => {
    logs.push(`[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    originalLog(...args);
  };

  console.error = (...args: any[]) => {
    logs.push(`[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    originalError(...args);
  };

  console.warn = (...args: any[]) => {
    logs.push(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`);
    originalWarn(...args);
  };
}

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<string[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (logs.length > 0) {
        setLogEntries([...logs.slice(-50)]); // Keep last 50 logs
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 9999,
          padding: '10px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
        }}
      >
        Debug
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: '50vh',
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        zIndex: 9999,
        overflow: 'auto',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
        <h3 style={{ margin: 0 }}>Debug Logs</h3>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            padding: '5px 10px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
        <button
          onClick={() => {
            logs.length = 0;
            setLogEntries([]);
          }}
          style={{
            padding: '5px 10px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            marginLeft: '10px',
          }}
        >
          Clear
        </button>
      </div>
      <div>
        {logEntries.map((log, i) => (
          <div key={i} style={{ marginBottom: '5px', whiteSpace: 'pre-wrap' }}>
            {log}
          </div>
        ))}
      </div>
    </div>
  );
}
```

Then add it to your layout or a specific page:

```typescript
// app/layout.tsx or your page
import { DebugPanel } from '@/components/DebugPanel';

export default function Layout({ children }) {
  return (
    <>
      {children}
      {process.env.NODE_ENV === 'development' && <DebugPanel />}
    </>
  );
}
```

### Option B: Show Errors in UI

Add error display directly in your components:

```typescript
// In LoginModal.tsx
const [debugInfo, setDebugInfo] = useState<string[]>([]);

// Add debug info
useEffect(() => {
  const addDebug = (msg: string) => {
    setDebugInfo(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };
  
  // Use addDebug() instead of console.log() for critical info
}, []);
```

---

## Method 5: Remote Logging Service

Send logs to a remote service you can view:

```typescript
// lib/remote-logging.ts
export function remoteLog(level: 'log' | 'error' | 'warn', ...args: any[]) {
  // Log locally
  console[level](...args);
  
  // Send to remote service (e.g., your API endpoint)
  if (typeof window !== 'undefined') {
    fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level,
        message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
      }),
    }).catch(() => {
      // Silently fail if logging service is unavailable
    });
  }
}
```

---

## Recommended Approach for NIP-46 Debugging

For debugging the NIP-46 connection issue:

1. **Use Chrome DevTools Remote Debugging** (Method 1) - This is the easiest and most comprehensive
2. **Add a Debug Panel** (Method 4, Option A) - As a fallback for when remote debugging isn't available
3. **Check the Network Tab** in DevTools to see API requests/responses
4. **Look for these specific logs:**
   - `✅ NIP-46: Connected via relay, signer pubkey:`
   - `📞 NIP-46: Calling connection callback with pubkey:`
   - `🔍 LoginModal: Getting public key from NIP-46 client...`
   - `✍️ NIP-46: Requesting signature for event:`
   - `🔍 NIP-46: Raw signature response:`

---

## Troubleshooting

**Chrome DevTools not showing device:**
- Make sure USB debugging is enabled
- Try revoking USB debugging authorizations and reconnect
- Check that Chrome has permission to access the device
- Try a different USB cable or port

**No logs appearing:**
- Make sure you're looking at the correct tab (Console tab)
- Check that filters aren't hiding logs
- Try clearing the console and testing again
- Verify your app is actually running and making requests

**ADB not working:**
- Install Android SDK Platform Tools
- Add ADB to your PATH
- Try `adb kill-server && adb start-server`
- Check device is authorized: `adb devices`

