# Testing Nostr Integration Guide

This guide will help you test all the Nostr features we've implemented.

## Prerequisites

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Ensure database is connected:**
   - Verify `DATABASE_URL` is set in `.env.local`
   - Database migration should already be applied

3. **Generate a test Nostr key pair** (optional, for manual testing):
   - You can use an online tool like https://nostr-keygen.com/
   - Or use the browser console to generate one (see below)

## 1. Testing Authentication

### Option A: Manual Key Login

1. **Generate a test key pair:**
   - Open browser console (F12)
   - Run this code:
   ```javascript
   // Generate a test key pair
   import('nostr-tools').then(({ generateSecretKey, getPublicKey }) => {
     const secretKey = generateSecretKey();
     const publicKey = getPublicKey(secretKey);
     
     // Convert to hex strings
     const privateKeyHex = Array.from(secretKey)
       .map(b => b.toString(16).padStart(2, '0'))
       .join('');
     const publicKeyHex = publicKey;
     
     console.log('Private Key (hex):', privateKeyHex);
     console.log('Public Key (hex):', publicKeyHex);
     console.log('Save these for testing!');
   });
   ```

2. **Add LoginButton to your UI:**
   - The `LoginButton` component should be added to your navigation/header
   - If not already added, import it:
   ```tsx
   import LoginButton from '@/components/Nostr/LoginButton';
   
   // Then use it:
   <LoginButton />
   ```

3. **Test Login:**
   - Click "Sign in with Nostr"
   - Choose "Manual Login"
   - Paste your private key (hex format, 64 characters)
   - Click "Login"
   - You should see your npub displayed and a "Logout" button

4. **Test Logout:**
   - Click "Logout"
   - User should be logged out
   - Login button should reappear

### Option B: NIP-07 Browser Extension

