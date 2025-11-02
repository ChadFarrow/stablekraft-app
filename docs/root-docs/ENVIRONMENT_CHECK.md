# Environment Variables Check

This project includes an automated environment variables check to ensure all required configuration is present before running scripts or commands.

## Quick Check

Run the environment check at any time:

```bash
npm run check-env
```

Or directly:

```bash
node scripts/check-env.js
```

## What It Checks

### Required Variables
- `PODCAST_INDEX_API_KEY` - Podcast Index API key
- `PODCAST_INDEX_API_SECRET` - Podcast Index API secret

### Optional Variables
- `DATABASE_URL` - Database connection string
- `JWT_SECRET` - JWT signing secret
- `SESSION_SECRET` - Session encryption secret
- `OPENAI_API_KEY` - OpenAI API key
- `ANTHROPIC_API_KEY` - Anthropic API key

## Setup

1. Create a `.env.local` file in your project root
2. Add your environment variables:

```bash
PODCAST_INDEX_API_KEY=your_api_key_here
PODCAST_INDEX_API_SECRET=your_api_secret_here
```

3. Make sure `.env.local` is in your `.gitignore` file
4. Run `npm run check-env` to verify setup

## Security

- Never commit `.env.local` to version control
- Use different values for development and production
- Consider using environment-specific files (`.env.development`, `.env.production`)

## Integration

The environment check is designed to be run:
- When starting a new chat session
- Before running scripts that require API access
- During development setup
- As part of CI/CD pipeline validation

## Troubleshooting

If you see missing variables:
1. Check that `.env.local` exists in the project root
2. Verify variable names are correct (case-sensitive)
3. Ensure no extra spaces around the `=` sign
4. Restart your development server after changes 