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
      // Fallback to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(value));
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
