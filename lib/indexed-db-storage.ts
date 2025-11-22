/**
 * IndexedDB-based storage utility for non-blocking, async storage operations
 * Provides a localStorage-like API but uses IndexedDB for better performance
 */

const DB_NAME = 'StableKraftDB';
const DB_VERSION = 1;
const STORE_NAME = 'keyValueStore';

interface DBInstance {
  db: IDBDatabase | null;
  opening: Promise<IDBDatabase> | null;
}

const dbInstance: DBInstance = {
  db: null,
  opening: null
};

/**
 * Opens or returns existing IndexedDB connection
 */
async function openDB(): Promise<IDBDatabase> {
  if (dbInstance.db) {
    return dbInstance.db;
  }

  if (dbInstance.opening) {
    return dbInstance.opening;
  }

  dbInstance.opening = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available in browser'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      dbInstance.opening = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance.db = request.result;
      dbInstance.opening = null;
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });

  return dbInstance.opening;
}

/**
 * Get item from IndexedDB
 */
export async function getItem<T = any>(key: string): Promise<T | null> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result !== undefined ? request.result : null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error(`IndexedDB getItem error for key "${key}":`, error);
    return null;
  }
}

/**
 * Set item in IndexedDB
 */
export async function setItem<T = any>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        // Check if it's a quota error
        if (request.error && (request.error.name === 'QuotaExceededError' || request.error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
          console.warn(`⚠️ IndexedDB quota exceeded for key "${key}"`);
        }
        reject(request.error);
      };
    });
  } catch (error) {
    console.error(`IndexedDB setItem error for key "${key}":`, error);
    throw error;
  }
}

/**
 * Remove item from IndexedDB
 */
export async function removeItem(key: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error(`IndexedDB removeItem error for key "${key}":`, error);
    throw error;
  }
}

/**
 * Clear all items from IndexedDB
 */
export async function clear(): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('IndexedDB clear error:', error);
    throw error;
  }
}

/**
 * Get all keys from IndexedDB
 */
export async function keys(): Promise<string[]> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onsuccess = () => {
        resolve(request.result as string[]);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('IndexedDB keys error:', error);
    return [];
  }
}

/**
 * Migrate data from localStorage to IndexedDB
 */
export async function migrateFromLocalStorage(keysToMigrate: string[]): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  const migrations: Promise<void>[] = [];

  for (const key of keysToMigrate) {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) {
        migrations.push(
          setItem(key, value).then(() => {
            console.log(`✅ Migrated "${key}" from localStorage to IndexedDB`);
          })
        );
      }
    } catch (error) {
      console.error(`Failed to migrate key "${key}":`, error);
    }
  }

  await Promise.all(migrations);
}

/**
 * Fallback to localStorage if IndexedDB is not available
 */
export const storage = {
  async getItem<T = any>(key: string): Promise<T | null> {
    try {
      return await getItem<T>(key);
    } catch (error) {
      // Fallback to localStorage
      if (typeof window !== 'undefined') {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      }
      return null;
    }
  },

  async setItem<T = any>(key: string, value: T): Promise<void> {
    try {
      await setItem(key, value);
    } catch (error) {
      // Handle quota exceeded errors gracefully
      if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
        console.warn(`⚠️ Storage quota exceeded for key "${key}". Attempting cleanup...`);
        
        // Try to clean up old cache entries
        try {
          const allKeys = await keys();
          const cacheKeys = allKeys.filter(k => k.startsWith('playlist_') || k.startsWith('mmm_') || k.startsWith('iam_'));
          
          // Sort by timestamp if available, or remove oldest entries
          for (const cacheKey of cacheKeys.slice(0, Math.floor(cacheKeys.length / 2))) {
            await removeItem(cacheKey);
            console.log(`🗑️ Cleaned up old cache entry: ${cacheKey}`);
          }
          
          // Retry storing the value
          try {
            await setItem(key, value);
            console.log(`✅ Successfully stored after cleanup`);
            return;
          } catch (retryError) {
            console.error(`❌ Still unable to store after cleanup:`, retryError);
            // If still failing, try to store a compressed/simplified version
            if (typeof value === 'object' && value !== null && 'tracks' in value) {
              const simplified = {
                ...value,
                tracks: (value as any).tracks.slice(0, 100) // Only keep first 100 tracks
              };
              await setItem(key, simplified);
              console.warn(`⚠️ Stored simplified version (first 100 tracks only) due to quota limits`);
              return;
            }
          }
        } catch (cleanupError) {
          console.error(`❌ Error during cleanup:`, cleanupError);
        }
        
        // If all else fails, throw the error
        throw new Error(`Storage quota exceeded. Please clear some browser storage or use a different device.`);
      }
      
      // Fallback to localStorage for other errors
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (localStorageError) {
          if (localStorageError instanceof DOMException && localStorageError.name === 'QuotaExceededError') {
            console.error(`❌ Both IndexedDB and localStorage quota exceeded for key "${key}"`);
            throw new Error(`Storage quota exceeded. Please clear browser storage.`);
          }
          throw localStorageError;
        }
      }
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await removeItem(key);
    } catch (error) {
      // Fallback to localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
      }
    }
  },

  async clear(): Promise<void> {
    try {
      await clear();
    } catch (error) {
      // Fallback to localStorage
      if (typeof window !== 'undefined') {
        localStorage.clear();
      }
    }
  }
};
