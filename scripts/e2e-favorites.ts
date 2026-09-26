#!/usr/bin/env tsx
/**
 * The favorites sync loop, end to end, against the local relay — no account.
 *
 * WHY THIS EXISTS: every other guard on this subsystem is a pure function under
 * `node:test`, and the unit vectors all pass over the bugs that actually
 * shipped. `content` had eleven test vectors beside it and none of them touched
 * it; the republish-from-`groups` bug type-checked; the baseline defects needed
 * TWO cycles before anything looked wrong. The wiring between the pure pieces
 * is where the failures live, and this is the only thing that exercises it.
 *
 * It uses a THROWAWAY key and the local relay, so it publishes nothing under
 * anyone's real npub and touches no production data. Run `npm run relay` first.
 *
 *   npm run relay            # in one terminal
 *   npm run e2e:favorites    # in another
 *
 * What it drives is the real module, not a copy: `fetchSingleList`,
 * `mergeSingleList`, `tagsFromNodes` and `templateFromTags` are imported from
 * `lib/nostr/favorites-single-list.ts`. Only the two things that cannot exist
 * outside a browser are stood in for — the signer (a raw secret key here) and
 * `localStorage` (the published record, passed directly).
 */

import WebSocket from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { installNodeWebSocket } from '../lib/nostr/node-websocket';
import {
  SINGLE_LIST_KIND,
  LIST_ALT,
  fetchSingleList,
  mergeSingleList,
  groupForSingleList,
  tagsFromNodes,
  templateFromTags,
  publishedRecordFrom,
} from '../lib/nostr/favorites-single-list';
import {
  encodePrivateFavorites,
  decodePrivateFavorites,
  parseSingleList,
} from '../lib/nostr/favorites-single-list';
import { publishGate, publishPlan, EMPTY_BASELINE } from '../lib/nostr/favorites-privacy';
import { itemId, showId, type FavoriteEntry } from '../lib/nostr/pc20-identifiers';

const RELAY = process.env.E2E_RELAY || `ws://127.0.0.1:${process.env.PORT || 7777}`;

let failures = 0;
const ok = (msg: string) => console.log(`  ✅ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ❌ ${msg}`);
};
const check = (cond: boolean, msg: string) => (cond ? ok(msg) : bad(msg));

/**
 * An opaque `content`, standing in for another app's NIP-44 private half.
 *
 * Base64 because that is what a NIP-44 payload looks like, but the shape is not
 * the point: this app cannot read it, has no business reading it, and must
 * return it byte for byte regardless.
 */
const FOREIGN_CONTENT = 'AkQBc1lPZ0hlYVh1WkJqc0hRZmpOUFlZQXpQMkVmVkxRPT0/dGhpcw==';

// Real-shaped guids, matching the fixtures in favorites-single-list.test.ts.
const MUSIC_A = '9b024349-ccf0-5f69-a609-6b82873eab3c';
const PUBLISHER_B = 'c31ad2f6-1b7e-5b34-a2a4-6b06d5b0b4e2';
// A feed favorited PRIVATELY, so its guid must never appear in the public tags.
const MUSIC_B = '791338e2-77bc-579e-8c7c-4c996cf73305';

const album = (guid: string, medium?: string): FavoriteEntry => ({ id: showId(guid), medium });
const track = (guid: string, parent: string, medium?: string): FavoriteEntry => ({
  id: itemId(guid),
  feedRef: showId(parent),
  medium,
});

/** Publish a signed event and wait for the relay's OK. */
function publish(event: Event): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`no OK from ${RELAY} within 5s`));
    }, 5000);
    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`cannot reach ${RELAY} — is \`npm run relay\` running? (${err.message})`));
    });
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', event])));
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg[0] !== 'OK') return;
      clearTimeout(timer);
      ws.close();
      msg[2] ? resolve() : reject(new Error(`relay refused: ${msg[3]}`));
    });
  });
}

