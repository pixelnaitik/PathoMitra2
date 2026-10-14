/**
 * Shared types for the local-first data layer.
 *
 * The whole app used to read and write Firestore documents. To keep the
 * migration surgical, the local repository hands back the *same* minimal
 * document shape Firestore did — `{ id, data() }` — so the Zod boundary
 * readers in `lib/models.ts` (`readPatients`, `readReports`, …) and every
 * page's `map` callback keep working untouched.
 */

/**
 * A single stored record. Deliberately mirrors the slice of a Firestore
 * `QueryDocumentSnapshot` the UI actually uses: an `id` plus a `data()`
 * method. `data()` is a method (not a property) so `models.ts`'s
 * `FirestoreDocs` type is satisfied without modification.
 */
export interface LocalDoc {
  id: string;
  data: () => Record<string, unknown>;
}

/** Collections the offline app knows about. */
export type EntityName =
  | 'users'
  | 'patients'
  | 'doctors'
  | 'reports'
  | 'reportNotes'
  | 'reportVersions'
  | 'invoices'
  | 'labSettings'
  | 'notificationState'
  | 'meta';

/**
 * Comparison operators supported by {@link WhereFilter}.
 *
 * `contains` is the local store's addition: case-insensitive substring matching.
 * Firestore never had it (which is why every search box in this app used to pull
 * a page of documents into memory and filter them in JS — and why the search
 * boxes could only ever find what they had loaded). Having it in the contract
 * lets the SQLite adapter run a real `LIKE` over the whole collection instead.
 */
export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains' | 'contains';

/** One filter clause, evaluated in memory over the local collection. */
export interface WhereFilter {
  field: string;
  op: WhereOp;
  value: string | number | boolean | null | readonly (string | number)[];
}

export interface ListOptions {
  /** Field to sort on (read from the parsed document). Defaults to `createdAt`. */
  orderBy?: string;
  direction?: 'asc' | 'desc';
  /** Maximum rows to return. */
  limit?: number;
  /** In-memory filters. */
  where?: WhereFilter[];
}

/**
 * The data-store contract every page programs against. Two implementations
 * exist: `SqliteRepository` (encrypted SQLCipher, on-device) and
 * `WebRepository` (localStorage, browser dev only). `data/index.ts` picks one
 * based on the runtime platform.
 */
export interface DataRepository {
  /** One-time open/encryption bootstrap. Safe to call more than once. */
  init(): Promise<void>;

  list(entity: EntityName, options?: ListOptions): Promise<LocalDoc[]>;

  get(entity: EntityName, id: string): Promise<LocalDoc | null>;

  /** Insert or overwrite a document with an explicit id. */
  set(entity: EntityName, id: string, value: Record<string, unknown>): Promise<void>;

  /** Insert with a generated id; returns the new id. */
  add(entity: EntityName, value: Record<string, unknown>): Promise<string>;

  /** Shallow-merge `patch` into an existing document. */
  update(entity: EntityName, id: string, patch: Record<string, unknown>): Promise<void>;

  delete(entity: EntityName, id: string): Promise<void>;

  /** Number of documents matching the filters (no rows returned). */
  count(entity: EntityName, where?: WhereFilter[]): Promise<number>;

  /**
   * Subscribe to changes on a collection. Returns an unsubscribe function.
   * Local stores emit synchronously after each mutation, so this is a thin
   * observer over writes rather than a network listener.
   *
   * `onError` matters: a failed read is not an empty collection, and replaying
   * `[]` without telling anyone lets a page show "no patients found" while the
   * database never actually answered. Callers that have an error state should
   * pass it; the empty replay still happens so no UI can hang in "loading".
   */
  subscribe(
    entity: EntityName,
    cb: (docs: LocalDoc[]) => void,
    onError?: (error: unknown) => void,
  ): () => void;

  /**
   * Run several mutations as one unit.
   *
   * On the native store this is a real SQLCipher transaction: either every
   * statement survives or none of them do, and listeners are notified once the
   * outcome is known. The localStorage adapter cannot offer that, and says so in
   * its own comment.
   */
  transaction(fn: (tx: DataRepository) => Promise<void>): Promise<void>;

  /** Wipe every collection — used by "erase all data" in settings. */
  clearAll(): Promise<void>;
}
