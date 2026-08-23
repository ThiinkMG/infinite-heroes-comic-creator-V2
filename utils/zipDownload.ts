/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bundle several images into one .zip download.
 *
 * "Download All" previously fired one `a.click()` per image in a loop. Browsers
 * treat a burst of programmatic downloads as abusive: Chrome prompts once for
 * "allow multiple downloads" and silently drops the rest if declined, Firefox
 * throttles them, and Safari generally delivers only the first. The user asked
 * for one action and got an unpredictable subset of files.
 *
 * One archive is one download, so none of that applies.
 */

import JSZip from 'jszip';

export interface ZipEntry {
  /** Filename inside the archive, including extension. */
  name: string;
  /** data: URL or bare base64. */
  data: string;
}

export interface ZipProgress {
  /** Entries added so far. */
  current: number;
  total: number;
  /** 'bundling' while adding files, 'compressing' while generating the archive. */
  phase: 'bundling' | 'compressing';
}

/** Strip a data: URL prefix, if present. */
const toBase64 = (data: string): string =>
  data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;

/** Make a filename safe across filesystems, preserving the extension. */
export const safeFileName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const cleaned = stem.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'file';
  return cleaned + ext;
};

/**
 * Ensure every entry has a distinct name.
 * Duplicate names inside a zip are legal but confusing, and some extractors
 * silently overwrite.
 */
const dedupeNames = (entries: ZipEntry[]): ZipEntry[] => {
  const seen = new Map<string, number>();
  return entries.map(e => {
    const base = safeFileName(e.name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) return { ...e, name: base };
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    return { ...e, name: `${stem}-${count + 1}${ext}` };
  });
};

/**
 * Build the archive. Separated from the download so it can be tested without a DOM.
 *
 * @returns The archive blob and the entry names it contains, or null if there
 *          was nothing usable to archive.
 */
export async function buildZip(
  entries: ZipEntry[],
  onProgress?: (p: ZipProgress) => void,
): Promise<{ blob: Blob; names: string[] } | null> {
  const usable = dedupeNames(entries.filter(e => e.data));
  if (usable.length === 0) return null;

  const zip = new JSZip();
  usable.forEach((entry, i) => {
    zip.file(entry.name, toBase64(entry.data), { base64: true });
    onProgress?.({ current: i + 1, total: usable.length, phase: 'bundling' });
  });

  onProgress?.({ current: usable.length, total: usable.length, phase: 'compressing' });

  // STORE rather than DEFLATE: PNG and JPEG are already compressed, so deflating
  // costs seconds of main-thread work for a percent or two of size.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, names: usable.map(u => u.name) };
}

/**
 * Build the archive and hand it to the browser as a single download.
 *
 * @returns How many entries made it into the archive.
 */
export async function downloadAsZip(
  entries: ZipEntry[],
  zipName: string,
  onProgress?: (p: ZipProgress) => void,
): Promise<number> {
  const built = await buildZip(entries, onProgress);
  if (!built) return 0;
  const { blob, names } = built;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return names.length;
}
