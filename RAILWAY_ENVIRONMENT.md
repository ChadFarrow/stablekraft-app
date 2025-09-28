# Railway Environment Configuration for Lightning Network Integration

## Required Environment Variables

Add these environment variables to your Railway project settings:

### Core Lightning Configuration
```bash
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=
```

### NWC (Nostr Wallet Connect) Configuration
```bash
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
```

### Nostr Integration (Optional - Disabled for now)
```bash
NEXT_PUBLIC_NOSTR_ENABLED=false
NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net
```

### Helipad Integration (Optional - Disabled for now)
```bash
NEXT_PUBLIC_HELIPAD_ENABLED=false
```

## How to Add Environment Variables in Railway

1. Go to your Railway project dashboard
2. Click on your service (fuckit-app)
3. Go to the "Variables" tab
4. Add each environment variable listed above
5. Click "Deploy" to trigger a new build

## Your Actual Configuration

Based on your Lightning integration:
- **Platform Lightning Address**: `chadf@getalby.com` (for platform fees)
- **Network**: `testnet` (for testing - change to `mainnet` for production)
- **NWC Relay**: `wss://relay.getalby.com` (Alby's relay)
- **Test Feed**: `https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml`

## Missing Values You Need to Provide

You'll need to add these values to Railway:

1. **NEXT_PUBLIC_PLATFORM_NODE_PUBKEY**: Your Lightning node's public key
   - Get this from your Lightning node (LND, CLN, etc.)
   - Or from your wallet if using a hosted node

2. **Optional**: If you want to enable Nostr integration later:
   - `NEXT_PUBLIC_NOSTR_ENABLED=true`
   - Your Nostr private key (keep this secure!)

## Testing Configuration

For testing purposes, you can use these minimal settings:
```bash
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
```

## Troubleshooting

If builds are still failing:
1. Check Railway build logs for specific error messages
2. Ensure all required environment variables are set
3. Verify the Lightning integration is not causing server-side rendering issues
4. Check if any Lightning components are being imported in server components

## Build Command

Railway uses: `npm run build`

Make sure this command works locally before deploying.
