/**
 * localStorage-backed {@link DataRepository} — **browser dev / tests only**.
 *
 * The APK never uses this (see `data/index.ts`, which picks SQLite on a native
 * platform). It exists so `npm run dev` and the vitest suite keep working
 * without a device or the jeep-sqlite WASM rig. Same generic document-store
 * semantics as `SqliteRepository`, minus encryption.
 *
 * If `localStorage` is unavailable (private mode, some jsdom configs) it
 * transparently degrades to an in-memory map so nothing throws.
 */
import type { DataRepository, EntityName, ListOptions, LocalDoc, WhereFilter } from './types';
import { applyQuery, generateId, makeDoc } from './query';

const PREFIX = 'pathlab:';

type Store = Record<string, Record<string, unknown>>;

export class WebRepository implements DataRepository {
  private memory = new Map<EntityName, Store>();
  private listeners = new Map<EntityName, Set<(docs: LocalDoc[]) => void>>();
  /** Error callbacks registered alongside listeners (see `subscribe`). */
  private failures = new Map<EntityName, Set<(error: unknown) => void>>();
  private ready: Promise<void> | null = null;

  private get storage(): Storage | null {
    try {
      const probe = '__pathlab_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch {
      return null;
    }
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = Promise.resolve();
    return this.ready;
  }

  private readStore(entity: EntityName): Store {
    if (this.memory.has(entity)) return this.memory.get(entity)!;
    const storage = this.storage;
    let store: Store = {};
    if (storage) {
      try {
        const raw = storage.getItem(PREFIX + entity);
        if (raw) store = JSON.parse(raw) as Store;
      } catch {
        store = {};
      }
    }
    this.memory.set(entity, store);
    return store;
  }

  private writeStore(entity: EntityName, store: Store): void {
    this.memory.set(entity, store);
    const storage = this.storage;
    if (storage) {
      try {
        storage.setItem(PREFIX + entity, JSON.stringify(store));
      } catch {
        // Quota / private mode — memory copy already updated.
      }
    }
  }

  private toDocs(entity: EntityName): LocalDoc[] {
    const store = this.readStore(entity);
    return Object.keys(store).map(id => makeDoc(id, store[id]));
  }

  async list(entity: EntityName, options: ListOptions = {}): Promise<LocalDoc[]> {
    return applyQuery(this.toDocs(entity), options);
  }

  async get(entity: EntityName, id: string): Promise<LocalDoc | null> {
    const store = this.readStore(entity);
    return store[id] ? makeDoc(id, store[id]) : null;
  }

  async set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void> {
    const store = this.readStore(entity);
    store[id] = value;
    this.writeStore(entity, store);
    await this.emit(entity);
  }

  async add(entity: EntityName, value: Record<string, unknown>): Promise<string> {
    const id = (value.id as string) || generateId();
    await this.set(entity, id, value);
    return id;
  }

  async update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void> {
    const store = this.readStore(entity);
    store[id] = { ...(store[id] ?? {}), ...patch };
    this.writeStore(entity, store);
    await this.emit(entity);
  }

  async delete(entity: EntityName, id: string): Promise<void> {
    const store = this.readStore(entity);
    delete store[id];
    this.writeStore(entity, store);
    await this.emit(entity);
  }

  async count(entity: EntityName, where?: WhereFilter[]): Promise<number> {
    return applyQuery(this.toDocs(entity), { where }).length;
  }

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
    // The empty replay keeps the contract every page relies on (a subscriber is
    // always called back, so nothing can sit in "loading"); the error callback is
    // what stops that empty list being read as "the lab has no records".
    try {
      cb(this.toDocs(entity));
    } catch (error) {
      onError?.(error);
      cb([]);
    }
    return () => {
      set?.delete(cb);
      if (onError) this.failures.get(entity)?.delete(onError);
    };
  }

  private async emit(entity: EntityName): Promise<void> {
    const set = this.listeners.get(entity);
    if (!set || set.size === 0) return;
    // A localStorage write can be refused (quota, private mode); the listeners
    // must learn that the collection they are showing may no longer match disk.
    try {
      const docs = this.toDocs(entity);
      set.forEach(cb => cb(docs));
    } catch (error) {
      this.failures.get(entity)?.forEach(cb => cb(error));
    }
  }

  async transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void> {
    await fn(this);
  }

  async clearAll(): Promise<void> {
    const entities: EntityName[] = [
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
    for (const entity of entities) {
      this.writeStore(entity, {});
      await this.emit(entity);
    }
  }
}
