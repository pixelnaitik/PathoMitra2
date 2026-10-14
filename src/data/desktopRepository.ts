/**
 * Electron-backed {@link DataRepository} — the desktop counterpart of the
 * APK's `SqliteRepository`.
 *
 * Query semantics are identical to {@link WebRepository} on purpose: the same
 * `applyQuery`/`makeDoc` helpers run in the renderer, so a filter or an
 * `orderBy` can never disagree between platforms — only *where the JSON
 * lives* changes. Reads are served from a renderer-side cache; every mutation
 * writes the collection back through the IPC bridge, where the main process
 * stores it in the SQLCipher file (`electron/db.ts`, key in Windows Credential
 * Manager). The renderer never sees the key or the raw file.
 *
 * v1 granularity is one row per collection (see electron/db.ts). If a lab's
 * report count ever makes whole-collection JSON writes heavy, the upgrade is
 * row-level statements in the main process — the DataRepository contract here
 * does not change.
 */
import { desktopBridge, type DesktopBridge } from '../lib/desktop-bridge';
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, makeDoc } from './query';

type Store = Record<string, Record<string, unknown>>;

const ALL_ENTITIES: EntityName[] = [
  'users',
  'patients',
  'doctors',
  'reports',
  'reportNotes',
  'reportVersions',
  'invoices',
  'labSettings',
  'notificationState',
  'meta',
];

export class DesktopRepository implements DataRepository {
  private bridge: DesktopBridge;
  private memory = new Map<EntityName, Promise<Store>>();
  private listeners = new Map<EntityName, Set<(docs: LocalDoc[]) => void>>();
  private ready: Promise<void> | null = null;
  /** Tail of the per-entity mutation chain (see `queue`). */
  private queues = new Map<EntityName, Promise<void>>();
  /** Error callbacks registered alongside listeners (see `subscribe`). */
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();
  /**
   * The active buffered transaction, or null when none is open. While set,
   * every write goes into the collection's in-memory `buffers` instead of
   * persisting, and listeners stay silent until the outcome is known — so
   * {@link transaction} commits the whole buffer set as ONE atomic
   * main-process write (`bridge.db.commit`) or not at all.
   */
  private tx: { buffers: Map<EntityName, Store>; touched: Set<EntityName> } | null = null;

  constructor() {
    const bridge = desktopBridge();
    if (!bridge) throw new Error('DesktopRepository requires the Electron bridge');
    this.bridge = bridge;
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.bridge.db.init();
    return this.ready;
  }

  /**
   * The collection's store, loaded once and cached for the session.
   *
   * A failed load is NOT cached as an empty store: the next mutation would
   * then persist `{}` + its own document over the collection and silently
   * destroy everything else in it. Dropping the cache entry on failure keeps
   * the error honest for the caller and lets a later call retry the read.
   */
  private store(entity: EntityName): Promise<Store> {
    let cached = this.memory.get(entity);
    if (!cached) {
      cached = this.bridge.db.load(entity).then(raw => (raw ? (JSON.parse(raw) as Store) : {}));
      cached = cached.catch((err: unknown) => {
        if (this.memory.get(entity) === cached) this.memory.delete(entity);
        throw err;
      });
      this.memory.set(entity, cached);
    }
    return cached;
  }

  private async persist(entity: EntityName, store: Store): Promise<void> {
    this.memory.set(entity, Promise.resolve(store));
    await this.bridge.db.save(entity, JSON.stringify(store));
  }

