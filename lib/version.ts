/**
 * Application Version Management
 * Auto-increments on GitHub changes via git hooks
 */

export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
  build: number;
}

// Current version - starts at 1.000
export const currentVersion: AppVersion = {
  major: 1,
  minor: 0,
  patch: 704,
  build: 629
};

/**
 * Format version as string (e.g., "1.001", "1.023")
 */
export function formatVersion(version: AppVersion = currentVersion): string {
  const minorPatch = (version.minor * 100 + version.patch).toString().padStart(3, '0');
  return `${version.major}.${minorPatch}`;
}

/**
 * Increment version by 0.001
 */
export function incrementVersion(version: AppVersion): AppVersion {
  let newPatch = version.patch + 1;
  let newMinor = version.minor;
  let newMajor = version.major;

  // Handle rollover: 0.999 -> 1.000
  if (newPatch >= 1000) {
    newPatch = 0;
    newMinor += 1;
    
    if (newMinor >= 10) {
      newMinor = 0;
      newMajor += 1;
    }
  }

  return {
    major: newMajor,
    minor: newMinor,
    patch: newPatch,
    build: version.build + 1
  };
}

/**
 * Get full version string with build number
 */
export function getFullVersionString(): string {
  return `v${formatVersion()} (build ${currentVersion.build})`;
}

/**
 * Get simple version string from package.json
 * Reads from NEXT_PUBLIC_APP_VERSION env var (set at build time)
 */
export function getVersionString(): string {
  // Try to get from environment variable (set at build time)
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_VERSION) {
    const version = process.env.NEXT_PUBLIC_APP_VERSION;
    // Extract just the version part (e.g., "1.2" from "1.2a40a7018")
    const versionMatch = version.match(/^(\d+\.\d+)/);
    if (versionMatch) {
      return `v${versionMatch[1]}`;
    }
    return `v${version}`;
  }
  
  // Fallback to hardcoded version
  return `v${formatVersion()}`;
}

/**
 * Get build version from package.json (git commit hash)
 * Reads from NEXT_PUBLIC_BUILD_VERSION env var (set at build time)
 */
export function getBuildVersion(): string {
  // Try to get from environment variable (set at build time)
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BUILD_VERSION) {
    return process.env.NEXT_PUBLIC_BUILD_VERSION;
  }
  
  // Fallback
  return '1.2a000000';
}