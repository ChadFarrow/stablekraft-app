# Claude Code Instructions

## Environment Configuration
- **API Keys**: Located in `.env.local` (not committed to git)
  - `PODCAST_INDEX_API_KEY` and `PODCAST_INDEX_API_SECRET` for V4V resolution
  - Load with: `const envContent = fs.readFileSync('.env.local', 'utf8')`

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
