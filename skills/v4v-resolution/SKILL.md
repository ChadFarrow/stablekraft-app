---
name: v4v-resolution
description: Resolve Value4Value Lightning Network payment information for music tracks and artists
---

# Value4Value Resolution Skill

This skill resolves Value4Value (V4V) Lightning Network payment information for music tracks, artists, and podcast episodes using the Podcast Index API and Lightning Network protocols.

## Inputs

- **resolution_target** (object, required): Target for V4V resolution
  - `type`: Type of target ('track', 'artist', 'episode', 'feed')
  - `identifier`: Unique identifier (track ID, artist name, episode GUID, feed URL)
  - `context`: Additional context information

- **resolution_options** (object, optional): Configuration options
  - `include_boostagrams`: Include boostagram information (default: true)
  - `include_value_splits`: Include value time splits (default: true)
  - `include_lightning_address`: Include Lightning payment addresses (default: true)
  - `cache_duration`: Cache duration in seconds (default: 7200)
  - `fallback_resolution`: Enable fallback resolution methods (default: true)

## Outputs

- **v4v_info** (object): Resolved Value4Value information
  - `lightning_address`: Primary Lightning payment address
  - `custom_key`: Custom key for payments
  - `custom_value`: Custom value for payments
  - `node_pubkey`: Lightning node public key
  - `value_splits`: Array of value time splits
    - `name`: Split recipient name
    - `start_time`: Start time in seconds
    - `end_time`: End time in seconds
    - `percentage`: Percentage of payment (0-100)
    - `lightning_address`: Payment address for this split
  - `boostagrams`: Array of boostagram information
    - `sender`: Boostagram sender
    - `message`: Boostagram message
    - `amount`: Payment amount in sats
    - `timestamp`: Payment timestamp
  - `payment_methods`: Available payment methods
    - `lightning`: Lightning Network payments
    - `bitcoin`: Bitcoin on-chain payments
    - `other`: Other payment methods

## Usage Example

```typescript
import { resolveV4V } from './v4v-resolver';

const v4vInfo = await resolveV4V({
  resolution_target: {
    type: 'track',
    identifier: 'track-123',
    context: {
      artist: 'Artist Name',
      title: 'Song Title',
      episode_guid: 'episode-456'
    }
  },
  resolution_options: {
    include_boostagrams: true,
    include_value_splits: true,
    cache_duration: 3600
  }
});

console.log(`Resolved Lightning address: ${v4vInfo.lightning_address}`);
```

## Resolution Methods

### 1. Podcast Index API
- Queries Podcast Index for V4V metadata
- Resolves feed-level payment information
- Fetches episode-specific value splits

### 2. Lightning Network Lookup
- Resolves Lightning addresses to node information
- Validates payment addresses
- Fetches node capabilities and fees

### 3. Custom Resolution
- Handles custom payment schemes
- Resolves artist-specific payment methods
- Integrates with external payment providers

### 4. Fallback Methods
- Uses cached resolution data
- Applies default payment schemes
- Handles resolution failures gracefully

## Payment Processing

### Lightning Payments
- Generates payment requests (invoices)
- Handles payment routing
- Processes payment confirmations
- Manages payment splitting

### Value Time Splits
- Calculates time-based payment splits
- Distributes payments to multiple recipients
- Handles dynamic split percentages
- Manages split timing

## Error Handling

- **API Failures**: Handles Podcast Index API errors
- **Network Issues**: Manages Lightning Network connectivity
- **Invalid Addresses**: Validates Lightning addresses
- **Resolution Timeouts**: Implements timeout handling
- **Cache Failures**: Handles cache miss scenarios

## Dependencies

- `lib/v4v-resolver.ts`: Core V4V resolution logic
- `lib/lightning-client.ts`: Lightning Network client
- Podcast Index API integration
- Lightning Network node connection

## Performance Notes

- Implements aggressive caching for resolution data
- Uses connection pooling for API requests
- Supports batch resolution for multiple targets
- Handles rate limiting and backoff strategies

## Security Considerations

- Validates Lightning addresses before use
- Implements payment amount limits
- Handles sensitive payment information securely
- Logs payment activities for audit trails
