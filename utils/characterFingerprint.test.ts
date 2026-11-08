/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { CharacterProfile, Persona } from '../types';
import {
  visualFingerprint,
  profileFingerprint,
  isProfileOutdated,
  isModelSheetOutdated,
  adoptSheetFingerprint,
  adoptProfileFingerprint,
} from './characterFingerprint';
import { hasValidModelSheet } from '../hooks/useGenerateModelSheet';
import { useSettingsStore, mergePersistedSettings } from '../stores/useSettingsStore';

const portraitA = 'data:image/png;base64,' + 'A'.repeat(20_000) + 'endA';
const portraitB = 'data:image/png;base64,' + 'A'.repeat(20_000) + 'endB';

const muse: Persona = {
  id: 'muse', name: 'Muse', base64: portraitA, desc: '',
  backstoryText: 'A painter who can step into her canvases.',
};

const profileFor = (p: Persona): CharacterProfile => ({
  id: p.id, name: p.name, faceDescription: 'oval', bodyType: 'slim', clothing: 'smock',
  colorPalette: 'ochre', distinguishingFeatures: 'paint flecks',
  sourceFingerprint: profileFingerprint(p),
});

describe('fingerprints', () => {
  it('are stable for the same character', () => {
    expect(visualFingerprint(muse)).toBe(visualFingerprint({ ...muse }));
  });

  it('change when the portrait changes, even if only the end of the image differs', () => {
    expect(visualFingerprint({ ...muse, base64: portraitB })).not.toBe(visualFingerprint(muse));
  });

  it('change when refs, emblem or weapon change', () => {
    const base = visualFingerprint(muse);
    expect(visualFingerprint({ ...muse, referenceImages: [portraitB] })).not.toBe(base);
    expect(visualFingerprint({ ...muse, emblemPlacement: 'chest-center' })).not.toBe(base);
    expect(visualFingerprint({ ...muse, weaponDescriptionText: 'a brush-spear' })).not.toBe(base);
  });

  it('a backstory edit outdates the profile but not the model sheet', () => {
    const edited = { ...muse, backstoryText: 'Now a sculptor.' };
    expect(visualFingerprint(edited)).toBe(visualFingerprint(muse));
    expect(profileFingerprint(edited)).not.toBe(profileFingerprint(muse));
  });
});

describe('profile staleness', () => {
  it('flags a profile made from an older portrait', () => {
    const profile = profileFor(muse);
    expect(isProfileOutdated(profile, muse)).toBe(false);
    expect(isProfileOutdated(profile, { ...muse, base64: portraitB })).toBe(true);
  });

  it('treats legacy profiles (no fingerprint) as current, and adopts one', () => {
    const { sourceFingerprint: _omit, ...legacy } = profileFor(muse);
    expect(isProfileOutdated(legacy, { ...muse, base64: portraitB })).toBe(false);
    const adopted = adoptProfileFingerprint(legacy, muse);
    expect(isProfileOutdated(adopted, { ...muse, base64: portraitB })).toBe(true);
  });
});

describe('model sheet validity', () => {
  const style = 'Modern American Comic';
  const withSheet = (source: 'generated' | 'uploaded'): Persona => ({
    ...muse,
    modelSheet: 'data:image/png;base64,SHEET',
    modelSheetStyle: style,
    modelSheetSource: source,
    modelSheetFingerprint: visualFingerprint(muse),
  });

  it('is valid for the matching style and portrait', () => {
    expect(hasValidModelSheet(withSheet('generated'), style)).toBe(true);
  });

  it('is invalid in another art style', () => {
    expect(hasValidModelSheet(withSheet('generated'), 'Black & White Manga')).toBe(false);
  });

  it('a generated sheet goes out of date when the portrait changes', () => {
    const changed = { ...withSheet('generated'), base64: portraitB };
    expect(isModelSheetOutdated(changed)).toBe(true);
    expect(hasValidModelSheet(changed, style)).toBe(false);
  });

  it('an uploaded sheet stays valid (it is the user\'s own art)', () => {
    const changed = { ...withSheet('uploaded'), base64: portraitB };
    expect(isModelSheetOutdated(changed)).toBe(true);
    expect(hasValidModelSheet(changed, style)).toBe(true);
  });

  it('legacy sheets adopt a fingerprint on load instead of being discarded', () => {
    const { modelSheetFingerprint: _omit, ...legacy } = withSheet('generated');
    expect(hasValidModelSheet(legacy, style)).toBe(true);
    const adopted = adoptSheetFingerprint(legacy);
    expect(adopted.modelSheetFingerprint).toBe(visualFingerprint(muse));
  });
});

describe('profileMode settings migration', () => {
  const merge = (persisted: unknown) => mergePersistedSettings(persisted, useSettingsStore.getState()).profileMode;

  it('defaults to reuse', () => {
    expect(merge({})).toBe('reuse');
  });

  it('keeps analysis off for users who had turned it off', () => {
    expect(merge({ autoCharacterAnalysis: false })).toBe('manual');
    expect(merge({ skipProfileAnalysis: true })).toBe('manual');
  });

  it('keeps an explicit profileMode', () => {
    expect(merge({ profileMode: 'analyze', skipProfileAnalysis: true })).toBe('analyze');
  });
});
