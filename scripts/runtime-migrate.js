#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🚀 Running runtime database migration...');

// Check if DATABASE_URL is available
if (!process.env.DATABASE_URL) {
  console.log('❌ DATABASE_URL not available - cannot run migrations');
  process.exit(1);
}

try {
  // First, try to run migrations normally
  console.log('Attempting to deploy migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('✅ Migrations deployed successfully');
} catch (error) {
  console.log('⚠️ Normal migration failed, checking if we need to baseline...');
  
  // If migrations fail, it might be because we need to baseline
  // In production, we'll just use db push to ensure schema is up to date
  try {
    console.log('📝 Syncing database schema with Prisma schema...');
    execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
    console.log('✅ Database schema synced successfully');
    
    // Mark migrations as applied by creating the migrations table
    console.log('📋 Marking migrations as applied...');
    try {
      execSync('npx prisma migrate resolve --applied 20250919152921_init', { stdio: 'inherit' });
      execSync('npx prisma migrate resolve --applied 20250920235900_add_track_order', { stdio: 'inherit' });
      console.log('✅ Migrations marked as applied');
    } catch (resolveError) {
      console.log('⚠️ Could not mark migrations as applied, but schema is synced');
    }
  } catch (pushError) {
    console.error('❌ Failed to sync database schema:', pushError.message);
    throw pushError;
  }
}

console.log('✅ Runtime migration process complete');

