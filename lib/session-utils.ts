/**
 * Session utilities for anonymous favorites system
 * Generates and retrieves session IDs from localStorage
 */

const SESSION_ID_KEY = 'favorites-session-id';

/**
 * Generate a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or create session ID from localStorage
 * Returns existing session ID if present, otherwise generates and stores a new one
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') {
    // Server-side: return empty string or generate a temporary ID
    return '';
  }

  try {
    let sessionId = localStorage.getItem(SESSION_ID_KEY);
    
    if (!sessionId) {
      sessionId = generateUUID();
      localStorage.setItem(SESSION_ID_KEY, sessionId);
    }
    
    return sessionId;
  } catch (error) {
    console.error('Error getting session ID from localStorage:', error);
    // Fallback: generate a temporary session ID
    return generateUUID();
  }
}

/**
 * Get session ID without creating one if it doesn't exist
 * Useful for checking if a session exists
 */
export function getSessionIdIfExists(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return localStorage.getItem(SESSION_ID_KEY);
  } catch (error) {
    console.error('Error reading session ID from localStorage:', error);
    return null;
  }
}

/**
 * Clear session ID from localStorage
 * Note: This will cause favorites to be associated with a new session
 */
export function clearSessionId(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(SESSION_ID_KEY);
  } catch (error) {
    console.error('Error clearing session ID from localStorage:', error);
  }
}

/**
 * Get session ID from request headers or cookies
 * For use in API routes
 */
export function getSessionIdFromRequest(request: Request): string | null {
  // Try to get from header first
  const headerSessionId = request.headers.get('x-session-id');
  if (headerSessionId) {
    return headerSessionId;
  }

  // Try to get from cookie
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    return cookies[SESSION_ID_KEY] || null;
  }

  return null;
}

