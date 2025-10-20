import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';

class AnthropicSkillsRegistry {
  constructor(skillsPath = '.') {
    this.skills = new Map();
    this.skillsPath = skillsPath;
  }

  async loadSkills() {
    try {
      const skillDirs = await readdir(this.skillsPath, { withFileTypes: true });
      
      for (const dir of skillDirs) {
        if (dir.isDirectory() && dir.name !== 'node_modules') {
          const skillPath = join(this.skillsPath, dir.name);
          const skillDef = await this.loadSkillDefinition(skillPath);
          
          if (skillDef) {
            this.skills.set(skillDef.name, skillDef);
          }
        }
      }
    } catch (error) {
      console.error('Error loading skills:', error);
      throw error;
    }
  }

  async loadSkillDefinition(skillPath) {
    try {
      const skillMdPath = join(skillPath, 'SKILL.md');
      const skillContent = await readFile(skillMdPath, 'utf-8');
      
      // Extract YAML frontmatter
      const frontmatterMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        console.warn(`No frontmatter found in ${skillMdPath}`);
        return null;
      }

      const metadata = yaml.load(frontmatterMatch[1]);
      
      if (!metadata.name || !metadata.description) {
        console.warn(`Invalid skill definition in ${skillMdPath}`);
        return null;
      }

      return {
        name: metadata.name,
        description: metadata.description,
        path: skillPath,
        metadata
      };
    } catch (error) {
      console.error(`Error loading skill definition from ${skillPath}:`, error);
      return null;
    }
  }

  getSkill(name) {
    return this.skills.get(name);
  }

  listSkills() {
    return Array.from(this.skills.values());
  }

  // Integration with Task Master AI
  async generateTaskMasterSkillTasks() {
    const tasks = [];
    
    for (const skill of this.listSkills()) {
      tasks.push({
        id: `skill-${skill.name}`,
        title: `Implement ${skill.name} skill`,
        description: skill.description,
        status: 'pending',
        priority: 'medium',
        details: `Implement the ${skill.name} skill according to Anthropic Skills specification.`,
        testStrategy: `Test ${skill.name} skill with various inputs and validate outputs.`,
        subtasks: [
          {
            id: `${skill.name}-1`,
            title: `Create ${skill.name} skill implementation`,
            description: `Implement the core functionality for ${skill.name}`,
            status: 'pending'
          },
          {
            id: `${skill.name}-2`,
            title: `Test ${skill.name} skill`,
            description: `Create comprehensive tests for ${skill.name}`,
            status: 'pending'
          },
          {
            id: `${skill.name}-3`,
            title: `Integrate ${skill.name} with Task Master AI`,
            description: `Add ${skill.name} to Task Master AI workflow`,
            status: 'pending'
          }
        ]
      });
    }
    
    return tasks;
  }
}

export default AnthropicSkillsRegistry;
