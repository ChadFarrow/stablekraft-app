// Quick script to clear V4V cache
const { V4VResolver } = require('./lib/v4v-resolver.ts');

console.log('Clearing V4V cache...');
V4VResolver.clearCache();
console.log('V4V cache cleared!');