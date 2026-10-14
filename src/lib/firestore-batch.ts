/**
 * Chunked local batch deletes.
 *
 * Cascading deletes (patient → reports → invoices → notes) run through a batch
 * so a failure cannot leave orphaned records. Locally there is no 500-op cap,
 * but the chunking is kept so the behaviour matches the previous contract and
 * very large cascades stay bounded per commit. Backed by the on-device store
 * via the `data/fs` façade — no Firestore.
 */
import { db, writeBatch, type DocumentReference } from '../data/fs';

/** Kept well under the old Firestore limit; harmless locally. */
const MAX_OPS_PER_BATCH = 450;

/**
 * Delete the given documents in committed chunks.
 */
export async function deleteInChunks(refs: readonly DocumentReference[]): Promise<void> {
  for (let index = 0; index < refs.length; index += MAX_OPS_PER_BATCH) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(index, index + MAX_OPS_PER_BATCH)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}
