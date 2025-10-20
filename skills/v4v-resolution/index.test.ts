import V4VResolutionSkill from './index';

describe('V4V Resolution Skill', () => {
  const mockResolutionTarget = {
    type: 'track' as const,
    identifier: 'track-123',
    context: {
      artist: 'Test Artist',
      title: 'Test Track',
      episode_guid: 'episode-456',
      feed_guid: '2b62ef49-fcff-523c-b81a-0a7dde2b0609',
      item_guid: 'item-789'
    }
  };

  describe('resolveV4V', () => {
    it('should resolve V4V information for a track', async () => {
      const input = {
        resolution_target: mockResolutionTarget,
        resolution_options: {
          include_boostagrams: true,
          include_value_splits: true,
          include_lightning_address: true
        }
      };

      // Mock the V4VResolver.resolve method
      const mockResult = {
        success: true,
        title: 'Test Track',
        artist: 'Test Artist',
        audioUrl: 'https://example.com/track.mp3',
        duration: 180,
        image: 'https://example.com/cover.jpg'
      };

      jest.spyOn(require('../../lib/v4v-resolver').V4VResolver, 'resolve')
        .mockResolvedValue(mockResult);

      const result = await V4VResolutionSkill.resolveV4V(input);

      expect(result).toHaveProperty('v4v_info');
      expect(result.v4v_info).toHaveProperty('value_splits');
      expect(result.v4v_info).toHaveProperty('boostagrams');
      expect(result.v4v_info).toHaveProperty('payment_methods');
    });

    it('should handle resolution errors gracefully', async () => {
      const input = {
        resolution_target: mockResolutionTarget,
        resolution_options: {}
      };

      // Mock the V4VResolver to return an error
      const mockErrorResult = {
        success: false,
        error: 'Track not found'
      };

      jest.spyOn(require('../../lib/v4v-resolver').V4VResolver, 'resolve')
        .mockResolvedValue(mockErrorResult);

      await expect(V4VResolutionSkill.resolveV4V(input))
        .rejects.toThrow('V4V resolution failed: Track not found');
    });

    it('should handle different resolution target types', async () => {
      const artistTarget = {
        type: 'artist' as const,
        identifier: 'artist-123',
        context: { artist: 'Test Artist' }
      };

      const input = {
        resolution_target: artistTarget,
        resolution_options: {}
      };

      const result = await V4VResolutionSkill.resolveV4V(input);

      expect(result).toHaveProperty('v4v_info');
    });

    it('should require feed_guid and item_guid for track resolution', async () => {
      const invalidTarget = {
        type: 'track' as const,
        identifier: 'track-123',
        context: { artist: 'Test Artist' } // Missing feed_guid and item_guid
      };

      const input = {
        resolution_target: invalidTarget,
        resolution_options: {}
      };

      await expect(V4VResolutionSkill.resolveV4V(input))
        .rejects.toThrow('Track resolution requires feed_guid and item_guid in context');
    });
  });

  describe('resolveBatch', () => {
    it('should resolve multiple V4V tracks in batch', async () => {
      const tracks = [
        { feedGuid: 'feed-1', itemGuid: 'item-1' },
        { feedGuid: 'feed-2', itemGuid: 'item-2' }
      ];

      const mockResults = new Map();
      mockResults.set('feed-1:item-1', { success: true, title: 'Track 1' });
      mockResults.set('feed-2:item-2', { success: true, title: 'Track 2' });

      jest.spyOn(require('../../lib/v4v-resolver').V4VResolver, 'resolveBatch')
        .mockResolvedValue(mockResults);

      const result = await V4VResolutionSkill.resolveBatch(tracks);

      expect(result.size).toBe(2);
      expect(result.get('feed-1:item-1')?.title).toBe('Track 1');
      expect(result.get('feed-2:item-2')?.title).toBe('Track 2');
    });

    it('should handle batch resolution errors', async () => {
      const tracks = [{ feedGuid: 'invalid', itemGuid: 'invalid' }];

      jest.spyOn(require('../../lib/v4v-resolver').V4VResolver, 'resolveBatch')
        .mockRejectedValue(new Error('Batch resolution failed'));

      await expect(V4VResolutionSkill.resolveBatch(tracks))
        .rejects.toThrow('Batch V4V resolution failed: Batch resolution failed');
    });
  });

  describe('validateLightningAddress', () => {
    it('should validate correct Lightning addresses', () => {
      expect(V4VResolutionSkill.validateLightningAddress('artist@example.com')).toBe(true);
      expect(V4VResolutionSkill.validateLightningAddress('user@domain.org')).toBe(true);
    });

    it('should reject invalid Lightning addresses', () => {
      expect(V4VResolutionSkill.validateLightningAddress('invalid-address')).toBe(false);
      expect(V4VResolutionSkill.validateLightningAddress('user@')).toBe(false);
      expect(V4VResolutionSkill.validateLightningAddress('@domain.com')).toBe(false);
    });
  });

  describe('generatePaymentRequest', () => {
    it('should generate payment request for a track', async () => {
      const trackInfo = {
        title: 'Test Track',
        artist: 'Test Artist',
        amount: 1000,
        lightningAddress: 'artist@example.com'
      };

      const result = await V4VResolutionSkill.generatePaymentRequest(trackInfo);

      expect(result).toHaveProperty('payment_request');
      expect(result).toHaveProperty('amount');
      expect(result).toHaveProperty('description');
      expect(result.amount).toBe(1000);
      expect(result.description).toBe('Test Track by Test Artist');
    });
  });

  describe('processPaymentConfirmation', () => {
    it('should process payment confirmation', async () => {
      const paymentRequest = 'lnbc1000u1p...';

      const result = await V4VResolutionSkill.processPaymentConfirmation(paymentRequest);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('transaction_id');
      expect(result).toHaveProperty('amount');
    });
  });

  describe('utility methods', () => {
    it('should clear V4V cache', () => {
      const clearCacheSpy = jest.spyOn(require('../../lib/v4v-resolver').V4VResolver, 'clearCache');

      V4VResolutionSkill.clearCache();

      expect(clearCacheSpy).toHaveBeenCalled();
    });

    it('should get V4V statistics', () => {
      const stats = V4VResolutionSkill.getV4VStats();

      expect(stats).toHaveProperty('known_feeds');
      expect(stats).toHaveProperty('cache_size');
      expect(stats).toHaveProperty('last_resolution');
      expect(typeof stats.known_feeds).toBe('number');
      expect(typeof stats.cache_size).toBe('number');
    });
  });
});
