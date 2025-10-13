#!/usr/bin/env node

// Validate environment variables using dotenv-safe
// Ensures .env.local matches keys in env.example and loads them

const path = require('path');

// Prefer .env.local for local dev
process.env.DOTENV_CONFIG_PATH = path.resolve(process.cwd(), '.env.local');
process.env.DOTENV_CONFIG_ENCODING = 'utf8';

try {
  require('dotenv-safe').config({
    allowEmptyValues: false,
    path: path.resolve(process.cwd(), '.env.local'),
    example: path.resolve(process.cwd(), 'env.example'),
  });
  console.log('✅ Environment validated with dotenv-safe (.env.local vs env.example)');
} catch (err) {
  console.error('❌ Environment validation failed:', err.message || err);
  if (err && err.missing && Array.isArray(err.missing)) {
    console.error('Missing keys:', err.missing.join(', '));
  }
  process.exit(1);
}


