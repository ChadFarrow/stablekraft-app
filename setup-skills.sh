#!/bin/bash

# Anthropic Skills Setup Script
# This script sets up the complete Anthropic Skills infrastructure for the podcast music site

set -e

echo "🚀 Setting up Anthropic Skills specification for Podcast Music Site..."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if Task Master AI is installed
if ! command -v task-master &> /dev/null; then
    echo "⚠️  Task Master AI not found. Installing..."
    npm install -g task-master-ai
fi

# Check if Task Master is initialized
if [ ! -d ".taskmaster" ]; then
    echo "⚠️  Task Master not initialized. Initializing..."
    task-master init --yes
fi

echo "📦 Installing skills dependencies..."
cd skills
npm install
cd ..

echo "🔍 Validating skills specification compliance..."
npm run skills:validate

echo "🔗 Integrating skills with Task Master AI..."
npm run skills:integrate

echo ""
echo "✅ Anthropic Skills setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Run 'task-master list' to see the new skill tasks"
echo "2. Run 'task-master next' to start implementing skills"
echo "3. Use 'task-master expand --id=<skill-task-id> --research' to break down implementation"
echo "4. Check SKILLS_INTEGRATION.md for detailed usage instructions"
echo ""
echo "🎯 Available skills:"
echo "  - rss-parsing: Parse podcast RSS feeds and extract metadata"
echo "  - music-extraction: Extract music tracks from podcast episodes"
echo "  - v4v-resolution: Resolve Value4Value Lightning Network payments"
echo "  - database-operations: Manage music track database operations"
echo ""
echo "📚 Documentation:"
echo "  - SKILLS_INTEGRATION.md: Complete integration guide"
echo "  - skills/README.md: Skills overview"
echo "  - .taskmaster/skills-integration-report.json: Integration report"
echo ""
echo "🔧 Useful commands:"
echo "  - npm run skills:validate: Validate skills specification compliance"
echo "  - npm run skills:integrate: Re-integrate skills with Task Master AI"
echo "  - task-master list: List all tasks including skill tasks"
echo "  - task-master next: Get next available task to work on"
