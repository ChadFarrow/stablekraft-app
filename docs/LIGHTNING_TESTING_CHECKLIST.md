# Lightning Network Testing Checklist

## Environment Setup

### Prerequisites
- [ ] Lightning wallet with WebLN support (Alby, Zeus, etc.)
- [ ] Test Lightning Network funds (testnet recommended for initial testing)
- [ ] Browser extension wallet installed and configured
- [ ] Development server running (`npm run dev`)

### Configuration
- [ ] Environment variables set in `.env.local`:
  - [ ] `NEXT_PUBLIC_LIGHTNING_NETWORK=testnet` (for testing)
  - [ ] `NEXT_PUBLIC_PLATFORM_NODE_PUBKEY` (optional platform fallback)
  - [ ] `NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS` (optional platform fallback)

---

## Core Infrastructure Testing

### Bitcoin Connect Integration
- [ ] **Wallet Connection**
  - [ ] Click boost button shows wallet connection modal
  - [ ] Can connect to Alby extension
  - [ ] Can connect to Zeus browser extension
  - [ ] Connection state persists across page reloads
  - [ ] Can disconnect wallet properly

- [ ] **Error Handling**
  - [ ] Shows appropriate error when no wallet installed
  - [ ] Handles wallet connection rejection gracefully
  - [ ] Shows loading states during connection

---

## Basic Boost Functionality

### Boost Button UI
- [ ] **Button Display**
  - [ ] Boost button appears on all track cards
  - [ ] Button shows lightning bolt icon and "Boost" text
  - [ ] Button styling matches app theme

- [ ] **Boost Modal**
  - [ ] Modal opens when boost button clicked
  - [ ] Shows track title and artist name
  - [ ] Displays payment method indicator
  - [ ] Has close button that works

### Amount Selection
- [ ] **Preset Amounts**
  - [ ] Can select from preset amounts (21, 50, 100, 250, 500, 1000, 5000, 10000 sats)
  - [ ] Selected amount highlights properly
  - [ ] Custom amount input works

- [ ] **Custom Amounts**
  - [ ] Can enter custom amount in input field
  - [ ] Custom amount overrides preset selection
  - [ ] Validation prevents amounts less than 1 sat
  - [ ] Shows amount in "Send X sats" button

### Message Feature (Boostagrams)
- [ ] **Message Input**
  - [ ] Message textarea accepts input
  - [ ] Character counter shows correctly (0/250)
  - [ ] Cannot exceed 250 character limit
  - [ ] Message is optional (can boost without message)

---

## Payment Method Testing

### Lightning Address Support
- [ ] **Valid Lightning Addresses** (if track has Lightning Address configured)
  - [ ] Modal shows "Lightning Address: user@domain.com" indicator
  - [ ] Can successfully send payment to Lightning Address
  - [ ] LNURL-pay protocol resolves correctly
  - [ ] Invoice generation works
  - [ ] Payment completion shows success message

- [ ] **Lightning Address Validation**
  - [ ] Test with various Lightning Address formats:
    - [ ] `user@getalby.com`
    - [ ] `test@strike.me`
    - [ ] `wallet@ln.tips`
  - [ ] Invalid formats show appropriate errors

### Value Splits (Multiple Recipients)
- [ ] **RSS Feeds with Value Tags** (requires test RSS feed with `<podcast:value>` tags)
  - [ ] Modal shows "Value splits to X recipients" indicator
  - [ ] Payments split proportionally among recipients
  - [ ] Both node pubkeys and Lightning addresses work as recipients
  - [ ] Console logs show individual payment results

- [ ] **Mixed Recipient Types**
  - [ ] Can pay to mix of node pubkeys and Lightning addresses
  - [ ] Partial failures handled gracefully (some payments succeed, others fail)
  - [ ] Error messages indicate which payments failed

### Platform Fallback
- [ ] **No Value Configuration**
  - [ ] Modal shows "Platform keysend" indicator
  - [ ] Falls back to platform node pubkey (if configured)
  - [ ] Shows appropriate error if no fallback configured

---

## Advanced Features Testing

### LNURL-pay Protocol
- [ ] **LNURL Resolution**
  - [ ] Lightning Address resolves to LNURL-pay params
  - [ ] Callback URL generates invoice correctly
  - [ ] Amount validation works (min/max sendable)
  - [ ] Comment field supports boostagram messages

