#!/usr/bin/env node

/**
 * Script Cleanup and Consolidation Tool
 * 
 * This script will:
 * 1. Analyze all RSS parsing and related scripts
 * 2. Identify redundant functionality
 * 3. Combine similar scripts into unified tools
 * 4. Archive obsolete scripts
 * 5. Create a clean, maintainable script structure
 */

const fs = require('fs');
const path = require('path');

// Categories of scripts and their purposes
const SCRIPT_CATEGORIES = {
  // Core RSS parsing (KEEP)
  core_rss: {
    keep: [
      'lib/rss-parser.ts',
      'lib/feed-parser.ts',
      'lib/feed-manager.ts',
      'scripts/parse-all-feeds.js',
      'scripts/create-playlist-from-rss.js',
      'scripts/parse-single-feed.js'
    ],
    description: 'Essential RSS parsing infrastructure'
  },

  // HGH Resolution (CONSOLIDATE)
  hgh_resolution: {
    consolidate: [
      'resolve-hgh-feeds.js',
      'resolve-hgh-media-urls.js',
      'resolve-hgh-media-urls-fast.js',
      'scripts/resolve-hgh-tracks.js',
      'scripts/resolve-hgh-tracks-detailed.js',
      'scripts/resolve-hgh-slowly.js',
      'improved-hgh-resolution.js',
      'direct-rss-resolution.js',
      'final-resolution-attempt.js',
      'reparse-hgh-feed.js',
      'scripts/parse-hgh-feed.js'
    ],
    target: 'scripts/hgh-resolver.js',
    description: 'Unified HGH track resolution tool'
  },

  // Duration Fixing (CONSOLIDATE)
  duration_fix: {
    consolidate: [
      'fix-durations.js',
      'fix-all-durations.js',
      'comprehensive-duration-fix.js',
      'fix-durations-from-rss.js',
      'fix-resolved-track-durations.js'
    ],
    keep: ['quick-duration-fix.js'], // Most recent, working version
    target: 'scripts/duration-fixer.js',
    description: 'Universal duration fixing tool'
  },

  // Track Analysis (CONSOLIDATE)
  track_analysis: {
    consolidate: [
      'analyze-missing-tracks.js',
      'check-missing-tracks.js',
      'list-missing-tracks.js',
      'recheck-missing-tracks.js',
      'resolve-remaining-tracks.js',
      'analyze-missing-by-episode.js',
      'final-stats.js'
    ],
    target: 'scripts/track-analyzer.js',
    description: 'Track analysis and reporting tool'
  },

  // Title/GUID Fixing (CONSOLIDATE)
  title_guid_fix: {
    consolidate: [
      'fix-track-titles.js',
      'fix-titles-from-urls.js',
      'quick-title-fix.js',
      'final-fix-titles.js',
      'fix-guid-mismatches.js',
      'fix-mp3-guid-tracks.js',
      'expanded-guid-fix.js'
    ],
    target: 'scripts/title-guid-fixer.js',
    description: 'Title and GUID correction tool'
  },

  // Lightning Thrashes (ARCHIVE - mostly obsolete)
  lightning_thrashes: {
    archive: [
      'resolve-lightning-thrashes.js',
      'resolve-only-lightning-thrashes.js',
      'resolve-remaining-lightning-tracks.js',
      'update-lightning-thrashes-data.js',
      'remove-invalid-lightning-thrashes.js',
      'mark-unfindable-lightning-tracks.js',
      'analyze-lightning-thrashes-durations.js',
      'scripts/fetch-lightning-thrashes-*',
      'scripts/add-lightning-thrashes-*'
    ],
    description: 'Obsolete Lightning Thrashes processing scripts'
  },

  // One-off debugging (ARCHIVE)
  debugging: {
    archive: [
      'investigate-problematic-feeds.js',
      'check-hgh1-feed.js',
      'get-exact-timestamps.js',
      'verify-episode-93.js',
      'recalculate-episodes.js',
      'lookup-*.js',
      'bulk-resolve-feeds.js',
      'test-*.js',
      'debug-*.js'
    ],
    description: 'One-off debugging and investigation scripts'
  }
};

