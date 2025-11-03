#!/bin/bash

# Task Master MCP Server Startup Script
# This script starts the Task Master MCP server in the background

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Change to the project directory
cd "$PROJECT_ROOT"

# Check if Task Master MCP server is already running
if ! pgrep -f "task-master-mcp" > /dev/null; then
    echo "🚀 Starting Task Master MCP server..."
    # Start Task Master MCP server in the background
    npx task-master-mcp > /dev/null 2>&1 &
    echo "✅ Task Master MCP server started in background"
else
    echo "ℹ️  Task Master MCP server is already running"
fi

# Function to start Task Master when entering the project directory
start_taskmaster_if_needed() {
    if [[ "$PWD" == *"StableKraft"* ]] && ! pgrep -f "task-master-mcp" > /dev/null; then
        echo "🚀 Auto-starting Task Master MCP server..."
        npx task-master-mcp > /dev/null 2>&1 &
    fi
}

# Export the function so it can be used in shell hooks
export -f start_taskmaster_if_needed 