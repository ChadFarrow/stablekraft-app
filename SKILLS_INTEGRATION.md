# Anthropic Skills Integration Guide

This guide explains how to integrate and use the Anthropic Skills specification with your podcast music site project.

## Overview

The Anthropic Skills specification has been integrated into your project to provide modular, reusable AI agent capabilities for podcast processing, music extraction, and Value4Value operations.

## Quick Start

### 1. Setup Skills Infrastructure

```bash
# Install skills dependencies
npm run skills:setup

# Validate skills specification compliance
npm run skills:validate

# Integrate skills with Task Master AI
npm run skills:integrate
```

### 2. View Generated Tasks

```bash
# List all tasks including new skill tasks
task-master list

# Get next available task
task-master next

# View specific skill task details
task-master show skill-rss-parsing
```

### 3. Implement Skills

```bash
# Expand skill task into subtasks
task-master expand --id=skill-rss-parsing --research --force

# Start implementing subtasks
task-master show skill-rss-parsing.1
```

## Available Skills

### 1. RSS Parsing Skill (`rss-parsing`)
- **Purpose**: Parse podcast RSS feeds and extract metadata
- **Inputs**: Feed URL, parsing options
- **Outputs**: Feed metadata, episodes, chapters, value splits
- **Integration**: Uses existing `lib/rss-parser/` modules

### 2. Music Extraction Skill (`music-extraction`)
- **Purpose**: Extract music tracks from podcast episodes
- **Inputs**: Episode data, extraction options
- **Outputs**: Music tracks with metadata and V4V info
- **Integration**: Uses existing `lib/music-track-parser/` modules

### 3. Value4Value Resolution Skill (`v4v-resolution`)
- **Purpose**: Resolve Lightning Network payment information
- **Inputs**: Resolution target, options
- **Outputs**: V4V info, payment methods, boostagrams
- **Integration**: Uses existing `lib/v4v-resolver.ts`

### 4. Database Operations Skill (`database-operations`)
- **Purpose**: Manage music track database operations
- **Inputs**: Operation type, data, filters
- **Outputs**: Operation results, analytics
- **Integration**: Uses existing Prisma ORM and database services

## Skills Architecture

```
skills/
├── README.md                 # Skills overview
├── package.json              # Skills dependencies
├── skills-registry.ts        # Skills discovery and management
├── integrate-skills.js       # Task Master AI integration
├── validate-skills.js        # Specification compliance validation
├── rss-parsing/
│   └── SKILL.md             # RSS parsing skill definition
├── music-extraction/
│   └── SKILL.md             # Music extraction skill definition
├── v4v-resolution/
│   └── SKILL.md             # V4V resolution skill definition
└── database-operations/
    └── SKILL.md             # Database operations skill definition
```

## Integration with Task Master AI

### Automatic Task Generation

The integration script automatically creates Task Master AI tasks for each skill:

- **Skill Implementation Tasks**: Core functionality implementation
- **Testing Tasks**: Comprehensive testing and validation
- **Integration Tasks**: Task Master AI workflow integration

### Task Structure

Each skill generates three main tasks:

1. **Implementation Task** (`skill-{name}-1`)
   - Create skill implementation
   - Integrate with existing codebase
   - Handle error cases

2. **Testing Task** (`skill-{name}-2`)
   - Create comprehensive tests
   - Validate skill functionality
   - Performance testing

3. **Integration Task** (`skill-{name}-3`)
   - Add to Task Master AI workflow
   - Update project configuration
   - Documentation updates

## Usage Examples

### Using Skills in Code

```typescript
import AnthropicSkillsRegistry from './skills/skills-registry';

// Initialize skills registry
const registry = new AnthropicSkillsRegistry();
await registry.loadSkills();

// Get specific skill
const rssSkill = registry.getSkill('rss-parsing');
console.log(rssSkill.description);

// List all available skills
const allSkills = registry.listSkills();
allSkills.forEach(skill => {
  console.log(`${skill.name}: ${skill.description}`);
});
```

