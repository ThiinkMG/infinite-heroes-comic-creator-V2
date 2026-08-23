/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for scene softening.
 *
 * The failure this addresses: the story model writes a scene the image model
 * refuses, so a page fails for a story the user's own AI produced — and
 * retrying the identical prompt fails identically, which is why Quick Retry
 * so often appeared to do nothing.
 */

import { describe, it, expect } from 'vitest';
import { softenScene, looksRisky, SAFE_RETRY_DIRECTION } from './sceneSafety';

describe('looksRisky', () => {
  it('flags wording that trips image-safety filters', () => {
    expect(looksRisky('blood pools around the fallen guard')).toBe(true);
    expect(looksRisky('she stabs him through the chest')).toBe(true);
    expect(looksRisky('a corpse slumped against the wall')).toBe(true);
  });

  it('leaves ordinary action alone', () => {
    expect(looksRisky('Kara raises her blade against the storm')).toBe(false);
    expect(looksRisky('they run through a flooded tunnel')).toBe(false);
  });

  it('handles empty input', () => {
    expect(looksRisky('')).toBe(false);
  });

  it('is not order-dependent across calls', () => {
    // A global regex carries lastIndex between calls; the same input must give
    // the same answer every time.
    const s = 'blood on the stones';
    expect(looksRisky(s)).toBe(true);
    expect(looksRisky(s)).toBe(true);
    expect(looksRisky(s)).toBe(true);
  });
});

describe('softenScene', () => {
  it('replaces gore while keeping the sentence intact', () => {
    const r = softenScene('Blood streaks the cobblestones as Muse advances.');
    expect(r.changed).toBe(true);
    expect(r.text).not.toMatch(/blood/i);
    expect(r.text).toMatch(/Muse advances/);
  });

  it('moves the camera rather than removing the conflict', () => {
    const r = softenScene('She stabs the creature.');
    expect(r.text).toMatch(/lunges at/i);
    expect(r.text).not.toMatch(/stabs/i);
  });

  it('handles killing language', () => {
    const r = softenScene('Muse kills the last of them.');
    expect(r.text).toMatch(/defeats/i);
  });

  it('reports which terms it matched, for logging', () => {
    const r = softenScene('blood and a corpse');
    expect(r.matched).toEqual(expect.arrayContaining(['blood', 'corpse']));
  });

  it('leaves clean scenes byte-identical', () => {
    const clean = 'Star Girl hovers above the plaza, hands glowing.';
    const r = softenScene(clean);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(clean);
    expect(r.matched).toEqual([]);
  });

  it('is idempotent — softening twice changes nothing further', () => {
    const once = softenScene('blood everywhere, he stabs her').text;
    const twice = softenScene(once).text;
    expect(twice).toBe(once);
  });

  it('handles empty input without throwing', () => {
    expect(softenScene('').text).toBe('');
  });
});

describe('SAFE_RETRY_DIRECTION', () => {
  it('says what to draw, not only what to avoid', () => {
    // "Do not draw blood" still puts blood in the prompt. The direction has to
    // name the shot the model should produce instead.
    expect(SAFE_RETRY_DIRECTION).toMatch(/posture|framing|expression/i);
    expect(SAFE_RETRY_DIRECTION).toMatch(/moment before contact|reaction after/i);
  });
});
