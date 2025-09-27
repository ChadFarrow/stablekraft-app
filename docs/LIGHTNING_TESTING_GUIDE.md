# Lightning Network Testing Guide

Quick guide for testing the Lightning Network integration features.

## Quick Start

### 1. Environment Setup
```bash
# Add to .env.local
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_NODE_PUBKEY=your_testnet_node_pubkey
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=your@testnet.address

# Start dev server
npm run dev
```

### 2. Install Test Wallet
- Install [Alby browser extension](https://getalby.com/)
- Create testnet wallet
- Fund with testnet Bitcoin (use faucets)

### 3. Basic Test Flow
1. Open app in browser
2. Navigate to any music track
3. Click the yellow "Boost" button
4. Select amount and add message
5. Click "Send X sats"
6. Approve in wallet
7. Verify success message

## Test Scenarios

### Scenario A: Basic Keysend Payment
**Purpose**: Test basic Lightning payment functionality

**Steps**:
1. Click boost button on any track
2. Modal should show "Platform keysend" indicator
3. Select 21 sats preset amount
4. Add message: "Test boost! ⚡"
5. Click "Send 21 sats"
6. Approve payment in Alby
7. Should see "Boost sent successfully!" message

**Expected Result**: Payment succeeds, modal closes automatically

### Scenario B: Lightning Address Payment
**Purpose**: Test LNURL-pay functionality

**Requirements**: Configure a track with `lightningAddress` prop

**Steps**:
1. Add Lightning Address to BoostButton component:
   ```tsx
   <BoostButton
     trackId={track.id}
     lightningAddress="test@getalby.com"
     // ... other props
   />
   ```
2. Click boost button
3. Modal should show "Lightning Address: test@getalby.com"
4. Select 100 sats
5. Send payment
6. Check network tab for LNURL requests

**Expected Result**: LNURL-pay protocol executes, invoice generated and paid

### Scenario C: Value Splits
**Purpose**: Test multi-recipient payments

**Requirements**: Use Chad's test feed with real value tags

**Test Feed**: `https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml`

**Steps**:
1. Configure MusicTrackList to use Chad's test feed
2. Parse value tags using ValueTagParser:
   ```typescript
   const response = await fetch('https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml');
   const xmlText = await response.text();
   const valueData = valueTagParser.parseValueTags(xmlText);
   ```
3. Test different episodes:
   - **Episode 1**: 7 recipients (5-30% splits)
   - **Episode 2**: 8 recipients (5-20% splits)
   - **Episode 3**: Dual valueRecipients (node + LN address pairs)
   - **Episode 4**: Single Cashu address (100% split)
4. Modal should show "Value splits to X recipients"
5. Send 1000 sats
6. Check console for individual payment logs
7. Verify payments to both Lightning addresses and node pubkeys

**Expected Result**: Multiple payments sent proportionally to real Lightning addresses like `chadf@getalby.com`

## Common Issues & Solutions

### Issue: "No wallet connected"
**Solution**:
- Ensure Alby extension is installed and unlocked
- Check that wallet is on correct network (testnet/mainnet)
- Try refreshing page and reconnecting

### Issue: "Keysend not supported by wallet"
**Solution**:
- Some wallets don't support keysend
- Try different wallet (Alby usually works)
- Check wallet settings for keysend enable

### Issue: "Lightning Address payment failed"
**Solution**:
- Verify Lightning Address format (user@domain.com)
- Check network connectivity
- Try with known working address like `test@getalby.com`

### Issue: "Amount outside allowed range"
**Solution**:
- LNURL endpoints have min/max limits
- Try amounts between 1-100,000 sats
- Check console for exact min/max values

## Debug Information

### Console Logs to Check
```javascript
// Payment method selection
"⚡ Paying via Lightning Address: user@domain.com"
"⚡ Paying via value splits to 3 recipients"
"⚡ Paying via keysend to platform: 02d5c1bf..."

// LNURL process
"✅ Lightning Address resolved: {callback, minSendable, maxSendable}"
"✅ Invoice received: lnbc1000n1..."

// Value split payments
"💸 Sent 400 sats to Primary Artist SUCCESS"
"💸 Sent 300 sats to Secondary Artist SUCCESS"
```

### Network Tab Monitoring
1. Open browser dev tools → Network tab
2. Send Lightning Address payment
3. Look for requests to:
   - `/.well-known/lnurlp/username`
   - Callback URL with amount parameter

### Database Logging
Check `/api/lightning/boost` endpoint receives:
```json
{
  "trackId": "track-123",
  "amount": 1000,
  "message": "Great track!",
  "preimage": "abc123...",
  "paymentMethod": "lightning-address"
}
```

## Testing with Real Feeds

### Add Value Tags to Existing Feed
```xml
<!-- Add to any RSS feed for testing -->
<podcast:value type="lightning" method="keysend">
  <podcast:valueRecipient
    name="Test Artist"
    type="lnaddress"
    address="your@testnet.address"
    split="100"/>
</podcast:value>
```

### Parse Value Tags in Code
```typescript
import { valueTagParser } from '@/lib/lightning/value-parser';

// In your RSS processing code
const valueData = valueTagParser.parseValueTags(xmlContent);
const recipients = valueTagParser.getValueRecipientsForItem(valueData, itemGuid);
const boostFormat = valueTagParser.convertToBoostButtonFormat(recipients);

// Pass to BoostButton
<BoostButton valueSplits={boostFormat} />
```

## Performance Testing

### Load Testing
- Test with many recipients (10+ value splits)
- Test with large amounts (100,000+ sats)
- Test rapid successive payments
- Monitor for memory leaks

### Error Recovery
- Disconnect wallet during payment
- Kill network connection
- Close browser tab during payment
- Test with invalid/malformed data

## Security Testing

### Input Validation
```javascript
// Test these inputs
amounts = [-1, 0, 1, 999999999999999]
messages = ["", "x".repeat(300), "<script>alert('xss')</script>"]
addresses = ["", "invalid", "user@", "@domain.com", "real@user.com"]
```

### Payment Amounts
- Minimum: 1 sat
- Maximum: Wallet/protocol limits
- Edge cases: 0, negative, extremely large

## Testnet Resources

### Lightning Testnet Faucets
- https://faucet.lightning.community/
- https://htlc.me/
- https://coinfaucet.eu/en/ltc-testnet/

### Test Lightning Addresses
- `test@getalby.com` (Alby testnet)
- `chadf@getalby.com` (Chad's test address from feed)
- Use your own testnet Lightning Address

### Test Feeds with Value Tags
- **Chad's Test Feed**: https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml
- **Podcasting 2.0 Examples**:
  - https://podcasting2.org/docs/podcast-namespace/tags/value
  - https://podcasting2.org/docs/podcast-namespace/tags/value-recipient

### Test Node Pubkeys
Use testnet node pubkeys only for testing.

## Success Criteria

✅ **Basic Functionality**
- Wallet connects successfully
- Boost button appears and works
- Payments complete successfully
- Success/error messages display

✅ **Lightning Address**
- LNURL resolution works
- Invoices generate correctly
- Payments complete via Lightning Address

✅ **Value Splits**
- RSS value tags parse correctly
- Multiple payments execute
- Proportional amounts calculated correctly

✅ **Error Handling**
- Network errors handled gracefully
- Invalid inputs rejected
- Partial failures managed properly

✅ **User Experience**
- Responsive UI during operations
- Clear feedback on all actions
- Intuitive workflow for non-technical users

## Next Steps After Testing

1. **Fix any discovered bugs**
2. **Optimize performance issues**
3. **Enhance error messages**
4. **Add more comprehensive logging**
5. **Prepare for mainnet deployment**

---

**Note**: Always start testing on testnet with small amounts. Never test with mainnet funds until thoroughly validated on testnet.