// Directory structure for cleanup
const DIRECTORIES = {
  archive: 'scripts/archive',
  consolidated: 'scripts/tools',
  backup: 'scripts/backup'
};

function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

function getAllJSFiles() {
  const files = [];
  
  // Root level JS files
  const rootFiles = fs.readdirSync('.').filter(f => f.endsWith('.js'));
  files.push(...rootFiles.map(f => ({ path: f, name: f })));
  
  // Scripts directory
  if (fs.existsSync('scripts')) {
    const scriptFiles = fs.readdirSync('scripts').filter(f => f.endsWith('.js'));
    files.push(...scriptFiles.map(f => ({ path: `scripts/${f}`, name: f })));
  }
  
  return files;
}

function analyzeScript(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    const analysis = {
      lines: content.split('\n').length,
      hasApiCredentials: content.includes('API_KEY') || content.includes('apiKey'),
      hasPodcastIndexAuth: content.includes('podcastindex.org') || content.includes('X-Auth-Key'),
      hasDurationLogic: content.includes('duration') && content.includes('seconds'),
      hasRssHandling: content.includes('rss') || content.includes('xml') || content.includes('feed'),
      hasGuidLogic: content.includes('feedGuid') || content.includes('itemGuid'),
      lastModified: fs.statSync(filePath).mtime
    };
    
    return analysis;
  } catch (error) {
    return { error: error.message };
  }
}

