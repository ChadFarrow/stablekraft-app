#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🚀 Starting production build process...');

// Step 1: Run database migration (if DATABASE_URL is available)
console.log('📊 Step 1: Database migration');
try {
  execSync('node scripts/migrate-production.js', { stdio: 'inherit' });
} catch (error) {
  console.log('⚠️ Database migration failed, continuing...');
}

// Step 2: Generate Prisma client
console.log('🔧 Step 2: Generating Prisma client');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('✅ Prisma client generated successfully');
} catch (error) {
  console.log('⚠️ Prisma generate failed:', error.message);
  console.log('ℹ️ This might be due to missing DATABASE_URL during build');
  console.log('ℹ️ The app will generate the client at runtime if needed');
}

// Step 3: Build Next.js application
console.log('🏗️ Step 3: Building Next.js application');
try {
  execSync('npx next build', { stdio: 'inherit' });
  console.log('✅ Next.js build completed successfully');
} catch (error) {
  console.error('❌ Next.js build failed:', error.message);
  process.exit(1);
}

console.log('🎉 Production build process completed successfully!');