### Task Master AI Integration

```bash
# Start implementing RSS parsing skill
task-master show skill-rss-parsing
task-master expand --id=skill-rss-parsing --research

# Implement first subtask
task-master show skill-rss-parsing.1
# ... implement code ...
task-master set-status --id=skill-rss-parsing.1 --status=done

# Continue with next subtask
task-master next
```

## Development Workflow

### 1. Skill Development

```bash
# Create new skill directory
mkdir skills/new-skill

# Create SKILL.md with proper frontmatter
cat > skills/new-skill/SKILL.md << EOF
---
name: new-skill
description: Description of the new skill
---

# New Skill

## Inputs
...

## Outputs
...

## Usage Example
...
EOF

# Validate skill
npm run skills:validate
```

### 2. Integration Testing

```bash
# Test skill integration
npm run skills:integrate

# Check generated tasks
task-master list --status=pending

# Start implementation
task-master next
```

### 3. Implementation

```bash
# Expand skill task
task-master expand --id=skill-new-skill --research --force

# Implement subtasks
task-master show skill-new-skill.1
# ... implement ...
task-master set-status --id=skill-new-skill.1 --status=done
```

## Configuration Files

### Skills Configuration (`.taskmaster/skills-config.json`)

```json
{
  "version": "1.0.0",
  "specification": "https://github.com/anthropics/skills/blob/main/agent_skills_spec.md",
  "skills": [
    {
      "name": "rss-parsing",
      "description": "Parse podcast RSS feeds and extract metadata",
      "path": "./skills/rss-parsing",
      "status": "pending",
      "integration_status": "not_started"
    }
  ],
  "integration": {
    "task_master_ai": {
      "enabled": true,
      "tasks_created": 4,
      "last_updated": "2025-01-21T00:00:00.000Z"
    }
  }
}
```

### Integration Report (`.taskmaster/skills-integration-report.json`)

Contains detailed information about the integration process, including:
- Skills loaded
- Tasks created
- Next steps
- Implementation status

## Best Practices

### 1. Skill Design
- Keep skills focused and single-purpose
- Use clear, descriptive names and descriptions
- Include comprehensive input/output documentation
- Provide usage examples

### 2. Implementation
- Follow existing codebase patterns
- Integrate with existing modules and services
- Handle errors gracefully
- Include proper logging and monitoring

### 3. Testing
- Create comprehensive tests for each skill
- Test error conditions and edge cases
- Validate performance requirements
- Test integration with Task Master AI

### 4. Documentation
- Keep SKILL.md files up to date
- Document any changes or updates
- Include troubleshooting information
- Provide integration examples

## Troubleshooting

### Common Issues

1. **Skills not loading**
   ```bash
   # Check skills directory structure
   ls -la skills/
   
   # Validate SKILL.md files
   npm run skills:validate
   ```

2. **Task Master AI integration fails**
   ```bash
   # Ensure Task Master is initialized
   task-master init
   
   # Re-run integration
   npm run skills:integrate
   ```

3. **Skills validation errors**
   ```bash
   # Check YAML frontmatter syntax
   npm run skills:validate
   
   # Fix any reported errors
   # Re-validate
   npm run skills:validate
   ```

### Getting Help

- Check `.taskmaster/skills-integration-report.json` for detailed status
- Review skill definitions in `skills/*/SKILL.md`
- Use `task-master list` to see all available tasks
- Run `task-master next` to continue implementation

## Next Steps

1. **Complete Skill Implementation**: Use Task Master AI to implement all skills
2. **Add More Skills**: Create additional skills for specific use cases
3. **Community Contribution**: Share your skills with the Anthropic Skills community
4. **Advanced Integration**: Explore advanced AI agent workflows using your skills

## Resources

- [Anthropic Skills Specification](https://github.com/anthropics/skills/blob/main/agent_skills_spec.md)
- [Task Master AI Documentation](https://github.com/task-master-ai/task-master-ai)
- [Project Documentation](./README.md)
- [API Documentation](./docs/)