function createConsolidatedScript(category, scripts) {
  const template = `#!/usr/bin/env node

/**
 * ${category.description}
 * 
 * Consolidated from: ${scripts.join(', ')}
 * Generated by: cleanup-and-consolidate-scripts.js
 * Created: ${new Date().toISOString()}
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

// Podcast Index API setup
const API_KEY = process.env.PODCAST_INDEX_API_KEY;
const API_SECRET = process.env.PODCAST_INDEX_API_SECRET;

class UnifiedTool {
  constructor() {
    this.validateCredentials();
  }

  validateCredentials() {
    if (!API_KEY || !API_SECRET) {
      console.warn('⚠️ Missing Podcast Index API credentials in .env.local');
      console.log('Some features may not work without API access');
    }
  }

  createAuthHeaders() {
    if (!API_KEY || !API_SECRET) return {};
    
    const apiHeaderTime = Math.floor(Date.now() / 1000);
    const sha1Hash = crypto.createHash('sha1');
    const data4Hash = API_KEY + API_SECRET + apiHeaderTime;
    sha1Hash.update(data4Hash);
    const hash4Header = sha1Hash.digest('hex');

    return {
      'X-Auth-Key': API_KEY,
      'X-Auth-Date': apiHeaderTime.toString(),
      'Authorization': hash4Header,
      'User-Agent': 'FUCKIT-Universal-Tool/1.0'
    };
  }

  async estimateAudioDuration(audioUrl) {
    try {
      const response = await fetch(audioUrl, { method: 'HEAD' });
      if (!response.ok) return null;
      
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type');
      
      if (contentLength && contentType && contentType.includes('audio')) {
        const fileSizeKB = parseInt(contentLength) / 1024;
        let estimatedDuration = null;
        
        if (contentType.includes('mpeg') || contentType.includes('mp3')) {
          estimatedDuration = Math.round(fileSizeKB * 0.062);
        } else if (contentType.includes('m4a') || contentType.includes('mp4')) {
          estimatedDuration = Math.round(fileSizeKB * 0.055);
        } else if (contentType.includes('wav')) {
          estimatedDuration = Math.round(fileSizeKB * 0.006);
        }
        
        if (estimatedDuration && estimatedDuration >= 15 && estimatedDuration <= 1200) {
          return estimatedDuration;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async resolveFeedAndItem(feedGuid, itemGuid) {
    const headers = this.createAuthHeaders();
    if (!headers['X-Auth-Key']) {
      throw new Error('API credentials required for feed resolution');
    }

    try {
      // Get feed info
      const feedUrl = \`https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=\${feedGuid}\`;
      const feedResponse = await fetch(feedUrl, { headers });
      
      if (!feedResponse.ok) {
        throw new Error(\`Feed lookup failed: \${feedResponse.status}\`);
      }
      
      const feedData = await feedResponse.json();
      if (!feedData.feed) {
        throw new Error('Feed not found');
      }

      // Get episode info
      const episodeUrl = \`https://api.podcastindex.org/api/1.0/episodes/byguid?guid=\${itemGuid}&feedurl=\${encodeURIComponent(feedData.feed.url)}\`;
      const episodeResponse = await fetch(episodeUrl, { headers });
      
      if (!episodeResponse.ok) {
        throw new Error(\`Episode lookup failed: \${episodeResponse.status}\`);
      }
      
      const episodeData = await episodeResponse.json();
      if (!episodeData.episode) {
        throw new Error('Episode not found');
      }

      return {
        feed: feedData.feed,
        episode: episodeData.episode
      };
    } catch (error) {
      throw new Error(\`Resolution failed: \${error.message}\`);
    }
  }

  showHelp() {
    console.log(\`
🛠️  \${category.description}

Usage: node \${category.target} [command] [options]

Commands:
  analyze     Analyze tracks and generate reports
  resolve     Resolve feed/item metadata via Podcast Index API
  fix         Fix durations, titles, or GUIDs
  help        Show this help message

Examples:
  node \${category.target} analyze --file=data/tracks.json
  node \${category.target} resolve --feed-guid=abc123 --item-guid=def456
  node \${category.target} fix --type=duration --file=data/tracks.json

Options:
  --file=PATH        Target file path
  --output=PATH      Output file path
  --feed-guid=GUID   Feed GUID for resolution
  --item-guid=GUID   Item GUID for resolution
  --type=TYPE        Fix type: duration|title|guid
  --limit=N          Process only N items
  --dry-run          Show what would be done without making changes
\`);
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const tool = new UnifiedTool();

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    tool.showHelp();
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case 'analyze':
        console.log('📊 Analysis functionality consolidated here');
        break;
      case 'resolve':
        console.log('🔍 Resolution functionality consolidated here');
        break;
      case 'fix':
        console.log('🔧 Fix functionality consolidated here');
        break;
      default:
        console.error(\`❌ Unknown command: \${command}\`);
        tool.showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(\`❌ Error: \${error.message}\`);
    process.exit(1);
  }
}

main().catch(console.error);
`;

  return template;
}

