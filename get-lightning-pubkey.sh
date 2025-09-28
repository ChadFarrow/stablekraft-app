#!/bin/bash
# Get Lightning Node Public Key Script

echo "🔍 Lightning Node Public Key Helper"
echo "=================================="
echo ""

echo "This script helps you find your Lightning node's public key."
echo "You'll need this for the NEXT_PUBLIC_PLATFORM_NODE_PUBKEY environment variable."
echo ""

echo "Choose your Lightning setup:"
echo "1) LND (Lightning Network Daemon)"
echo "2) CLN (Core Lightning)"
echo "3) Alby Wallet"
echo "4) Zeus Wallet"
echo "5) Other wallet/node"
echo ""

read -p "Enter your choice (1-5): " choice

case $choice in
    1)
        echo "For LND, run:"
        echo "lncli getinfo | grep identity_pubkey"
        echo "or"
        echo "lncli getinfo | jq -r '.identity_pubkey'"
        ;;
    2)
        echo "For CLN, run:"
        echo "lightning-cli getinfo | grep id"
        echo "or"
        echo "lightning-cli getinfo | jq -r '.id'"
        ;;
    3)
        echo "For Alby Wallet:"
        echo "1. Open Alby Wallet"
        echo "2. Go to Settings > Lightning"
        echo "3. Look for 'Node Public Key' or 'Pubkey'"
        echo "4. Copy the long string starting with '02' or '03'"
        ;;
    4)
        echo "For Zeus Wallet:"
        echo "1. Open Zeus Wallet"
        echo "2. Go to Settings > Lightning"
        echo "3. Look for 'Node Public Key'"
        echo "4. Copy the long string starting with '02' or '03'"
        ;;
    5)
        echo "For other wallets/nodes:"
        echo "Look for 'Node Public Key', 'Pubkey', or 'Identity' in your wallet settings."
        echo "It should be a long string starting with '02' or '03'."
        ;;
    *)
        echo "Invalid choice. Please run the script again."
        ;;
esac

echo ""
echo "Once you have your public key, add it to Railway as:"
echo "NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=your_public_key_here"
echo ""
echo "Note: The public key should start with '02' or '03' and be about 66 characters long."
