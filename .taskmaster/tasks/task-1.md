# RSS Parsing Skill

## Description
Parse podcast RSS feeds and extract metadata including episodes, chapters, and music track information

## Status
done

## Priority
high

## Details
The rss-parsing skill has been implemented according to Anthropic Skills specification. It provides parse podcast rss feeds and extract metadata including episodes, chapters, and music track information.

## Test Strategy
Test rss-parsing skill with various inputs and validate outputs match expected schema.

## Subtasks
- [x] Create rss-parsing skill implementation: Implement the core functionality for rss-parsing
- [x] Test rss-parsing skill: Create comprehensive tests for rss-parsing
- [x] Integrate rss-parsing with Task Master AI: Add rss-parsing to Task Master AI workflow

## Implementation Notes
- Skill implementation follows Anthropic Skills specification
- Includes proper error handling and validation
- Comprehensive tests are included
- Integrated with Task Master AI workflow

## Related Files
- `skills/rss-parsing/index.ts`
- `skills/rss-parsing/index.test.ts`
- `skills/rss-parsing/SKILL.md`

## Usage Example
```javascript
import SkillsRegistry from './skills/skills-registry';

// Execute a skill
const result = await SkillsRegistry.executeSkill('rss-parsing', {
  // skill inputs
});
```
