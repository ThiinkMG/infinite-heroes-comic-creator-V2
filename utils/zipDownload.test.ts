/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for bundled downloads.
 *
 * "Download All" used to fire one `a.click()` per image. Browsers throttle or
 * silently drop a burst of programmatic downloads, so the user asked for an
 * issue and received an unpredictable subset of it. These cover the archive
 * construction; the anchor click itself is verified in the browser.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { buildZip, safeFileName } from './zipDownload';

// JSZip cannot consume a Blob under Node, so archives are read back via
// arrayBuffer(). The Blob path itself is exercised in the browser.

/** A 1x1 transparent PNG. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('safeFileName', () => {
  it('replaces characters that break on some filesystems', () => {
    expect(safeFileName('From Paris: With Love?.png')).toBe('From-Paris-With-Love.png');
  });

  it('preserves the extension', () => {
    expect(safeFileName('my file.jpeg')).toBe('my-file.jpeg');
  });

  it('never returns an empty stem', () => {
    expect(safeFileName('???.png')).toBe('file.png');
  });
});

describe('buildZip', () => {
  it('returns null when there is nothing to archive', async () => {
    expect(await buildZip([])).toBeNull();
    expect(await buildZip([{ name: 'a.png', data: '' }])).toBeNull();
  });

  it('skips entries with no data rather than writing empty files', async () => {
    const built = await buildZip([
      { name: 'good.png', data: PNG },
      { name: 'missing.png', data: '' },
    ]);
    expect(built!.names).toEqual(['good.png']);
  });

  it('deduplicates names that collide after sanitising', async () => {
    const built = await buildZip([
      { name: 'Page 01.png', data: PNG },
      { name: 'Page-01.png', data: PNG },
      { name: 'Page:01.png', data: PNG },
    ]);
    // All three sanitise to the same stem; each must still be extractable.
    expect(new Set(built!.names).size).toBe(3);
    expect(built!.names).toEqual(['Page-01.png', 'Page-01-2.png', 'Page-01-3.png']);
  });

  it('produces an archive whose entries decode back to the original bytes', async () => {
    const built = await buildZip([{ name: 'cover.png', data: PNG }]);
    const zip = await JSZip.loadAsync(await built!.blob.arrayBuffer());
    const bytes = await zip.file('cover.png')!.async('uint8array');
    // PNG magic number — proves the base64 survived the round trip intact.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('accepts bare base64 as well as data URLs', async () => {
    const bare = PNG.slice(PNG.indexOf(',') + 1);
    const built = await buildZip([{ name: 'bare.png', data: bare }]);
    const zip = await JSZip.loadAsync(await built!.blob.arrayBuffer());
    const bytes = await zip.file('bare.png')!.async('uint8array');
    expect(bytes[0]).toBe(0x89);
  });

  it('reports progress through both phases', async () => {
    const seen: string[] = [];
    await buildZip(
      [{ name: 'a.png', data: PNG }, { name: 'b.png', data: PNG }],
      p => seen.push(`${p.phase}:${p.current}/${p.total}`),
    );
    expect(seen).toEqual(['bundling:1/2', 'bundling:2/2', 'compressing:2/2']);
  });
});
