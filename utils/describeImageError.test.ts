/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describeImageError } from './describeImageError';

const ROOT = resolve(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', 'research', 'research_notes', 'reports', 'assets', '.git', '.claude', '.codex', 'config']);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });

describe('describeImageError', () => {
  it('explains the 404 a renamed or wrong-endpoint model returns', () => {
    const raw = 'ApiError: {"error":{"code":404,"message":"models/gemini-3-pro-image-preview is not found for API version v1beta, or is not supported for predict.","status":"NOT_FOUND"}}';
    expect(describeImageError(new Error(raw))).toMatch(/could not be found/);
  });

  it('explains a rejected key, rate limits, and safety blocks', () => {
    expect(describeImageError('{"error":{"code":403,"status":"PERMISSION_DENIED"}}')).toMatch(/key was rejected/);
    expect(describeImageError('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')).toMatch(/Rate limit/);
    expect(describeImageError('Response blocked: SAFETY')).toMatch(/safety filter/);
  });

  it('never returns raw JSON', () => {
    expect(describeImageError('{"error":{"code":418}}')).not.toMatch(/[{}]/);
  });
});

describe('model calls', () => {
  const files = sourceFiles(ROOT);

  it('never calls generateImages (Imagen\'s endpoint, 404s for Gemini image models)', () => {
    const offenders = files.filter(f => /\.generateImages\s*\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps every model ID in config/models.ts', () => {
    const offenders = files.filter(f => /['"](gemini-[0-9][^'"]*|claude-sonnet[^'"]*)['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
