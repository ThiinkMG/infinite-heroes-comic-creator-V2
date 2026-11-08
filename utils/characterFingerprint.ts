/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Fingerprints that record what a character's profile and model sheet were
 * built from, so editing the character marks them out of date.
 *
 * Before this, nothing tied a profile or sheet to the inputs that produced it.
 * A sheet counted as valid if its art style matched, and "Use Saved Profiles"
 * (on by default, and it skips the review dialog) reused any saved profile. So
 * swapping a character's photo kept generating the old face, with no warning.
 * There was a session-only "stale" flag, but it was lost on reload and nothing
 * acted on it.
 */

import type { CharacterProfile, Persona } from '../types';

/**
 * Cheap, stable hash of a possibly multi-megabyte string (a base64 image).
 *
 * Samples about 4K characters spread across the string, plus its length and
 * tail, instead of hashing every byte. These run during render (the casting
 * strip, character cards), and two different images virtually never match at
 * every sampled position with the same length.
 */
const sampleHash = (value: string | undefined): string => {
  if (!value) return '0';
  let h = 0x811c9dc5;
  const mix = (code: number) => {
    h ^= code;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const step = Math.max(1, Math.floor(value.length / 4096));
  for (let i = 0; i < value.length; i += step) mix(value.charCodeAt(i));
  for (let i = Math.max(0, value.length - 256); i < value.length; i++) mix(value.charCodeAt(i));
  return `${value.length.toString(36)}.${h.toString(36)}`;
};

const combine = (parts: (string | undefined)[]): string => sampleHash(parts.map(p => p ?? '').join('|'));

/**
 * What a model sheet is drawn from: every image and visual detail of the
 * character. Excludes the backstory, which is mostly plot, so editing the story
 * side of a character doesn't throw away a good sheet.
 */
export const visualFingerprint = (p: Persona): string =>
  combine([
    sampleHash(p.base64),
    ...(p.referenceImages ?? []).map(sampleHash),
    sampleHash(p.emblemImage),
    p.emblemPlacement,
    p.emblemPlacementCustom,
    sampleHash(p.weaponImage),
    p.weaponDescriptionText,
  ]);

/** What a profile is analysed from: the visuals plus the description and role. */
export const profileFingerprint = (p: Persona): string =>
  combine([
    visualFingerprint(p),
    p.backstoryText?.trim(),
    p.role,
    p.customRole,
    ...(p.backstoryFiles ?? []).map(f => `${f.name}:${sampleHash(f.base64)}`),
  ]);

/**
 * True when the profile was built from different inputs than the character has
 * now. A profile with no fingerprint (saved before fingerprints existed) is
 * treated as current; `adoptProfileFingerprint` records one on load.
 */
export const isProfileOutdated = (profile: CharacterProfile | undefined, p: Persona): boolean =>
  Boolean(profile?.sourceFingerprint) && profile!.sourceFingerprint !== profileFingerprint(p);

/**
 * Migration for casts saved before fingerprints existed: assume their current
 * sheet and profile match the character as it is now, and record that. Only
 * edits made from here on mark them out of date, so nobody's existing sheets
 * are thrown away on upgrade.
 */
export const adoptSheetFingerprint = (p: Persona): Persona =>
  p.modelSheet && !p.modelSheetFingerprint ? { ...p, modelSheetFingerprint: visualFingerprint(p) } : p;

export const adoptProfileFingerprint = (profile: CharacterProfile, p: Persona): CharacterProfile =>
  profile.sourceFingerprint ? profile : { ...profile, sourceFingerprint: profileFingerprint(p) };

/** True when a generated sheet was drawn from different visuals than the character has now. */
export const isModelSheetOutdated = (p: Persona): boolean =>
  Boolean(p.modelSheet && p.modelSheetFingerprint) && p.modelSheetFingerprint !== visualFingerprint(p);
