#!/usr/bin/env node

/**
 * Database Utilities for Scripts
 * 
 * Shared utilities for database scripts including:
 * - Console formatting
 * - Stats tracking
 * - Batch processing
 * - Coverage calculation
 * - Progress file management
 */

import fs from 'fs';
import path from 'path';

/**
 * Format console output with emoji and consistent styling
 */
export function formatConsoleOutput(type, message, details = '') {
  const emojiMap = {
    info: '📊',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    progress: '🔄',
    batch: '📦',
    save: '💾',
    complete: '🎉',
    stats: '📈'
  };
  
  const emoji = emojiMap[type] || '•';
  const formatted = details ? `${emoji} ${message}\n   ${details}` : `${emoji} ${message}`;
  console.log(formatted);
}

/**
 * Create a stats tracker for database operations
 */
export function createStatsTracker(initialStats = {}) {
  const stats = {
    successful: 0,
    failed: 0,
    processed: 0,
    remaining: 0,
    artistNamesFixed: 0,
    valueForValueEnabled: 0,
    audioUrlsAdded: 0,
    durationResolved: 0,
    ...initialStats
  };

  return {
    stats,
    increment: (field) => {
      if (stats[field] !== undefined) {
        stats[field]++;
      }
    },
    update: (field, value) => {
      if (stats[field] !== undefined) {
        stats[field] = value;
      }
    },
    getStats: () => ({ ...stats }),
    printStats: (totalTracks) => {
      const successRate = stats.processed > 0 
        ? ((stats.successful / stats.processed) * 100).toFixed(1)
        : '0.0';
      
      formatConsoleOutput('stats', `Stats: ${stats.successful} enhanced, ${stats.failed} failed (${successRate}% success)`);
      formatConsoleOutput('stats', `Processed: ${stats.processed}/${totalTracks}`, `Remaining: ${stats.remaining}`);
    }
  };
}

/**
 * Process items in batches with progress tracking
 */
export async function processBatch(items, batchSize, processor, options = {}) {
  const {
    onBatchStart = () => {},
    onBatchComplete = () => {},
    onProgress = () => {},
    delayBetweenBatches = 1000,
    startIndex = 0
  } = options;

  const totalItems = items.length;
  const results = {
    successful: [],
    failed: [],
    total: 0
  };

  for (let i = startIndex; i < totalItems; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, totalItems));
    const batchNum = Math.floor((i - startIndex) / batchSize) + 1;
    const totalBatches = Math.ceil((totalItems - startIndex) / batchSize);
    const batchEnd = Math.min(i + batchSize, totalItems);

    onBatchStart(batchNum, totalBatches, i + 1, batchEnd);

    try {
      const batchResults = await Promise.allSettled(
        batch.map((item, batchIndex) => 
          processor(item, i + batchIndex, batchIndex)
        )
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          if (result.value.failed) {
            results.failed.push(result.value.data);
          } else {
            results.successful.push(result.value);
          }
        } else {
          results.failed.push({
            item: batch[index],
            error: result.reason?.message || 'Unknown error'
          });
        }
      });

      results.total = i + batch.length;
      onProgress(results.total, totalItems);
      onBatchComplete(batchNum, results);

      if (i + batchSize < totalItems) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    } catch (error) {
      formatConsoleOutput('error', `Batch ${batchNum} failed:`, error.message);
      throw error;
    }
  }

  return results;
}

/**
 * Calculate coverage percentage for database fields
 */
export function calculateCoverage(items, fieldName, options = {}) {
  const {
    excludeValues = ['Unknown', 'Unknown Artist', 'Unknown Album', '', null, undefined],
    customFilter = null
  } = options;

  const total = items.length;
  if (total === 0) return { count: 0, total: 0, percentage: '0.0' };

  let withField = 0;
  
  items.forEach(item => {
    const value = typeof fieldName === 'function' 
      ? fieldName(item)
      : item[fieldName];

    if (customFilter) {
      if (customFilter(item, value)) withField++;
    } else {
      if (value && !excludeValues.includes(value)) {
        withField++;
      }
    }
  });

  return {
    count: withField,
    total,
    percentage: total > 0 ? ((withField / total) * 100).toFixed(1) : '0.0'
  };
}

/**
 * Save progress to file
 */
export function saveProgress(progressFile, data, options = {}) {
  const {
    createBackup = false,
    prettyPrint = true
  } = options;

  try {
    if (createBackup && fs.existsSync(progressFile)) {
      const backupFile = `${progressFile}.backup-${Date.now()}`;
      fs.copyFileSync(progressFile, backupFile);
    }

    const dir = path.dirname(progressFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = prettyPrint 
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data);
    
    fs.writeFileSync(progressFile, content, 'utf8');
    return true;
  } catch (error) {
    formatConsoleOutput('error', `Failed to save progress:`, error.message);
    return false;
  }
}

/**
 * Load progress from file
 */
export function loadProgress(progressFile) {
  try {
    if (!fs.existsSync(progressFile)) {
      return null;
    }

    const content = fs.readFileSync(progressFile, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    formatConsoleOutput('error', `Failed to load progress:`, error.message);
    return null;
  }
}

/**
 * Create a progress tracker for resumable operations
 */
export function createProgressTracker(progressFile, totalItems) {
  let progress = loadProgress(progressFile) || {
    lastProcessedIndex: -1,
    timestamp: new Date().toISOString(),
    batchesCompleted: 0
  };

  return {
    getStartIndex: () => progress.lastProcessedIndex + 1,
    getBatchesCompleted: () => progress.batchesCompleted,
    update: (lastIndex, batchesCompleted) => {
      progress = {
        lastProcessedIndex: lastIndex,
        timestamp: new Date().toISOString(),
        batchesCompleted
      };
      saveProgress(progressFile, progress);
    },
    clear: () => {
      if (fs.existsSync(progressFile)) {
        fs.unlinkSync(progressFile);
      }
      progress = {
        lastProcessedIndex: -1,
        timestamp: new Date().toISOString(),
        batchesCompleted: 0
      };
    },
    isResuming: () => progress.lastProcessedIndex >= 0
  };
}

/**
 * Print section header
 */
export function printSectionHeader(title, width = 70) {
  console.log('\n' + '═'.repeat(width));
  console.log(title.toUpperCase());
  console.log('═'.repeat(width) + '\n');
}

/**
 * Format duration for display
 */
export function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

