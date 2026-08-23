/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for reroll quick presets.
 *
 * Presets express intent through `modes`, which App.tsx renders into instruction
 * text. Each preset used to ALSO carry a full prose instruction saying the same
 * thing in different words, so selecting one emitted two near-identical
 * directions — the redundancy promptAssemblerV2 exists to prevent, reintroduced
 * through the instruction path.
 */

import { describe, it, expect } from 'vitest';
import { QUICK_PRESETS } from './QuickPresets';

/** Mode instruction text, mirrored from App.tsx's modeInstructions map. */
const MODE_SAYS: Record<string, string[]> = {
  characters_only: ['background', 'environment', 'lighting', 'composition', 'characters'],
  expression_only: ['facial expressions', 'pose', 'clothing', 'background', 'lighting'],
  outfit_only: ['clothing', 'faces', 'pose', 'background'],
  emblem_only: ['emblem'],
  weapon_only: ['weapon'],
  full: [],
};

describe('QUICK_PRESETS', () => {
  it('every preset is well formed', () => {
    for (const p of QUICK_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(Array.isArray(p.modes)).toBe(true);
      expect(p.modes.length).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = QUICK_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not restate what its own modes already say', () => {
    for (const p of QUICK_PRESETS) {
      if (!p.prompt) continue;
      const covered = p.modes.flatMap(m => MODE_SAYS[m] ?? []);
      // A preset whose prose repeats several of its mode's own keywords is
      // duplicating the instruction rather than adding to it.
      const echoed = covered.filter(word => p.prompt.toLowerCase().includes(word));
      expect(
        echoed.length,
        `Preset "${p.id}" prose echoes its modes: ${echoed.join(', ')}`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it('never uses prose to restate scope a narrow mode already sets', () => {
    // Scope statements ("Keep the background", "Preserve the pose") are exactly
    // what the mode instructions say. Prose on a narrow mode should add a
    // qualitative direction instead — how closely to match, not what to leave
    // alone. Presets running as 'full' are exempt: 'full' sets no scope at all.
    const SCOPE_OPENERS = /^(keep|preserve|maintain|do not change|leave)/i;
    for (const p of QUICK_PRESETS) {
      if (!p.prompt || p.modes.includes('full')) continue;
      expect(
        SCOPE_OPENERS.test(p.prompt.trim()),
        `Preset "${p.id}" restates scope its mode already sets: "${p.prompt}"`,
      ).toBe(false);
    }
  });

  it('keeps remaining prose to a single instruction', () => {
    for (const p of QUICK_PRESETS) {
      if (!p.prompt) continue;
      // Long stacked prose is what made the combined instruction unreadable when
      // several presets were selected at once.
      const sentences = p.prompt.split(/[.!?]+/).filter(x => x.trim());
      expect(sentences.length, `Preset "${p.id}" prose is ${sentences.length} sentences`).toBeLessThanOrEqual(2);
    }
  });

  it('every preset that relies on likeness requests references', () => {
    const likenessPresets = QUICK_PRESETS.filter(p =>
      p.modes.some(m => ['expression_only', 'characters_only', 'outfit_only', 'emblem_only'].includes(m)),
    );
    for (const p of likenessPresets) {
      expect(p.useRefs, `Preset "${p.id}" changes characters but does not request refs`).toBe(true);
    }
  });
});
