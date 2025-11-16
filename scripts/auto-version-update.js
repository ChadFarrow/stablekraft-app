#!/usr/bin/env node

/**
 * Auto-version update script
 * Updates package.json version based on git commit hash
 * Format: 1.2a<short-commit-hash>
 * 
 * Note: In Docker builds (where .git is not available), this script
 * will skip the update and use the version already in package.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '..', 'package.json');

try {
  // Check if we're in a git repository
  let gitHash;
  try {
    gitHash = execSync('git rev-parse --short HEAD', { 
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'] // Suppress stderr
    }).trim();
  } catch (gitError) {
    // Not in a git repository (e.g., Docker build)
    // Read current version and use it as-is
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    console.log(`ℹ️  Skipping version update (not in git repository). Using existing version: ${packageJson.version}`);
    process.exit(0);
  }
  
  // Read package.json
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  
  // Extract current version parts
  const currentVersion = packageJson.version || '1.2a000000';
  const versionMatch = currentVersion.match(/^(\d+)\.(\d+)a(.+)$/);
  
  let major, minor, hash;
  if (versionMatch) {
    major = parseInt(versionMatch[1], 10);
    minor = parseInt(versionMatch[2], 10);
    hash = versionMatch[3];
  } else {
    // Fallback if version format is unexpected
    major = 1;
    minor = 2;
    hash = '000000';
  }
  
  // Only update if hash changed
  if (hash !== gitHash) {
    const newVersion = `${major}.${minor}a${gitHash}`;
    packageJson.version = newVersion;
    
    // Write updated package.json
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`✅ Version updated: ${currentVersion} → ${newVersion}`);
  } else {
    console.log(`ℹ️  Version unchanged: ${currentVersion} (same commit hash)`);
  }
} catch (error) {
  // If there's an error, log it but don't fail the build
  console.warn('⚠️  Warning: Could not update version:', error.message);
  console.log('ℹ️  Continuing with existing version in package.json');
  process.exit(0);
}

