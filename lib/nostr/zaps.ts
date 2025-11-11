/**
 * NIP-57: Lightning Zaps
 * https://github.com/nostr-protocol/nips/blob/master/57.md
 */

import { Event } from 'nostr-tools';
import { createZapRequest, createZapReceipt } from './events';
import { NostrClient } from './client';

export interface ZapRequest {
  recipientPubkey: string;
  amount: number; // in millisats
  invoice: string;
  message?: string;
  relays?: string[];
}

export interface ZapReceipt {
  zapRequestEventId: string;
  zapRequestEvent: Event;
  preimage: string;
}

/**
 * Create and publish a zap request
 * @param zapRequest - Zap request data
 * @param privateKey - Private key in hex format
 * @param client - Nostr client instance
 * @returns Published zap request event
 */
export async function createAndPublishZapRequest(
  zapRequest: ZapRequest,
  privateKey: string,
  client: NostrClient
): Promise<Event> {
  const event = createZapRequest(
    zapRequest.recipientPubkey,
    zapRequest.amount,
    zapRequest.invoice,
    privateKey,
    zapRequest.relays,
    zapRequest.message || ''
  );

  await client.publish(event, {
    relays: zapRequest.relays,
    waitForRelay: true,
  });

  return event;
}

/**
 * Create and publish a zap receipt (after payment confirmation)
 * @param zapReceipt - Zap receipt data
 * @param privateKey - Private key in hex format
 * @param client - Nostr client instance
 * @returns Published zap receipt event
 */
export async function createAndPublishZapReceipt(
  zapReceipt: ZapReceipt,
  privateKey: string,
  client: NostrClient
): Promise<Event> {
  const event = createZapReceipt(
    zapReceipt.zapRequestEventId,
    zapReceipt.zapRequestEvent,
    zapReceipt.preimage,
    privateKey
  );

  await client.publish(event, {
    relays: zapReceipt.zapRequestEvent.tags
      .filter(tag => tag[0] === 'relays')
      .map(tag => tag[1])
      .filter(Boolean),
    waitForRelay: true,
  });

  return event;
}

/**
 * Extract zap information from a zap request event
 * @param event - Zap request event (kind 9735)
 * @returns Zap information or null
 */
export function parseZapRequest(event: Event): {
  recipientPubkey: string;
  amount: number;
  invoice?: string;
  message?: string;
  relays?: string[];
} | null {
  if (event.kind !== 9735) {
    return null;
  }

  const pTag = event.tags.find(tag => tag[0] === 'p');
  const amountTag = event.tags.find(tag => tag[0] === 'amount');
  const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
  const relaysTags = event.tags.filter(tag => tag[0] === 'relays');

  if (!pTag || !amountTag) {
    return null;
  }

  return {
    recipientPubkey: pTag[1],
    amount: parseInt(amountTag[1], 10),
    invoice: bolt11Tag?.[1],
    message: event.content || undefined,
    relays: relaysTags.map(tag => tag[1]).filter(Boolean),
  };
}

/**
 * Extract zap receipt information from a zap receipt event
 * @param event - Zap receipt event (kind 9736)
 * @returns Zap receipt information or null
 */
export function parseZapReceipt(event: Event): {
  bolt11: string;
  description: string;
  recipientPubkey: string;
  preimage?: string;
} | null {
  if (event.kind !== 9736) {
    return null;
  }

  const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
  const descriptionTag = event.tags.find(tag => tag[0] === 'description');
  const pTag = event.tags.find(tag => tag[0] === 'p');
  const preimageTag = event.tags.find(tag => tag[0] === 'preimage');

  if (!bolt11Tag || !descriptionTag || !pTag) {
    return null;
  }

  return {
    bolt11: bolt11Tag[1],
    description: descriptionTag[1],
    recipientPubkey: pTag[1],
    preimage: preimageTag?.[1],
  };
}

