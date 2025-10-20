# Anthropic Skills Specification Implementation

This directory contains AI agent skills following the [Anthropic Skills specification](https://github.com/anthropics/skills/blob/main/agent_skills_spec.md).

## Skills Overview

Each skill is a self-contained directory with:
- `SKILL.md` - Skill definition with YAML frontmatter
- Supporting scripts and resources
- Clear input/output specifications
- Usage examples

## Available Skills

### Core Processing Skills
- **rss-parsing** - Parse podcast RSS feeds and extract metadata
- **music-extraction** - Extract music tracks from podcast content
- **v4v-resolution** - Resolve Value4Value Lightning Network payments
- **database-operations** - Manage music track database operations

### Integration Skills
- **cache-management** - Handle feed and track caching
- **playlist-generation** - Create and manage playlists
- **audio-resolution** - Resolve audio URLs and metadata

## Usage

Skills can be used by AI agents through the Task Master AI system or directly via the MCP interface.

## Adding New Skills

1. Create a new directory under `skills/`
2. Add `SKILL.md` with proper YAML frontmatter
3. Include supporting scripts and documentation
4. Test the skill integration
5. Update this README

## Integration with Task Master AI

Skills are automatically discovered and can be referenced in task definitions and subtasks for AI agent execution.