async function main() {
  // Node 20 has no WebSocket global, Node 22's is undici's (which recurses on a
  // failed connect), and nostr-tools captures it at module load.
  await installNodeWebSocket();

  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const relays = [RELAY];

  console.log(`favorites e2e — throwaway key ${pubkey.slice(0, 12)}… against ${RELAY}\n`);

  // -------------------------------------------------------------------------
  console.log('① Another app publishes a list with a private half');
  // -------------------------------------------------------------------------
  // Two entries this app will also hold, one it never will, and a `content` it
  // cannot read. The foreign entry and the foreign content are the two things
  // a republish is most likely to quietly drop.
  const seeded = finalizeEvent(
    {
      kind: SINGLE_LIST_KIND,
      created_at: Math.floor(Date.now() / 1000) - 600,
      content: FOREIGN_CONTENT,
      tags: [
        ['alt', LIST_ALT],
        ['medium', 'music'],
        ['i', `podcast:guid:${MUSIC_A}`],
        ['i', `podcast:publisher:guid:${PUBLISHER_B}`], // a kind this app does not model
        ['k', 'podcast:guid'],
      ],
    },
    sk
  );
  await publish(seeded);
  ok(`seeded ${seeded.tags.length} tags and ${FOREIGN_CONTENT.length} bytes of content`);

  // -------------------------------------------------------------------------
  console.log('\n② This app reads it');
  // -------------------------------------------------------------------------
  const read = await fetchSingleList(pubkey, relays);
  check(read.trustworthy, 'the read is trustworthy — a real EOSE arrived');
  check(read.exists, 'the event was found');
  check(
    read.content === FOREIGN_CONTENT,
    `content captured verbatim (${read.content.length} bytes)`
  );
  if (!read.trustworthy) {
    // Everything below publishes on top of this read. Rule 1 of the spec: a
    // publish over a read that failed is the whole list, and it is the one
    // mistake this format makes unrecoverable.
    bad('read degraded — refusing to continue, exactly as the app would');
    return;
  }

  // -------------------------------------------------------------------------
  console.log('\n③ This app favorites something and republishes');
  // -------------------------------------------------------------------------
  const local: FavoriteEntry[] = [
    album(MUSIC_A, 'music'),
    track('a-favorited-track-guid', MUSIC_A, 'music'),
  ];
  const localGroups = groupForSingleList(local);
  const merged = mergeSingleList(read, localGroups, publishedRecordFrom(localGroups));
  const tags = tagsFromNodes(merged.nodes, merged.foreignTags, merged.foreignKinds);

  // From `read.content`, not `''`. This is the line the whole harness is for.
  const template = templateFromTags(tags, Math.floor(Date.now() / 1000), read.content);
  await publish(finalizeEvent(template, sk));
  ok(`republished ${tags.filter((t) => t[0] === 'i').length} entries`);

  // -------------------------------------------------------------------------
  console.log('\n④ The private half survived, and so did the entry we cannot model');
  // -------------------------------------------------------------------------
  const after = await fetchSingleList(pubkey, relays);
  check(after.trustworthy && after.exists, 'the republished event reads back');
  check(
    after.content === FOREIGN_CONTENT,
    after.content === FOREIGN_CONTENT
      ? 'content is byte-identical — the private half survived'
      : `content CHANGED: ${after.content.length} bytes, expected ${FOREIGN_CONTENT.length}`
  );
  check(after.updatedAt > read.updatedAt, 'created_at moved, so this really was a republish');
  check(
    after.nodes.some((n) => n.t === 'loose' && n.loose.tag[1]?.includes('podcast:publisher:guid')),
    'the publisher entry this app cannot model is still on the list'
  );

  // -------------------------------------------------------------------------
  console.log('\n⑤ A second cycle changes nothing');
  // -------------------------------------------------------------------------
  // Idempotence, and the reason it gets its own step: a merge that is not
  // idempotent makes two apps rewrite the event against each other forever,
  // each publish locally reasonable, the only symptom being that it never
  // stops. This is also where a ciphertext comparison would fail once the
  // private half is real — NIP-44 draws a fresh nonce every time.
  const merged2 = mergeSingleList(after, localGroups, publishedRecordFrom(localGroups));
  const tags2 = tagsFromNodes(merged2.nodes, merged2.foreignTags, merged2.foreignKinds);
  check(JSON.stringify(tags2) === JSON.stringify(tags), 'the tags are byte-identical, so nothing republishes');
  check(after.content === read.content, 'content is unchanged, so nothing rewrites it');

  // -------------------------------------------------------------------------
  console.log('\n⑥ A real private half: encrypt, publish, read back, decrypt');
  // -------------------------------------------------------------------------
  // Real NIP-44 to the key's own pubkey — the same encrypt-to-self the app does
  // through the signer. The signer itself cannot run outside a browser, so this
  // covers everything on either side of it: the codec, the plan, the relay
  // round trip, and the decrypt.
  const convo = nip44.getConversationKey(sk, pubkey);

  const privateLocal = groupForSingleList([album(MUSIC_B, 'music')]);
  const privatePlan = publishPlan({
    mode: 'private',
    publicRead: after,
    privateRead: parseSingleList([]),
    local: privateLocal,
    baseline: EMPTY_BASELINE,
  });

  const plaintext = encodePrivateFavorites(privatePlan.privateTags!);
  const ciphertext = nip44.encrypt(plaintext, convo);
  await publish(
    finalizeEvent(
      {
        kind: SINGLE_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000) + 1,
        content: ciphertext,
        tags: privatePlan.tags,
      },
      sk
    )
  );
  ok(`published ${plaintext.length} bytes of plaintext as ${ciphertext.length} of ciphertext`);

  const encrypted = await fetchSingleList(pubkey, relays);
  const roundTripped = decodePrivateFavorites(nip44.decrypt(encrypted.content, convo));
  check(roundTripped !== null, 'the private half decrypts and parses as a tag array');
  check(
    JSON.stringify(roundTripped) === JSON.stringify(privatePlan.privateTags),
    'and is byte-identical to what was encrypted'
  );
  check(
    parseSingleList(roundTripped ?? []).groups.some((g) => g.feedGuid === MUSIC_B),
    'the favorite is in there, and readable only with the key'
  );
  check(
    !JSON.stringify(encrypted.nodes).includes(MUSIC_B),
    'and its guid appears NOWHERE in the public half — `i` is relay-indexed'
  );

  // -------------------------------------------------------------------------
  console.log('\n⑦ Encrypting the same entries twice produces different bytes');
  // -------------------------------------------------------------------------
  // The reason the digest compares plaintext. A writer comparing ciphertext
  // sees a change on every pass and republishes forever — two apps rewriting
  // the event against each other, self-inflicted, with no symptom but that it
  // never stops.
  const again = nip44.encrypt(plaintext, convo);
  check(again !== ciphertext, 'fresh nonce, so the ciphertext differs');
  check(
    nip44.decrypt(again, convo) === plaintext,
    'while the plaintext is identical — which is what must be compared'
  );

  // -------------------------------------------------------------------------
  console.log('\n⑧ A list in BOTH halves is not re-disclosed, and says so');
  // -------------------------------------------------------------------------
  // The state measured on a real account: 284 in the public tags, 287 in the
  // encrypted half, all 284 in both. It gets there because this app's local
  // favorites are a database and its inbound reconcile is add-only, so entries
  // adopted while the mode was Private outlive a switch to Public and arrive
  // back in `local` — which goes wholly into the ACTIVE half.
  //
  // Driven through the relay rather than as a unit vector because the input
  // that matters is a REAL encrypted half read back off the wire, and because
  // the fault is in the wiring between the reads and the plan, which is where
  // every shipped bug in this subsystem has been.
  const bothPublic = tagsFromNodes(
    mergeSingleList(parseSingleList([]), groupForSingleList([album(MUSIC_A, 'music')])).nodes
  );
  const bothPrivate = encodePrivateFavorites(
    tagsFromNodes(
      mergeSingleList(
        parseSingleList([]),
        groupForSingleList([album(MUSIC_A, 'music'), album(MUSIC_B, 'music')])
      ).nodes
    )
  );
  await publish(
    finalizeEvent(
      {
        kind: SINGLE_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000) + 2,
        content: nip44.encrypt(bothPrivate, convo),
        tags: bothPublic,
      },
      sk
    )
  );
  const split = await fetchSingleList(pubkey, relays);
  const splitPrivate = parseSingleList(
    decodePrivateFavorites(nip44.decrypt(split.content, convo)) ?? []
  );
  check(
    split.groups.some((g) => g.feedGuid === MUSIC_A) &&
      splitPrivate.groups.some((g) => g.feedGuid === MUSIC_A),
    'seeded: one feed in both halves, one encrypted only'
  );

  // The database holds both, because it adopted them while the mode was
  // Private and has no way to give them back.
  const adopted = groupForSingleList([album(MUSIC_A, 'music'), album(MUSIC_B, 'music')]);
  const splitPlan = publishPlan({
    mode: 'public',
    publicRead: split,
    privateRead: splitPrivate,
    local: adopted,
    baseline: EMPTY_BASELINE,
  });
  const publicIds = splitPlan.tags.filter((t) => t[0] === 'i').map((t) => t[1]);
  check(publicIds.includes(showId(MUSIC_A)), 'the feed already public stays public');
  check(
    !publicIds.includes(showId(MUSIC_B)),
    'the encrypted-only feed is NOT published as a plaintext tag'
  );
  check(
    (splitPlan.privateTags ?? []).some((t) => t[1] === showId(MUSIC_B)),
    'it stays where its writer put it'
  );
  check(
    !splitPlan.baseline.public.feeds.includes(MUSIC_B),
    'and we do not claim an entry we did not publish'
  );
  check(
    splitPlan.carriedInOtherHalf === 1 && splitPlan.inBothHalves === 1,
    `the counts name both states separately (carried ${splitPlan.carriedInOtherHalf}, both ${splitPlan.inBothHalves})`
  );

  // -------------------------------------------------------------------------
  console.log('\n⑨ A stored mode the wire contradicts holds the publish');
  // -------------------------------------------------------------------------
  // Two apps, one event, and nothing on the wire saying which half the list
  // intends to be. Whichever app loads last would otherwise rewrite the whole
  // list to match its own stored answer.
  const wholly = await fetchSingleList(pubkey, relays);
  const hasPublic = wholly.groups.length > 0 || wholly.orphanItemGuids.length > 0;
  check(
    publishGate({
      stored: 'private',
      privateHalfUsable: true,
      hasPublic,
      hasPrivate: false,
      intent: 'auto',
    }).publish === false,
    'a page load does not move a public list into the encrypted half'
  );
  check(
    publishGate({
      stored: 'private',
      privateHalfUsable: true,
      hasPublic,
      hasPrivate: false,
      intent: 'resolve',
    }).publish === true,
    'and pressing the button in the app does'
  );
  check(
    publishGate({
      stored: 'private',
      privateHalfUsable: true,
      hasPublic,
      hasPrivate: true,
      intent: 'auto',
    }).conflict === null,
    'while a list that really is in both halves is not held at all'
  );

  // -------------------------------------------------------------------------
  console.log('\n⑩ The list says which half it lives in, and the tag survives');
  // -------------------------------------------------------------------------
  // Through a real relay round trip, because the tag has to survive parse,
  // merge and republish — and because this app's parser deliberately DROPS a
  // `visibility` tag it finds inside the private half, where the mode is not
  // a claim any reader may act on.
  const statedPlan = publishPlan({
    mode: 'private',
    publicRead: parseSingleList([['alt', LIST_ALT]]),
    privateRead: parseSingleList([]),
    local: groupForSingleList([album(MUSIC_B, 'music')]),
    baseline: EMPTY_BASELINE,
    userChose: true,
  });
  await publish(
    finalizeEvent(
      {
        kind: SINGLE_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000) + 3,
        content: nip44.encrypt(encodePrivateFavorites(statedPlan.privateTags!), convo),
        tags: statedPlan.tags,
      },
      sk
    )
  );
  const stated = await fetchSingleList(pubkey, relays);
  check(stated.visibility === 'private', `the event states its mode (${stated.visibility})`);
  check(
    stated.groups.length === 0,
    'and no entry reached the plaintext tags — `i` is relay-indexed',
  );

  // An empty list that SAYS private is the case emptiness cannot answer. A
  // reader with no stored preference must take the tag, not guess.
  const emptyStated = parseSingleList([
    ['alt', LIST_ALT],
    ['visibility', 'private'],
  ]);
  check(
    emptyStated.visibility === 'private' && emptyStated.groups.length === 0,
    'an empty list still carries a mode',
  );

  // And the tag does not leak into `content`, which is where a shared
  // `tagsFromNodes` would have put it.
  const inner = decodePrivateFavorites(nip44.decrypt(stated.content, convo)) ?? [];
  check(
    !inner.some((t) => t[0] === 'visibility'),
    'the private half carries no mode claim of its own',
  );

  // -------------------------------------------------------------------------
  console.log('\n⑪ A legacy item is upgraded ONCE, beside one already upgraded');
  // -------------------------------------------------------------------------
  // The migration, end to end. A list holding BOTH forms: a two-element item
  // that takes its feed from the entry above it, and a three-element one that
  // names its own. The first publish rewrites the legacy tag and leaves the
  // other byte-identical; the second changes nothing.
  const LEGACY_TRACK = 'e2e-legacy-track';
  const NAMED_TRACK = 'e2e-named-track';
  // AFTER whatever the scenarios above left, or the relay refuses it as older
  // than stored — a replaceable event keeps the newest `created_at`, and the
  // scenarios above have already moved it forward.
  const priorAt = (await fetchSingleList(pubkey, relays)).updatedAt;
  const mixed = finalizeEvent(
    {
      kind: SINGLE_LIST_KIND,
      created_at: priorAt + 1,
      content: '',
      tags: [
        ['alt', LIST_ALT],
        ['medium', 'music'],
        ['i', `podcast:guid:${MUSIC_A}`],
        ['i', `podcast:item:guid:${LEGACY_TRACK}`],
        ['i', `podcast:guid:${MUSIC_A}`, `podcast:item:guid:${NAMED_TRACK}`, 'newer-writer'],
        ['k', 'podcast:guid'],
        ['k', 'podcast:item:guid'],
      ],
    },
    sk
  );
  await publish(mixed);

  const mixedRead = await fetchSingleList(pubkey, relays);
  check(mixedRead.trustworthy && mixedRead.exists, 'the mixed list reads back');

  const mixedLocal = groupForSingleList([
    { id: `podcast:guid:${MUSIC_A}`, medium: 'music' },
    { id: `podcast:item:guid:${LEGACY_TRACK}`, feedRef: MUSIC_A, medium: 'music' },
    { id: `podcast:item:guid:${NAMED_TRACK}`, feedRef: MUSIC_A, medium: 'music' },
  ]);
  const upgraded = mergeSingleList(mixedRead, mixedLocal, publishedRecordFrom(mixedLocal));
  const upgradedTags = tagsFromNodes(
    upgraded.nodes,
    upgraded.foreignTags,
    upgraded.foreignKinds,
    upgraded.visibility
  );
  const tagOf = (guid: string) =>
    upgradedTags.find((t) => t[0] === 'i' && t[2] === `podcast:item:guid:${guid}`);
  check(
    JSON.stringify(tagOf(LEGACY_TRACK)) ===
      JSON.stringify(['i', `podcast:guid:${MUSIC_A}`, `podcast:item:guid:${LEGACY_TRACK}`]),
    'the legacy item was rewritten under the feed it was read under',
  );
  check(
    JSON.stringify(tagOf(NAMED_TRACK)) ===
      JSON.stringify([
        'i',
        `podcast:guid:${MUSIC_A}`,
        `podcast:item:guid:${NAMED_TRACK}`,
        'newer-writer',
      ]),
    'the entry already naming its feed came back byte-identical, extra element included',
  );

  await publish(finalizeEvent(
    {
      kind: SINGLE_LIST_KIND,
      created_at: priorAt + 2,
      content: mixedRead.content,
      tags: upgradedTags,
    },
    sk
  ));
  const settled = await fetchSingleList(pubkey, relays);
  const settledMerge = mergeSingleList(settled, mixedLocal, publishedRecordFrom(mixedLocal));
  check(
    JSON.stringify(
      tagsFromNodes(
        settledMerge.nodes,
        settledMerge.foreignTags,
        settledMerge.foreignKinds,
        settledMerge.visibility
      )
    ) === JSON.stringify(upgradedTags),
    'a second cycle changes nothing — the upgrade happened once',
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\ne2e threw:', e.message);
  process.exit(1);
});