  /**
   * Run one mutation for `entity` after every mutation already queued for it.
   *
   * Whole-collection writes are read-copy-persist; two that interleave (a
   * report save racing a note write) would each copy the pre-mutation store
   * and the slower one would roll the faster one's document back out of the
   * database. Chaining per entity makes the read and its write atomic
   * against sibling mutations, and failures do not poison the chain.
   */
  private queue<T>(entity: EntityName, task: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(entity) ?? Promise.resolve();
    const run = prev.then(task, task);
    this.queues.set(
      entity,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async toDocs(entity: EntityName): Promise<LocalDoc[]> {
    const store = await this.store(entity);
    return Object.keys(store).map(id => makeDoc(id, store[id]));
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    return applyQuery(await this.toDocs(entity), options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    const store = await this.store(entity);
    return store[id] ? makeDoc(id, store[id]) : null;
  }

  /**
   * Apply one document-level mutation to `entity`.
   *
   * Outside a transaction the change is queued per entity (read-copy-persist,
   * then emit) exactly as before. Inside one (`this.tx` set) it mutates the
   * collection's working buffer instead: nothing reaches the database or the
   * listeners until {@link transaction} commits the whole buffer set atomically.
   * A later write to the same entity within the transaction reads the pending
   * buffer, so a merge sees the earlier one's change.
   */
  private async applyMutation(
    entity: EntityName,
    transform: (store: Store) => Store,
  ): Promise<void> {
    if (this.tx) {
      const base = this.tx.buffers.get(entity) ?? (await this.store(entity));
      this.tx.buffers.set(entity, transform({ ...base }));
      this.tx.touched.add(entity);
      return;
    }
    await this.queue(entity, async () => {
      const store = transform({ ...(await this.store(entity)) });
      await this.persist(entity, store);
      await this.emit(entity);
    });
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    await this.applyMutation(entity, store => {
      store[id] = value;
      return store;
    });
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    await this.applyMutation(entity, store => {
      store[id] = { ...(store[id] ?? {}), ...patch };
      return store;
    });
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    await this.applyMutation(entity, store => {
      delete store[id];
      return store;
    });
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return applyQuery(await this.toDocs(entity), { where }).length;
  }

  /**
   * Like the other two repositories, listeners fire after local mutations —
   * but the initial replay is async because the first read hits the main
   * process. Unsubscribe stays synchronous, matching Firestore's contract.
   */
  subscribe(
    entity: EntityName,
    cb: (docs: LocalDoc[]) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    let set = this.listeners.get(entity);
    if (!set) {
      set = new Set();
      this.listeners.set(entity, set);
    }
    set.add(cb);
    if (onError) {
      let failed = this.failures.get(entity);
      if (!failed) {
        failed = new Set();
        this.failures.set(entity, failed);
      }
      failed.add(onError);
    }
    // The first read is async — drop the replay if the caller already
    // unsubscribed (component gone). A failed first read replays an empty list
    // *and* reports the error: the UI must never hang in "loading", but an empty
    // list must never be presented as "the lab has no records" either.
    void this.toDocs(entity)
      .then(docs => {
        if (set?.has(cb)) cb(docs);
      })
      .catch(error => {
        if (set?.has(cb)) {
          onError?.(error);
          cb([]);
        }
      });
    return () => {
      set?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    try {
      const docs = await this.toDocs(entity);
      set.forEach(cb => cb(docs));
    } catch (error) {
      this.failures.get(entity)?.forEach(cb => cb(error));
    }
  }

  /**
   * Run several mutations as ONE atomic unit — the desktop counterpart of the
   * native store's SQLCipher transaction (P0.4/P0.5).
   *
   * The body's writes are buffered per collection (see `applyMutation`) and sent
   * through a single `bridge.db.commit`, which the main process runs inside one
   * SQLite BEGIN/COMMIT. A report amendment and its history row therefore land
   * together or not at all; a restore cannot half-apply. If the body throws, or
   * the commit fails, nothing was ever promoted into the cache and the database
   * received no partial batch — listeners re-read the unchanged state.
   *
   * Atomicity caveat kept honest: the localStorage (web/dev) adapter has no such
   * guarantee and says so in `webRepository.ts`; this method only makes the
   * desktop claim true, matching the native store.
   */
  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    // Nested call joins the open transaction rather than flushing it early.
    if (this.tx) {
      await fn(this);
      return;
    }
    // Let every queued mutation settle first so the buffer starts from committed
    // state, not a mid-write cache snapshot.
    await Promise.all(ALL_ENTITIES.map(entity => this.drain(entity)));

    const tx: { buffers: Map<EntityName, Store>; touched: Set<EntityName> } = {
      buffers: new Map(),
      touched: new Set(),
    };
    this.tx = tx;
    try {
      await fn(this);
      const entries = [...tx.buffers.entries()].map(([entity, store]) => ({
        entity,
        json: JSON.stringify(store),
      }));
      if (entries.length > 0) {
        await this.bridge.db.commit(entries);
        // Success: the committed stores become the new cache, so listeners re-read
        // exactly what persisted and any later write chains off them.
        for (const [entity, store] of tx.buffers) this.memory.set(entity, Promise.resolve(store));
      }
    } finally {
      this.tx = null;
      // Notify after the outcome is known — after a commit the rows are new; on a
      // throw the touched collections are re-read from the untouched database.
      for (const entity of tx.touched) await this.emit(entity);
    }
  }

  /** Resolve when every mutation queued for `entity` has settled. */
  private drain(entity: EntityName): Promise<void> {
    return (this.queues.get(entity) ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Drop every collection — "erase all data". Queued mutations are drained
   * first: a write still in the chain must not re-persist its stale store
   * (from the memory cache) after the database rows are gone.
   */
  async clearAll(): Promise<void> {
    await Promise.all(ALL_ENTITIES.map(entity => this.drain(entity)));
    await this.bridge.db.clear();
    for (const entity of ALL_ENTITIES) {
      await this.queue(entity, async () => {
        await this.persist(entity, {});
        await this.emit(entity);
      });
    }
  }
}
