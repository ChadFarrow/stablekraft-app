// Example integration test using Chad's real Lightning value feed
// This shows how to integrate the value parser with actual RSS data

import { valueTagParser } from '@/lib/lightning/value-parser';

// Test function to parse Chad's Lightning test feed
export async function testChadsLightningFeed() {
  const TEST_FEED_URL = 'https://raw.githubusercontent.com/ChadFarrow/lnurl-test-feed/main/public/lnurl-test-feed.xml';

  try {
    console.log('🔍 Fetching Chad\'s Lightning test feed...');

    // Fetch the RSS feed
    const response = await fetch(TEST_FEED_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log('📄 Feed fetched, size:', xmlText.length, 'characters');

    // Parse value tags
    const valueData = valueTagParser.parseValueTags(xmlText);
    console.log('📊 Value parsing results:', {
      hasChannelValue: !!valueData.channelValue,
      itemCount: valueData.itemValues.size,
      channelRecipients: valueData.channelValue?.recipients.length || 0
    });

    // Analyze channel-level value splits
    if (valueData.channelValue) {
      console.log('\n📺 Channel-level value splits:');
      valueData.channelValue.recipients.forEach(recipient => {
        console.log(`  - ${recipient.name}: ${recipient.split}% (${recipient.type}: ${recipient.address.slice(0, 30)}...)`);
      });
    }

    // Analyze each episode's value splits
    console.log('\n🎧 Episode-specific value splits:');
    valueData.itemValues.forEach((valueTag, itemGuid) => {
      console.log(`\n  Episode "${itemGuid}": ${valueTag.recipients.length} recipients`);
      valueTag.recipients.forEach(recipient => {
        console.log(`    - ${recipient.name}: ${recipient.split}% (${recipient.type})`);
        if (recipient.type === 'lnaddress') {
          console.log(`      Lightning Address: ${recipient.address}`);
        } else {
          console.log(`      Node: ${recipient.address.slice(0, 30)}...`);
        }
      });
    });

    // Test payment calculations for 1000 sats
    console.log('\n💰 Payment calculation example (1000 sats):');
    if (valueData.channelValue) {
      const paymentSplits = valueTagParser.calculatePaymentSplits(
        valueData.channelValue.recipients,
        1000
      );

      paymentSplits.forEach(split => {
        console.log(`  ${split.recipient.name}: ${split.amount} sats (${split.recipient.type})`);
      });
    }

    // Convert to BoostButton format
    console.log('\n🔧 BoostButton format conversion:');
    if (valueData.channelValue) {
      const boostFormat = valueTagParser.convertToBoostButtonFormat(valueData.channelValue.recipients);
      console.log('  Recipients for BoostButton:', boostFormat.length);

      // Find Lightning addresses
      const lightningAddress = valueTagParser.extractLightningAddress(valueData.channelValue.recipients);
      if (lightningAddress) {
        console.log('  Primary Lightning Address:', lightningAddress);
      }
    }

    return {
      success: true,
      valueData,
      testResults: {
        channelRecipients: valueData.channelValue?.recipients.length || 0,
        episodeCount: valueData.itemValues.size,
        hasLightningAddresses: valueData.channelValue?.recipients.some(r => r.type === 'lnaddress') || false,
        hasNodeAddresses: valueData.channelValue?.recipients.some(r => r.type === 'node') || false
      }
    };

  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Test function for specific episode
export async function testEpisodeValueSplits(episodeGuid: string) {
  const result = await testChadsLightningFeed();

  if (!result.success || !result.valueData) {
    return result;
  }

  const recipients = valueTagParser.getValueRecipientsForItem(result.valueData, episodeGuid);
  console.log(`\n🎯 Testing episode "${episodeGuid}":`, recipients.length, 'recipients');

  if (recipients.length > 0) {
    // Test payment calculation
    const paymentSplits = valueTagParser.calculatePaymentSplits(recipients, 1000);
    console.log('Payment splits for 1000 sats:');
    paymentSplits.forEach(split => {
      console.log(`  ${split.recipient.name}: ${split.amount} sats`);
    });

    // Convert for BoostButton
    const boostFormat = valueTagParser.convertToBoostButtonFormat(recipients);
    return {
      success: true,
      recipients,
      paymentSplits,
      boostFormat
    };
  }

  return {
    success: false,
    error: `No recipients found for episode: ${episodeGuid}`
  };
}

// Example usage in React component
// To use this in a React component, create a .tsx file with:
/*
import { useState, useEffect } from 'react';
import { BoostButton } from '@/components/Lightning/BoostButton';

export function ExampleBoostButtonIntegration() {
  const [valueSplits, setValueSplits] = useState<any[]>([]);
  const [lightningAddress, setLightningAddress] = useState<string | undefined>();

  useEffect(() => {
    async function loadValueSplits() {
      const result = await testChadsLightningFeed();

      if (result.success && result.valueData?.channelValue) {
        const boostFormat = valueTagParser.convertToBoostButtonFormat(
          result.valueData.channelValue.recipients
        );
        const lnAddress = valueTagParser.extractLightningAddress(
          result.valueData.channelValue.recipients
        );

        setValueSplits(boostFormat);
        setLightningAddress(lnAddress);
      }
    }

    loadValueSplits();
  }, []);

  return (
    <BoostButton
      trackId="test-track"
      trackTitle="Test Lightning Track"
      artistName="Chad's Test Feed"
      valueSplits={valueSplits}
      lightningAddress={lightningAddress}
    />
  );
}
*/

// Console testing commands
export const testCommands = {
  // Test full feed parsing
  testFeed: () => testChadsLightningFeed(),

  // Test specific episodes
  testEpisode1: () => testEpisodeValueSplits('episode-1'),
  testEpisode2: () => testEpisodeValueSplits('episode-2'),
  testEpisode3: () => testEpisodeValueSplits('episode-3'),
  testEpisode4: () => testEpisodeValueSplits('episode-4'),

  // Quick validation
  validate: async () => {
    const result = await testChadsLightningFeed();
    console.log('✅ Validation Results:', {
      feedParsingWorks: result.success,
      hasChannelValue: !!result.valueData?.channelValue,
      episodeCount: result.valueData?.itemValues.size || 0,
      channelRecipients: result.valueData?.channelValue?.recipients.length || 0
    });
  }
};

// Browser console usage:
// 1. Copy this file's content to browser console
// 2. Run: testCommands.testFeed()
// 3. Run: testCommands.testEpisode1()
// 4. Run: testCommands.validate()