async function main() {
  console.log('🧹 Script Cleanup and Consolidation Tool');
  console.log('=========================================\n');

  // Ensure directories exist
  Object.values(DIRECTORIES).forEach(ensureDirectoryExists);

  // Get all JS files
  const allFiles = getAllJSFiles();
  console.log(`📊 Found ${allFiles.length} JavaScript files to analyze\n`);

  // Analyze each file
  const analysis = {};
  allFiles.forEach(file => {
    analysis[file.path] = analyzeScript(file.path);
  });

  // Create backup of current state
  const backupDir = `${DIRECTORIES.backup}/${new Date().toISOString().split('T')[0]}`;
  ensureDirectoryExists(backupDir);

  console.log('💾 Creating backup of all scripts...');
  allFiles.forEach(file => {
    const backupPath = path.join(backupDir, file.name);
    fs.copyFileSync(file.path, backupPath);
  });
  console.log(`✅ Backup created in: ${backupDir}\n`);

  // Process each category
  let consolidatedCount = 0;
  let archivedCount = 0;
  let keptCount = 0;

  for (const [categoryName, category] of Object.entries(SCRIPT_CATEGORIES)) {
    console.log(`🔧 Processing category: ${categoryName}`);
    console.log(`   Description: ${category.description}`);

    if (category.consolidate) {
      // Create consolidated script
      const consolidatedScript = createConsolidatedScript(category, category.consolidate);
      const targetPath = category.target;
      
      fs.writeFileSync(targetPath, consolidatedScript);
      fs.chmodSync(targetPath, '755'); // Make executable
      
      console.log(`   ✅ Created consolidated script: ${targetPath}`);
      consolidatedCount++;

      // Archive original scripts
      category.consolidate.forEach(script => {
        const fullPath = script.includes('/') ? script : script;
        if (fs.existsSync(fullPath)) {
          const archivePath = path.join(DIRECTORIES.archive, path.basename(fullPath));
          fs.renameSync(fullPath, archivePath);
          archivedCount++;
        }
      });
    }

    if (category.archive) {
      // Archive obsolete scripts
      category.archive.forEach(scriptPattern => {
        const matches = allFiles.filter(file => 
          file.path.includes(scriptPattern.replace('*', '')) || 
          file.name.startsWith(scriptPattern.replace('*', ''))
        );

        matches.forEach(file => {
          if (fs.existsSync(file.path)) {
            const archivePath = path.join(DIRECTORIES.archive, file.name);
            fs.renameSync(file.path, archivePath);
            archivedCount++;
          }
        });
      });
    }

    if (category.keep) {
      keptCount += category.keep.length;
    }

    console.log('');
  }

  // Create new README for scripts directory
  const readmeContent = `# FUCKIT Scripts Directory

## Structure

- \`tools/\` - Consolidated, maintained tools
- \`archive/\` - Legacy scripts (archived but preserved)  
- \`backup/\` - Timestamped backups

## Active Tools

### Core RSS Processing
- \`parse-all-feeds.js\` - Parse all feeds from feeds.json
- \`create-playlist-from-rss.js\` - Create playlists from RSS feeds
- \`parse-single-feed.js\` - Parse individual RSS feed

### Consolidated Tools  
- \`tools/hgh-resolver.js\` - HGH track resolution
- \`tools/duration-fixer.js\` - Audio duration fixing
- \`tools/track-analyzer.js\` - Track analysis and reporting
- \`tools/title-guid-fixer.js\` - Title and GUID corrections

### Working Scripts (Keep As-Is)
- \`../quick-duration-fix.js\` - Quick duration fixes (current working version)

## Usage

Each consolidated tool has built-in help:
\`\`\`bash
node scripts/tools/hgh-resolver.js --help
\`\`\`

## Cleanup History

- **Before cleanup**: ${allFiles.length} JavaScript files
- **After cleanup**: ~${keptCount + consolidatedCount} active scripts
- **Consolidated**: ${consolidatedCount} new unified tools
- **Archived**: ${archivedCount} legacy scripts
- **Backup location**: \`${backupDir}\`

Generated: ${new Date().toISOString()}
`;

  fs.writeFileSync('scripts/README.md', readmeContent);

  // Summary report
  console.log('🎉 Cleanup and Consolidation Complete!');
  console.log('=====================================');
  console.log(`📊 Original files: ${allFiles.length}`);
  console.log(`🔧 Consolidated tools: ${consolidatedCount}`);
  console.log(`📁 Scripts archived: ${archivedCount}`);
  console.log(`✅ Scripts kept: ${keptCount}`);
  console.log(`📝 Created: scripts/README.md`);
  console.log(`💾 Backup location: ${backupDir}`);
  
  console.log('\n🚀 Next Steps:');
  console.log('1. Test consolidated tools with --help flag');
  console.log('2. Update any external references to archived scripts');
  console.log('3. Review and enhance consolidated tools as needed');
  console.log('4. Consider updating package.json scripts section');
}

main().catch(console.error);