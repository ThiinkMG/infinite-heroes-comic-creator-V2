/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the v2 image-prompt assembler.
 *
 * The property this suite exists to protect is NON-REPETITION. The legacy
 * assembler drifted into restating each character's face/hair/skin 8-14 times
 * per request because nothing ever failed when a new block was added. These
 * tests fail when that starts happening again.
 */

import { describe, it, expect } from 'vitest';
import { buildV2Prompt, type V2Character, type V2Input } from './promptAssemblerV2';
import type { Beat, CharacterProfile, Persona, StoryContext } from '../types';

const mime = () => 'image/png';

const persona = (over: Partial<Persona> = {}): Persona => ({
  id: 'hero-1',
  name: 'Kara Vance',
  base64: 'AAAAportraitAAAA',
  desc: '',
  ...over,
});

const profile = (over: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id: 'hero-1',
  name: 'Kara Vance',
  faceDescription: 'sharp jawline, high cheekbones',
  bodyType: 'lean athletic',
  clothing: 'navy tactical jacket, silver shoulder plates',
  colorPalette: 'navy and silver',
  distinguishingFeatures: 'scar over left brow',
  identityHeader: {
    face: 'sharp jawline, high cheekbones, small scar over left brow',
    eyes: 'pale grey',
    hair: 'black, shoulder-length, wavy',
    skin: 'light olive',
    build: 'lean athletic',
    signature: ['silver shoulder plates', 'scar over left brow'],
  },
  hardNegatives: ['cape', 'glasses'],
  ...over,
});

const character = (over: Partial<V2Character> = {}): V2Character => ({
  persona: persona(),
  profile: profile(),
  roleLabel: 'hero',
  referenceImage: 'AAAAportraitAAAA',
  isModelSheet: false,
  outfitRefs: [],
  isPreserved: false,
  ...over,
});

const storyContext = (over: Partial<StoryContext> = {}): StoryContext => ({
  title: 'First Light',
  descriptionText: '',
  descriptionFiles: [],
  publisherName: 'Infinite',
  seriesTitle: 'Aria of Twilight',
  issueNumber: '1',
  useOverlayLogo: false,
  artStyle: 'Modern American Comic',
  pageLength: 6,
  ...over,
});

const beat = (over: Partial<Beat> = {}): Beat => ({
  scene: 'Kara stands in the rain, thinking in silence',
  choices: [],
  focus_char: 'hero',
  ...over,
});

const input = (over: Partial<V2Input> = {}): V2Input => ({
  beat: beat(),
  type: 'story',
  storyContext: storyContext(),
  genre: 'Superhero Action',
  characters: [character()],
  consistencyStrength: 1.0,
  compact: false,
  ...over,
});

/** Count how many prompt-text blocks mention a given substring. */
const countMentions = (text: string, needle: string): number =>
  text.toLowerCase().split(needle.toLowerCase()).length - 1;

describe('buildV2Prompt — non-repetition', () => {
  it('states each distinctive character fact exactly once', () => {
    const { promptText } = buildV2Prompt(input(), mime);

    // These are the exact values the legacy assembler repeated across many blocks.
    expect(countMentions(promptText, 'pale grey')).toBe(1);
    expect(countMentions(promptText, 'light olive')).toBe(1);
    expect(countMentions(promptText, 'black, shoulder-length, wavy')).toBe(1);
    expect(countMentions(promptText, 'small scar over left brow')).toBe(1);
  });

  it('merges hard negatives into a single "Never draw" rule', () => {
    const two = [
      character(),
      character({
        persona: persona({ id: 'friend-1', name: 'Dane' }),
        profile: profile({ id: 'friend-1', name: 'Dane', hardNegatives: ['cape', 'beard'] }),
        roleLabel: 'co-star',
      }),
    ];
    const { promptText } = buildV2Prompt(input({ characters: two }), mime);

    // 'cape' appears in both characters' negatives; the merged rule must dedupe.
    expect(countMentions(promptText, 'never draw:')).toBe(1);
    const rule = promptText.split('Never draw:')[1].split('\n')[0];
    expect(countMentions(rule, 'cape')).toBe(1);
    expect(rule).toContain('beard');
    expect(rule).toContain('glasses');
  });

  it('does not grow super-linearly with character count', () => {
    const one = buildV2Prompt(input(), mime).promptText.length;
    const three = buildV2Prompt(input({
      characters: [
        character(),
        character({ persona: persona({ id: 'b', name: 'Dane' }), profile: profile({ id: 'b', name: 'Dane' }), roleLabel: 'co-star' }),
        character({ persona: persona({ id: 'c', name: 'Mira' }), profile: profile({ id: 'c', name: 'Mira' }), roleLabel: 'villain' }),
      ],
    }), mime).promptText.length;

    // Three characters should cost well under 3x one character, because the
    // style contract, scene, and rules are shared.
    expect(three).toBeLessThan(one * 3);
  });
});

