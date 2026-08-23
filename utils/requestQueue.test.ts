/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for the promise API added to RequestQueue.
 *
 * This queue shipped unused for months; the generation loop ran raw sequential
 * awaits instead. These tests cover the two things that made it usable —
 * `submit()` and `updateOptions()` — so the wiring cannot silently regress.
 */

import { describe, it, expect } from 'vitest';
import { RequestQueue } from './requestQueue';

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const tick = () => new Promise(r => setTimeout(r, 0));

describe('RequestQueue.submit', () => {
  it('resolves with the work result', async () => {
    const q = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 1000 });
    await expect(q.submit(async () => 'done')).resolves.toBe('done');
  });

  it('rejects with the original error', async () => {
    const q = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 1000 });
    const boom = new Error('boom');
    await expect(q.submit(async () => { throw boom; })).rejects.toThrow('boom');
  });

  it('one failure does not prevent other work from completing', async () => {
    const q = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 1000 });
    const results = await Promise.allSettled([
      q.submit(async () => { throw new Error('nope'); }),
      q.submit(async () => 'ok'),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: 'ok' });
  });

  it('honours the concurrency cap', async () => {
    const q = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 1000 });
    let active = 0;
    let peak = 0;
    const gates = [defer<void>(), defer<void>(), defer<void>(), defer<void>()];

    const work = (i: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await gates[i].promise;
      active--;
      return i;
    };

    const all = Promise.all(gates.map((_, i) => q.submit(work(i))));
    await tick();

    // Only two may be in flight regardless of how many were submitted.
    expect(peak).toBe(2);

    gates.forEach(g => g.resolve());
    await expect(all).resolves.toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });
});

describe('RequestQueue.updateOptions', () => {
  it('raising concurrency lets more work start', async () => {
    const q = new RequestQueue({ maxConcurrent: 1, maxPerMinute: 1000 });
    let active = 0;
    let peak = 0;
    const gates = [defer<void>(), defer<void>(), defer<void>()];

    const work = (i: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await gates[i].promise;
      active--;
      return i;
    };

    const all = Promise.all(gates.map((_, i) => q.submit(work(i))));
    await tick();
    expect(peak).toBe(1);

    q.updateOptions({ maxConcurrent: 3 });
    await tick();
    expect(peak).toBe(3);

    gates.forEach(g => g.resolve());
    await all;
  });

  it('clamps nonsense values instead of deadlocking the queue', async () => {
    const q = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 1000 });
    q.updateOptions({ maxConcurrent: 0 });
    // A zero cap would stall forever; it must floor to 1 and still drain.
    await expect(q.submit(async () => 'still works')).resolves.toBe('still works');
  });

  it('leaves omitted fields unchanged', async () => {
    const q = new RequestQueue({ maxConcurrent: 1, maxPerMinute: 1000 });
    q.updateOptions({ maxPerMinute: 500 });
    let active = 0;
    let peak = 0;
    const gates = [defer<void>(), defer<void>()];
    const all = Promise.all(gates.map((_, i) => q.submit(async () => {
      active++; peak = Math.max(peak, active);
      await gates[i].promise;
      active--;
    })));
    await tick();
    expect(peak).toBe(1); // maxConcurrent untouched
    gates.forEach(g => g.resolve());
    await all;
  });
});
