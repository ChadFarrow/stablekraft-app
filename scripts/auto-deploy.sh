#!/bin/bash

# Auto-deploy script for StableKraft app
# This script automatically builds and deploys your app to the server

set -e

echo "🚀 Auto-deploying StableKraft app to stablekraft.app"
echo "=============================================="

# Configuration
SERVER_HOST="185.98.170.24"
SERVER_USER="root"  # Change this to your server username
DEPLOY_DIR="/var/www/stablekraft.app"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Make sure you're in the project root."
    exit 1
fi

# Build the app
print_status "Building the app..."
npm run build

# Check if build was successful
if [ ! -d ".next" ]; then
    print_error "Build failed. .next directory not found."
    exit 1
fi

print_status "Build completed successfully!"

# Create temporary deployment package
TEMP_DIR=$(mktemp -d)
print_status "Creating deployment package in $TEMP_DIR"

# Copy necessary files
cp -r .next "$TEMP_DIR/"
cp -r public "$TEMP_DIR/"
cp package.json "$TEMP_DIR/"
cp package-lock.json "$TEMP_DIR/"
cp next.config.js "$TEMP_DIR/"
cp -r lib "$TEMP_DIR/"
cp -r components "$TEMP_DIR/"
cp -r app "$TEMP_DIR/"
cp -r types "$TEMP_DIR/"
cp ecosystem.config.js "$TEMP_DIR/"

# Create production environment file
cat > "$TEMP_DIR/.env.production" << EOF
# Production environment variables
NODE_ENV=production
EOF

# Deploy to server
print_status "Deploying to server..."

# Create deployment script
cat > "$TEMP_DIR/deploy.sh" << 'EOF'
#!/bin/bash
set -e

DEPLOY_DIR="/var/www/stablekraft.app"
BACKUP_DIR="/var/www/backup-$(date +%Y%m%d-%H%M%S)"

echo "🚀 Starting deployment..."

# Backup current deployment
if [ -d "$DEPLOY_DIR" ]; then
    sudo cp -r "$DEPLOY_DIR" "$BACKUP_DIR"
    echo "✅ Backup created at $BACKUP_DIR"
fi

# Create deployment directory if it doesn't exist
sudo mkdir -p "$DEPLOY_DIR"
sudo chown $USER:$USER "$DEPLOY_DIR"

# Stop the current application
cd "$DEPLOY_DIR" && pm2 stop stablekraft-app || true

# Clean up old files
sudo rm -rf "$DEPLOY_DIR"/*

# Copy new files
sudo cp -r . "$DEPLOY_DIR/"
sudo chown -R $USER:$USER "$DEPLOY_DIR"

# Install dependencies
cd "$DEPLOY_DIR"
npm install --production

# Start the application
pm2 start ecosystem.config.js
pm2 save

echo "✅ Deployment completed successfully!"
echo "🌐 Your app is now live at https://stablekraft.app"
EOF

chmod +x "$TEMP_DIR/deploy.sh"

# Upload and execute deployment
if scp -r "$TEMP_DIR"/* "$SERVER_USER@$SERVER_HOST:/tmp/deploy/" && \
   ssh "$SERVER_USER@$SERVER_HOST" "cd /tmp/deploy && chmod +x deploy.sh && ./deploy.sh"; then
    print_status "Deployment successful!"
    print_status "Your app is now live at https://stablekraft.app"
else
    print_error "Deployment failed!"
    exit 1
fi

# Clean up
rm -rf "$TEMP_DIR"
print_status "Cleanup completed"

echo ""
echo "🎉 Auto-deployment completed!"
echo "📱 Your app is live at: https://stablekraft.app"
echo "🔄 Next time, just run: ./scripts/auto-deploy.sh" 