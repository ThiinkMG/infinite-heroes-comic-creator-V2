/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression tests for the story-structure bugs found in the 2026-11-08
 * workflow review:
 *  - The beat and outline writers read a page length nothing ever set (stuck at
 *    6), so a 9-page issue was planned as 6 pages and ended early.
 *  - A fresh setup defaulted to 10 pages, which the dropdown doesn't offer, so it
 *    displayed "3 Pages" while generating 10.
 *  - Outline Mode marked decision pages, so automated stories stopped on choices
 *    the reader never shows.
 *  - Blank "+ Add Character" cards were analysed and written into the story.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getComicConfig, PAGE_LENGTHS, DEFAULT_PAGE_LENGTH, isCastMember } from './types';
import type { Persona } from './types';
import { useSettingsStore } from './stores/useSettingsStore';

const source = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe('getComicConfig decision pages', () => {
  it.each(PAGE_LENGTHS.map(l => l.value))('has no decision pages in Outline Mode (%i pages)', (pages) => {
    expect(getComicConfig(pages, 0, false).DECISION_PAGES).toEqual([]);
  });

  it('puts a decision after every spread in Novel Mode, and always on the last page', () => {
    expect(getComicConfig(6, 0, true).DECISION_PAGES).toEqual([2, 4, 6]);
    expect(getComicConfig(3, 0, true).DECISION_PAGES).toEqual([2, 3]);
    expect(getComicConfig(9, 0, true).DECISION_PAGES).toEqual([2, 4, 6, 8, 9]);
  });

  it('places the back cover right after the last story page', () => {
    const config = getComicConfig(9, 0, false);
    expect(config.MAX_STORY_PAGES).toBe(9);
    expect(config.BACK_COVER_PAGE).toBe(10);
  });
});

describe('page length has one source', () => {
  it('defaults to a length the dropdown actually offers', () => {
    expect(PAGE_LENGTHS.map(l => l.value)).toContain(DEFAULT_PAGE_LENGTH);
  });

  it('keeps no second copy of the page length in the settings store', () => {
    expect('selectedPageLength' in useSettingsStore.getState()).toBe(false);
  });

  it.each([
    'hooks/useGenerateBeat.ts',
    'hooks/useGenerateOutline.ts',
  ])('%s reads the length from storyContext', (file) => {
    const text = source(file);
    expect(text).not.toMatch(/selectedPageLength/);
    expect(text).toMatch(/getComicConfig\(storyContext\.pageLength/);
  });

  it('never hardcodes the old 10-page default', () => {
    expect(source('App.tsx')).not.toMatch(/pageLength:\s*10\b/);
    expect(source('hooks/useExportImport.ts')).not.toMatch(/pageLength:\s*10\b/);
  });
});

describe('isCastMember', () => {
  const blank: Persona = { id: 'x', name: 'Character 3', base64: '', desc: 'Additional Character', backstoryFiles: [] };

  it('excludes a freshly added blank card, even with its placeholder desc', () => {
    expect(isCastMember(blank)).toBe(false);
  });

  it('excludes a card with only whitespace in the description', () => {
    expect(isCastMember({ ...blank, backstoryText: '   ' })).toBe(false);
  });

  it('includes a character with a portrait, a description, or files', () => {
    expect(isCastMember({ ...blank, base64: 'data:image/png;base64,AAAA' })).toBe(true);
    expect(isCastMember({ ...blank, backstoryText: 'A retired detective.' })).toBe(true);
    expect(isCastMember({ ...blank, backstoryFiles: [{ base64: 'AA', mimeType: 'text/plain', name: 'bio.txt' }] })).toBe(true);
  });

  it('treats null and undefined as not in the cast', () => {
    expect(isCastMember(null)).toBe(false);
    expect(isCastMember(undefined)).toBe(false);
  });
});