- [ ] **Error Scenarios**
  - [ ] Invalid Lightning Address shows error
  - [ ] Network failures handled gracefully
  - [ ] Malformed LNURL responses handled
  - [ ] Amount outside min/max range rejected

### Podcasting 2.0 Value Tags
- [ ] **Feed Parsing** (use Chad's test feed: `https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml`)
  - [ ] Channel-level value tags parsed correctly (8 recipients, 5-15% splits)
  - [ ] Item-level value tags override channel-level
  - [ ] Multiple recipients extracted properly
  - [ ] Lightning addresses recognized (`chadf@getalby.com`)
  - [ ] Node pubkeys handled correctly
  - [ ] Mixed recipient types in same episode

- [ ] **Episode-Specific Testing**
  - [ ] **Episode 1**: 7 recipients (5-30% splits)
  - [ ] **Episode 2**: 8 recipients (5-20% splits)
  - [ ] **Episode 3**: Dual valueRecipients (node + LN address pairs)
  - [ ] **Episode 4**: Single Cashu address (100% split)
  - [ ] Verify proportional split calculations
  - [ ] Test real Lightning address payments to `chadf@getalby.com`

### Payment Processing
- [ ] **Keysend Payments**
  - [ ] Node pubkey payments work
  - [ ] Custom TLV records included (boostagram messages)
  - [ ] Preimage returned on success
  - [ ] Payment hash logged correctly

- [ ] **WebLN Integration**
  - [ ] `webln.keysend()` called correctly
  - [ ] `webln.sendPayment()` for invoices works
  - [ ] Wallet prompts appear as expected
  - [ ] Payment confirmations work

---

## Error Handling & Edge Cases

### Network Errors
- [ ] **Connection Issues**
  - [ ] Offline network handled gracefully
  - [ ] LNURL resolution timeouts
  - [ ] Slow payment processing
  - [ ] Wallet disconnection during payment

### Payment Failures
- [ ] **WebLN Errors**
  - [ ] Insufficient funds in wallet
  - [ ] Payment routing failures
  - [ ] User cancels payment in wallet
  - [ ] Wallet doesn't support keysend

- [ ] **LNURL Errors**
  - [ ] Invalid Lightning Address domains
  - [ ] Service unavailable errors
  - [ ] Invoice generation failures
  - [ ] Payment amount validation errors

### Data Validation
- [ ] **Input Validation**
  - [ ] Zero or negative amounts rejected
  - [ ] Extremely large amounts handled
  - [ ] Empty or invalid addresses
  - [ ] Malformed value tag data

---

## User Experience Testing

### Performance
- [ ] **Loading States**
  - [ ] Boost button shows loading during payment
  - [ ] Modal shows loading during LNURL resolution
  - [ ] No UI freezing during long operations
  - [ ] Appropriate timeouts for network operations

### Feedback
- [ ] **Success States**
  - [ ] Success message shows after payment
  - [ ] Modal closes automatically after success
  - [ ] Payment logged to console/database
  - [ ] User can continue using app

- [ ] **Error States**
  - [ ] Clear error messages displayed
  - [ ] Errors don't crash the app
  - [ ] Can retry failed payments
  - [ ] Can close modal after errors

### Accessibility
- [ ] **Keyboard Navigation**
  - [ ] Can navigate boost modal with keyboard
  - [ ] Tab order is logical
  - [ ] Enter key submits payment
  - [ ] Escape key closes modal

---

## Integration Testing

### Database Logging
- [ ] **Boost Records**
  - [ ] Boosts logged to `/api/lightning/boost` endpoint
  - [ ] Track ID and feed ID recorded correctly
  - [ ] Amount and message stored
  - [ ] Payment method tracked
  - [ ] Preimage stored (when available)

### RSS Feed Integration
- [ ] **Test Feeds**
  - [ ] Test with feeds containing value tags
  - [ ] Test with feeds without value tags
  - [ ] Test with malformed value tags
  - [ ] Test with mixed content

### Browser Compatibility
- [ ] **WebLN Support**
  - [ ] Chrome with Alby extension
  - [ ] Firefox with Alby extension
  - [ ] Safari (if supported)
  - [ ] Mobile browsers (if applicable)

---

## Security Testing

### Input Sanitization
- [ ] **XSS Prevention**
  - [ ] Message input sanitized properly
  - [ ] No script injection in boost amounts
  - [ ] Lightning addresses validated
  - [ ] Node pubkeys validated

### Payment Security
- [ ] **Amount Validation**
  - [ ] Cannot send negative amounts
  - [ ] Cannot send zero amounts
  - [ ] Large amounts require confirmation
  - [ ] No integer overflow issues

---

## Test Scenarios

### Scenario 1: Simple Keysend Boost
```
1. Open app in browser with Lightning wallet
2. Navigate to any track with boost button
3. Click boost button
4. Select 100 sats preset amount
5. Add message "Great track! ⚡"
6. Click "Send 100 sats"
7. Approve payment in wallet
8. Verify success message
```

### Scenario 2: Lightning Address Payment
```
1. Configure track with Lightning Address
2. Open boost modal
3. Verify Lightning Address indicator shows
4. Send 500 sats with custom message
5. Check LNURL-pay process in network tab
6. Verify invoice generation and payment
```

### Scenario 3: Value Split Payment
```
1. Use RSS feed with multiple value recipients
2. Open boost modal for track from that feed
3. Verify "Value splits to X recipients" indicator
4. Send 1000 sats
5. Check console for individual payment logs
6. Verify proportional amounts sent to each recipient
```

### Scenario 4: Error Recovery
```
1. Disconnect wallet during payment process
2. Try to send boost without wallet connected
3. Use invalid Lightning Address
4. Send amount outside LNURL limits
5. Verify all errors handled gracefully
```

---

## Test Data Requirements

### RSS Feeds for Testing

#### Primary Test Feed
**Chad's Lightning Test Feed**: https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml
- Real Lightning addresses and node pubkeys
- Multiple episodes with different value configurations
- Channel-level and item-level value tags
- Mix of Lightning addresses and node pubkeys

#### Reference Documentation
**Podcasting 2.0 Value Tag Examples**:
- https://podcasting2.org/docs/podcast-namespace/tags/value
- https://podcasting2.org/docs/podcast-namespace/tags/value-recipient

#### Example Value Tag Structure
```xml
<!-- From Podcasting 2.0 specification -->
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <podcast:value type="lightning" method="keysend">
      <podcast:valueRecipient
        name="Test Artist"
        type="node"
        address="02d5c1bf8b940dc9cadca86d1b0a3c37fbe39cee4c7e839e33bef9174531d27f52"
        split="80"/>
      <podcast:valueRecipient
        name="Test Platform"
        type="lnaddress"
        address="test@getalby.com"
        split="20"
        fee="true"/>
    </podcast:value>
    <!-- ... rest of feed ... -->
  </channel>
</rss>
```

### Lightning Addresses for Testing
- `test@getalby.com` (Alby test address)
- `test@strike.me` (Strike test address)
- `test@ln.tips` (Lightning Tips test address)

### Test Node Pubkeys
- Use testnet node pubkeys for safe testing
- Verify nodes are reachable and accept keysend

---

## Automated Testing

### Unit Tests (Future)
- [ ] LNURL service functions
- [ ] Value tag parser
- [ ] Payment split calculations
- [ ] Lightning address validation

### Integration Tests (Future)
- [ ] End-to-end payment flows
- [ ] RSS feed parsing
- [ ] Database logging
- [ ] Error handling

---

## Production Readiness

### Before Mainnet Deployment
- [ ] All tests pass on testnet
- [ ] Security review completed
- [ ] Error handling robust
- [ ] Performance acceptable
- [ ] User experience polished
- [ ] Documentation complete

### Monitoring Setup
- [ ] Payment success/failure rates
- [ ] Error logging and alerting
- [ ] Performance metrics
- [ ] User feedback collection

---

## Test Environment Setup Commands

```bash
# Start development server
npm run dev

# Check TypeScript compilation
npx tsc --noEmit

# Run any existing tests
npm test

# Check for console errors
# Open browser dev tools -> Console tab
```

---

## Notes
- Start testing on **testnet** first
- Keep detailed logs of test results
- Document any bugs or issues found
- Test with small amounts initially
- Verify all payments on Lightning Network explorers
- Test with multiple different wallets if possible

## Success Criteria
✅ All payment methods work reliably
✅ Error handling is comprehensive
✅ User experience is smooth
✅ Security validations prevent abuse
✅ Performance is acceptable
✅ Documentation is complete