# Lightning Network Implementation Roadmap

## Overview
This document outlines the phased implementation of Lightning Network Value4Value features for the music streaming app, based on the successful implementation in https://github.com/ChadFarrow/ITDV-Lightning

## Core Lightning Network Features to Implement

### Value4Value Implementation
- **Podcasting 2.0 Value Tags**: Parse Lightning Network value splits from podcast feeds for automatic payment distribution
- **Multi-Recipient Payments**: Automatically split payments between artists, collaborators, and platform (2 sat platform fee)
- **Real-time Payments**: Instant Bitcoin payments with preimage verification

### Payment Methods
- **WebLN Integration**: Browser extension wallets (Alby, Zeus, etc.)
- **NWC (Nostr Wallet Connect)**: Integration with Alby Hub, Mutiny, and other NWC-compatible wallets
- **Lightning Addresses**: Email-style Lightning payments (e.g., chadf@getalby.com, user@strike.me)
- **Node Keysends**: Direct payments to Lightning node public keys

### Advanced Features
- **Auto Boost System**: 25 sats automatically sent when songs complete
- **Boostagram Features**: 250-character messages with Lightning payments
- **Nostr Integration**: NIP-57/NIP-73 compliant boost posts to Nostr relays
- **Helipad Integration**: Webhook system for boost notifications

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

#### 1. Set up core Lightning infrastructure and dependencies
- [ ] Install Bitcoin Connect library: `npm install @getalby/bitcoin-connect`
- [ ] Add Lightning-related environment variables to `.env.local`
- [ ] Create `/lib/lightning/` directory for Lightning utilities
- [ ] Set up basic Lightning configuration module

#### 2. Implement WebLN integration for browser extension wallets
- [ ] Create `WebLNProvider` component wrapper
- [ ] Add WebLN detection and initialization
- [ ] Implement basic send payment functionality
- [ ] Add error handling for missing WebLN providers
- [ ] Test with Alby, Zeus browser extensions

---

### Phase 2: Payment Methods (Week 3-4)

#### 3. Add Lightning Address support with LNURL resolution
- [ ] Create LNURL resolver utility (`/lib/lightning/lnurl.ts`)
- [ ] Implement Lightning address validation (email format)
- [ ] Add LNURL-pay protocol support
- [ ] Create UI input for Lightning addresses
- [ ] Handle payment confirmation responses

#### 4. Parse Podcasting 2.0 value tags from feeds
- [ ] Update RSS parser to extract `<podcast:value>` tags
- [ ] Create value split data model in Prisma schema
- [ ] Parse destination addresses and split percentages
- [ ] Store value recipients in database
- [ ] Add fallback for feeds without value tags

---

### Phase 3: Core Features (Week 5-6)

#### 5. Implement basic boost functionality with custom amounts
- [ ] Create Boost button component
- [ ] Add custom amount input modal
- [ ] Implement payment execution logic
- [ ] Add success/failure notifications
- [ ] Create boost transaction logging

#### 6. Add NWC (Nostr Wallet Connect) integration
- [ ] Install NWC dependencies
- [ ] Create NWC connection handler
- [ ] Implement wallet pairing flow
- [ ] Add NWC payment methods
- [ ] Prioritize NWC over WebLN to prevent popups

---

### Phase 4: Advanced Payments (Week 7-8)

#### 7. Implement multi-recipient payment splitting
- [ ] Create payment splitter utility
- [ ] Calculate proportional splits from value tags
- [ ] Execute multiple keysend payments
- [ ] Add 2 sat platform fee logic
- [ ] Handle partial payment failures

#### 8. Create boostagram feature with messages
- [ ] Add message input to boost modal
- [ ] Implement 250-character limit
- [ ] Include messages in TLV records
- [ ] Store boostagrams in database
- [ ] Display boostagrams in UI

---

### Phase 5: Automation (Week 9-10)

#### 9. Add auto-boost system for song completion
- [ ] Create auto-boost settings component
- [ ] Detect song completion events
- [ ] Implement 25 sat default auto-payment
- [ ] Use NWC for background payments
- [ ] Add enable/disable toggle

---

### Phase 6: Nostr Integration (Week 11-12)

#### 10. Integrate Nostr protocol for boost notes
- [ ] Install Nostr SDK dependencies
- [ ] Create Nostr relay connection manager
- [ ] Implement NIP-57/NIP-73 boost notes
- [ ] Publish to multiple relays (Primal, Snort, etc.)
- [ ] Generate nevent references

