/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-session full-state snapshots, stored in IndexedDB.
 *
 * The Recent Sessions list previously held metadata only — title, mode, page
 * count, thumbnail — so there was nothing to restore even once the rows were
 * made clickable. This is the missing half: the actual comic state, keyed by
 * session id.
 *
 * Why a dedicated module rather than reusing what exists:
 *  - `utils/indexedDBStorage.ts` is image-oriented (one store, `saveImage`/
 *    `getImage`) and adding a sibling store means bumping the version of a DB
 *    that already holds user data. A separate database carries no such risk.
 *  - `hooks/useAutoSave.ts` autosaves a single value under a fixed key. It can
 *    load and clear *its own* key, but cannot read or delete another session's
 *    entry, which is exactly what a session list needs.
 *
 * Snapshots contain base64 images and routinely run to tens of megabytes, so
 * localStorage is not an option.
 */

const DB_NAME = 'InfiniteHeroesSessionsDB';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

/**
 * Snapshots hold whatever the draft serializer produces. Deliberately loose:
 * this module is storage, and pinning the shape here would mean updating two
 * places every time a field is added to a draft.
 */
export type SessionSnapshot = Record<string, unknown>;

/**
 * Reserved key for the persisted cast.
 *
 * The cast used to live in localStorage, which caps at ~5MB. Portraits,
 * reference images, emblems, weapons, and (since model sheets landed) a
 * multi-megabyte turnaround per character do not fit, so the app fell back to
 * deleting images to keep the text — meaning a returning user's characters had
 * no reference art at all, and generation silently degraded to text-only
 * descriptions. IndexedDB has no such ceiling.
 *
 * Excluded from pruning: it is not a session and has no session row.
 */
export const CAST_SNAPSHOT_KEY = '__cast__';

export interface SnapshotResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

interface SnapshotRecord {
  sessionId: string;
  snapshot: SessionSnapshot;
  savedAt: number;
  /** Approximate serialized size in bytes, for diagnostics and quota reporting. */
  size: number;
}

let dbInstance: IDBDatabase | null = null;

const isAvailable = (): boolean => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
};

/** Open (and if needed create) the snapshots database. */
async function openDB(): Promise<IDBDatabase | null> {
  if (dbInstance) return dbInstance;
  if (!isAvailable()) return null;

  return new Promise(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      // A version change from another tab invalidates this handle.
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Run one transaction, resolving to a uniform result rather than throwing. */
function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  map: (raw: unknown) => T,
): Promise<SnapshotResult<T>> {
  return openDB().then(db => {
    if (!db) return { success: false, error: 'IndexedDB unavailable' };

    return new Promise<SnapshotResult<T>>(resolve => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE_NAME, mode);
      } catch (e) {
        resolve({ success: false, error: String(e) });
        return;
      }
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve({ success: true, data: map(request.result) });
      request.onerror = () => resolve({ success: false, error: String(request.error) });
      tx.onabort = () => resolve({ success: false, error: String(tx.error ?? 'transaction aborted') });
    });
  });
}

/**
 * Store (or replace) the snapshot for a session.
 * Never throws — a failed snapshot must not interrupt comic generation.
 */
export async function saveSnapshot(
  sessionId: string,
  snapshot: SessionSnapshot,
): Promise<SnapshotResult<{ size: number }>> {
  if (!sessionId) return { success: false, error: 'sessionId is required' };

  let size = 0;
  try {
    size = JSON.stringify(snapshot).length;
  } catch (e) {
    // Circular or non-serializable state would also break structured clone.
    return { success: false, error: `snapshot not serializable: ${String(e)}` };
  }

  const record: SnapshotRecord = { sessionId, snapshot, savedAt: Date.now(), size };
  const result = await withStore('readwrite', store => store.put(record), () => ({ size }));
  return result.success ? { success: true, data: { size } } : result as SnapshotResult<{ size: number }>;
}

/** Retrieve a session's snapshot, or report that none exists. */
export async function loadSnapshot(sessionId: string): Promise<SnapshotResult<SessionSnapshot>> {
  if (!sessionId) return { success: false, error: 'sessionId is required' };

  const result = await withStore(
    'readonly',
    store => store.get(sessionId),
    raw => (raw as SnapshotRecord | undefined)?.snapshot,
  );

  if (!result.success) return result;
  if (!result.data) return { success: false, error: 'no snapshot stored for this session' };
  return { success: true, data: result.data };
}

/** Remove a session's snapshot. Called when the session is deleted. */
export async function deleteSnapshot(sessionId: string): Promise<SnapshotResult> {
  if (!sessionId) return { success: false, error: 'sessionId is required' };
  const result = await withStore('readwrite', store => store.delete(sessionId), () => undefined);
  return result.success ? { success: true } : result;
}

/** Every session id that currently has a snapshot. */
export async function listSnapshotIds(): Promise<SnapshotResult<string[]>> {
  return withStore(
    'readonly',
    store => store.getAllKeys(),
    raw => (raw as IDBValidKey[]).map(String).filter(id => id !== CAST_SNAPSHOT_KEY),
  );
}

/**
 * Delete snapshots whose session no longer exists.
 *
 * Sessions can be removed while a tab is closed, or the metadata store can be
 * cleared independently; without this the snapshots outlive their rows and the
 * database grows without bound.
 *
 * @param keepIds Session ids that should be retained
 * @returns How many orphaned snapshots were removed
 */
export async function pruneSnapshots(keepIds: string[]): Promise<SnapshotResult<number>> {
  const listed = await listSnapshotIds();
  if (!listed.success || !listed.data) return { success: false, error: listed.error };

  const keep = new Set(keepIds);
  // The cast is not a session; pruning it would delete the user's characters.
  const orphans = listed.data.filter(id => id !== CAST_SNAPSHOT_KEY && !keep.has(id));

  let removed = 0;
  for (const id of orphans) {
    const result = await deleteSnapshot(id);
    if (result.success) removed++;
  }
  return { success: true, data: removed };
}

/** Close the cached handle. Exposed for tests and teardown. */
export function closeSnapshotDB(): void {
  dbInstance?.close();
  dbInstance = null;
}
