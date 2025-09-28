#!/usr/bin/env node

/**
 * Build diagnostic script to identify Railway deployment issues
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Railway Build Diagnostic Script');
console.log('=====================================\n');

// Check for potential build issues
const checks = [
  {
    name: 'Environment Variables',
    check: () => {
      const envLocal = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envLocal)) {
        const content = fs.readFileSync(envLocal, 'utf8');
        const requiredVars = [
          'DATABASE_URL',
          'NEXT_PUBLIC_LIGHTNING_NETWORK',
          'NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS'
        ];

        const missing = requiredVars.filter(varName => !content.includes(varName));
        return {
          status: missing.length === 0 ? 'pass' : 'warn',
          message: missing.length === 0
            ? 'All required variables found in .env.local'
            : `Missing variables: ${missing.join(', ')}`
        };
      }
      return { status: 'warn', message: '.env.local not found' };
    }
  },

  {
    name: 'TypeScript Check',
    check: () => {
      try {
        execSync('npx tsc --noEmit', { stdio: 'pipe', timeout: 30000 });
        return { status: 'pass', message: 'TypeScript compilation successful' };
      } catch (error) {
        return {
          status: 'fail',
          message: `TypeScript errors: ${error.stdout?.toString() || error.message}`
        };
      }
    }
  },

  {
    name: 'Client-side APIs in Components',
    check: () => {
      const problematicPatterns = [
        { pattern: /localStorage(?!\.)/g, issue: 'localStorage usage' },
        { pattern: /sessionStorage(?!\.)/g, issue: 'sessionStorage usage' },
        { pattern: /window\.(?!addEventListener)/g, issue: 'window object access' },
        { pattern: /document\.(?!addEventListener)/g, issue: 'document object access' },
        { pattern: /HTMLElement/g, issue: 'HTMLElement reference' }
      ];

      const componentsDir = path.join(process.cwd(), 'components');
      const appDir = path.join(process.cwd(), 'app');
      const issues = [];

      function checkDirectory(dir) {
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir, { recursive: true })
          .filter(file => file.endsWith('.tsx') || file.endsWith('.ts'))
          .map(file => path.join(dir, file));

        files.forEach(file => {
          const content = fs.readFileSync(file, 'utf8');

          // Skip if file has 'use client' directive
          if (content.includes("'use client'") || content.includes('"use client"')) {
            return;
          }

          problematicPatterns.forEach(({ pattern, issue }) => {
            const matches = content.match(pattern);
            if (matches) {
              issues.push(`${path.relative(process.cwd(), file)}: ${issue} (${matches.length} occurrences)`);
            }
          });
        });
      }

      checkDirectory(componentsDir);
      checkDirectory(appDir);

      return {
        status: issues.length === 0 ? 'pass' : 'fail',
        message: issues.length === 0
          ? 'No client-side API usage in server components'
          : `Found issues:\n${issues.map(i => `  - ${i}`).join('\n')}`
      };
    }
  },

  {
    name: 'Package.json Scripts',
    check: () => {
      const packageJson = require(path.join(process.cwd(), 'package.json'));
      const requiredScripts = ['build', 'start'];
      const missing = requiredScripts.filter(script => !packageJson.scripts?.[script]);

      return {
        status: missing.length === 0 ? 'pass' : 'fail',
        message: missing.length === 0
          ? 'Required build scripts present'
          : `Missing scripts: ${missing.join(', ')}`
      };
    }
  },

  {
    name: 'Next.js Config',
    check: () => {
      const configPath = path.join(process.cwd(), 'next.config.js');
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');

        // Check for potential issues
        const issues = [];
        if (content.includes('experimental.turbo')) {
          issues.push('Deprecated experimental.turbo config (use turbopack instead)');
        }

        return {
          status: issues.length === 0 ? 'pass' : 'warn',
          message: issues.length === 0
            ? 'Next.js config looks good'
            : `Issues: ${issues.join(', ')}`
        };
      }
      return { status: 'pass', message: 'No custom Next.js config' };
    }
  },

  {
    name: 'Import Paths',
    check: () => {
      const files = [];

      function collectFiles(dir) {
        if (!fs.existsSync(dir)) return;

        const items = fs.readdirSync(dir, { recursive: true });
        items.forEach(item => {
          const fullPath = path.join(dir, item);
          if (fs.statSync(fullPath).isFile() && (item.endsWith('.tsx') || item.endsWith('.ts'))) {
            files.push(fullPath);
          }
        });
      }

      collectFiles(path.join(process.cwd(), 'app'));
      collectFiles(path.join(process.cwd(), 'components'));
      collectFiles(path.join(process.cwd(), 'lib'));

      const issues = [];
      files.forEach(file => {
        const content = fs.readFileSync(file, 'utf8');
        const importLines = content.split('\n').filter(line => line.trim().startsWith('import'));

        importLines.forEach((line, index) => {
          // Check for relative imports that might be problematic
          if (line.includes('../../../') || line.includes('../../../../')) {
            issues.push(`${path.relative(process.cwd(), file)}:${index + 1} - Deep relative import: ${line.trim()}`);
          }
        });
      });

      return {
        status: issues.length === 0 ? 'pass' : 'warn',
        message: issues.length === 0
          ? 'Import paths look good'
          : `Potential issues:\n${issues.slice(0, 5).map(i => `  - ${i}`).join('\n')}${issues.length > 5 ? `\n  ... and ${issues.length - 5} more` : ''}`
      };
    }
  }
];

// Run all checks
console.log('Running diagnostic checks...\n');

checks.forEach(({ name, check }) => {
  process.stdout.write(`${name}... `);

  try {
    const result = check();
    const icon = result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
    console.log(`${icon} ${result.status.toUpperCase()}`);

    if (result.message && result.status !== 'pass') {
      console.log(`   ${result.message}\n`);
    } else if (result.status === 'pass') {
      console.log(`   ${result.message}\n`);
    }
  } catch (error) {
    console.log(`❌ ERROR`);
    console.log(`   ${error.message}\n`);
  }
});

console.log('🔧 Railway Environment Variables Needed:');
console.log('=========================================');
console.log('DATABASE_URL - PostgreSQL connection string');
console.log('NEXT_PUBLIC_LIGHTNING_NETWORK=testnet');
console.log('NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com');
console.log('PODCAST_INDEX_API_KEY - (optional, for V4V resolution)');
console.log('PODCAST_INDEX_API_SECRET - (optional, for V4V resolution)');
console.log('');

console.log('📝 Next Steps:');
console.log('==============');
console.log('1. Fix any ❌ FAIL issues above');
console.log('2. Review ⚠️ WARN issues');
console.log('3. Set environment variables in Railway');
console.log('4. Retry deployment');