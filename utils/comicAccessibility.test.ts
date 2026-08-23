/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for comic accessibility helpers.
 *
 * These guard the property that matters: a screen-reader user must be able to
 * learn what is in a panel and follow the story, and must never be told
 * something the page does not actually contain.
 */

import { describe, it, expect } from 'vitest';
import { describeFace, buildScript, scriptToText, generationAnnouncement } from './comicAccessibility';
import type { ComicFace, Persona } from '../types';

const hero: Persona = { id: 'h', name: 'Kara Vance', base64: '', desc: '' };
const friend: Persona = { id: 'f', name: 'Dane', base64: '', desc: '' };
const cast = { hero, friend, others: [] };

const face = (over: Partial<ComicFace> = {}): ComicFace => ({
  id: 'page-1',
  type: 'story',
  choices: [],
  pageIndex: 1,
  ...over,
});

describe('describeFace', () => {
  it('describes the scene, caption, and speaker', () => {
    const alt = describeFace(face({
      imageUrl: 'x',
      narrative: {
        scene: 'Kara stands in flooded ruins',
        caption: 'The rain had not stopped.',
        dialogue: 'We finish it tonight.',
        focus_char: 'hero',
        choices: [],
      },
    }), cast);

    expect(alt).toContain('Page 1');
    expect(alt).toContain('Kara stands in flooded ruins');
    expect(alt).toContain('Caption: The rain had not stopped');
    expect(alt).toContain('Kara Vance says: We finish it tonight');
  });

  it('prefers structured art direction over prose', () => {
    const alt = describeFace(face({
      narrative: {
        scene: 'unused prose',
        choices: [],
        focus_char: 'hero',
        art: {
          characters_present: ['hero'],
          subject: 'Kara',
          action: 'raises her blade',
          environment: 'flooded ruins',
        },
      },
    }), cast);
    expect(alt).toContain('Kara raises her blade in flooded ruins');
    expect(alt).not.toContain('unused prose');
  });

  it('resolves the co-star role to a real name', () => {
    const alt = describeFace(face({
      narrative: { scene: 's', dialogue: 'Behind you!', focus_char: 'friend', choices: [] },
    }), cast);
    expect(alt).toContain('Dane says');
    // The internal role key must never leak into user-facing text.
    expect(alt).not.toContain('friend says');
  });

  it('reports loading and failed states honestly', () => {
    expect(describeFace(face({ isLoading: true }), cast)).toContain('still generating');
    expect(describeFace(face({ hasFailed: true }), cast)).toContain('could not be generated');
  });

  it('labels covers rather than calling them pages', () => {
    expect(describeFace(face({ type: 'cover', pageIndex: 0 }), cast)).toContain('Comic cover');
    expect(describeFace(face({ type: 'back_cover' }), cast)).toContain('Back cover');
  });

  it('announces available choices', () => {
    const alt = describeFace(face({
      narrative: { scene: 's', focus_char: 'hero', choices: [] },
      choices: ['Confront him', 'Slip away'],
    }), cast);
    expect(alt).toContain('Choices: Confront him; or Slip away');
  });
});

describe('buildScript', () => {
  it('orders pages by index regardless of array order', () => {
    const script = buildScript([
      face({ id: 'c', pageIndex: 2, narrative: { scene: 'second', focus_char: 'hero', choices: [] } }),
      face({ id: 'a', pageIndex: 1, narrative: { scene: 'first', focus_char: 'hero', choices: [] } }),
    ], cast);
    expect(script.map(e => e.scene)).toEqual(['first', 'second']);
  });

  it('marks pages whose art failed rather than pretending they rendered', () => {
    const script = buildScript([face({ hasFailed: true, narrative: undefined })], cast);
    expect(script[0].scene).toBe('[art failed to generate]');
  });

  it('records which choice the reader took', () => {
    const script = buildScript([face({
      narrative: { scene: 's', focus_char: 'hero', choices: [] },
      choices: ['Fight', 'Flee'],
      resolvedChoice: 'Flee',
    })], cast);
    expect(script[0].resolvedChoice).toBe('Flee');
  });
});

describe('scriptToText', () => {
  it('renders a readable transcript', () => {
    const text = scriptToText(buildScript([face({
      narrative: {
        scene: 'Kara stands in flooded ruins',
        caption: 'The rain had not stopped.',
        dialogue: 'We finish it tonight.',
        focus_char: 'hero',
        choices: [],
      },
    })], cast), 'First Light');

    expect(text).toContain('FIRST LIGHT');
    expect(text).toContain('PAGE 1');
    expect(text).toContain('CAPTION: The rain had not stopped');
    expect(text).toContain('KARA VANCE: "We finish it tonight"');
  });
});

describe('generationAnnouncement', () => {
  it('stays silent when nothing is happening', () => {
    expect(generationAnnouncement(null, false)).toBe('');
  });

  it('announces the current page, one-indexed for humans', () => {
    expect(generationAnnouncement({ current: 2, total: 6 }, true)).toBe('Generating page 3 of 6.');
  });

  it('announces completion', () => {
    expect(generationAnnouncement({ current: 6, total: 6 }, true)).toBe('Comic generation complete.');
  });
});
