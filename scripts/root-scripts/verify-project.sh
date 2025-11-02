#!/bin/bash

# Project verification script
PROJECT_ID=$(cat .project-identifier 2>/dev/null)

if [[ "$PROJECT_ID" == "FUCKIT - Main Music Project" ]]; then
    echo "✅ Correct project: FUCKIT"
    echo "📍 Location: $(pwd)"
    echo "🎵 Ready for music project development"
    exit 0
elif [[ "$PROJECT_ID" == "dl-rss-checker - Secondary Project" ]]; then
    echo "⚠️  WARNING: You're in dl-rss-checker project"
    echo "📍 Location: $(pwd)"
    echo "💡 To switch to FUCKIT: cd /Users/chad-mini/Vibe/apps/FUCKIT"
    exit 1
else
    echo "❌ Unknown project directory"
    echo "📍 Location: $(pwd)"
    echo "💡 Available projects:"
    echo "   - FUCKIT: /Users/chad-mini/Vibe/apps/FUCKIT"
    echo "   - dl-rss-checker: /Users/chad-mini/Vibe/dl-rss-checker"
    exit 1
fi 