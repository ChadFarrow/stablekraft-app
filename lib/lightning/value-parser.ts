import { XMLParser } from 'fast-xml-parser';

export interface ValueRecipient {
  name?: string;
  type: 'node' | 'lnaddress';
  address: string;
  split: number;
  customKey?: string;
  customValue?: string;
  fee?: boolean;
  /** 
   * Keysend fallback info resolved from Lightning Address details lookup
   * When a Lightning Address supports keysend, this contains the node pubkey and custom records
   * needed for direct keysend payments. Keysend is preferred over LNURL because it supports
   * Helipad metadata for podcast apps.
   */
  keysendFallback?: {
    pubkey: string;
    customKey?: string;
    customValue?: string;
  };
  /**
   * Nostr pubkey (hex) resolved from Lightning Address NIP-05 verification
   * Extracted from the Lightning Address details API response. Used to tag musicians
   * in Nostr boost posts so they receive notifications when boosted.
   */
  nostrPubkey?: string;
  /**
   * LNURL/Lightning Address fallback for node pubkey recipients
   * When a keysend payment fails (e.g., wallet doesn't support keysend),
   * this address can be used for LNURL-pay as a fallback.
   */
  lnurlFallback?: string;
}

export interface ValueTag {
  type: string; // 'lightning'
  method: string; // 'keysend'
  suggested?: number;
  recipients: ValueRecipient[];
}

export interface ParsedValueData {
  channelValue?: ValueTag;
  itemValues: Map<string, ValueTag>; // Item GUID -> ValueTag
}

