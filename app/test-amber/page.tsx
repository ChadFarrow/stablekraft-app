'use client';

import React, { useState, useEffect, useRef } from 'react';
import { NIP46Client } from '@/lib/nostr/nip46-client';
import { NIP55Client } from '@/lib/nostr/nip55-client';
import { getDefaultRelays } from '@/lib/nostr/relay';
import { generateKeyPair, publicKeyToNpub } from '@/lib/nostr/keys';
import { isAndroid } from '@/lib/utils/device';
import { QRCodeSVG } from 'qrcode.react';
import { TestTube, CheckCircle, XCircle, AlertCircle, Wifi, Key, Download, Copy, QrCode, Trash2 } from 'lucide-react';

interface TestResult {
  test: string;
  status: 'pending' | 'success' | 'error';
  message: string;
  details?: any;
  timestamp: number;
}

interface LogEntry {
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  timestamp: number;
  data?: any;
}

export default function AmberTestPage() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [nip46Client, setNip46Client] = useState<NIP46Client | null>(null);
  const [nip55Client, setNip55Client] = useState<NIP55Client | null>(null);
  const [connectionState, setConnectionState] = useState<any>(null);
  const [customRelayUrl, setCustomRelayUrl] = useState<string>('');
  const [customToken, setCustomToken] = useState<string>('');
  const [manualUri, setManualUri] = useState<string>('');
  const [pendingRequests, setPendingRequests] = useState<Map<string, any>>(new Map());
  const [mounted, setMounted] = useState(false);
  const [receivedEvents, setReceivedEvents] = useState<any[]>([]);
  const [lastSignRequestTime, setLastSignRequestTime] = useState<number>(0);
  
  const logCaptureRef = useRef<{ originalLog: typeof console.log; originalError: typeof console.error; originalWarn: typeof console.warn; originalInfo: typeof console.info } | null>(null);
  const addLogRef = useRef<((level: LogEntry['level'], message: string, data?: any) => void) | null>(null);

  // Set mounted flag on client side only
  useEffect(() => {
    setMounted(true);
  }, []);

  // Capture console logs - only on client side after mount
  useEffect(() => {
    if (typeof window === 'undefined' || !mounted) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    logCaptureRef.current = { originalLog, originalError, originalWarn, originalInfo };

    console.log = (...args: any[]) => {
      originalLog(...args);
      if (addLogRef.current) {
        // Defer state update to avoid updating during render
        queueMicrotask(() => {
          if (addLogRef.current) {
            addLogRef.current('log', args.join(' '), args.length > 1 ? args : undefined);
          }
        });
      }
    };

    console.error = (...args: any[]) => {
      originalError(...args);
      if (addLogRef.current) {
        // Defer state update to avoid updating during render
        queueMicrotask(() => {
          if (addLogRef.current) {
            addLogRef.current('error', args.join(' '), args.length > 1 ? args : undefined);
          }
        });
      }
    };

    console.warn = (...args: any[]) => {
      originalWarn(...args);
      if (addLogRef.current) {
        // Defer state update to avoid updating during render
        queueMicrotask(() => {
          if (addLogRef.current) {
            addLogRef.current('warn', args.join(' '), args.length > 1 ? args : undefined);
          }
        });
      }
    };

    console.info = (...args: any[]) => {
      originalInfo(...args);
      if (addLogRef.current) {
        // Defer state update to avoid updating during render
        queueMicrotask(() => {
          if (addLogRef.current) {
            addLogRef.current('info', args.join(' '), args.length > 1 ? args : undefined);
          }
        });
      }
    };

    return () => {
      if (logCaptureRef.current) {
        console.log = logCaptureRef.current.originalLog;
        console.error = logCaptureRef.current.originalError;
        console.warn = logCaptureRef.current.originalWarn;
        console.info = logCaptureRef.current.originalInfo;
      }
    };
  }, [mounted]);

  // Monitor connection state and pending requests - only on client side
  useEffect(() => {
    if (!mounted) return;

    const interval = setInterval(() => {
      if (nip46Client) {
        const connection = nip46Client.getConnection();
        // Access pending requests from client (if exposed)
        const clientAny = nip46Client as any;
        const pendingReqs = clientAny.pendingRequests ? 
          Array.from(clientAny.pendingRequests.entries()).map(([id, req]: [string, any]) => ({
            id,
            method: req.method,
            startTime: req.startTime,
            elapsed: req.startTime ? Date.now() - req.startTime : 0,
          })) : [];
        
        setPendingRequests(new Map(pendingReqs.map((req: any) => [req.id, req])));
        
        setConnectionState({
          type: 'nip46',
          connected: nip46Client.isConnected(),
          connection,
          pubkey: nip46Client.getPubkey(),
          pendingRequests: pendingReqs,
          pendingRequestCount: pendingReqs.length,
        });
      } else if (nip55Client) {
        const connection = nip55Client.getConnection();
        const clientAny = nip55Client as any;
        const pendingSigs = clientAny.pendingSignatures ? 
          Array.from(clientAny.pendingSignatures.keys()) : [];
        
        setConnectionState({
          type: 'nip55',
          connected: nip55Client.isConnected(),
          connection,
          pubkey: connection?.pubkey,
          pendingSignatures: pendingSigs,
          pendingSignatureCount: pendingSigs.length,
        });
      } else {
        setConnectionState(null);
        setPendingRequests(new Map());
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [nip46Client, nip55Client, mounted]);

  const addLog = (level: LogEntry['level'], message: string, data?: any) => {
    if (!mounted) return; // Don't add logs during SSR
    setLogs(prev => [...prev, {
      level,
      message,
      timestamp: typeof window !== 'undefined' ? Date.now() : 0,
      data,
    }].slice(-500)); // Keep last 500 logs
  };

  // Store addLog in ref so console capture can use it
  useEffect(() => {
    addLogRef.current = addLog;
  }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTestResult = (test: string, status: TestResult['status'], message: string, details?: any) => {
    if (!mounted) return; // Don't add results during SSR
    setTestResults(prev => [...prev, { 
      test, 
      status, 
      message, 
      details,
      timestamp: typeof window !== 'undefined' ? Date.now() : 0,
    }]);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const clearState = async () => {
    if (nip46Client) {
      try {
        await nip46Client.disconnect();
      } catch (e) {
        console.error('Error disconnecting NIP-46:', e);
      }
      setNip46Client(null);
    }
    if (nip55Client) {
      try {
        await nip55Client.disconnect();
      } catch (e) {
        console.error('Error disconnecting NIP-55:', e);
      }
      setNip55Client(null);
    }
    
    if (typeof window !== 'undefined') {
      localStorage.removeItem('nostr_user');
      localStorage.removeItem('nostr_login_type');
      sessionStorage.removeItem('nip46_pending_connection');
    }
    
    setConnectionState(null);
    setPendingRequests(new Map());
    addTestResult('State Cleared', 'success', 'All connections and state cleared');
  };

  const exportLogs = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      testResults,
      logs,
      connectionState,
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amber-test-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addTestResult('Copied', 'success', 'Copied to clipboard');
  };

  // NIP-46 Tests
  const testNip46Connection = async () => {
    addTestResult('NIP-46 Connection', 'pending', 'Testing relay connection...');
    try {
      const relayUrl = customRelayUrl || getDefaultRelays()[0] || 'wss://relay.damus.io';
      const client = new NIP46Client();
      setNip46Client(client);
      
      // Get or create persistent app key pair (reused across sessions)
      const { getOrCreateAppKeyPair } = await import('@/lib/nostr/nip46-storage');
      const keyPair = getOrCreateAppKeyPair();
      const { privateKey, publicKey } = keyPair;
      const token = customToken || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Store connection info (for backward compatibility with sessionStorage)
      const connectionInfo = {
        token,
        privateKey,
        publicKey,
        relayUrl,
        createdAt: Date.now(),
      };
      sessionStorage.setItem('nip46_pending_connection', JSON.stringify(connectionInfo));
      
      await client.connect(relayUrl, token, false);
      
      addTestResult('NIP-46 Connection', 'success', 'Relay connection established', {
        relayUrl,
        appPubkey: publicKey.slice(0, 16) + '...',
      });
    } catch (error) {
      addTestResult('NIP-46 Connection', 'error', `Connection failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46UriGeneration = async () => {
    addTestResult('NIP-46 URI Generation', 'pending', 'Generating nostrconnect:// URI...');
    try {
      const { privateKey, publicKey } = generateKeyPair();
      const relayUrl = customRelayUrl || getDefaultRelays()[0] || 'wss://relay.damus.io';
      const token = customToken || `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Store connection info for later use
      const connectionInfo = {
        token,
        privateKey,
        publicKey,
        relayUrl,
        createdAt: Date.now(),
      };
      sessionStorage.setItem('nip46_pending_connection', JSON.stringify(connectionInfo));
      
      const relayEncoded = encodeURIComponent(relayUrl);
      const secretEncoded = encodeURIComponent(token);
      const nameEncoded = encodeURIComponent('Amber Test');
      const urlEncoded = encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '');
      
      const nostrconnectUri = `nostrconnect://${publicKey}?relay=${relayEncoded}&secret=${secretEncoded}&name=${nameEncoded}&url=${urlEncoded}`;
      
      addTestResult('NIP-46 URI Generation', 'success', 'URI generated successfully - QR code displayed below', {
        uri: nostrconnectUri,
        pubkey: publicKey.slice(0, 16) + '...',
        relayUrl,
        token: token.slice(0, 20) + '...',
      });
      
      setManualUri(nostrconnectUri);
    } catch (error) {
      addTestResult('NIP-46 URI Generation', 'error', `URI generation failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46GetPublicKey = async () => {
    addTestResult('NIP-46 Get Public Key', 'pending', 'Requesting public key from signer...');
    try {
      if (!nip46Client) {
        throw new Error('NIP-46 client not initialized. Run connection test first.');
      }
      
      // Check if we have a connection with Amber's pubkey
      const connection = nip46Client.getConnection();
      if (!connection?.pubkey) {
        addTestResult('NIP-46 Get Public Key', 'error', 'Not connected to Amber yet. Please:\n1. Scan the QR code with Amber\n2. Wait for connection (use "Test Connection Wait" button)\n3. Then try this again', {
          note: 'You need to wait for Amber to connect first. The connection event will provide Amber\'s pubkey, which is required to encrypt the get_public_key request properly.',
        });
        return;
      }
      
      addTestResult('NIP-46 Get Public Key', 'pending', `Connected to Amber (${connection.pubkey.slice(0, 16)}...). Requesting public key...`);
      
      const pubkey = await Promise.race([
        nip46Client.getPublicKey(),
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 90 seconds')), 90000)
        ),
      ]) as string;
      
      const npub = publicKeyToNpub(pubkey);
      
      addTestResult('NIP-46 Get Public Key', 'success', 'Public key received', {
        pubkey: pubkey.slice(0, 16) + '...',
        npub: npub.slice(0, 16) + '...',
        fullPubkey: pubkey,
        fullNpub: npub,
      });
    } catch (error) {
      addTestResult('NIP-46 Get Public Key', 'error', `Failed to get public key: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46SignEvent = async () => {
    // Rate limiting: prevent requests more than once every 5 seconds
    const now = Date.now();
    const timeSinceLastRequest = now - lastSignRequestTime;
    const minInterval = 5000; // 5 seconds
    
    if (timeSinceLastRequest < minInterval) {
      const waitTime = Math.ceil((minInterval - timeSinceLastRequest) / 1000);
      addTestResult('NIP-46 Sign Event', 'error', 
        `Please wait ${waitTime} second${waitTime > 1 ? 's' : ''} before making another request. This prevents hitting Amber's rate limit.`,
        { waitTime, timeSinceLastRequest, minInterval });
      return;
    }
    
    setLastSignRequestTime(now);
    addTestResult('NIP-46 Sign Event', 'pending', 'Requesting signature for test event...');
    try {
      if (!nip46Client) {
        throw new Error('NIP-46 client not initialized. Run connection test first.');
      }
      
      // Check connection status
      const connection = nip46Client.getConnection();
      const isConnected = nip46Client.isConnected();
      const pubkey = nip46Client.getPubkey();
      
      console.log('🔍 NIP-46: Pre-sign check:', {
        hasClient: !!nip46Client,
        isConnected,
        hasConnection: !!connection,
        hasPubkey: !!pubkey,
        pubkey: pubkey ? pubkey.slice(0, 16) + '...' : 'N/A',
        connectionPubkey: connection?.pubkey ? connection.pubkey.slice(0, 16) + '...' : 'N/A',
        signerUrl: connection?.signerUrl || 'N/A',
      });
      
      if (!isConnected || !pubkey) {
        throw new Error(`Not connected to Amber. Connection status: connected=${isConnected}, hasPubkey=${!!pubkey}. Please run "Test Connection Wait" first.`);
      }
      
      console.log('✅ NIP-46: Connection verified, proceeding with sign request');
      console.log('📱 IMPORTANT: Watch your phone - Amber should show a notification or prompt');
      console.log('🔵 [TEST] About to call nip46Client.signEvent() - this should trigger a signature request, NOT just get the pubkey');
      
      // Use Kind 1 (note) instead of Kind 22242 - simpler and more widely supported
      // Kind 22242 might be causing Amber to crash
      const event = {
        kind: 1,
        tags: [],
        content: 'Test message from Amber integration test - ' + Date.now(),
        created_at: Math.floor(Date.now() / 1000),
      };
      
      console.log('🔵 [TEST] Event to sign:', event);
      console.log('🔵 [TEST] Calling nip46Client.signEvent() now...');
      
      const signedEvent = await Promise.race([
        nip46Client.signEvent(event as any),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 90 seconds. Amber received the request (you got a notification), but no response came back. This usually means:\n1. Amber requires manual approval - check your phone and approve the request\n2. Amber is auto-approving but not sending responses (check Amber settings)\n3. Amber sent a response but it\'s not reaching us (check relay connection)')), 90000)
        ),
      ]) as any;
      
      console.log('✅ [TEST] signEvent() returned successfully:', {
        hasId: !!signedEvent?.id,
        hasSig: !!signedEvent?.sig,
        kind: signedEvent?.kind,
      });
      
      addTestResult('NIP-46 Sign Event', 'success', 'Event signed successfully', {
        eventId: signedEvent.id?.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey?.slice(0, 16) + '...',
        sig: signedEvent.sig?.slice(0, 16) + '...',
        kind: signedEvent.kind,
        fullEvent: signedEvent,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ NIP-46: Sign event failed:', errorMsg);
      addTestResult('NIP-46 Sign Event', 'error', `Failed to sign event: ${errorMsg}`, {
        error: errorMsg,
        troubleshooting: [
          '1. Make sure you are connected (run "Test Connection Wait" first)',
          '2. Check console logs for "Request event published" message',
          '3. Verify Amber is connected to the same relay',
          '4. Check if Amber received the request (look for notifications)',
        ],
      });
    }
  };

  const testNip46SignNote = async () => {
    addTestResult('NIP-46 Sign Note (Kind 1)', 'pending', 'Requesting signature for note event (may require approval)...');
    try {
      if (!nip46Client) {
        throw new Error('NIP-46 client not initialized. Run connection test first.');
      }
      
      // Check connection status
      const connection = nip46Client.getConnection();
      const isConnected = nip46Client.isConnected();
      const pubkey = nip46Client.getPubkey();
      
      console.log('🔍 NIP-46: Pre-sign check:', {
        hasClient: !!nip46Client,
        isConnected,
        hasConnection: !!connection,
        hasPubkey: !!pubkey,
        pubkey: pubkey ? pubkey.slice(0, 16) + '...' : 'N/A',
        connectionPubkey: connection?.pubkey ? connection.pubkey.slice(0, 16) + '...' : 'N/A',
        signerUrl: connection?.signerUrl || 'N/A',
      });
      
      if (!isConnected || !pubkey) {
        throw new Error(`Not connected to Amber. Connection status: connected=${isConnected}, hasPubkey=${!!pubkey}. Please run "Test Connection Wait" first.`);
      }
      
      console.log('✅ NIP-46: Connection verified, proceeding with sign request');
      console.log('📱 IMPORTANT: Watch your phone - Amber should show a notification or approval prompt');
      console.log('📝 Requesting signature for note event (kind 1) - this may require approval in Amber');
      
      const event = {
        kind: 1,
        tags: [],
        content: `Test note from Amber integration - ${new Date().toISOString()}`,
        created_at: Math.floor(Date.now() / 1000),
      };
      
      const signedEvent = await Promise.race([
        nip46Client.signEvent(event as any),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 90 seconds. Check if Amber received the request.')), 90000)
        ),
      ]) as any;
      
      addTestResult('NIP-46 Sign Note (Kind 1)', 'success', 'Note event signed successfully', {
        eventId: signedEvent.id?.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey?.slice(0, 16) + '...',
        sig: signedEvent.sig?.slice(0, 16) + '...',
        kind: signedEvent.kind,
        content: signedEvent.content?.substring(0, 50) + '...',
        fullEvent: signedEvent,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ NIP-46: Sign note failed:', errorMsg);
      addTestResult('NIP-46 Sign Note (Kind 1)', 'error', `Failed to sign note: ${errorMsg}`, {
        error: errorMsg,
        troubleshooting: [
          '1. Make sure you are connected (run "Test Connection Wait" first)',
          '2. Check console logs for "Request event published" message',
          '3. Verify Amber is connected to the same relay',
          '4. Check if Amber received the request (look for notifications)',
        ],
      });
    }
  };

  const testNip46Disconnect = async () => {
    addTestResult('NIP-46 Disconnect', 'pending', 'Disconnecting from Amber...');
    try {
      if (nip46Client) {
        // Clear connection
        nip46Client.disconnect();
      }
      
      // Clear from state
      setNip46Client(null);
      setConnectionState(null);
      setPendingRequests(new Map());
      
      // Clear ALL localStorage items related to NIP-46
      if (typeof window !== 'undefined') {
        // Clear standard items
        localStorage.removeItem('nostr_user');
        localStorage.removeItem('nostr_login_type');
        localStorage.removeItem('nostr_nip46_connection');
        sessionStorage.removeItem('nip46_pending_connection');
        
        // Clear any NIP-46 connection data (but keep the app key pair for consistency)
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && (key.includes('nip46') || key.includes('nostr_connect'))) {
            // Don't remove the app key pair - it should persist for consistency
            if (key !== 'nostr_nip46_app_keypair') {
              keysToRemove.push(key);
            }
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
        console.log('🧹 Cleared all NIP-46 connection data from localStorage (app key pair preserved)');
      }
      
      addTestResult('NIP-46 Disconnect', 'success', '⚠️ IMPORTANT: You must also clear Amber\'s connection cache on your phone!', {
        note: 'Amber is responding to an old connection. Steps to fix:\n1. In Amber app, go to Settings > Connected Apps\n2. Remove/delete the connection for this app\n3. Scan a fresh QR code\n4. Try signing again\n\nNote: The app key pair is preserved for consistency. If you need to reset it completely, clear localStorage manually.',
        warning: 'The app connection is cleared, but Amber still has the old connection cached. You MUST clear it in Amber\'s settings.',
      });
    } catch (error) {
      addTestResult('NIP-46 Disconnect', 'error', `Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46ConnectionWait = async () => {
    console.log('🔵 Test Connection Wait button clicked');
    addTestResult('NIP-46 Connection Wait', 'pending', 'Waiting for Amber to connect via relay...');
    try {
      // Get connection info first
      const pendingConnection = typeof window !== 'undefined' 
        ? sessionStorage.getItem('nip46_pending_connection')
        : null;
      
      console.log('🔵 Checking for pending connection...', { hasPendingConnection: !!pendingConnection });
      if (!pendingConnection) {
        const errorMsg = 'No pending connection found. Click "Test URI Generation" first to create a connection and scan the QR code with Amber.';
        console.error('❌', errorMsg);
        addTestResult('NIP-46 Connection Wait', 'error', errorMsg, {
          instructions: [
            '1. Click "Test URI Generation" to create a connection',
            '2. Scan the QR code with Amber',
            '3. Approve the connection in Amber',
            '4. Then click "Test Connection Wait" again',
          ],
        });
        return;
      }
      
      const connectionInfo = JSON.parse(pendingConnection);
      
      // Check if already connected
      if (nip46Client) {
        const existingConnection = nip46Client.getConnection();
        if (existingConnection?.pubkey) {
          addTestResult('NIP-46 Connection Wait', 'success', 'Already connected!', {
            pubkey: existingConnection.pubkey.slice(0, 16) + '...',
            npub: publicKeyToNpub(existingConnection.pubkey).slice(0, 16) + '...',
            fullPubkey: existingConnection.pubkey,
            fullNpub: publicKeyToNpub(existingConnection.pubkey),
          });
          return;
        }
      }
      
      // Initialize client if it doesn't exist
      console.log('🔵 Checking if NIP-46 client exists...', { hasClient: !!nip46Client });
      let client = nip46Client;
      if (!client) {
        console.log('🔵 NIP-46 client not found, initializing...');
        const relayUrl = connectionInfo.relayUrl || getDefaultRelays()[0] || 'wss://relay.damus.io';
        client = new NIP46Client();
        setNip46Client(client);
        
        // Connect to relay
        addTestResult('NIP-46 Connection Wait', 'pending', 'Initializing connection to relay...');
        await client.connect(relayUrl, connectionInfo.token, false);
        console.log('✅ NIP-46 client initialized and connected');
      }
      
      if (!client) {
        throw new Error('Failed to initialize NIP-46 client');
      }
      
      // Set up connection callback to detect when Amber connects
      let connectionResolved = false;
      const connectionPromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!connectionResolved) {
            connectionResolved = true;
            reject(new Error('Timeout: Amber did not connect within 90 seconds.\n\nMake sure you:\n1. Scanned the QR code with Amber (from "Test URI Generation")\n2. Approved the connection in Amber\n3. Amber is connected to the same relay (wss://relay.damus.io)\n\nIf you haven\'t scanned the QR code yet, click "Test URI Generation" first.'));
          }
        }, 90000);
        
        client.setOnConnection((pubkey: string) => {
          if (!connectionResolved) {
            connectionResolved = true;
            clearTimeout(timeout);
            resolve(pubkey);
          }
        });
      });
      
      // Wait for connection callback (Amber will send a connection event after scanning QR)
      addTestResult('NIP-46 Connection Wait', 'pending', 'Waiting for Amber to connect... Make sure you have:\n1. Scanned the QR code with Amber\n2. Approved the connection in Amber');
      
      // Wait for the connection callback
      const pubkey = await connectionPromise;
      
      console.log('✅ Connection wait succeeded, pubkey:', pubkey.slice(0, 16) + '...');
      addTestResult('NIP-46 Connection Wait', 'success', 'Amber connected successfully!', {
        pubkey: pubkey.slice(0, 16) + '...',
        npub: publicKeyToNpub(pubkey).slice(0, 16) + '...',
        fullPubkey: pubkey,
        fullNpub: publicKeyToNpub(pubkey),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('❌ Connection wait failed:', error);
      console.error('❌ Error details:', { error, errorMsg, stack: error instanceof Error ? error.stack : 'N/A' });
      
      // Provide helpful instructions based on the error
      let helpfulMsg = errorMsg;
      if (errorMsg.includes('Timeout')) {
        helpfulMsg += '\n\nTroubleshooting:\n1. Make sure you clicked "Test URI Generation" first\n2. Scan the QR code with Amber\n3. Approve the connection in Amber\n4. Ensure Amber is connected to wss://relay.damus.io';
      }
      
      addTestResult('NIP-46 Connection Wait', 'error', helpfulMsg, {
        error: errorMsg,
        instructions: [
          '1. Click "Test URI Generation" to get a QR code',
          '2. Open Amber on your phone',
          '3. Scan the QR code',
          '4. Approve the connection in Amber',
          '5. Click "Test Connection Wait" again',
        ],
      });
    }
  };

  const testNip46InspectEvents = async () => {
    addTestResult('NIP-46 Inspect Events', 'pending', 'Inspecting recent relay events...');
    try {
      if (!nip46Client) {
        throw new Error('NIP-46 client not initialized. Run connection test first.');
      }
      
      // Get connection info
      const pendingConnection = typeof window !== 'undefined' 
        ? sessionStorage.getItem('nip46_pending_connection')
        : null;
      
      if (!pendingConnection) {
        throw new Error('No pending connection found');
      }
      
      const connectionInfo = JSON.parse(pendingConnection);
      const appPubkey = connectionInfo.publicKey;
      const connection = nip46Client.getConnection();
      
      // Access the relay client to inspect events
      const clientAny = nip46Client as any;
      const relayClient = clientAny.relayClient;
      
      if (!relayClient) {
        throw new Error('Relay client not available');
      }
      
      // Try to query recent events from the relay
      const relayUrl = connection?.signerUrl || connectionInfo.relayUrl;
      
      addTestResult('NIP-46 Inspect Events', 'success', 'Connection info retrieved', {
        appPubkey: appPubkey.slice(0, 16) + '...',
        relayUrl,
        hasRelayClient: !!relayClient,
        connectionState: {
          connected: connection?.connected,
          hasPubkey: !!connection?.pubkey,
          pubkey: connection?.pubkey?.slice(0, 16) + '...',
        },
        note: 'Check the event logs above to see what events are being received and their tags',
      });
    } catch (error) {
      addTestResult('NIP-46 Inspect Events', 'error', `Inspection failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46Connect = async () => {
    addTestResult('NIP-46 Connect', 'pending', 'Sending connect request to Amber...');
    try {
      if (!nip46Client) {
        throw new Error('NIP-46 client not initialized. Run connection test first.');
      }
      
      // Get connection info
      const pendingConnection = typeof window !== 'undefined' 
        ? sessionStorage.getItem('nip46_pending_connection')
        : null;
      
      if (!pendingConnection) {
        throw new Error('No pending connection found. Generate URI first.');
      }
      
      const connectionInfo = JSON.parse(pendingConnection);
      
      // Call connect method - this should establish the connection
      // Note: connect might not be a standard NIP-46 method, but some implementations use it
      const clientAny = nip46Client as any;
      
      // Try to call connect via sendRequest if available
      if (clientAny.sendRequest) {
        try {
          const result = await Promise.race([
            clientAny.sendRequest('connect', [connectionInfo.token]),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Timeout after 30 seconds')), 30000)
            ),
          ]);
          
          addTestResult('NIP-46 Connect', 'success', 'Connect request sent', {
            result: typeof result === 'string' ? result.slice(0, 16) + '...' : result,
          });
        } catch (error) {
          addTestResult('NIP-46 Connect', 'error', `Connect failed: ${error instanceof Error ? error.message : String(error)}`, error);
        }
      } else {
        addTestResult('NIP-46 Connect', 'error', 'sendRequest method not available', {
          note: 'The connect method might not be needed. Try get_public_key instead.',
        });
      }
    } catch (error) {
      addTestResult('NIP-46 Connect', 'error', `Connect test failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip46FullFlow = async () => {
    addTestResult('NIP-46 Full Flow', 'pending', 'Running complete NIP-46 flow...');
    try {
      await testNip46Connection();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await testNip46GetPublicKey();
      await new Promise(resolve => setTimeout(resolve, 1000));
      await testNip46SignEvent();
      
      addTestResult('NIP-46 Full Flow', 'success', 'Complete flow executed successfully');
    } catch (error) {
      addTestResult('NIP-46 Full Flow', 'error', `Full flow failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  // NIP-55 Tests
  const testNip55Availability = async () => {
    addTestResult('NIP-55 Availability', 'pending', 'Checking NIP-55 availability...');
    try {
      const available = NIP55Client.isAvailable();
      const isAndroidDevice = isAndroid();
      
      addTestResult('NIP-55 Availability', available ? 'success' : 'error', 
        available ? 'NIP-55 is available' : 'NIP-55 is not available (Android required)',
        {
          available,
          isAndroidDevice,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
        });
    } catch (error) {
      addTestResult('NIP-55 Availability', 'error', `Availability check failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip55Connection = async () => {
    addTestResult('NIP-55 Connection', 'pending', 'Connecting via NIP-55...');
    try {
      if (!NIP55Client.isAvailable()) {
        throw new Error('NIP-55 is not available on this device');
      }
      
      const client = new NIP55Client();
      setNip55Client(client);
      
      const pubkey = await Promise.race([
        client.getPublicKey(),
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 90 seconds')), 90000)
        ),
      ]) as string;
      
      const npub = publicKeyToNpub(pubkey);
      
      addTestResult('NIP-55 Connection', 'success', 'Connected and got public key', {
        pubkey: pubkey.slice(0, 16) + '...',
        npub: npub.slice(0, 16) + '...',
        fullPubkey: pubkey,
        fullNpub: npub,
      });
    } catch (error) {
      addTestResult('NIP-55 Connection', 'error', `Connection failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip55UriGeneration = async () => {
    addTestResult('NIP-55 URI Generation', 'pending', 'Generating nostrsigner:// URI...');
    try {
      if (!NIP55Client.isAvailable()) {
        throw new Error('NIP-55 is not available on this device');
      }
      
      const client = nip55Client || new NIP55Client();
      if (!nip55Client) {
        setNip55Client(client);
      }
      
      // Get pubkey first
      let pubkey: string;
      try {
        pubkey = await client.getPublicKey();
      } catch {
        // If not connected, use a dummy event to trigger connection
        const dummyEvent = {
          kind: 0,
          tags: [],
          content: '',
          created_at: Math.floor(Date.now() / 1000),
        };
        const signed = await client.signEvent(dummyEvent);
        pubkey = signed.pubkey;
      }
      
      const eventTemplate = {
        kind: 22242,
        tags: [['challenge', 'test']],
        content: '',
        created_at: Math.floor(Date.now() / 1000),
      };
      
      const signRequest = {
        event: { ...eventTemplate, pubkey },
        type: 'sign_event',
      };
      
      const requestJson = JSON.stringify(signRequest);
      const encodedJson = encodeURIComponent(requestJson);
      const callbackUrl = typeof window !== 'undefined' 
        ? `${window.location.origin}${window.location.pathname}?nip55-callback=true&requestId=test-${Date.now()}`
        : '';
      
      const nip55Uri = `nostrsigner:${encodedJson}?compressionType=none&returnType=signature&type=sign_event&callbackUrl=${encodeURIComponent(callbackUrl)}`;
      
      addTestResult('NIP-55 URI Generation', 'success', 'URI generated successfully', {
        uri: nip55Uri.substring(0, 200) + '...',
        pubkey: pubkey.slice(0, 16) + '...',
        callbackUrl,
        fullUri: nip55Uri,
      });
      
      setManualUri(nip55Uri);
    } catch (error) {
      addTestResult('NIP-55 URI Generation', 'error', `URI generation failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip55SignEvent = async () => {
    addTestResult('NIP-55 Sign Event', 'pending', 'Requesting signature via NIP-55...');
    try {
      if (!NIP55Client.isAvailable()) {
        throw new Error('NIP-55 is not available on this device');
      }
      
      const client = nip55Client || new NIP55Client();
      if (!nip55Client) {
        setNip55Client(client);
      }
      
      const eventTemplate = {
        kind: 22242,
        tags: [['challenge', 'test-challenge-' + Date.now()]],
        content: '',
        created_at: Math.floor(Date.now() / 1000),
      };
      
      const signedEvent = await Promise.race([
        client.signEvent(eventTemplate),
        new Promise<any>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout after 90 seconds')), 90000)
        ),
      ]) as any;
      
      addTestResult('NIP-55 Sign Event', 'success', 'Event signed successfully', {
        eventId: signedEvent.id?.slice(0, 16) + '...',
        pubkey: signedEvent.pubkey?.slice(0, 16) + '...',
        sig: signedEvent.sig?.slice(0, 16) + '...',
        kind: signedEvent.kind,
        fullEvent: signedEvent,
      });
    } catch (error) {
      addTestResult('NIP-55 Sign Event', 'error', `Failed to sign event: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const testNip55CallbackHandling = async () => {
    addTestResult('NIP-55 Callback Handling', 'pending', 'Testing callback URL parsing and response handling...');
    try {
      if (!NIP55Client.isAvailable()) {
        throw new Error('NIP-55 is not available on this device');
      }
      
      // Check if we're returning from a callback
      const search = typeof window !== 'undefined' ? window.location.search : '';
      const hash = typeof window !== 'undefined' ? window.location.hash : '';
      const fullUrl = typeof window !== 'undefined' ? window.location.href : '';
      
      const isCallback = search.includes('nip55-callback') || 
                        hash.includes('nip55-callback') || 
                        fullUrl.includes('nip55-callback');
      
      if (isCallback) {
        // Parse callback parameters
        const queryParams = new URLSearchParams(search);
        const hashParams = hash.includes('?') 
          ? new URLSearchParams(hash.split('?')[1]) 
          : new URLSearchParams();
        
        const requestId = queryParams.get('requestId') || hashParams.get('requestId');
        const signature = queryParams.get('signature') || hashParams.get('signature');
        const pubkey = queryParams.get('pubkey') || hashParams.get('pubkey');
        const error = queryParams.get('error') || hashParams.get('error');
        
        addTestResult('NIP-55 Callback Handling', 'success', 'Callback detected and parsed', {
          requestId,
          hasSignature: !!signature,
          signatureLength: signature?.length,
          hasPubkey: !!pubkey,
          pubkeyLength: pubkey?.length,
          error,
          allQueryParams: Object.fromEntries(queryParams),
          allHashParams: Object.fromEntries(hashParams),
          callbackUrl: fullUrl,
        });
      } else {
        // Simulate callback parsing
        const testCallbackUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}${typeof window !== 'undefined' ? window.location.pathname : ''}?nip55-callback=true&requestId=test-123&signature=abc123&pubkey=def456`;
        const testUrl = new URL(testCallbackUrl);
        const testParams = new URLSearchParams(testUrl.search);
        
        addTestResult('NIP-55 Callback Handling', 'success', 'Callback handler ready (no active callback)', {
          currentUrl: fullUrl,
          testCallbackUrl,
          testParams: Object.fromEntries(testParams),
          note: 'Callback handler is set up and will process callbacks when Amber returns',
        });
      }
    } catch (error) {
      addTestResult('NIP-55 Callback Handling', 'error', `Callback handling test failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'pending':
        return <AlertCircle className="w-4 h-4 text-yellow-400 animate-pulse" />;
      default:
        return null;
    }
  };

  const getLogIcon = (level: LogEntry['level']) => {
    switch (level) {
      case 'error':
        return <XCircle className="w-3 h-3 text-red-400" />;
      case 'warn':
        return <AlertCircle className="w-3 h-3 text-yellow-400" />;
      case 'info':
        return <AlertCircle className="w-3 h-3 text-blue-400" />;
      default:
        return <CheckCircle className="w-3 h-3 text-gray-400" />;
    }
  };

  // Don't render until mounted to avoid hydration issues
  if (!mounted) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-gray-900 rounded-lg p-6">
          <div className="text-white">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-gray-900 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-6">
          <TestTube className="w-6 h-6 text-blue-400" />
          <h1 className="text-2xl font-bold text-white">Amber/NIP-46/NIP-55 Test Dashboard</h1>
        </div>

        {/* Connection State Monitor */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3 flex-wrap">
              <Wifi className="w-5 h-5 text-gray-400" />
              <span className="text-white font-medium">Connection State:</span>
              <span className={`px-3 py-1 rounded-full text-sm ${
                connectionState?.connected 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {connectionState?.connected ? 'Connected' : 'Not Connected'}
              </span>
              {connectionState?.type && (
                <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
                  {connectionState.type.toUpperCase()}
                </span>
              )}
              {connectionState?.pendingRequestCount > 0 && (
                <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-400">
                  {connectionState.pendingRequestCount} Pending Request{connectionState.pendingRequestCount !== 1 ? 's' : ''}
                </span>
              )}
              {connectionState?.pendingSignatureCount > 0 && (
                <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-400">
                  {connectionState.pendingSignatureCount} Pending Signature{connectionState.pendingSignatureCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button
              onClick={clearState}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear State
            </button>
          </div>
          
          {/* Pending Requests Display */}
          {connectionState?.pendingRequests && connectionState.pendingRequests.length > 0 && (
            <div className="mt-3 p-3 bg-gray-900 rounded">
              <h4 className="text-sm font-semibold text-yellow-400 mb-2">Pending Requests:</h4>
              <div className="space-y-1">
                {connectionState.pendingRequests.map((req: any, idx: number) => (
                  <div key={idx} className="text-xs text-gray-300">
                    <span className="font-mono">{req.id.slice(0, 16)}...</span>
                    <span className="ml-2 text-gray-500">({req.method})</span>
                    {req.elapsed > 0 && (
                      <span className="ml-2 text-gray-500">
                        - {Math.floor(req.elapsed / 1000)}s elapsed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Relay Status Display (for NIP-46) */}
          {connectionState?.type === 'nip46' && connectionState?.connection && (
            <div className="mt-3 p-3 bg-gray-900 rounded">
              <h4 className="text-sm font-semibold text-blue-400 mb-2">Relay Status:</h4>
              <div className="text-xs text-gray-300 space-y-1">
                <div>
                  <span className="text-gray-500">Relay URL:</span>{' '}
                  <span className="font-mono">{connectionState.connection.signerUrl || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Connected:</span>{' '}
                  <span className={connectionState.connected ? 'text-green-400' : 'text-red-400'}>
                    {connectionState.connected ? 'Yes' : 'No'}
                  </span>
                </div>
                {connectionState.eventsReceived !== undefined && (
                  <div>
                    <span className="text-gray-500">Events Received:</span>{' '}
                    <span className="font-mono">{connectionState.eventsReceived}</span>
                  </div>
                )}
                {connectionState.connection.connectedAt && (
                  <div>
                    <span className="text-gray-500">Connected At:</span>{' '}
                    <span>{new Date(connectionState.connection.connectedAt).toLocaleString()}</span>
                  </div>
                )}
                {connectionState.pubkey && (
                  <div>
                    <span className="text-gray-500">Pubkey:</span>{' '}
                    <span className="font-mono">{connectionState.pubkey.slice(0, 16)}...</span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Diagnostic Info */}
          {connectionState?.type === 'nip46' && (
            <div className="mt-3 p-3 bg-yellow-900/30 rounded border border-yellow-700/50">
              <h4 className="text-sm font-semibold text-yellow-400 mb-2">⚠️ Diagnostic Info:</h4>
              <div className="text-xs text-gray-300 space-y-1">
                <div>
                  <span className="text-yellow-400">Issue:</span> Events are being received but not tagged with your app pubkey.
                </div>
                <div>
                  <span className="text-yellow-400">Possible causes:</span>
                  <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                    <li>Amber is not tagging responses with your app pubkey</li>
                    <li>Amber might be using a different pubkey format</li>
                    <li>Encryption keys might not match (invalid MAC errors)</li>
                  </ul>
                </div>
                <div className="mt-2">
                  <span className="text-yellow-400">Check the Event Logs section below</span> to see all received events and their tags.
                </div>
              </div>
            </div>
          )}
          
          {connectionState && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300">Full Connection Details</summary>
              <pre className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-300 overflow-x-auto">
                {JSON.stringify(connectionState, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* QR Code Display */}
        {manualUri && manualUri.startsWith('nostrconnect://') && (
          <div className="mb-6 p-4 bg-gray-800 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <QrCode className="w-5 h-5 text-blue-400" />
              <h3 className="text-white font-semibold">Scan QR Code with Amber</h3>
            </div>
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="bg-white p-4 rounded-lg">
                <QRCodeSVG
                  value={manualUri}
                  size={256}
                  level="M"
                  includeMargin={true}
                />
              </div>
              <div className="flex-1">
                <p className="text-gray-300 text-sm mb-3">
                  Open Amber on your phone and scan this QR code to connect. After scanning, approve the connection in Amber, then come back and click &quot;Test Connection Wait&quot; or &quot;Test Get Public Key&quot;.
                </p>
                <div className="mb-3">
                  <label className="block text-sm text-gray-400 mb-1">Connection URI:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={manualUri}
                      readOnly
                      className="flex-1 px-3 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 text-xs font-mono"
                    />
                    <button
                      onClick={() => copyToClipboard(manualUri)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      title="Copy URI"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setManualUri('')}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
                >
                  Clear QR Code
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Test Controls - Simplified */}
        <div className="mb-6 p-4 bg-gray-800 rounded-lg">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Key className="w-5 h-5" />
            NIP-46 Tests
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              onClick={testNip46UriGeneration}
              className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              1. Generate QR Code
            </button>
            <button
              onClick={testNip46ConnectionWait}
              className="px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              2. Wait for Connection
            </button>
            <button
              onClick={testNip46SignEvent}
              className="px-4 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              3. Test Sign Event
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={clearResults}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
          >
            Clear Results
          </button>
          <button
            onClick={exportLogs}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm"
          >
            <Download className="w-4 h-4" />
            Export Logs
          </button>
        </div>

        {/* Test Results */}
        <div className="mb-6">
          <h3 className="text-white font-semibold mb-3">Test Results</h3>
          {testResults.length === 0 ? (
            <div className="text-gray-400 text-center py-8 bg-gray-800 rounded-lg">
              No tests run yet. Click a test button to start.
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {testResults.map((result, index) => (
                <div key={index} className="p-4 bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusIcon(result.status)}
                    <span className="font-medium text-white">{result.test}</span>
                    <span className={`px-2 py-1 rounded text-xs ${
                      result.status === 'success' 
                        ? 'bg-green-500/20 text-green-400'
                        : result.status === 'error'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-yellow-500/20 text-yellow-400'
                    }`}>
                      {result.status}
                    </span>
                    <span className="text-xs text-gray-500 ml-auto">
                      {new Date(result.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-2">{result.message}</p>
                  {result.details && (
                    <details className="text-xs text-gray-400">
                      <summary className="cursor-pointer hover:text-gray-300">Details</summary>
                      <pre className="mt-2 p-2 bg-gray-900 rounded overflow-x-auto">
                        {JSON.stringify(result.details, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Log Viewer */}
        <div>
          <h3 className="text-white font-semibold mb-3">Event Logs ({logs.length})</h3>
          <div className="bg-gray-800 rounded-lg p-4 max-h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-gray-400 text-center py-8">
                No logs yet. Logs will appear here as tests run.
              </div>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.slice(-100).map((log, index) => (
                  <div key={index} className={`flex items-start gap-2 ${
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-yellow-400' :
                    log.level === 'info' ? 'text-blue-400' :
                    'text-gray-300'
                  }`}>
                    {getLogIcon(log.level)}
                    <span className="text-gray-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

