#!/bin/bash

# Railway Environment Variables Setup Script
# This script helps set up Lightning integration environment variables in Railway

echo "⚡ Setting up Lightning Integration Environment Variables for Railway"
echo "=================================================================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI is not installed. Installing..."
    npm install -g @railway/cli
fi

# Check if user is logged in
if ! railway whoami &> /dev/null; then
    echo "❌ Not logged in to Railway. Please run 'railway login' first."
    exit 1
fi

echo "✅ Railway CLI is ready"

# Function to set environment variable
set_env_var() {
    local var_name=$1
    local var_value=$2
    local description=$3
    
    echo "Setting $var_name..."
    echo "Description: $description"
    echo "Value: $var_value"
    
    railway variables set "$var_name=$var_value"
    
    if [ $? -eq 0 ]; then
        echo "✅ $var_name set successfully"
    else
        echo "❌ Failed to set $var_name"
    fi
    echo ""
}

# Core Lightning Configuration
echo "🔧 Setting up Core Lightning Configuration..."
set_env_var "NEXT_PUBLIC_LIGHTNING_NETWORK" "testnet" "Lightning Network (testnet/mainnet/regtest)"
set_env_var "NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS" "chadf@getalby.com" "Platform Lightning Address for receiving payments"
set_env_var "NEXT_PUBLIC_PLATFORM_NODE_PUBKEY" "" "Platform Node Public Key (optional, for keysend)"

# NWC Configuration
echo "🔧 Setting up Nostr Wallet Connect Configuration..."
set_env_var "NEXT_PUBLIC_NWC_RELAY_URL" "wss://relay.getalby.com" "NWC Relay URL"
set_env_var "NEXT_PUBLIC_NOSTR_ENABLED" "false" "Enable Nostr integration"
set_env_var "NEXT_PUBLIC_NOSTR_RELAYS" "wss://relay.damus.io,wss://relay.primal.net" "Nostr Relay URLs"

# Helipad Configuration
echo "🔧 Setting up Helipad Configuration..."
set_env_var "NEXT_PUBLIC_HELIPAD_ENABLED" "false" "Enable Helipad webhook system"
set_env_var "NEXT_PUBLIC_HELIPAD_URL" "https://helipad.example.com" "Helipad instance URL"
set_env_var "NEXT_PUBLIC_HELIPAD_API_KEY" "" "Helipad API Key"

echo "🎉 Environment variables setup complete!"
echo ""
echo "📋 Summary of configured variables:"
echo "- NEXT_PUBLIC_LIGHTNING_NETWORK: testnet"
echo "- NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS: chadf@getalby.com"
echo "- NEXT_PUBLIC_PLATFORM_NODE_PUBKEY: (empty)"
echo "- NEXT_PUBLIC_NWC_RELAY_URL: wss://relay.getalby.com"
echo "- NEXT_PUBLIC_NOSTR_ENABLED: false"
echo "- NEXT_PUBLIC_NOSTR_RELAYS: wss://relay.damus.io,wss://relay.primal.net"
echo "- NEXT_PUBLIC_HELIPAD_ENABLED: false"
echo "- NEXT_PUBLIC_HELIPAD_URL: https://helipad.example.com"
echo "- NEXT_PUBLIC_HELIPAD_API_KEY: (empty)"
echo ""
echo "🚀 Next steps:"
echo "1. Deploy your application: railway up"
echo "2. Test Lightning functionality on the deployed site"
echo "3. Update NEXT_PUBLIC_LIGHTNING_NETWORK to 'mainnet' for production"
echo "4. Set your own NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS"
echo ""
echo "📖 For more information, see RAILWAY_ENVIRONMENT_SETUP.md"
