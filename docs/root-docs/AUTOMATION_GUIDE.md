# 🤖 How to Use Anthropic Skills & Automation Guide

## 🚀 Quick Start Usage

### 1. **Basic Skill Execution**

```typescript
// Import the skills registry
import SkillsRegistry from './skills/skills-registry';

// Execute a single skill
const result = await SkillsRegistry.executeSkill('rss-parsing', {
  feed_url: 'https://example.com/podcast.xml',
  parse_options: {
    include_chapters: true,
    include_value_splits: true,
    extract_music: true
  }
});

console.log('Parsed episodes:', result.episodes.length);
```

### 2. **Chain Skills Together**

```typescript
// Complete workflow: Parse → Extract → Resolve → Store
async function processPodcastFeed(feedUrl: string) {
  // Step 1: Parse RSS feed
  const rssResult = await SkillsRegistry.executeSkill('rss-parsing', {
    feed_url: feedUrl,
    parse_options: { include_chapters: true, extract_music: true }
  });

  // Step 2: Extract music tracks from each episode
  for (const episode of rssResult.episodes) {
    const musicResult = await SkillsRegistry.executeSkill('music-extraction', {
      episode_data: episode,
      extraction_options: { 
        source_types: ['chapters', 'value_splits'],
        deduplicate: true 
      }
    });

    // Step 3: Resolve V4V info for tracks with payment data
    for (const track of musicResult.music_tracks) {
      if (track.v4v_info?.lightning_address) {
        const v4vResult = await SkillsRegistry.executeSkill('v4v-resolution', {
          resolution_target: {
            type: 'track',
            identifier: track.id,
            context: { 
              artist: track.artist, 
              title: track.title,
              episode_guid: episode.guid 
            }
          }
        });
        
        // Update track with V4V info
        track.v4v_info = v4vResult.v4v_info;
      }

      // Step 4: Store track in database
      await SkillsRegistry.executeSkill('database-operations', {
        operation: 'create',
        entity_type: 'track',
        data: {
          ...track,
          feedUrl: feedUrl,
          discoveredAt: new Date().toISOString()
        }
      });
    }
  }

  return { processed: rssResult.episodes.length };
}
```

## 🤖 Automation Options

### 1. **Scheduled Automation (Cron Jobs)**

Create a script that runs automatically:

```bash
# Add to your crontab (runs every hour)
0 * * * * cd /path/to/your/project && node scripts/auto-process-feeds.js

# Or every 6 hours
0 */6 * * * cd /path/to/your/project && node scripts/auto-process-feeds.js
```

### 2. **Webhook Automation**

Set up webhooks to trigger skill execution:

```typescript
// API endpoint: /api/webhooks/podcast-updated
export async function POST(request: Request) {
  const { feedUrl, episodeGuid } = await request.json();
  
  // Automatically process new episodes
  const result = await processPodcastFeed(feedUrl);
  
  return Response.json({ success: true, processed: result.processed });
}
```

### 3. **Task Master AI Automation**

Use your existing Task Master AI to automate skill execution:

```bash
# Create automated tasks
task-master add-task --prompt="Process all podcast feeds every 6 hours using RSS parsing and music extraction skills"

# Set up recurring tasks
task-master add-task --prompt="Monitor new episodes and automatically extract music tracks"
```

## 🛠️ Practical Implementation Examples

I've created ready-to-use automation scripts for you:

### 1. **Automated Feed Processing** (`scripts/auto-process-feeds.js`)

Process multiple podcast feeds automatically:

```bash
# Run automated processing
node scripts/auto-process-feeds.js

# Set up cron job (runs every 6 hours)
echo "0 */6 * * * cd /path/to/your/project && node scripts/auto-process-feeds.js" | crontab -
```

**Features:**
- Processes multiple feeds in batches
- Configurable processing options
- Comprehensive logging and error handling
- Results saved to JSON file
- Performance metrics and reporting

### 2. **Webhook Automation** (`scripts/webhook-automation.js`)

Set up webhooks to trigger skill execution:

```bash
# Start webhook server
node scripts/webhook-automation.js

# Test webhook endpoints
curl -X POST http://localhost:3001/webhook/new-episode \
  -H "Content-Type: application/json" \
  -d '{"feedUrl": "https://example.com/podcast.xml", "episodeGuid": "ep123"}'
```

