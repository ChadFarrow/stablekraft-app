import RSSParsingSkill from './rss-parsing';
import MusicExtractionSkill from './music-extraction';
import V4VResolutionSkill from './v4v-resolution';
import DatabaseOperationsSkill from './database-operations';

export interface SkillDefinition {
  name: string;
  description: string;
  category: 'processing' | 'data' | 'integration' | 'utility';
  version: string;
  implementation: any;
  inputs: any;
  outputs: any;
  metadata: Record<string, any>;
}

export class SkillsRegistry {
  private static skills: Map<string, SkillDefinition> = new Map();

  static {
    // Register RSS Parsing Skill
    this.skills.set('rss-parsing', {
      name: 'rss-parsing',
      description: 'Parse podcast RSS feeds and extract metadata including episodes, chapters, and music track information',
      category: 'processing',
      version: '1.0.0',
      implementation: RSSParsingSkill,
      inputs: {
        feed_url: 'string',
        parse_options: 'object'
      },
      outputs: {
        feed_metadata: 'object',
        episodes: 'array'
      },
      metadata: {
        author: 'Podcast Music Site',
        created: new Date().toISOString(),
        dependencies: ['lib/rss-parser']
      }
    });

    // Register Music Extraction Skill
    this.skills.set('music-extraction', {
      name: 'music-extraction',
      description: 'Extract music tracks from podcast episodes using chapters, value splits, and content analysis',
      category: 'processing',
      version: '1.0.0',
      implementation: MusicExtractionSkill,
      inputs: {
        episode_data: 'object',
        extraction_options: 'object'
      },
      outputs: {
        music_tracks: 'array'
      },
      metadata: {
        author: 'Podcast Music Site',
        created: new Date().toISOString(),
        dependencies: ['lib/music-track-parser']
      }
    });

    // Register V4V Resolution Skill
    this.skills.set('v4v-resolution', {
      name: 'v4v-resolution',
      description: 'Resolve Value4Value Lightning Network payment information for music tracks, artists, and podcast episodes',
      category: 'data',
      version: '1.0.0',
      implementation: V4VResolutionSkill,
      inputs: {
        resolution_target: 'object',
        resolution_options: 'object'
      },
      outputs: {
        v4v_info: 'object'
      },
      metadata: {
        author: 'Podcast Music Site',
        created: new Date().toISOString(),
        dependencies: ['lib/v4v-resolver']
      }
    });

    // Register Database Operations Skill
    this.skills.set('database-operations', {
      name: 'database-operations',
      description: 'Execute database operations for music tracks, episodes, feeds, and playlists',
      category: 'data',
      version: '1.0.0',
      implementation: DatabaseOperationsSkill,
      inputs: {
        operation: 'string',
        entity_type: 'string',
        data: 'object',
        filters: 'object',
        options: 'object'
      },
      outputs: {
        success: 'boolean',
        data: 'any',
        count: 'number',
        error: 'string'
      },
      metadata: {
        author: 'Podcast Music Site',
        created: new Date().toISOString(),
        dependencies: ['@prisma/client']
      }
    });
  }

  /**
   * Get all registered skills
   */
  static getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get a skill by name
   */
  static getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  /**
   * Get skills by category
   */
  static getSkillsByCategory(category: string): SkillDefinition[] {
    return Array.from(this.skills.values()).filter(skill => skill.category === category);
  }

  /**
   * Check if a skill exists
   */
  static hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Get skill implementation
   */
  static getSkillImplementation(name: string): any {
    const skill = this.skills.get(name);
    return skill?.implementation;
  }

  /**
   * Execute a skill with given inputs
   */
  static async executeSkill(name: string, inputs: any): Promise<any> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill '${name}' not found`);
    }

    const implementation = skill.implementation;
    
    // Determine the main method to call based on skill name
    let methodName: string;
    switch (name) {
      case 'rss-parsing':
        methodName = 'parseRSSFeed';
        break;
      case 'music-extraction':
        methodName = 'extractMusicTracks';
        break;
      case 'v4v-resolution':
        methodName = 'resolveV4V';
        break;
      case 'database-operations':
        methodName = 'executeOperation';
        break;
      default:
        throw new Error(`Unknown skill method for '${name}'`);
    }

    if (typeof implementation[methodName] !== 'function') {
      throw new Error(`Method '${methodName}' not found in skill '${name}'`);
    }

    return await implementation[methodName](inputs);
  }

  /**
   * Generate Task Master AI tasks for all skills
   */
  static generateTaskMasterTasks(): any[] {
    const tasks = [];
    
    for (const skill of this.getAllSkills()) {
      tasks.push({
        id: `skill-${skill.name}`,
        title: `Implement ${skill.name} skill`,
        description: skill.description,
        status: 'completed', // Skills are already implemented
        priority: 'high',
        details: `The ${skill.name} skill has been implemented according to Anthropic Skills specification. It provides ${skill.description.toLowerCase()}.`,
        testStrategy: `Test ${skill.name} skill with various inputs and validate outputs match expected schema.`,
        subtasks: [
          {
            id: `${skill.name}-1`,
            title: `Create ${skill.name} skill implementation`,
            description: `Implement the core functionality for ${skill.name}`,
            status: 'completed'
          },
          {
            id: `${skill.name}-2`,
            title: `Test ${skill.name} skill`,
            description: `Create comprehensive tests for ${skill.name}`,
            status: 'completed'
          },
          {
            id: `${skill.name}-3`,
            title: `Integrate ${skill.name} with Task Master AI`,
            description: `Add ${skill.name} to Task Master AI workflow`,
            status: 'completed'
          }
        ]
      });
    }
    
    return tasks;
  }

  /**
   * Get skill statistics
   */
  static getSkillStats(): {
    total_skills: number;
    skills_by_category: Record<string, number>;
    skills_by_status: Record<string, number>;
  } {
    const skills = this.getAllSkills();
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    skills.forEach(skill => {
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
      byStatus['implemented'] = (byStatus['implemented'] || 0) + 1;
    });

    return {
      total_skills: skills.length,
      skills_by_category: byCategory,
      skills_by_status: byStatus
    };
  }

  /**
   * Validate skill inputs
   */
  static validateSkillInputs(name: string, inputs: any): { valid: boolean; errors: string[] } {
    const skill = this.skills.get(name);
    if (!skill) {
      return { valid: false, errors: [`Skill '${name}' not found`] };
    }

    const errors: string[] = [];
    const expectedInputs = skill.inputs;

    // Basic validation - check required fields exist
    for (const [field, type] of Object.entries(expectedInputs)) {
      if (!(field in inputs)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get skill documentation
   */
  static getSkillDocumentation(name: string): string {
    const skill = this.skills.get(name);
    if (!skill) {
      return `Skill '${name}' not found`;
    }

    return `
# ${skill.name}

**Description:** ${skill.description}

**Category:** ${skill.category}

**Version:** ${skill.version}

**Inputs:**
${Object.entries(skill.inputs).map(([key, type]) => `- ${key}: ${type}`).join('\n')}

**Outputs:**
${Object.entries(skill.outputs).map(([key, type]) => `- ${key}: ${type}`).join('\n')}

**Dependencies:** ${skill.metadata.dependencies?.join(', ') || 'None'}

**Created:** ${skill.metadata.created}
`;
  }
}

export default SkillsRegistry;