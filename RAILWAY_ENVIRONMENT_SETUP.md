# ⚡ Railway Environment Variables Setup for Lightning Integration

## 🎯 **Required Environment Variables**

The following environment variables need to be configured in Railway for the Lightning integration to work properly:

### **Core Lightning Configuration**

```bash
# Lightning Network Configuration
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
# Options: 'mainnet', 'testnet', 'regtest'
# Recommended: 'testnet' for development, 'mainnet' for production

# Platform Lightning Address (for receiving payments)
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
# This is where platform fees/donations will be sent
# Format: username@domain.com

# Platform Node Public Key (for keysend payments)
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=
# Your Lightning node's public key for direct keysend payments
# Leave empty if not using keysend, or add your node's pubkey
```

### **Nostr Wallet Connect (NWC) Configuration**

```bash
# NWC Relay URL
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
# WebSocket URL for Nostr Wallet Connect relay
# Default: wss://relay.getalby.com

# Nostr Integration (Optional)
NEXT_PUBLIC_NOSTR_ENABLED=false
# Enable Nostr social features
# Options: 'true', 'false'

# Nostr Relays (Optional)
NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net
# Comma-separated list of Nostr relay URLs
# Only used if NEXT_PUBLIC_NOSTR_ENABLED=true
```

### **Helipad Integration (Optional)**

```bash
# Helipad Webhook System (Optional)
NEXT_PUBLIC_HELIPAD_ENABLED=false
# Enable Helipad for boost notifications
# Options: 'true', 'false'

# Helipad URL (Optional)
NEXT_PUBLIC_HELIPAD_URL=https://helipad.example.com
# Your Helipad instance URL
# Only used if NEXT_PUBLIC_HELIPAD_ENABLED=true

# Helipad API Key (Optional)
NEXT_PUBLIC_HELIPAD_API_KEY=
# Your Helipad API key for authentication
# Only used if NEXT_PUBLIC_HELIPAD_ENABLED=true
```

## 🔧 **How to Set Environment Variables in Railway**

### **Method 1: Railway Dashboard**
1. Go to your Railway project dashboard
2. Click on your service
3. Go to the "Variables" tab
4. Add each environment variable with its value
5. Click "Deploy" to apply changes

### **Method 2: Railway CLI**
```bash
# Install Railway CLI if not already installed
npm install -g @railway/cli

# Login to Railway
railway login

# Link to your project
railway link

# Set environment variables
railway variables set NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
railway variables set NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
railway variables set NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
railway variables set NEXT_PUBLIC_NOSTR_ENABLED=false
railway variables set NEXT_PUBLIC_HELIPAD_ENABLED=false

# Deploy changes
railway up
```

## 🎯 **Recommended Configuration for Production**

For a production deployment, use these settings:

```bash
# Production Lightning Configuration
NEXT_PUBLIC_LIGHTNING_NETWORK=mainnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=your-email@your-domain.com
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=your-node-pubkey-here
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
NEXT_PUBLIC_NOSTR_ENABLED=false
NEXT_PUBLIC_HELIPAD_ENABLED=false
```

## 🧪 **Test Configuration**

For testing and development:

```bash
# Test Lightning Configuration
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
NEXT_PUBLIC_NOSTR_ENABLED=false
NEXT_PUBLIC_HELIPAD_ENABLED=false
```

## 🔍 **Verification Steps**

After setting up the environment variables:

1. **Deploy the application** to Railway
2. **Check the deployed site** for Lightning functionality
3. **Test wallet connection** using the header wallet button
4. **Test boost functionality** on music tracks
5. **Verify environment variables** are loaded correctly

## 🚨 **Important Notes**

- **NEXT_PUBLIC_*** variables are exposed to the client-side
- **Never put sensitive data** in NEXT_PUBLIC_ variables
- **Test thoroughly** before switching to mainnet
- **Backup your configuration** before making changes
- **Monitor logs** for any Lightning-related errors

## 📞 **Support**

If you encounter issues:
1. Check Railway deployment logs
2. Verify environment variables are set correctly
3. Test with a simple Lightning Address first
4. Ensure your Lightning wallet supports WebLN/NWC

---

**Next Step**: After setting up environment variables, test the Lightning payment flows end-to-end.
