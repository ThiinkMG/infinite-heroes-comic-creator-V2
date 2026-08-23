/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the canonical character descriptor, using the REAL profile data that
 * produced observable drift in the "From Paris With Love" issue.
 *
 * Every case here corresponds to something visibly wrong in that issue's art:
 * a missing tail, missing pointed ears, an invented emblem name lettered across
 * a character's chest, and prompt-template instructions leaking into the artwork
 * description.
 */

import { describe, it, expect } from 'vitest';
import {
  formatCanonicalCharacter,
  sanitizeProfileText,
  extractAnatomy,
} from './types';
import type { CharacterProfile } from './types';

/** Muse, exactly as stored by the profile analyser. */
const MUSE: CharacterProfile = {
  id: 'muse',
  name: 'Muse',
  faceDescription: 'Angular face, high cheekbones',
  bodyType: 'Lean athletic',
  clothing: 'Maroon padded torso armour, black sleeves, red shoulder plates, utility belt',
  colorPalette: 'Indigo, maroon, black',
  distinguishingFeatures:
    'Indigo-blue skin, solid glowing white eyes, pointed elven ears, and a long, prehensile, scaled tail ending in an arrow-like spade.',
  emblemDescription:
    'A metallic silver or dark gunmetal emblem is prominently displayed on his chest. The design elegantly fuses an infinity symbol with a downward-pointing spear or anchor. It is placed centrally on the maroon, padded section of his torso. Include this in EVERY panel featuring this character.',
  emblemPlacement: 'left-chest',
  maskDescription: 'Black domino mask',
  identityHeader: {
    face: 'Angular face, high cheekbones',
    eyes: 'Solid glowing white, perpetually framed by a black domino mask.',
    hair: 'Medium-length off-black dreadlocks worn swept to one side over a shaved undercut.',
    skin: 'Indigo-blue skin tone.',
    build: 'Lean athletic',
    signature: [
      'Indigo-blue skin',
      'Chest emblem (infinity symbol with anchor)',
      'Black domino mask',
      'Prehensile tail with spade tip',
    ],
  },
  hardNegatives: ['no human skin tones', 'no rounded ears', 'no pupils', 'no irises', 'no glasses', 'no facial hair'],
};

/** Star Girl, exactly as stored. */
const STAR_GIRL: CharacterProfile = {
  id: 'star',
  name: 'Star Girl',
  faceDescription: 'Oval face',
  bodyType: 'Athletic',
  clothing: 'White and gold armoured suit with black panels, white cape with gold trim',
  colorPalette: 'White, gold, black',
  distinguishingFeatures:
    'Her eyes can shift from blue to a burning, solid golden-yellow. She has glowing, intricate golden sigils on the black parts of her suit on her arms and thighs. Energy, in the form of golden light, emanates from her hands. A prominent, fractured star emblem on her chest.',
  emblemDescription:
    'Located centrally on her chest is the Solari emblem: a fractured, black, eight-pointed star. This emblem is set within a golden circle and outlined in gold, placed upon the white armored section of her torso.',
  identityHeader: {
    face: 'Oval face',
    eyes: 'Almond-shaped blue eyes that can glow a solid, intense gold.',
    hair: 'Long black wavy hair worn loose and parted off-center.',
    skin: 'Medium-dark brown skin tone with visible glowing golden sigils on her arms and thighs.',
    build: 'Athletic',
    signature: [
      'White and gold armored suit',
      'Fractured eight-pointed star emblem on chest',
      'Glowing golden hands and sigils',
    ],
  },
  hardNegatives: ['no short hair', 'no straight hair', 'no mask'],
};

describe('sanitizeProfileText', () => {
  it('strips instruction text the analyser copied from its own template', () => {
    const cleaned = sanitizeProfileText(MUSE.emblemDescription!);
    // This sentence is a directive to the analyser, not a description of artwork,
    // and it was reaching the image model verbatim.
    expect(cleaned).not.toMatch(/Include this in EVERY panel/i);
    expect(cleaned).toContain('infinity symbol');
  });

  it('strips invented emblem proper nouns', () => {
    const cleaned = sanitizeProfileText(STAR_GIRL.emblemDescription!);
    // A generated page came back with "SOLARI" lettered across her chest.
    expect(cleaned).not.toMatch(/Solari/i);
    expect(cleaned).toContain('eight-pointed star');
  });

  it('leaves clean text untouched', () => {
    expect(sanitizeProfileText('A silver triangle with three bars')).toBe('A silver triangle with three bars');
  });

  it('handles empty and undefined input', () => {
    expect(sanitizeProfileText('')).toBe('');
    expect(sanitizeProfileText(undefined as unknown as string)).toBe('');
  });
});

describe('extractAnatomy', () => {
  it('surfaces non-human anatomy that was previously dead data', () => {
    const anatomy = extractAnatomy(MUSE);
    // Neither trait appeared in any page of the finished issue.
    expect(anatomy).toMatch(/pointed elven ears/i);
    expect(anatomy).toMatch(/tail/i);
  });

  it('drops clauses that describe costume rather than body', () => {
    const anatomy = extractAnatomy(STAR_GIRL);
    // Costume is already covered by `clothing`; repeating it here would be the
    // duplication the v2 assembler exists to prevent.
    expect(anatomy).not.toMatch(/suit/i);
    expect(anatomy).toMatch(/eyes/i);
  });

  it('returns empty for a profile with no distinguishing features', () => {
    expect(extractAnatomy({ ...MUSE, distinguishingFeatures: '' })).toBe('');
  });
});

describe('formatCanonicalCharacter — regressions from the shipped issue', () => {
  it("keeps Muse's tail, which slice(0, 3) used to drop", () => {
    const out = formatCanonicalCharacter(MUSE, 'hero');
    // 'Prehensile tail with spade tip' was signature[3] — cut off by the old
    // slice, and absent from every page of the generated issue.
    expect(out).toMatch(/tail/i);
  });

  it("keeps Muse's pointed ears", () => {
    const out = formatCanonicalCharacter(MUSE, 'hero');
    expect(out).toMatch(/pointed elven ears/i);
    // A negative alone never produced them.
    expect(out).toMatch(/Anatomy — always draw/);
  });

  it('forbids lettering on the emblem', () => {
    const out = formatCanonicalCharacter(STAR_GIRL, 'co-star');
    expect(out).toMatch(/Emblem \(shape only, no text or letters\)/);
    expect(out).not.toMatch(/Solari/i);
  });

  it('carries no leaked template instructions', () => {
    const out = formatCanonicalCharacter(MUSE, 'hero');
    expect(out).not.toMatch(/Include this in EVERY panel/i);
    expect(out).not.toMatch(/leave empty string/i);
  });

  it('lists every signature element, not the first three', () => {
    const out = formatCanonicalCharacter(MUSE, 'hero');
    const line = out.split('\n').find(l => l.startsWith('Always visible:')) ?? '';
    for (const item of MUSE.identityHeader!.signature) {
      expect(line.toLowerCase()).toContain(item.toLowerCase().split(' (')[0].toLowerCase());
    }
  });

  it('still produces a usable block for a profile with no identityHeader', () => {
    const bare: CharacterProfile = {
      id: 'x', name: 'Bare', faceDescription: 'Round face', bodyType: 'Stocky',
      clothing: 'Grey coveralls', colorPalette: 'Grey', distinguishingFeatures: 'Eye patch',
    };
    const out = formatCanonicalCharacter(bare, 'supporting');
    expect(out).toContain('BARE');
    expect(out).toMatch(/Round face/);
    expect(out).toMatch(/Eye patch/i);
  });
});