---

### Phase 7: External Integrations (Week 13-14)

#### 11. Implement Helipad webhook integration
- [ ] Create `/api/helipad-webhook` endpoint
- [ ] Set up webhook verification
- [ ] Handle TOR compatibility
- [ ] Store Helipad boosts in database
- [ ] Create `/api/helipad-boosts` retrieval endpoint

---

### Phase 8: UI & Analytics (Week 15-16)

#### 12. Add boost history and analytics pages
- [ ] Create `/boosts` page for boost history
- [ ] Add boost statistics dashboard
- [ ] Implement boost leaderboard
- [ ] Create artist earnings view
- [ ] Add CSV export functionality

#### 13. Optimize performance and fix potential issues
- [ ] Fix render loop issues with useMemo
- [ ] Optimize payment recipient detection
- [ ] Add payment retry logic
- [ ] Implement rate limiting
- [ ] Add comprehensive error logging

---

## Implementation Tips

1. **Start Simple**: Begin with WebLN as it's the easiest to test
2. **Use Testnet**: Test all Lightning features on testnet first
3. **Mock Data**: Create mock value splits for testing before parsing real feeds
4. **Progressive Enhancement**: Ensure app works without Lightning features
5. **Security First**: Validate all payment amounts and addresses
6. **User Control**: Always give users control over automatic payments

---

## Testing Checklist for Each Phase

- [ ] Unit tests for utility functions
- [ ] Integration tests for API endpoints
- [ ] Manual testing with real wallets
- [ ] Error scenario testing
- [ ] Performance benchmarking
- [ ] Security audit

---

## API Endpoints to Implement

- `/api/albums-static-cached` - Cached album data with Lightning payment info
- `/api/helipad-webhook` - Webhook endpoint for Helipad boost notifications
- `/api/helipad-boosts` - Retrieve stored Helipad boosts
- `/api/lightning/pay` - Execute Lightning payments
- `/api/lightning/lnurl` - Resolve LNURL addresses
- `/api/value-splits` - Get value split information for tracks

---

## Database Schema Updates Required

```prisma
// Add to schema.prisma

model ValueRecipient {
  id          String   @id @default(cuid())
  feedId      String
  name        String?
  customKey   String?
  customValue String?
  address     String   // Lightning address or node pubkey
  split       Int      // Percentage (0-100)
  type        String   // "node" or "lnaddress"
  fee         Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  feed        Feed     @relation(fields: [feedId], references: [id])

  @@index([feedId])
}

model BoostTransaction {
  id              String   @id @default(cuid())
  trackId         String?
  feedId          String?
  amount          Int      // Satoshis
  message         String?  @db.Text
  senderName      String?
  paymentHash     String?
  preimage        String?
  timestamp       DateTime @default(now())
  status          String   // "pending", "completed", "failed"
  source          String   // "webln", "nwc", "helipad"

  track           Track?   @relation(fields: [trackId], references: [id])
  feed            Feed?    @relation(fields: [feedId], references: [id])

  @@index([trackId])
  @@index([feedId])
  @@index([timestamp])
}
```

---

## Environment Variables Required

```env
# Lightning Configuration
LIGHTNING_NETWORK=mainnet # or testnet
PLATFORM_LIGHTNING_ADDRESS=your@getalby.com
PLATFORM_NODE_PUBKEY=your_node_pubkey

# NWC Configuration
NWC_RELAY_URL=wss://relay.getalby.com
NWC_SECRET=your_nwc_secret

# Nostr Configuration
NOSTR_PRIVATE_KEY=your_nostr_private_key
NOSTR_RELAYS=wss://relay.damus.io,wss://relay.primal.net

# Helipad Configuration
HELIPAD_WEBHOOK_SECRET=your_webhook_secret
```

---

## Resources

- **Reference Implementation**: https://github.com/ChadFarrow/ITDV-Lightning
- **Bitcoin Connect Docs**: https://bitcoin-connect.com/docs
- **Podcasting 2.0 Spec**: https://github.com/Podcastindex-org/podcast-namespace
- **Lightning Address**: https://lightningaddress.com/
- **NWC Protocol**: https://nwc.dev/
- **Nostr NIPs**: https://github.com/nostr-protocol/nips