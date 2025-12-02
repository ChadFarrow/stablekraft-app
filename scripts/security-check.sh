#!/bin/bash

# Security check script to prevent sensitive data commits
echo "🔒 Running security checks..."

# Check for common API key patterns (UUID format)
if git diff --cached | grep -E "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}" 2>/dev/null; then
    echo "❌ WARNING: Possible API key pattern detected!"
    echo "Please verify this is not a real API key before committing."
    exit 1
fi

# Check for other common sensitive patterns
if git diff --cached | grep -E "(api_key|api_secret|access_token|secret_key|private_key|password|credential)" 2>/dev/null; then
    echo "❌ WARNING: Possible sensitive data pattern detected!"
    echo "Please verify this is not real sensitive data before committing."
    exit 1
fi

# Check for email addresses (might contain sensitive info)
if git diff --cached | grep -E "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" 2>/dev/null; then
    echo "⚠️  WARNING: Email addresses detected in staged files!"
    echo "Please verify these are not sensitive before committing."
fi

# Check for potential database connection strings
if git diff --cached | grep -E "(mongodb://|postgresql://|mysql://|redis://)" 2>/dev/null; then
    echo "❌ ERROR: Database connection string detected!"
    echo "Please remove database credentials before committing."
    exit 1
fi

# Check for potential AWS/GCP/Azure keys
if git diff --cached | grep -E "(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{35}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})" 2>/dev/null; then
    echo "❌ WARNING: Possible cloud service key detected!"
    echo "Please verify this is not a real key before committing."
    exit 1
fi

echo "✅ Security checks passed!"
exit 0 