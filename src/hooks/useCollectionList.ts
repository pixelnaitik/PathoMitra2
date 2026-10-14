/**
 * Local-first list hook — the offline replacement for the Firestore listener.
 *
 * The public API is deliberately unchanged (same options, same return shape) so
 * the dashboard pages keep working with minimal edits. What changed underneath:
 * instead of an `onSnapshot` on a Firestore query with server-side filters and
 * cursor paging, it subscribes to a local collection and does the filtering,
 * sorting and paging in memory (`data/query.ts`). A single-device lab store is
 * small enough that this is both simpler and faster than round-tripping a
 * backend, and it keeps working with no network at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRepository } from '../data';
import { applyQuery } from '../data/query';
import type { EntityName, LocalDoc, WhereOp } from '../data/types';

/** Anything with an `id` — the identity used for de-duplication. */
type Identified = { id: string };

/** The slice of a stored document the mapper needs (matches `models.ts`). */
export type MappableDocs = readonly LocalDoc[];

/** One in-memory filter constraint. */
export interface ListFilter {
  field: string;
  op: WhereOp;
  value: string | number | boolean | null | readonly (string | number)[];
}

export interface UseCollectionListOptions<T> {
  /** Collection name, e.g. `reports`. */
  path: string;
  /** Map raw documents into domain objects (use the `read*` helpers in lib/models). */
  map: (docs: MappableDocs) => T[];
  /** Field to order on. Defaults to `createdAt`. */
  orderField?: string;
  direction?: 'asc' | 'desc';
  /** Documents per "page" of client-side pagination. */
  pageSize?: number;
  /** Filters evaluated in memory. Change them to recompute the list. */
  filters?: ListFilter[];
  /** Called when the underlying read fails. */
  onError?: (error: unknown) => void;
}

export interface CollectionList<T> {
  items: T[];
  /** True until the first read has arrived. */
  loading: boolean;
  /** Kept for API compatibility; local paging is synchronous. */
  loadingMore: boolean;
  /** False once every matching document is on screen. */
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
}

export function useCollectionList<T extends Identified>(
  options: UseCollectionListOptions<T>,
): CollectionList<T> {
  const {
    path,
    map,
    orderField = 'createdAt',
    direction = 'desc',
    pageSize = 25,
    filters,
    onError,
  } = options;

  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(pageSize);

  // Serialised filters are the stable dependency; callers build the array
  // inline, so its identity cannot decide when to recompute.
  const filterKey = JSON.stringify(filters ?? []);

  // The error callback lives on a ref: callers pass an inline closure, and the
  // subscription must not be torn down and re-read on every render to keep it
  // current.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setVisible(pageSize);

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = getRepository().subscribe(
        path as EntityName,
        next => {
          if (!active) return;
          setDocs(next);
          setLoading(false);
        },
        // A failed read is recorded as an error and the previous documents are
        // kept: showing an empty list for a store that never answered is how a
        // lab concludes a patient does not exist.
        error => {
          if (!active) return;
          setError(error instanceof Error ? error.message : String(error));
          setLoading(false);
          onErrorRef.current?.(error);
        },
      );
    } catch (err) {
      if (active) {
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
        onError?.(err);
      }
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
    // `onError` is an inline closure at every call site; re-subscribing on its
    // identity would re-read the collection each render. It is only used in the
    // rare synchronous-throw path above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, pageSize]);

  /** Filter + sort the live documents, then map through the domain readers. */
  const mapped = useMemo(() => {
    const queried = applyQuery(docs, { where: filters ?? [], orderBy: orderField, direction });
    return map(queried);
    // `filterKey` stands in for the inline `filters` array; `map` is a stable
    // module-level reader (`readReports`, `readPatients`, …) at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, orderField, direction, filterKey, map]);

  const items = useMemo(() => mapped.slice(0, visible), [mapped, visible]);
  const hasMore = visible < mapped.length;

  const loadMore = useCallback(async () => {
    setVisible(v => v + pageSize);
  }, [pageSize]);

  return { items, loading, loadingMore: false, hasMore, error, loadMore };
}
