#!/usr/bin/env node

/**
 * Skills Validation Script
 * 
 * This script validates that all skills follow the Anthropic Skills specification
 * and checks for proper structure, documentation, and implementation.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';

class SkillsValidator {
  constructor(skillsPath = '.') {
    this.skillsPath = skillsPath;
    this.errors = [];
    this.warnings = [];
  }

  async validateAllSkills() {
    console.log('🔍 Validating Anthropic Skills specification compliance...');
    
    try {
      const skillDirs = await readdir(this.skillsPath, { withFileTypes: true });
      
      for (const dir of skillDirs) {
        if (dir.isDirectory() && dir.name !== 'node_modules') {
          await this.validateSkill(dir.name);
        }
      }
      
      this.printResults();
      return this.errors.length === 0;
    } catch (error) {
      console.error('❌ Error during validation:', error);
      return false;
    }
  }

  async validateSkill(skillName) {
    const skillPath = join(this.skillsPath, skillName);
    
    try {
      // Check if SKILL.md exists
      const skillMdPath = join(skillPath, 'SKILL.md');
      const skillMdExists = await this.fileExists(skillMdPath);
      
      if (!skillMdExists) {
        this.errors.push(`❌ ${skillName}: Missing SKILL.md file`);
        return;
      }

      // Validate SKILL.md content
      await this.validateSkillMarkdown(skillName, skillMdPath);
      
      // Check for additional files
      await this.validateSkillFiles(skillName, skillPath);
      
    } catch (error) {
      this.errors.push(`❌ ${skillName}: Validation error - ${error.message}`);
    }
  }

  async validateSkillMarkdown(skillName, skillMdPath) {
    try {
      const content = await readFile(skillMdPath, 'utf-8');
      
      // Check for YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        this.errors.push(`❌ ${skillName}: Missing YAML frontmatter in SKILL.md`);
        return;
      }

      // Parse and validate frontmatter
      const metadata = yaml.load(frontmatterMatch[1]);
      
      if (!metadata.name) {
        this.errors.push(`❌ ${skillName}: Missing 'name' in frontmatter`);
      } else if (metadata.name !== skillName) {
        this.warnings.push(`⚠️  ${skillName}: Frontmatter name '${metadata.name}' doesn't match directory name`);
      }

      if (!metadata.description) {
        this.errors.push(`❌ ${skillName}: Missing 'description' in frontmatter`);
      } else if (metadata.description.length < 10) {
        this.warnings.push(`⚠️  ${skillName}: Description is very short (${metadata.description.length} chars)`);
      }

      // Check for required sections
      const requiredSections = ['Inputs', 'Outputs', 'Usage Example'];
      for (const section of requiredSections) {
        if (!content.includes(`## ${section}`)) {
          this.warnings.push(`⚠️  ${skillName}: Missing '${section}' section`);
        }
      }

      // Check for code examples
      if (!content.includes('```')) {
        this.warnings.push(`⚠️  ${skillName}: No code examples found`);
      }

    } catch (error) {
      this.errors.push(`❌ ${skillName}: Error reading SKILL.md - ${error.message}`);
    }
  }

  async validateSkillFiles(skillName, skillPath) {
    try {
      const files = await readdir(skillPath);
      
      // Check for implementation files
      const hasImplementation = files.some(file => 
        file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.py')
      );
      
      if (!hasImplementation) {
        this.warnings.push(`⚠️  ${skillName}: No implementation files found (.ts, .js, .py)`);
      }

      // Check for test files
      const hasTests = files.some(file => 
        file.includes('test') || file.includes('spec')
      );
      
      if (!hasTests) {
        this.warnings.push(`⚠️  ${skillName}: No test files found`);
      }

    } catch (error) {
      this.warnings.push(`⚠️  ${skillName}: Error checking files - ${error.message}`);
    }
  }

  async fileExists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  printResults() {
    console.log('\n📊 Validation Results:');
    
    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('✅ All skills are valid and compliant!');
      return;
    }

    if (this.errors.length > 0) {
      console.log(`\n❌ Errors (${this.errors.length}):`);
      this.errors.forEach(error => console.log(`  ${error}`));
    }

    if (this.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${this.warnings.length}):`);
      this.warnings.forEach(warning => console.log(`  ${warning}`));
    }

    console.log(`\n📈 Summary: ${this.errors.length} errors, ${this.warnings.length} warnings`);
  }
}

// Run validation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new SkillsValidator();
  validator.validateAllSkills().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { SkillsValidator };