describe('buildV2Prompt — structured art direction', () => {
  it('uses structured fields when the writer supplied them', () => {
    const { promptText } = buildV2Prompt(input({
      beat: beat({
        art: {
          characters_present: ['hero'],
          subject: 'Kara',
          action: 'raises her blade overhead',
          environment: 'flooded cathedral ruins, ankle-deep water',
          camera: 'low angle, medium shot',
          lighting: 'hard rim light from a broken window',
          mood: 'defiant',
        },
      }),
    }), mime);

    expect(promptText).toContain('ACTION: raises her blade overhead');
    expect(promptText).toContain('SETTING: flooded cathedral ruins, ankle-deep water');
    expect(promptText).toContain('CAMERA: low angle, medium shot');
    // The prose scene must not also be emitted — that would be a second,
    // differently-worded description of the same panel.
    expect(promptText).not.toContain('thinking in silence');
  });

  it('falls back to the prose scene when art direction is absent', () => {
    const { promptText } = buildV2Prompt(input(), mime);
    expect(promptText).toContain('SCENE: Kara stands in the rain, thinking in silence');
  });
});

describe('buildV2Prompt — image ordering and payload', () => {
  it('emits each character image with its own labelled text block', () => {
    const { contents } = buildV2Prompt(input({
      characters: [character({
        outfitRefs: ['OUTFITREF'],
        emblem: { image: 'EMBLEM', placement: 'left chest' },
        weapon: { image: 'WEAPON', description: 'curved silver blade' },
      })],
    }), mime);

    const images = contents.filter(c => 'inlineData' in c);
    expect(images).toHaveLength(4); // portrait + outfit + emblem + weapon

    // Every image must be immediately preceded by a text block that explains it.
    contents.forEach((part, i) => {
      if ('inlineData' in part) {
        expect(contents[i - 1]).toHaveProperty('text');
      }
    });
  });

  it('caps costume references at one to avoid diluting the portrait', () => {
    const { contents } = buildV2Prompt(input({
      characters: [character({ outfitRefs: ['A', 'B', 'C', 'D'] })],
    }), mime);
    expect(contents.filter(c => 'inlineData' in c)).toHaveLength(2); // portrait + 1 outfit
  });

  it('labels a model sheet differently from a raw portrait', () => {
    const sheet = buildV2Prompt(input({
      characters: [character({ isModelSheet: true })],
    }), mime).promptText;
    expect(sheet).toContain('model sheet');
    expect(sheet).toContain('several angles');
  });

  it('scopes continuity images away from faces', () => {
    const { promptText } = buildV2Prompt(input({
      sceneContext: [{ base64: 'PREV', label: 'Previous page:' }],
    }), mime);
    expect(promptText).toContain('background, palette, and lighting only');
    expect(promptText).toContain('Do not take faces, hair, or skin from these');
  });
});

describe('buildV2Prompt — rules', () => {
  it('emits locked attributes once per character', () => {
    const { promptText } = buildV2Prompt(input({
      characters: [character({
        locks: { characterId: 'hero-1', lockFace: true, lockOutfit: true, lockWeapon: false, lockEmblem: false },
      })],
    }), mime);
    expect(countMentions(promptText, 'is locked')).toBe(1);
    expect(promptText).toContain('face, costume is locked');
  });

  it('names preserved and regenerated characters when partially rerolling', () => {
    const { promptText } = buildV2Prompt(input({
      preserveImage: 'EXISTING',
      characters: [
        character({ isPreserved: true }),
        character({ persona: persona({ id: 'b', name: 'Dane' }), profile: profile({ id: 'b', name: 'Dane' }), roleLabel: 'co-star' }),
      ],
    }), mime);
    expect(promptText).toContain('Copy these characters unchanged from the existing panel: KARA VANCE');
    expect(promptText).toContain('Redraw these to match their CAST references: DANE');
  });

  it('softens the match rule at low consistency strength', () => {
    const hard = buildV2Prompt(input({ consistencyStrength: 1.0 }), mime).promptText;
    const soft = buildV2Prompt(input({ consistencyStrength: 0.4 }), mime).promptText;
    expect(hard).toContain('must match its CAST reference exactly');
    expect(soft).toContain('recognisably the same person');
    // Low strength also uses the brief descriptor, so it must be shorter.
    expect(soft.length).toBeLessThan(hard.length);
  });

  it('omits disambiguation for a single character', () => {
    const { promptText } = buildV2Prompt(input(), mime);
    expect(promptText).not.toContain('Keep these characters distinct');
  });

  it('carries the user reroll instruction verbatim', () => {
    const { promptText } = buildV2Prompt(input({ instruction: 'make it rain harder' }), mime);
    expect(promptText).toContain('"make it rain harder"');
  });
});