1. **Install a Nostr extension:**
   - Install [Alby](https://getalby.com/) or [nos2x](https://github.com/fiatjaf/nos2x) browser extension

2. **Test Extension Login:**
   - Click "Sign in with Nostr"
   - Choose "Use Browser Extension"
   - Approve the extension prompt
   - You should be logged in

### Verify Authentication

- Check browser console for any errors
- Check Network tab for API calls:
  - `/api/nostr/auth/challenge` (POST) - Should return challenge
  - `/api/nostr/auth/login` (POST) - Should return success
  - `/api/nostr/auth/me` (GET) - Should return user data
- Check localStorage:
  - `nostr_private_key` - Should contain your private key
  - `nostr_user` - Should contain user object

## 2. Testing Favorites Migration

### Test Session-Based Favorites (Before Login)

1. **Add favorites while logged out:**
   - Browse tracks/albums
   - Click favorite buttons
   - Favorites should be saved with `sessionId`

2. **Verify in database:**
   ```sql
   SELECT * FROM "FavoriteTrack" WHERE "sessionId" IS NOT NULL;
   SELECT * FROM "FavoriteAlbum" WHERE "sessionId" IS NOT NULL;
   ```

### Test User-Based Favorites (After Login)

1. **Login with Nostr:**
   - Use the LoginButton to authenticate

2. **Add favorites while logged in:**
   - Browse tracks/albums
   - Click favorite buttons
   - Favorites should be saved with `userId`

3. **Verify in database:**
   ```sql
   SELECT * FROM "FavoriteTrack" WHERE "userId" IS NOT NULL;
   SELECT * FROM "FavoriteAlbum" WHERE "userId" IS NOT NULL;
   ```

4. **Test persistence:**
   - Logout and login again
   - Your favorites should still be there
   - Check that favorites are associated with your user ID

### Test Favorites API

```bash
# Get favorites (should work for both session and user)
curl -X GET http://localhost:3000/api/favorites/tracks \
  -H "x-session-id: your-session-id" \
  -H "x-nostr-user-id: your-user-id"

# Add favorite
curl -X POST http://localhost:3000/api/favorites/tracks \
  -H "Content-Type: application/json" \
  -H "x-nostr-user-id: your-user-id" \
  -d '{"trackId": "test-track-id"}'
```

## 3. Testing Social Features

### Test Follow/Unfollow

1. **Login with two different accounts:**
   - Account A: Login with key pair 1
   - Account B: Login with key pair 2

2. **Test Follow:**
   ```bash
   # Follow user B from user A
   curl -X POST http://localhost:3000/api/nostr/follow \
     -H "Content-Type: application/json" \
     -H "x-nostr-user-id: user-a-id" \
     -d '{"followingId": "user-b-id"}'
   ```

3. **Test Get Followers:**
   ```bash
   # Get user B's followers
   curl -X GET http://localhost:3000/api/nostr/followers?userId=user-b-id
   ```

4. **Test Get Following:**
   ```bash
   # Get users that user A is following
   curl -X GET http://localhost:3000/api/nostr/following?userId=user-a-id
   ```

### Test Share to Nostr

1. **Login with Nostr account**

2. **Share a track:**
   ```bash
   curl -X POST http://localhost:3000/api/nostr/share \
     -H "Content-Type: application/json" \
     -H "x-nostr-user-id: your-user-id" \
     -d '{
       "trackId": "test-track-id",
       "content": "Check out this track!"
     }'
   ```

3. **Verify event was created:**
   - Check database: `SELECT * FROM "NostrPost" WHERE "userId" = 'your-user-id';`
   - Event should be published to Nostr relays (check relay logs)

### Test Activity Feed

1. **Get activity feed:**
   ```bash
   curl -X GET http://localhost:3000/api/nostr/activity?userId=your-user-id
   ```

2. **Should return:**
   - Recent posts
   - Recent boost events
   - Ordered by creation date

## 4. Testing Lightning Boost Integration

### Prerequisites

- Lightning integration must be configured
- You need a valid Lightning invoice endpoint

### Test Boost with Nostr Posting

1. **Login with Nostr account**

2. **Boost a track:**
   - Find a track with Lightning boost enabled
   - Click the boost button
   - Complete the Lightning payment

3. **Verify Nostr posting:**
   - After successful payment, check:
     - Database: `SELECT * FROM "BoostEvent" WHERE "userId" = 'your-user-id';`
     - Event should be published to Nostr relays
     - Event kind should be 9735 (Zap Request)

4. **Check browser console:**
   - Should see: `✅ Boost posted to Nostr: <event-id>`
   - If error: `Failed to post boost to Nostr: <error>`

### Test Boost API Directly

```bash
curl -X POST http://localhost:3000/api/nostr/boost \
  -H "Content-Type: application/json" \
  -H "x-nostr-user-id: your-user-id" \
  -H "x-nostr-private-key: your-private-key-hex" \
  -d '{
    "trackId": "test-track-id",
    "amount": 1000,
    "message": "Great track!",
    "paymentHash": "test-payment-hash"
  }'
```

## 5. Testing User Profile

### Test Profile Display

1. **Login with Nostr account**

2. **View profile:**
   - Use `UserProfile` component:
   ```tsx
   import UserProfile from '@/components/Nostr/UserProfile';
   
   <UserProfile showDetails={true} />
   ```

3. **Update profile:**
   ```bash
   curl -X POST http://localhost:3000/api/nostr/profile/update \
     -H "Content-Type: application/json" \
     -H "x-nostr-user-id: your-user-id" \
     -d '{
       "displayName": "Test User",
       "bio": "This is a test bio",
       "avatar": "https://example.com/avatar.jpg"
     }'
   ```

### Test Profile by Pubkey

```bash
curl -X GET http://localhost:3000/api/nostr/profile/<pubkey>
```

## 6. Testing Relay Management

### Test Get Relays

```bash
curl -X GET http://localhost:3000/api/nostr/relays?userId=your-user-id
```

### Test Update Relays

```bash
curl -X POST http://localhost:3000/api/nostr/relays \
  -H "Content-Type: application/json" \
  -H "x-nostr-user-id: your-user-id" \
  -d '{
    "relays": [
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.snort.social"
    ]
  }'
```

## 7. Common Issues & Debugging

### Issue: Login fails with "Invalid signature"

**Solution:**
- Verify private key is in hex format (64 characters)
- Check that challenge signing is working correctly
- Check server logs for detailed error messages

### Issue: Favorites not persisting after login

**Solution:**
- Check that `userId` is being sent in API requests
- Verify database has correct `userId` in favorites table
- Check that session favorites are being migrated (if implemented)

### Issue: Boost not posting to Nostr

**Solution:**
- Verify `NEXT_PUBLIC_NOSTR_ENABLED=true` in environment
- Check that user is authenticated
- Verify relays are configured
- Check browser console for errors
- Verify private key is accessible in localStorage

### Issue: Events not appearing on relays

**Solution:**
- Check relay URLs are valid (wss://)
- Verify relay connection status
- Check relay logs for errors
- Test with default relays first

## 8. Database Verification

### Check User Table

```sql
SELECT * FROM "User" ORDER BY "createdAt" DESC LIMIT 10;
```

### Check Follows

```sql
SELECT 
  f.*,
  u1.nostrNpub as follower_npub,
  u2.nostrNpub as following_npub
FROM "Follow" f
JOIN "User" u1 ON f."followerId" = u1.id
JOIN "User" u2 ON f."followingId" = u2.id;
```

### Check Nostr Posts

```sql
SELECT * FROM "NostrPost" ORDER BY "createdAt" DESC LIMIT 10;
```

### Check Boost Events

```sql
SELECT * FROM "BoostEvent" ORDER BY "createdAt" DESC LIMIT 10;
```

## 9. Browser Console Testing

### Generate Test Key Pair

```javascript
// In browser console
import('nostr-tools').then(async ({ generateSecretKey, getPublicKey, nip19 }) => {
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);
  
  const privateKeyHex = Array.from(secretKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  const npub = nip19.npubEncode(publicKey);
  const nsec = nip19.nsecEncode(secretKey);
  
  console.log('Private Key (hex):', privateKeyHex);
  console.log('Private Key (nsec):', nsec);
  console.log('Public Key (hex):', publicKey);
  console.log('Public Key (npub):', npub);
});
```

### Test Authentication Flow

```javascript
// Test challenge endpoint
fetch('/api/nostr/auth/challenge', { method: 'POST' })
  .then(r => r.json())
  .then(console.log);

// Test login (replace with your keys)
const privateKey = 'your-private-key-hex';
// ... (use the login flow from NostrContext)
```

## 10. Next Steps

After testing:

1. **Add UI components** to your app:
   - Add `LoginButton` to navigation
   - Add `UserProfile` to user menu
   - Add `FollowButton` to user pages
   - Add `ShareButton` to track/album pages
   - Add `ActivityFeed` to dashboard

2. **Test end-to-end flows:**
   - Login → Add favorites → Share track → Boost track → View activity

3. **Monitor production:**
   - Set up error tracking
   - Monitor relay connection status
   - Track user adoption metrics

## Additional Resources

- [Nostr Protocol Documentation](https://github.com/nostr-protocol/nips)
- [nostr-tools Documentation](https://github.com/nbd-wtf/nostr-tools)
- [NIP-07 (Browser Extension)](https://github.com/nostr-protocol/nips/blob/master/07.md)
- [NIP-57 (Lightning Zaps)](https://github.com/nostr-protocol/nips/blob/master/57.md)

