# Railway Environment Variables Setup

## Required Environment Variables for Lightning Branch

Copy these environment variables to your Railway deployment:

### Database
```
DATABASE_URL=postgresql://postgres:RZebAIqzMjvrqWVBzkcpsOpvKHrIYGVc@shuttle.proxy.rlwy.net:14633/railway
```

### Lightning Network Configuration
```
NEXT_PUBLIC_LIGHTNING_NETWORK=testnet
NEXT_PUBLIC_PLATFORM_LIGHTNING_ADDRESS=chadf@getalby.com
```

### Optional - Podcast Index API (for V4V resolution)
```
PODCAST_INDEX_API_KEY=your_api_key_here
PODCAST_INDEX_API_SECRET=your_api_secret_here
```

## How to Set Variables in Railway

1. Go to your Railway project dashboard
2. Click on your service
3. Go to the "Variables" tab
4. Add each variable using the format: `VARIABLE_NAME=value`

## Important Notes

- The `DATABASE_URL` should already be configured if you're using Railway's PostgreSQL
- The `NEXT_PUBLIC_` variables are required for the Lightning functionality to work in the browser
- The Podcast Index API variables are optional but recommended for full V4V support

## Testing the Deployment

Once these variables are set:
1. Trigger a new deployment (or Railway will auto-deploy from your latest commit)
2. The build should succeed
3. You can test Lightning payments with your Alby wallet extension