describe('buildV2Prompt — reroll paths', () => {
  it('keeps character descriptions when cast images are suppressed', () => {
    const { promptText, contents } = buildV2Prompt(input({
      suppressCastImages: true,
      characters: [character({
        outfitRefs: ['OUTFIT'],
        emblem: { image: 'EMB', placement: 'left chest' },
      })],
    }), mime);

    // "Use only selected refs" swaps the pictures, not the identities.
    // Dropping the descriptions left rerolls with no idea who they were drawing.
    expect(promptText).toContain('KARA VANCE');
    expect(promptText).toContain('pale grey');
    expect(contents.filter(c => 'inlineData' in c)).toHaveLength(0);
    expect(promptText).toContain('reference images supplied at the end');
  });

  it('sends a face close-up alongside a model sheet', () => {
    const { promptText, contents } = buildV2Prompt(input({
      characters: [character({ isModelSheet: true, facePortrait: 'PORTRAIT' })],
    }), mime);

    // A wide multi-figure sheet gives each face few pixels after downsampling;
    // the portrait carries facial detail the sheet cannot.
    expect(promptText).toContain('model sheet');
    expect(promptText).toContain('face close-up');
    expect(contents.filter(c => 'inlineData' in c)).toHaveLength(2);
  });

  it('does not send a face close-up when there is no model sheet', () => {
    const { promptText } = buildV2Prompt(input({
      characters: [character({ isModelSheet: false, facePortrait: 'PORTRAIT' })],
    }), mime);
    // Without a sheet, referenceImage IS the portrait — sending it twice is the
    // duplication this assembler exists to prevent.
    expect(promptText).not.toContain('face close-up');
  });

  it('carries reroll instructions without bracket notation', () => {
    // Gemini renders [BRACKETED] tokens literally as captions and speech
    // bubbles (learned in Session 30). Reroll instructions must stay prose.
    const instruction = 'Redraw only the characters, matching their cast references more closely.';
    const { promptText } = buildV2Prompt(input({ instruction }), mime);
    expect(promptText).toContain(instruction);
    expect(promptText).not.toMatch(/[[A-Z][A-Z _-]{4,}]/);
  });
});

describe('buildV2Prompt — page types', () => {
  it('suppresses all lettering on an overlay cover', () => {
    const { promptText } = buildV2Prompt(input({
      type: 'cover',
      storyContext: storyContext({ useOverlayLogo: true }),
    }), mime);
    expect(promptText).toContain('Draw no text, letters, or logos anywhere');
    expect(promptText).not.toContain('ARIA OF TWILIGHT');
  });

  it('letters the series title on a non-overlay cover', () => {
    const { promptText } = buildV2Prompt(input({
      type: 'cover',
      storyContext: storyContext({ useOverlayLogo: false }),
    }), mime);
    expect(promptText).toContain('ARIA OF TWILIGHT');
    expect(promptText).toContain('#1');
  });

  it('omits caption and dialogue from a back cover', () => {
    const { promptText } = buildV2Prompt(input({
      type: 'back_cover',
      beat: beat({ caption: 'She fell.', dialogue: 'No!' }),
    }), mime);
    expect(promptText).not.toContain('She fell.');
    expect(promptText).toContain('NEXT ISSUE SOON');
  });

  it('letters caption and dialogue exactly once on a story page', () => {
    const { promptText } = buildV2Prompt(input({
      beat: beat({ caption: 'She fell.', dialogue: 'No!' }),
    }), mime);
    expect(countMentions(promptText, 'She fell.')).toBe(1);
    expect(countMentions(promptText, 'No!')).toBe(1);
  });
});