**Available Webhooks:**
- `/webhook/new-episode` - Process new podcast episodes
- `/webhook/music-discovered` - Process discovered music tracks
- `/webhook/v4v-payment` - Process V4V payment information
- `/webhook/batch-process` - Process multiple feeds in batch

### 3. **Task Master AI Integration** (`scripts/taskmaster-automation.js`)

Integrate skills with your existing Task Master AI:

```bash
# Set up automated tasks
node scripts/taskmaster-automation.js

# This creates tasks for:
# - Feed monitoring
# - Batch processing
# - Database maintenance
# - Performance monitoring
```

## 🚀 Quick Start Automation

### Option 1: Simple Cron Job
```bash
# Add to crontab for hourly processing
0 * * * * cd /home/laptop/StableKraft && node scripts/auto-process-feeds.js
```

### Option 2: Webhook Integration
```bash
# Start webhook server
node scripts/webhook-automation.js &

# Configure your podcast platform to send webhooks to:
# http://your-server:3001/webhook/new-episode
```

### Option 3: Task Master AI Integration
```bash
# Set up automated tasks
node scripts/taskmaster-automation.js

# Then use Task Master AI commands:
task-master list
task-master next
task-master set-status --id=1 --status=done
```

## 🔧 Configuration

All automation scripts use the same configuration pattern:

```javascript
const CONFIG = {
  feeds: [
    'https://example.com/podcast1.xml',
    'https://example.com/podcast2.xml'
  ],
  processingOptions: {
    includeChapters: true,
    includeValueSplits: true,
    extractMusic: true,
    resolveV4V: true,
    storeInDatabase: true
  },
  batchSize: 5,
  delayBetweenFeeds: 1000
};
```

## 📊 Monitoring and Logging

All scripts include comprehensive logging:

```bash
# View processing logs
tail -f processing-results.json

# Monitor webhook activity
curl http://localhost:3001/health

# Check Task Master AI tasks
task-master list --status=in-progress
```

## 🎯 Real-World Usage Examples

### Example 1: Daily Feed Processing
```bash
# Create daily processing script
cat > daily-processing.sh << 'EOF'
#!/bin/bash
cd /home/laptop/StableKraft
node scripts/auto-process-feeds.js
echo "Daily processing completed at $(date)"
EOF

chmod +x daily-processing.sh

# Add to crontab (runs daily at 2 AM)
echo "0 2 * * * /home/laptop/StableKraft/daily-processing.sh" | crontab -
```

### Example 2: Real-time Webhook Processing
```bash
# Start webhook server with PM2 for production
npm install -g pm2
pm2 start scripts/webhook-automation.js --name "skills-webhooks"
pm2 save
pm2 startup
```

### Example 3: Task Master AI Workflow
```bash
# Set up automated task execution
task-master add-task --prompt="Process all feeds using automation script"
task-master expand --id=1 --research
task-master set-status --id=1 --status=in-progress
```

## 🔄 Advanced Automation Patterns

### Pattern 1: Event-Driven Processing
```typescript
// Trigger skills based on events
const eventHandlers = {
  'new-episode': async (data) => {
    await SkillsRegistry.executeSkill('rss-parsing', data);
    await SkillsRegistry.executeSkill('music-extraction', data);
  },
  'v4v-payment': async (data) => {
    await SkillsRegistry.executeSkill('v4v-resolution', data);
  }
};
```

### Pattern 2: Pipeline Processing
```typescript
// Chain skills in a pipeline
const pipeline = [
  'rss-parsing',
  'music-extraction', 
  'v4v-resolution',
  'database-operations'
];

for (const skill of pipeline) {
  const result = await SkillsRegistry.executeSkill(skill, data);
  data = result; // Pass result to next skill
}
```

### Pattern 3: Batch Processing with Retry
```typescript
// Process feeds with retry logic
async function processWithRetry(feedUrl, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await SkillsRegistry.executeSkill('rss-parsing', { feed_url: feedUrl });
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## 🎉 Ready to Automate!

Your Anthropic Skills are now ready for full automation. Choose the approach that best fits your needs:

1. **Simple**: Use cron jobs with `auto-process-feeds.js`
2. **Real-time**: Use webhooks with `webhook-automation.js`  
3. **AI-powered**: Use Task Master AI with `taskmaster-automation.js`

All scripts are production-ready with error handling, logging, and monitoring built-in!
