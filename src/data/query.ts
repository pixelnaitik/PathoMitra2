/**
 * In-memory query helpers shared by every {@link DataRepository} adapter.
 *
 * A single-device lab store holds at most a few thousand rows, so filtering,
 * sorting and paging are done in JS after the rows are read. That keeps the
 * SQL trivial (and identical across the SQLite and web adapters) while still
 * honouring the `orderBy` / `where` / `limit` options the pages pass.
 */
import type { LocalDoc, ListOptions, WhereFilter } from './types';

/** Wrap a plain object in the Firestore-shaped `{ id, data() }` envelope. */
export function makeDoc(id: string, data: Record<string, unknown>): LocalDoc {
  return { id, data: () => data };
}

/**
 * Collision-resistant id for locally-created documents. Prefers the platform
 * UUID generator and falls back to a random hex string (WebView on old Android
 * and jsdom both lack `randomUUID` in some configurations).
 */
export function generateId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function readField(doc: LocalDoc, field: string): unknown {
  return doc.data()[field];
}

function matches(doc: LocalDoc, filter: WhereFilter): boolean {
  const actual = readField(doc, filter.field);
  switch (filter.op) {
    case '==':
      return actual === filter.value;
    case '!=':
      return actual !== filter.value;
    case '<':
      return cmp(actual, filter.value) < 0;
    case '<=':
      return cmp(actual, filter.value) <= 0;
    case '>':
      return cmp(actual, filter.value) > 0;
    case '>=':
      return cmp(actual, filter.value) >= 0;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(actual as string | number);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(filter.value as string | number);
    case 'contains':
      // Case-insensitive substring, matching what the SQLite adapter does with
      // LIKE so a search means the same thing on every platform.
      return (
        typeof actual === 'string' &&
        actual.toLowerCase().includes(String(filter.value ?? '').toLowerCase())
      );
    default:
      return true;
  }
}

/** Total ordering over the primitive types the app stores. */
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/** Apply `where` → `orderBy` → `limit`, in that order, returning a new array. */
export function applyQuery(docs: LocalDoc[], options: ListOptions = {}): LocalDoc[] {
  const { where, orderBy = 'createdAt', direction = 'desc', limit } = options;

  let out =
    where && where.length > 0
      ? docs.filter(doc => where.every(f => matches(doc, f)))
      : docs.slice();

  out.sort((x, y) => {
    const r = cmp(readField(x, orderBy), readField(y, orderBy));
    return direction === 'asc' ? r : -r;
  });

  if (typeof limit === 'number' && limit >= 0) out = out.slice(0, limit);
  return out;
}
