'use client';

import { useState, useEffect, useRef } from 'react';

// Global log storage
const logs: Array<{ level: string; message: string; timestamp: number }> = [];
const MAX_LOGS = 100;

// Override console methods to capture logs
if (typeof window !== 'undefined') {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  const addLog = (level: string, ...args: any[]) => {
    const message = args
      .map(a => {
        if (typeof a === 'object') {
          try {
            return JSON.stringify(a, null, 2);
          } catch {
            return String(a);
          }
        }
        return String(a);
      })
      .join(' ');

    logs.push({
      level,
      message,
      timestamp: Date.now(),
    });

    // Keep only last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
  };

  console.log = (...args: any[]) => {
    addLog('log', ...args);
    originalLog(...args);
  };

  console.error = (...args: any[]) => {
    addLog('error', ...args);
    originalError(...args);
  };

  console.warn = (...args: any[]) => {
    addLog('warn', ...args);
    originalWarn(...args);
  };

  console.info = (...args: any[]) => {
    addLog('info', ...args);
    originalInfo(...args);
  };
}

export function DebugPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [logEntries, setLogEntries] = useState<typeof logs>([]);
  const [filter, setFilter] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (logs.length > 0) {
        setLogEntries([...logs]);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && isOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logEntries, autoScroll, isOpen]);

  const filteredLogs = logEntries.filter(log => {
    if (!filter) return true;
    const searchTerm = filter.toLowerCase();
    return (
      log.message.toLowerCase().includes(searchTerm) ||
      log.level.toLowerCase().includes(searchTerm)
    );
  });

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error':
        return '#ff6b6b';
      case 'warn':
        return '#ffd93d';
      case 'info':
        return '#6bcf7f';
      default:
        return '#d4d4d4';
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          zIndex: 99999,
          padding: '12px 16px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 'bold',
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        }}
      >
        🐛 Debug ({logs.length})
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
        height: '60vh',
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        borderTop: '2px solid #007bff',
        boxShadow: '0 -4px 6px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 15px',
          backgroundColor: '#2d2d2d',
          borderBottom: '1px solid #444',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
            🐛 Debug Logs ({filteredLogs.length}/{logs.length})
          </h3>
          <label style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              style={{ margin: 0 }}
            />
            Auto-scroll
          </label>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            placeholder="Filter logs..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{
              padding: '5px 10px',
              backgroundColor: '#1e1e1e',
              color: '#d4d4d4',
              border: '1px solid #444',
              borderRadius: '4px',
              fontSize: '12px',
              width: '150px',
            }}
          />
          <button
            onClick={() => {
              logs.length = 0;
              setLogEntries([]);
            }}
            style={{
              padding: '5px 12px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Clear
          </button>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              padding: '5px 12px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Close
          </button>
        </div>
      </div>

      {/* Logs */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '10px',
          fontFamily: 'monospace',
          fontSize: '12px',
          lineHeight: '1.5',
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
            No logs yet. Try interacting with the app to see logs here.
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div
              key={i}
              style={{
                marginBottom: '8px',
                padding: '8px',
                backgroundColor: i % 2 === 0 ? '#252525' : '#1e1e1e',
                borderRadius: '4px',
                borderLeft: `3px solid ${getLogColor(log.level)}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span
                  style={{
                    color: getLogColor(log.level),
                    fontWeight: 'bold',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                  }}
                >
                  {log.level}
                </span>
                <span style={{ color: '#888', fontSize: '11px' }}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: '#d4d4d4',
                }}
              >
                {log.message}
              </div>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

