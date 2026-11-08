/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TONES } from '../types';
import {
  TONE_AUTO,
  resolveTone,
  toneLabel,
  formatStoryDriver,
  getArcPhase,
  getArcGuidance,
  getFinalePageInstruction,
  formatPacingPlan,
  formatAttachedText,
} from './storyBrief';

const toBase64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const source = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('tone', () => {
  it('resolves Auto from the genre, the same way every time', () => {
    expect(resolveTone('Lighthearted Comedy', TONE_AUTO)).toBe(TONES[2]);
    expect(resolveTone('Lighthearted Comedy', TONE_AUTO)).toBe(resolveTone('Lighthearted Comedy', undefined));
  });

  it('honours an explicit tone over the genre default', () => {
    expect(resolveTone('Classic Horror', TONES[5])).toBe(TONES[5]);
  });

  it('falls back for unknown tones and the Custom genre', () => {
    expect(resolveTone('Custom', 'not a tone')).toBe(TONES[0]);
  });

  it('labels tones for the dropdown', () => {
    expect(toneLabel(TONES[1])).toBe('Inner monologue');
  });
});

describe('formatStoryDriver', () => {
  it('keeps the tone for Custom stories', () => {
    const line = formatStoryDriver('Custom', 'A heist on the moon', TONES[2]);
    expect(line).toContain('A heist on the moon');
    expect(line).toContain(`TONE: ${TONES[2]}`);
  });

  it('uses genre and tone otherwise', () => {
    expect(formatStoryDriver('Dark Sci-Fi', '', TONES[1])).toBe(`GENRE: Dark Sci-Fi. TONE: ${TONES[1]}.`);
  });
});

describe('story arc scales to the issue length', () => {
  const phases = (n: number) => Array.from({ length: n }, (_, i) => getArcPhase(i + 1, n));

  it('3 pages: inciting, climax, finale', () => {
    expect(phases(3)).toEqual(['inciting', 'climax', 'finale']);
  });

  it('6 pages reach every phase', () => {
    expect(phases(6)).toEqual(['inciting', 'rising', 'rising', 'complication', 'climax', 'finale']);
  });

  it('9 pages climax on page 8, not only after page 8 regardless of length', () => {
    const p = phases(9);
    expect(p[0]).toBe('inciting');
    expect(p[7]).toBe('climax');
    expect(p[8]).toBe('finale');
    expect(p).toContain('complication');
  });

  it('gives guidance text for non-final pages only', () => {
    expect(getArcGuidance(2, 3)).toMatch(/CLIMAX/);
    expect(getArcGuidance(3, 3)).toBe('');
  });

  it('builds an outline pacing plan with one line per page', () => {
    const plan = formatPacingPlan(3).split('\n');
    expect(plan).toHaveLength(3);
    expect(plan[2]).toMatch(/Page 3: SLOW \(resolution/);
  });
});

describe('final page', () => {
  it('references the reader\'s actual choices', () => {
    const text = getFinalePageInstruction(['Trust the stranger']);
    expect(text).toContain('"Trust the stranger"');
    expect(text).not.toMatch(/PAGE 3/);
  });

  it('does not invent a choice when there were none (Outline Mode)', () => {
    const text = getFinalePageInstruction([]);
    expect(text).not.toMatch(/choice/i);
    expect(text).toContain('TO BE CONTINUED');
  });
});

describe('attached text files', () => {
  it('inlines .txt and .md content and skips images', () => {
    const text = formatAttachedText([
      { name: 'script.md', mimeType: '', base64: toBase64('# Act One\nThe café opens.') },
      { name: 'mood.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' },
    ], 'ATTACHED STORY DOCUMENT');
    expect(text).toContain('ATTACHED STORY DOCUMENT: script.md');
    expect(text).toContain('The café opens.');
    expect(text).not.toContain('mood.png');
  });

  it('accepts data-URL prefixed content', () => {
    const text = formatAttachedText([
      { name: 'a.txt', mimeType: 'text/plain', base64: `data:text/plain;base64,${toBase64('hello')}` },
    ], 'DOC');
    expect(text).toContain('hello');
  });

  it('truncates very long files', () => {
    const text = formatAttachedText([
      { name: 'novel.txt', mimeType: 'text/plain', base64: toBase64('x'.repeat(50_000)) },
    ], 'DOC');
    expect(text.length).toBeLessThan(16_000);
    expect(text).toContain('[…truncated]');
  });

  it('returns nothing for no files', () => {
    expect(formatAttachedText(undefined, 'DOC')).toBe('');
  });
});

describe('both writers share the brief', () => {
  it.each(['hooks/useGenerateBeat.ts', 'hooks/useGenerateOutline.ts'])('%s uses formatStoryDriver and attached text', (file) => {
    const text = source(file);
    expect(text).toMatch(/formatStoryDriver\(/);
    expect(text).toMatch(/formatAttachedText\(/);
    expect(text).toMatch(/resolveTone\(selectedGenre, storyContext\.tone\)/);
  });

  it('the app no longer picks a random tone', () => {
    expect(source('App.tsx')).not.toMatch(/setStoryTone/);
  });
});
