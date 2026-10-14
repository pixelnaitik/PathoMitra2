/**
 * A Firestore-shaped façade over the local {@link DataRepository}.
 *
 * Why this exists: six large pages call the Firestore API directly
 * (`collection`, `query`, `onSnapshot`, `writeBatch`, `getAggregateFromServer`,
 * …). Rewriting every call site by hand is high-risk and slow. This module
 * re-implements exactly the subset of that API the app uses, backed by the
 * encrypted on-device store, so pages migrate by swapping two import lines and
 * the Firebase SDK is gone entirely.
 *
 * It is intentionally a *compatibility shim*, not a re-implementation of
 * Firestore: queries are evaluated in memory (`data/query.ts`), `onSnapshot`
 * is a local observer, and server-only concepts (`serverTimestamp`,
 * `waitForPendingWrites`) resolve immediately against device state.
 */
import { getRepository } from './index';
import { applyQuery, generateId } from './query';
import type { EntityName, ListOptions, LocalDoc, WhereFilter, WhereOp } from './types';

// ---------------------------------------------------------------------------
// Reference / constraint shapes
// ---------------------------------------------------------------------------

export interface CollectionRef {
  __kind: 'collection';
  path: EntityName;
}
export interface DocRef {
  __kind: 'doc';
  path: EntityName;
  id: string;
}
export type Constraint =
  | { __c: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { __c: 'where'; field: string; op: WhereOp; value: WhereFilter['value'] }
  | { __c: 'limit'; n: number }
  | { __c: 'startAfter'; args: unknown[] };
export interface QueryRef {
  __kind: 'query';
  path: EntityName;
  constraints: Constraint[];
}

export type DocumentReference = DocRef;
export type QueryConstraint = Constraint;
export type WhereFilterOp = WhereOp;
/**
 * Mirrors Firestore's permissive `DocumentData` so existing call sites can read
 * `doc.data().someField` without casts. Values are `any` by design (this is a
 * compatibility surface; domain validation still happens in `lib/models.ts`).
 */

export type DocumentData = { [key: string]: any };
export interface SetOptions {
  merge?: boolean;
}

/** Stand-in for the Firestore instance; passed as the first arg by convention. */
export const db = { __kind: 'db' } as const;

const asEntity = (p: string): EntityName => p as EntityName;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function collection(_db: unknown, path: string): CollectionRef {
  return { __kind: 'collection', path: asEntity(path) };
}

/** Supports `doc(db, coll, id)`, `doc(collRef)`, and `doc(collRef, id)`. */
export function doc(...args: unknown[]): DocRef {
  const first = args[0] as { __kind?: string; path?: string };
  if (first && first.__kind === 'collection') {
    const id = (args[1] as string) || generateId();
    return { __kind: 'doc', path: asEntity(first.path as string), id };
  }
  const strings = args.slice(1).filter((a): a is string => typeof a === 'string');
  const path = asEntity(strings[0]);
  const id = strings[1] || generateId();
  return { __kind: 'doc', path, id };
}

export function query(coll: CollectionRef, ...constraints: Constraint[]): QueryRef {
  return { __kind: 'query', path: coll.path, constraints };
}

export function orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Constraint {
  return { __c: 'orderBy', field, dir };
}
export function where(field: string, op: WhereOp, value: WhereFilter['value']): Constraint {
  return { __c: 'where', field, op, value };
}
export function limit(n: number): Constraint {
  return { __c: 'limit', n };
}
export function startAfter(...args: unknown[]): Constraint {
  return { __c: 'startAfter', args };
}

function toListOptions(constraints: Constraint[]): ListOptions {
  const opts: ListOptions = { where: [] };
  for (const c of constraints) {
    if (c.__c === 'where') opts.where!.push({ field: c.field, op: c.op, value: c.value });
    else if (c.__c === 'orderBy') {
      opts.orderBy = c.field;
      opts.direction = c.dir;
    } else if (c.__c === 'limit') opts.limit = c.n;
    // startAfter is a no-op locally (client-side paging lives in the hook).
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface SnapshotMetadata {
  hasPendingWrites: boolean;
  fromCache: boolean;
  id: string;
}

/**
 * A document in a query result. Shaped like the slice of a Firestore
 * `QueryDocumentSnapshot` the app uses, so the `read*()` mappers accept it.
 */
export interface WrappedDoc {
  id: string;
  data: () => DocumentData;
  exists: () => boolean;
  metadata: SnapshotMetadata;
  ref: DocRef;
}

export interface DocumentChange {
  type: 'added' | 'modified' | 'removed';
  doc: WrappedDoc;
  oldIndex: number;
  newIndex: number;
}

/**
 * One snapshot type for both query and document reads. Every member is present
 * so call sites can use `.docs` (queries) or `.exists()`/`.data()` (documents)
 * without casts; the members that don't apply simply carry neutral values.
 */
export interface SnapshotLike {
  id: string;
  docs: WrappedDoc[];
  size: number;
  empty: boolean;
  forEach: (cb: (d: WrappedDoc) => void) => void;
  docChanges: () => DocumentChange[];
  exists: () => boolean;
  data: () => DocumentData;
  metadata: SnapshotMetadata;
  ref: DocRef;
}

function wrapDoc(path: EntityName, d: LocalDoc): WrappedDoc {
  return {
    id: d.id,
    data: () => d.data(),
    exists: () => true,
    metadata: { hasPendingWrites: false, fromCache: true, id: d.id },
    ref: { __kind: 'doc', path, id: d.id },
  };
}

function buildSnapshot(path: EntityName, docs: LocalDoc[], docId?: string): SnapshotLike {
  const wrapped = docs.map(d => wrapDoc(path, d));
  const id = docId ?? '';
  const single = docId !== undefined ? (docs[0] ?? null) : null;
  return {
    id,
    docs: wrapped,
    size: wrapped.length,
    empty: wrapped.length === 0,
    forEach: cb => wrapped.forEach(cb),
    docChanges: () =>
      wrapped.map(d => ({ type: 'added' as const, doc: d, oldIndex: -1, newIndex: 0 })),
    exists: () => single !== null,
    data: () => (single ? single.data() : {}),
    metadata: { hasPendingWrites: false, fromCache: true, id },
    ref: { __kind: 'doc', path, id },
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDocs(q: QueryRef | CollectionRef): Promise<SnapshotLike> {
  const opts = q.__kind === 'query' ? toListOptions(q.constraints) : {};
  const docs = await getRepository().list(q.path, opts);
  return buildSnapshot(q.path, docs);
}

export async function getDoc(ref: DocRef): Promise<SnapshotLike> {
  const found = await getRepository().get(ref.path, ref.id);
  return buildSnapshot(ref.path, found ? [found] : [], ref.id);
}

export async function getCountFromServer(q: QueryRef | CollectionRef) {
  const opts = q.__kind === 'query' ? toListOptions(q.constraints) : {};
  const n = await getRepository().count(q.path, opts.where);
  return { data: () => ({ count: n }) };
}

type AggSpec = { __agg: 'sum' | 'avg' | 'count'; field?: string };
export function sum(field: string): AggSpec {
  return { __agg: 'sum', field };
}
export function avg(field: string): AggSpec {
  return { __agg: 'avg', field };
}
export function count(): AggSpec {
  return { __agg: 'count' };
}

export async function getAggregateFromServer(
  q: QueryRef | CollectionRef,
  spec: Record<string, AggSpec>,
) {
  const opts = q.__kind === 'query' ? toListOptions(q.constraints) : {};
  const docs = await getRepository().list(q.path, opts);
  const result: Record<string, number> = {};
  for (const [key, agg] of Object.entries(spec)) {
    if (agg.__agg === 'count') {
      result[key] = docs.length;
      continue;
    }
    const total = docs.reduce((acc, d) => {
      const v = d.data()[agg.field as string];
      const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
    result[key] = agg.__agg === 'avg' ? (docs.length ? total / docs.length : 0) : total;
  }
  return { data: () => result };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function clean(data: DocumentData): Record<string, unknown> {
  return data as Record<string, unknown>;
}

export async function addDoc(coll: CollectionRef, data: DocumentData): Promise<DocRef> {
  const id = await getRepository().add(coll.path, clean(data));
  return { __kind: 'doc', path: coll.path, id };
}

export async function setDoc(ref: DocRef, data: DocumentData, options?: SetOptions): Promise<void> {
  if (options?.merge) await getRepository().update(ref.path, ref.id, clean(data));
  else await getRepository().set(ref.path, ref.id, clean(data));
}

export async function updateDoc(ref: DocRef, data: DocumentData): Promise<void> {
  await getRepository().update(ref.path, ref.id, clean(data));
}

export async function deleteDoc(ref: DocRef): Promise<void> {
  await getRepository().delete(ref.path, ref.id);
}

interface Batch {
  set(ref: DocRef, data: DocumentData, options?: SetOptions): void;
  update(ref: DocRef, data: DocumentData): void;
  delete(ref: DocRef): void;
  commit(): Promise<void>;
}

export function writeBatch(_db: unknown): Batch {
  const ops: Array<() => Promise<void>> = [];
  return {
    set(ref, data, options) {
      ops.push(() => setDoc(ref, data, options));
    },
    update(ref, data) {
      ops.push(() => updateDoc(ref, data));
    },
    delete(ref) {
      ops.push(() => deleteDoc(ref));
    },
    /**
     * Commit as one unit.
     *
     * This used to be a bare sequential loop while the calling code promised
     * "committed batches, so a partial failure cannot leave orphaned records".
     * On the native store the loop is now a real SQLCipher transaction: either
     * every document in the chunk goes, or none of them do. The localStorage
     * adapter still runs them sequentially and says so in its own comment — the
     * browser store has no atomicity to offer.
     */
    async commit() {
      await getRepository().transaction(async () => {
        for (const op of ops) await op();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------

export function onSnapshot(
  ref: QueryRef | CollectionRef | DocRef,
  onNext: (snap: SnapshotLike) => void,
  onError?: (e: unknown) => void,
): () => void {
  try {
    if (ref.__kind === 'doc') {
      return getRepository().subscribe(ref.path, docs => {
        const found = docs.find(d => d.id === ref.id) ?? null;
        onNext(buildSnapshot(ref.path, found ? [found] : [], ref.id));
      });
    }
    const path = ref.path;
    const opts = ref.__kind === 'query' ? toListOptions(ref.constraints) : {};
    return getRepository().subscribe(path, docs => {
      onNext(buildSnapshot(path, applyQuery(docs, opts)));
    });
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Misc Firestore surface used by the app
// ---------------------------------------------------------------------------

/** Locally there are never pending writes; resolves immediately. */
export function waitForPendingWrites(_db?: unknown): Promise<void> {
  return Promise.resolve();
}

/** Device time stands in for server time in an offline app. */
export function serverTimestamp(): string {
  return new Date().toISOString();
}
