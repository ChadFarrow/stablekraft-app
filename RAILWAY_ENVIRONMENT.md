# Railway Environment Configuration for Lightning Network Integration

## Required Environment Variables

Add these environment variables to your Railway project settings:

### Core Lightning Configuration
```bash
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=your@getalby.com
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=your_node_pubkey_here
```

### NWC (Nostr Wallet Connect) Configuration
```bash
NEXT_PUBLIC_NWC_RELAY_URL=wss://relay.getalby.com
```

### Nostr Integration (Optional)
```bash
NEXT_PUBLIC_NOSTR_ENABLED=false
NEXT_PUBLIC_NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net
```

### Helipad Integration (Optional)
```bash
NEXT_PUBLIC_HELIPAD_ENABLED=false
```

## How to Add Environment Variables in Railway

1. Go to your Railway project dashboard
2. Click on your service (fuckit-app)
3. Go to the "Variables" tab
4. Add each environment variable listed above
5. Click "Deploy" to trigger a new build

## Default Values

If environment variables are not set, the Lightning integration will use these defaults:
- Network: `mainnet` (change to `testnet` for testing)
- Platform Lightning Address: Empty (no platform fees)
- Platform Node Pubkey: Empty
- NWC Relay: `wss://relay.getalby.com`
- Nostr: Disabled
- Helipad: Disabled

## Testing Configuration

For testing purposes, you can use these minimal settings:
```bash
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=test@getalby.com
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
