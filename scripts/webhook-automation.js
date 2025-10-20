#!/usr/bin/env node

/**
 * Webhook Automation for Anthropic Skills
 * Handles incoming webhooks and triggers skill execution
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

// Simulate SkillsRegistry (in real usage, import the actual module)
const SkillsRegistry = {
  async executeSkill(skillName, params) {
    console.log(`🔧 Webhook triggered skill: ${skillName}`);
    return { success: true, skill: skillName, timestamp: new Date().toISOString() };
  }
};

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook endpoints
const webhooks = {
  // New podcast episode webhook
  '/webhook/new-episode': async (req, res) => {
    try {
      const { feedUrl, episodeGuid, episodeTitle } = req.body;
      
      console.log(`📡 New episode webhook: ${episodeTitle}`);
      
      // Process the new episode
      const result = await SkillsRegistry.executeSkill('rss-parsing', {
        feed_url: feedUrl,
        parse_options: { 
          include_chapters: true, 
          extract_music: true,
          specific_episode: episodeGuid 
        }
      });

      res.json({ 
        success: true, 
        message: 'Episode processed successfully',
        episode: episodeTitle,
        tracksFound: result.episodes?.[0]?.music_tracks?.length || 0
      });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Music track discovery webhook
  '/webhook/music-discovered': async (req, res) => {
    try {
      const { trackData, source } = req.body;
      
      console.log(`🎵 Music discovery webhook: ${trackData.title}`);
      
      // Extract and process the music track
      const musicResult = await SkillsRegistry.executeSkill('music-extraction', {
        episode_data: trackData,
        extraction_options: { 
          source_types: [source],
          deduplicate: true,
          enhance_metadata: true 
        }
      });

      // Resolve V4V if available
      if (musicResult.music_tracks?.[0]?.v4v_info?.lightning_address) {
        await SkillsRegistry.executeSkill('v4v-resolution', {
          resolution_target: {
            type: 'track',
            identifier: musicResult.music_tracks[0].id,
            context: musicResult.music_tracks[0]
          }
        });
      }

      // Store in database
      await SkillsRegistry.executeSkill('database-operations', {
        operation: 'create',
        entity_type: 'track',
        data: musicResult.music_tracks[0]
      });

      res.json({ 
        success: true, 
        message: 'Music track processed and stored',
        track: musicResult.music_tracks[0].title
      });
    } catch (error) {
      console.error('Music webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // V4V payment webhook
  '/webhook/v4v-payment': async (req, res) => {
    try {
      const { trackId, paymentData } = req.body;
      
      console.log(`⚡ V4V payment webhook for track: ${trackId}`);
      
      // Resolve V4V information
      const v4vResult = await SkillsRegistry.executeSkill('v4v-resolution', {
        resolution_target: {
          type: 'track',
          identifier: trackId,
          context: paymentData
        },
        resolution_options: {
          include_boostagrams: true,
          include_value_splits: true,
          include_lightning_address: true
        }
      });

      // Update database with V4V info
      await SkillsRegistry.executeSkill('database-operations', {
        operation: 'update',
        entity_type: 'track',
        data: { id: trackId, v4v_info: v4vResult.v4v_info }
      });

      res.json({ 
        success: true, 
        message: 'V4V information updated',
        v4v_info: v4vResult.v4v_info
      });
    } catch (error) {
      console.error('V4V webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // Batch processing webhook
  '/webhook/batch-process': async (req, res) => {
    try {
      const { feeds, options = {} } = req.body;
      
      console.log(`📦 Batch processing webhook: ${feeds.length} feeds`);
      
      const results = [];
      
      for (const feedUrl of feeds) {
        const result = await SkillsRegistry.executeSkill('rss-parsing', {
          feed_url: feedUrl,
          parse_options: {
            include_chapters: true,
            extract_music: true,
            ...options
          }
        });
        
        results.push({
          feed: feedUrl,
          episodes: result.episodes?.length || 0,
          tracks: result.episodes?.reduce((sum, ep) => sum + (ep.music_tracks?.length || 0), 0) || 0
        });
      }

      res.json({ 
        success: true, 
        message: 'Batch processing completed',
        results: results,
        totalFeeds: feeds.length
      });
    } catch (error) {
      console.error('Batch webhook error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

// Register webhook endpoints
Object.entries(webhooks).forEach(([endpoint, handler]) => {
  app.post(endpoint, handler);
  console.log(`🔗 Registered webhook: ${endpoint}`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    webhooks: Object.keys(webhooks).length
  });
});

// List all available webhooks
app.get('/webhooks', (req, res) => {
  res.json({
    available_webhooks: Object.keys(webhooks).map(endpoint => ({
      endpoint,
      method: 'POST',
      description: getWebhookDescription(endpoint)
    }))
  });
});

function getWebhookDescription(endpoint) {
  const descriptions = {
    '/webhook/new-episode': 'Triggered when a new podcast episode is published',
    '/webhook/music-discovered': 'Triggered when new music is discovered in an episode',
    '/webhook/v4v-payment': 'Triggered when V4V payment information is received',
    '/webhook/batch-process': 'Triggered for batch processing multiple feeds'
  };
  return descriptions[endpoint] || 'Webhook endpoint';
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Webhook server error:', error);
  res.status(500).json({ 
    success: false, 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Webhook automation server running on port ${PORT}`);
  console.log(`📡 Available webhooks:`);
  Object.keys(webhooks).forEach(endpoint => {
    console.log(`   POST http://localhost:${PORT}${endpoint}`);
  });
  console.log(`\n🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`📋 Webhook list: http://localhost:${PORT}/webhooks`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down webhook server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Shutting down webhook server...');
  process.exit(0);
});

module.exports = app;
