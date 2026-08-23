/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for per-session snapshot storage.
 *
 * Runs against fake-indexeddb so the real persistence path is exercised rather
 * than a mock of it — the bugs worth catching here (a snapshot that silently
 * fails to save, a delete that leaves the record behind) only show up against
 * a real IndexedDB implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  saveSnapshot,
  loadSnapshot,
  deleteSnapshot,
  listSnapshotIds,
  pruneSnapshots,
  closeSnapshotDB,
} from './sessionSnapshots';

const draft = (over: Record<string, unknown> = {}) => ({
  comicFaces: [{ id: 'page-1', type: 'story', choices: [], pageIndex: 1, imageUrl: 'data:image/png;base64,AAA' }],
  hero: { id: 'h', name: 'Kara Vance', base64: 'AAA', desc: '' },
  friend: null,
  additionalCharacters: [],
  storyContext: { title: 'First Light', artStyle: 'Modern American Comic' },
  selectedGenre: 'Superhero Action',
  ...over,
});

describe('sessionSnapshots', () => {
  beforeEach(async () => {
    closeSnapshotDB();
    const ids = await listSnapshotIds();
    for (const id of ids.data ?? []) await deleteSnapshot(id);
  });

  it('round-trips a snapshot', async () => {
    const saved = await saveSnapshot('sess-1', draft());
    expect(saved.success).toBe(true);
    expect(saved.data?.size).toBeGreaterThan(0);

    const loaded = await loadSnapshot('sess-1');
    expect(loaded.success).toBe(true);
    expect(loaded.data).toMatchObject({
      storyContext: { title: 'First Light' },
      selectedGenre: 'Superhero Action',
    });
  });

  it('overwrites rather than duplicating on re-save', async () => {
    await saveSnapshot('sess-1', draft({ selectedGenre: 'Classic Horror' }));
    await saveSnapshot('sess-1', draft({ selectedGenre: 'High Fantasy' }));

    const loaded = await loadSnapshot('sess-1');
    expect((loaded.data as Record<string, unknown>).selectedGenre).toBe('High Fantasy');
    expect((await listSnapshotIds()).data).toEqual(['sess-1']);
  });

  it('reports a missing snapshot distinctly, so the UI can explain itself', async () => {
    const loaded = await loadSnapshot('never-saved');
    expect(loaded.success).toBe(false);
    // The UI branches on this exact reason to tell the user the session predates
    // snapshots, rather than showing a generic failure.
    expect(loaded.error).toBe('no snapshot stored for this session');
  });

  it('deletes a snapshot', async () => {
    await saveSnapshot('sess-1', draft());
    expect((await deleteSnapshot('sess-1')).success).toBe(true);
    expect((await loadSnapshot('sess-1')).success).toBe(false);
  });

  it('rejects a non-serializable snapshot instead of storing garbage', async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = await saveSnapshot('sess-circular', circular);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not serializable');
  });

  it('requires a session id', async () => {
    expect((await saveSnapshot('', draft())).success).toBe(false);
    expect((await loadSnapshot('')).success).toBe(false);
    expect((await deleteSnapshot('')).success).toBe(false);
  });

  it('prunes snapshots whose session row is gone', async () => {
    await saveSnapshot('keep-1', draft());
    await saveSnapshot('keep-2', draft());
    await saveSnapshot('orphan-1', draft());
    await saveSnapshot('orphan-2', draft());

    const pruned = await pruneSnapshots(['keep-1', 'keep-2']);
    expect(pruned.success).toBe(true);
    expect(pruned.data).toBe(2);

    const remaining = (await listSnapshotIds()).data ?? [];
    expect(remaining.sort()).toEqual(['keep-1', 'keep-2']);
  });

  it('keeps everything when pruning against the full id list', async () => {
    await saveSnapshot('a', draft());
    await saveSnapshot('b', draft());
    const pruned = await pruneSnapshots(['a', 'b']);
    expect(pruned.data).toBe(0);
    expect(((await listSnapshotIds()).data ?? []).length).toBe(2);
  });

  it('prunes everything when no sessions remain', async () => {
    await saveSnapshot('a', draft());
    const pruned = await pruneSnapshots([]);
    expect(pruned.data).toBe(1);
    expect((await listSnapshotIds()).data).toEqual([]);
  });
});
