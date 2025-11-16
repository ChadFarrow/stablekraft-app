#!/usr/bin/env node

/**
 * Auto-version update script
 * Updates package.json version based on git commit hash
 * Format: 1.2a<short-commit-hash>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJsonPath = path.join(__dirname, '..', 'package.json');

try {
  // Get short git commit hash
  const gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  
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
  console.error('❌ Error updating version:', error.message);
  process.exit(1);
}