export class ValueTagParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '_text',
      allowBooleanAttributes: true,
      parseAttributeValue: true,
      trimValues: true,
    });
  }

  /**
   * Parse Podcasting 2.0 value tags from RSS feed XML
   */
  parseValueTags(xmlContent: string): ParsedValueData {
    try {
      const parsed = this.parser.parse(xmlContent);
      const rss = parsed.rss || parsed;

      if (!rss.channel) {
        console.warn('No RSS channel found in XML');
        return { itemValues: new Map() };
      }

      const channel = rss.channel;
      const result: ParsedValueData = {
        itemValues: new Map(),
      };

      // Parse channel-level value tag
      result.channelValue = this.parseValueTag(channel);

      // Parse item-level value tags
      if (channel.item) {
        const items = Array.isArray(channel.item) ? channel.item : [channel.item];

        for (const item of items) {
          const guid = this.extractGuid(item);
          const itemValue = this.parseValueTag(item);

          if (guid && itemValue) {
            result.itemValues.set(guid, itemValue);
          }
        }
      }

      console.log(`📊 Parsed value tags: channel=${result.channelValue ? 'yes' : 'no'}, items=${result.itemValues.size}`);
      return result;
    } catch (error) {
      console.error('Failed to parse value tags:', error);
      return { itemValues: new Map() };
    }
  }

  /**
   * Parse a single value tag from an RSS item or channel
   */
  private parseValueTag(element: any): ValueTag | undefined {
    // Look for podcast:value tag
    const valueTag = element['podcast:value'] || element.value;

    if (!valueTag) {
      return undefined;
    }

    try {
      const type = valueTag['@_type'] || 'lightning';
      const method = valueTag['@_method'] || 'keysend';
      const suggested = valueTag['@_suggested'] ? parseFloat(valueTag['@_suggested']) : undefined;

      // Parse value recipients
      const recipients = this.parseValueRecipients(valueTag);

      if (recipients.length === 0) {
        console.warn('Value tag found but no recipients');
        return undefined;
      }

      return {
        type,
        method,
        suggested,
        recipients,
      };
    } catch (error) {
      console.error('Failed to parse value tag:', error);
      return undefined;
    }
  }

  /**
   * Parse value recipients from a value tag
   */
  private parseValueRecipients(valueTag: any): ValueRecipient[] {
    const recipients: ValueRecipient[] = [];

    // Handle both single and multiple recipients
    let recipientElements = valueTag['podcast:valueRecipient'] || valueTag.valueRecipient;

    if (!recipientElements) {
      return recipients;
    }

    if (!Array.isArray(recipientElements)) {
      recipientElements = [recipientElements];
    }

    for (const recipient of recipientElements) {
      try {
        const name = recipient['@_name'];
        const type = recipient['@_type'] || 'node';
        const address = recipient['@_address'];
        const split = parseInt(recipient['@_split'] || '0');
        // Handle customKey/customValue as both attributes and nested elements
        // Some feeds use nested <key> and <value> elements instead of attributes
        let customKey = recipient['@_customKey'];
        let customValue = recipient['@_customValue'];
        
        // Check for nested <key> element (maps to customKey)
        if (!customKey && recipient.key) {
          customKey = typeof recipient.key === 'string' 
            ? recipient.key 
            : recipient.key._text || recipient.key['#text'] || recipient.key;
        }
        
        // Check for nested <value> element (maps to customValue)
        if (!customValue && recipient.value) {
          customValue = typeof recipient.value === 'string'
            ? recipient.value
            : recipient.value._text || recipient.value['#text'] || recipient.value;
        }
        
        const fee = recipient['@_fee'] === 'true' || recipient['@_fee'] === true;

        if (!address || !split) {
          console.warn('Invalid recipient: missing address or split');
          continue;
        }

        recipients.push({
          name,
          type: type as 'node' | 'lnaddress',
          address,
          split,
          customKey,
          customValue,
          fee,
        });
      } catch (error) {
        console.error('Failed to parse recipient:', error);
      }
    }

    return recipients;
  }

  /**
   * Extract GUID from RSS item
   */
  private extractGuid(item: any): string | undefined {
    if (item.guid) {
      if (typeof item.guid === 'string') {
        return item.guid;
      }
      if (item.guid._text || item.guid['#text']) {
        return item.guid._text || item.guid['#text'];
      }
    }

    // Fallback to other unique identifiers
    if (item.link) {
      return item.link;
    }

    if (item.title && item.pubDate) {
      return `${item.title}-${item.pubDate}`;
    }

    return undefined;
  }

  /**
   * Get value recipients for a specific track/item
   */
  getValueRecipientsForItem(
    parsedData: ParsedValueData,
    itemGuid: string
  ): ValueRecipient[] {
    // Item-level value tags override channel-level
    const itemValue = parsedData.itemValues.get(itemGuid);
    if (itemValue) {
      return itemValue.recipients;
    }

    // Fall back to channel-level value tag
    if (parsedData.channelValue) {
      return parsedData.channelValue.recipients;
    }

    return [];
  }

  /**
   * Calculate payment amounts for recipients
   */
  calculatePaymentSplits(
    recipients: ValueRecipient[],
    totalAmount: number
  ): Array<{ recipient: ValueRecipient; amount: number }> {
    const totalSplits = recipients.reduce((sum, r) => sum + r.split, 0);

    if (totalSplits === 0) {
      console.warn('No splits defined for recipients');
      return [];
    }

    return recipients.map(recipient => ({
      recipient,
      amount: Math.floor((recipient.split / totalSplits) * totalAmount),
    })).filter(split => split.amount > 0); // Filter out zero amounts
  }

  /**
   * Convert parsed recipients to BoostButton format
   */
  convertToBoostButtonFormat(recipients: ValueRecipient[]): Array<{
    name?: string;
    address: string;
    split: number;
    type: 'node' | 'lnaddress';
  }> {
    return recipients.map(r => ({
      name: r.name,
      address: r.address,
      split: r.split,
      type: r.type,
    }));
  }

  /**
   * Extract Lightning Address from value recipients (if any)
   */
  extractLightningAddress(recipients: ValueRecipient[]): string | undefined {
    const lnAddressRecipient = recipients.find(r =>
      r.type === 'lnaddress' && r.address.includes('@')
    );

    return lnAddressRecipient?.address;
  }
}

// Export singleton instance
export const valueTagParser = new ValueTagParser();