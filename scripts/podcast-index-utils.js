/**
 * Podcast Index API utilities for GUID/URL resolution
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { USER_AGENT } = require('../lib/user-agent');

// Load API credentials from .env.local
function loadEnvCredentials() {
    try {
        const envPath = path.join(process.cwd(), '.env.local');
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        const apiKey = envContent.match(/PODCAST_INDEX_API_KEY=(.+)/)?.[1]?.trim();
        const apiSecret = envContent.match(/PODCAST_INDEX_API_SECRET=(.+)/)?.[1]?.trim();
        
        if (!apiKey || !apiSecret) {
            throw new Error('Missing PODCAST_INDEX_API_KEY or PODCAST_INDEX_API_SECRET in .env.local');
        }
        
        return { apiKey, apiSecret };
    } catch (error) {
        throw new Error(`Failed to load API credentials: ${error.message}`);
    }
}

// Generate Podcast Index API auth headers
function generateAuthHeaders() {
    const { apiKey, apiSecret } = loadEnvCredentials();
    const timestamp = Math.floor(Date.now() / 1000);
    const hash = crypto.createHash('sha1').update(apiKey + apiSecret + timestamp).digest('hex');
    
    return {
        'User-Agent': USER_AGENT,
        'X-Auth-Key': apiKey,
        'X-Auth-Date': timestamp.toString(),
        'Authorization': hash
    };
}

// Look up feed by GUID
async function podcastIndexLookup(feedGuid) {
    try {
        const headers = generateAuthHeaders();
        const url = `https://api.podcastindex.org/api/1.0/podcasts/byguid?guid=${encodeURIComponent(feedGuid)}`;
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'true' && data.feed) {
            return {
                url: data.feed.url,
                title: data.feed.title,
                author: data.feed.author,
                image: data.feed.image
            };
        }
        
        return null;
        
    } catch (error) {
        throw new Error(`Podcast Index API error: ${error.message}`);
    }
}

module.exports = {
    podcastIndexLookup,
    generateAuthHeaders,
    loadEnvCredentials
};