import { describe, it, expect, beforeEach } from 'vitest';
import { DesktopRepository } from './desktopRepository';
import type { DesktopBridge } from '../lib/desktop-bridge';

/**
 * P0.4 / P0.5 — the desktop `transaction()` is a real atomic unit.
 *
 * The repository is exercised against a fake Electron bridge that mimics the
 * main process: whole-collection JSON rows, a `save` for single writes and a
 * `commit` that applies several collections as ONE all-or-nothing batch. We
 * assert the properties the fix exists to guarantee, not the implementation:
 * a transaction issues exactly one commit and never a per-collection save; and
 * any failure — in the body or at commit — leaves the database untouched.
 */

type Collections = Map<string, string>;

function makeBridge(failCommitOn?: (entity: string) => boolean) {
  const collections: Collections = new Map();
  const calls = {
    saves: [] as string[],
    commits: 0,
    committedEntities: [] as string[],
  };
  const bridge = {
    kind: 'desktop',
    version: 'test',
    db: {
      init: async () => {},
      load: async (entity: string) => collections.get(entity) ?? null,
      save: async (entity: string, json: string) => {
        calls.saves.push(entity);
        collections.set(entity, json);
      },
      clear: async () => {
        collections.clear();
      },
      commit: async (entries: Array<{ entity: string; json: string }>) => {
        calls.commits += 1;
        calls.committedEntities.push(...entries.map(e => e.entity));
        // The main process runs this inside BEGIN/COMMIT: a refusal applies
        // NOTHING, so model that here by throwing before the writes.
        if (failCommitOn && entries.some(e => failCommitOn(e.entity))) {
          throw new Error('commit refused');
        }
        for (const e of entries) collections.set(e.entity, e.json);
      },
    },
  } as unknown as DesktopBridge;
  return { bridge, collections, calls };
}

async function withRepo(failCommitOn?: (entity: string) => boolean) {
  const b = makeBridge(failCommitOn);
  window.pathomitraDesktop = b.bridge;
  const repo = new DesktopRepository();
  await repo.init();
  return { repo, ...b };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  delete window.pathomitraDesktop;
});

describe('DesktopRepository.transaction (P0.4)', () => {
  it('buffers every write and issues ONE commit — never a per-collection save', async () => {
    const { repo, calls, collections } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('patients', 'p1', { name: 'Asha' });
      await tx.set('patients', 'p2', { name: 'Bilal' });
      await tx.set('reports', 'r1', { status: 'final' });
    });

    expect(calls.commits).toBe(1);
    expect(calls.saves).toEqual([]);
    expect([...calls.committedEntities].sort()).toEqual(['patients', 'reports']);

    const patients = JSON.parse(collections.get('patients') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(patients).sort()).toEqual(['p1', 'p2']);
    const p = await repo.get('patients', 'p1');
    expect(p?.data()).toMatchObject({ name: 'Asha' });
  });

  it('discards all buffered writes when the body throws — the database is untouched', async () => {
    const { repo, calls, collections } = await withRepo();
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'X' });
        await tx.set('reports', 'r1', { status: 'final' });
        throw new Error('domain check failed');
      }),
    ).rejects.toThrow('domain check failed');

    expect(calls.commits).toBe(0);
    expect(calls.saves).toEqual([]);
    expect(collections.size).toBe(0);
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('leaves the cache intact when the atomic commit itself fails', async () => {
    const { repo } = await withRepo(entity => entity === 'reports');
    await expect(
      repo.transaction(async tx => {
        await tx.set('patients', 'p1', { name: 'Asha' });
        await tx.set('reports', 'r1', { status: 'final' });
      }),
    ).rejects.toThrow('commit refused');
    // Nothing was promoted, so a later read sees the pre-transaction store (empty).
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('applies a report-amendment pair (history row + live report) together', async () => {
    const { repo, calls, collections } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('reportVersions', 'r1:v1', { snapshot: 'old' });
      await tx.update('reports', 'r1', { status: 'final', version: 2 });
    });
    expect(calls.commits).toBe(1);
    expect(collections.has('reportVersions')).toBe(true);
    expect(collections.has('reports')).toBe(true);
  });

  it('a nested transaction joins the open one instead of flushing early', async () => {
    const { repo, calls } = await withRepo();
    await repo.transaction(async tx => {
      await tx.set('patients', 'p1', { name: 'Asha' });
      await repo.transaction(async inner => {
        await inner.set('reports', 'r1', { status: 'final' });
      });
    });
    expect(calls.commits).toBe(1);
    expect([...calls.committedEntities].sort()).toEqual(['patients', 'reports']);
  });

  it('never notifies a listener with a partial transaction', async () => {
    const { repo } = await withRepo();
    const snapshots: string[][] = [];
    const unsub = repo.subscribe('patients', docs => snapshots.push(docs.map(d => d.id).sort()));
    await tick(); // let the subscribe's initial async replay settle

    await repo.transaction(async tx => {
      await tx.set('patients', 'p1', { name: 'A' });
      await tx.set('patients', 'p2', { name: 'B' });
    });
    await tick(); // let the post-commit emit settle
    unsub();

    // Any view that shows p1 must show both — a mid-transaction emit would have
    // shown exactly one, which the suppressed-listeners design forbids.
    for (const snap of snapshots) {
      if (snap.includes('p1')) expect(snap).toEqual(['p1', 'p2']);
    }
    expect(snapshots).toContainEqual(['p1', 'p2']);
  });
});
