import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickFlexibleSlugMatch, type SlugCandidate } from './flexible-slug-match';

const feed = (id: string, title: string, trackCount: number, guid: string | null = null): SlugCandidate => ({
  id,
  title,
  guid,
  trackCount,
});

describe('pickFlexibleSlugMatch', () => {
  it('matches a title equal to the slug, lowercased', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Yellowhammer', 3)], 'yellowhammer')?.id, 'a');
    assert.equal(pickFlexibleSlugMatch([feed('a', 'YellowHammer', 3)], 'YellowHammer')?.id, 'a');
  });

  it('matches the URL-decoded slug', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'rock & roll', 3)], 'rock%20%26%20roll')?.id, 'a');
  });

  it('matches the slug with hyphens read as spaces', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Ten More Miles', 3)], 'ten-more-miles')?.id, 'a');
  });

  it('matches a title whose whitespace becomes hyphens', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Ten  More', 3)], 'ten-more')?.id, 'a');
  });

  it('matches a title with punctuation stripped', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', "That's It!", 3)], 'thats-it')?.id, 'a');
  });

  it('matches a title that contains a slug longer than five characters', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'the-bloodshot-lies-album', 3)], 'bloodshot-lies')?.id, 'a');
    assert.equal(pickFlexibleSlugMatch([feed('a', 'The Bloodshot Lies Album', 3)], 'bloodshot-lies')?.id, 'a');
  });

  it('does not use containment for a slug of five characters or fewer', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Big Crash', 3)], 'crash'), null);
  });

  it('matches a feed guid, exactly or case-insensitively', () => {
    const guid = '49c3af23-f100-5d5f-bebe-915a5290d348';
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Other', 3, guid)], guid)?.id, 'a');
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Other', 3, guid.toUpperCase())], guid)?.id, 'a');
  });

  it('skips a feed with no playable tracks', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Yellowhammer', 0)], 'yellowhammer'), null);
  });

  it('prefers the match with the most tracks', () => {
    const picked = pickFlexibleSlugMatch(
      [feed('a', 'Yellowhammer', 2), feed('b', 'yellowhammer', 9), feed('c', 'YELLOWHAMMER', 4)],
      'yellowhammer'
    );
    assert.equal(picked?.id, 'b');
  });

  it('keeps the first of equal track counts', () => {
    const picked = pickFlexibleSlugMatch([feed('a', 'Yellowhammer', 5), feed('b', 'yellowhammer', 5)], 'yellowhammer');
    assert.equal(picked?.id, 'a');
  });

  it('returns null when nothing matches', () => {
    assert.equal(pickFlexibleSlugMatch([feed('a', 'Something Else', 5)], 'yellowhammer'), null);
    assert.equal(pickFlexibleSlugMatch([], 'yellowhammer'), null);
  });
});
