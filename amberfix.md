# Amber NIP-46 Connection Fixes

## The Main Issues

### 1. Connection being cleared during login/authentication
- **Problem**: During login, Amber sends old cached events encrypted with old app pubkeys that we can't decrypt. The code was clearing the connection because there was a pending `get_public_key` request, even though these old cached events are expected during authentication.
- **Fix**: Added a check to detect if we're in the middle of authentication (checking for `get_public_key` or `connect` requests) and don't clear the connection during authentication - just ignore the old cached events silently.

### 2. Relay client not initialized
- **Problem**: When restoring a saved connection, `authenticate()` was returning early with the saved pubkey but didn't ensure the relay client was initialized. When `signEvent()` tried to use it, it failed with "Relay client not initialized".
- **Fix**: Modified `authenticate()` to wait for the relay client to be initialized (up to 5 seconds) and initialize it if needed before returning.

### 3. Connection cleared unnecessarily
- **Problem**: The connection was being cleared whenever decryption failed, even if there were no pending requests (just old cached events from Amber).
- **Fix**: Only clear the connection if there are pending requests waiting for responses. If there are no pending requests, these are just old cached events that we should ignore silently.

### 4. Connection not saved after login
- **Problem**: In some cases, the connection wasn't being saved properly after login, causing "No saved connection found" errors.
- **Fix**: Added validation and logging to ensure connections are saved with all required fields.

## The Result

- ✅ Login works reliably (connection isn't cleared during authentication)
- ✅ Connection persists after page refresh (restored from localStorage)
- ✅ Boosts post successfully (relay client is ready when needed)
- ✅ Works on both web and Android (Amber uses NIP-46 on both)

The core issue was being too aggressive about clearing connections when encountering old cached events from Amber, combined with not ensuring the relay client was ready before using it.

### 5. bunker:// connections not working (commit 830e5b4)
- **Problem**: Commit `830e5b4` broke bunker:// connections by making incorrect assumptions about the protocol flow. Three specific issues:
  1. **Blocked connect requests** - Code assumed the signer (Amber) initiates first. Wrong - the CLIENT must send a `connect` request first with `[appPubkey, secret]`.
  2. **Removed p-tags** - Code didn't tag bunker:// request events with the signer's pubkey. Without the p-tag, Amber couldn't find the events on the relay.
  3. **ACK didn't resolve** - When Amber responded with "ack" to the connect request, the code logged it but didn't resolve the promise - it waited for a "connection event handler" that never came.

- **Fix**: Made the code match nostrify's working implementation:
  1. Removed connect request blocking logic (2 locations)
  2. Always tag events with signer pubkey when available
  3. Resolve promise immediately on ACK response so `get_public_key` can proceed

- **Correct flow** (matching nostrify/zaptrax):
  ```
  send connect request → receive ACK → resolve → send get_public_key → receive npub → done
  ```

### 6. Duplicate get_public_key requests causing rate limit errors
- **Problem**: When authenticate() sent `connect` → received ACK → sent `get_public_key`, the event handler ALSO detected the ACK and sent another `get_public_key`. This caused rate limit errors ("Please wait 5 seconds before sending another get_public_key request").

- **Fix**: Added check in event handler to skip sending `get_public_key` if one is already pending:
  ```js
  const hasPendingGetPublicKey = Array.from(this.pendingRequests.values())
    .some(req => req.method === 'get_public_key');
  if (isConnectResponse && !hasPendingGetPublicKey) {
    // Only send get_public_key if authenticate() hasn't already sent one
  }
  ```

## Testing Status

- ✅ **Web (Alby extension)**: Tested and working - NIP-07 signing works
- ✅ **Android (Amber)**: Tested and working - bunker:// connections work
- ✅ **iOS (Aegis)**: Tested and working - bunker:// connections work
- ✅ **iOS Safari (Nostore)**: Tested and working - NIP-07 extension works
- ✅ **bunker:// URI**: Tested and working - both Amber and Aegis receive notifications and login completes

All NIP-46 bunker:// signers confirmed working on both Android and iOS.
NIP-07 browser extensions working on desktop and iOS Safari.

