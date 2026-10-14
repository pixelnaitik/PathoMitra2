/**
 * Read / muted state for the Notification Center.
 *
 * Alerts are derived, so nothing here stores a notification itself — only which
 * alert ids the staff member has already handled or silenced. Keeping that in
 * Firestore (mirrored to localStorage) means marking something read at the lab
 * desk also clears it on the phone, which a localStorage-only design could not
 * do; the local copy is what keeps the badge correct offline and on first paint.
 *
 * Same shape as `lib/settings-sync.ts`: Firestore is authoritative, the local
 * cache is a convenience, and last-write-wins is decided by `updatedAt`.
 */
import { z } from 'zod';
import type { NotificationItem } from './notification-engine';

export const NOTIFICATION_STATE_COLLECTION = 'notificationState';
const LOCAL_STATE_KEY = 'pathologyos_notification_state';

/**
 * Bounded on purpose. Firestore bills per document and caps one at 1 MiB, and an
 * alert id is only meaningful while the record behind it is recent — so the
 * oldest entries are dropped rather than growing forever.
 */
export const MAX_READ_IDS = 300;
export const MAX_MUTED_IDS = 200;

export interface NotificationState {
  readIds: string[];
  mutedIds: string[];
  updatedAt: string;
}

const StateSchema = z.looseObject({
  readIds: z.array(z.unknown()).default([]),
  mutedIds: z.array(z.unknown()).default([]),
  updatedAt: z.unknown().optional(),
});

export function emptyState(): NotificationState {
  return { readIds: [], mutedIds: [], updatedAt: '' };
}

/** Parse a Firestore document or cached JSON. Never throws; bad input means empty. */
export function parseState(raw: unknown): NotificationState {
  const result = StateSchema.safeParse(raw ?? {});
  if (!result.success) return emptyState();
  // Individual entries are filtered rather than rejected: one stray number
  // written by an old client must not wipe a staff member's whole handled list.
  const asIds = (values: unknown[]): string[] =>
    values.filter((value): value is string => typeof value === 'string');
  return {
    readIds: dedupe(asIds(result.data.readIds)).slice(-MAX_READ_IDS),
    mutedIds: dedupe(asIds(result.data.mutedIds)).slice(-MAX_MUTED_IDS),
    updatedAt: typeof result.data.updatedAt === 'string' ? result.data.updatedAt : '',
  };
}

function dedupe(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(id => typeof id === 'string' && id.length > 0)));
}

/** Append and keep the newest entries, dropping the oldest past the cap. */
function pushCapped(existing: string[], add: string[], cap: number): string[] {
  const merged = dedupe([...existing, ...add]);
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export function markRead(state: NotificationState, ids: string[]): NotificationState {
  if (ids.length === 0) return state;
  return {
    ...state,
    readIds: pushCapped(state.readIds, ids, MAX_READ_IDS),
    mutedIds: state.mutedIds.filter(id => !ids.includes(id)),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Silence one alert until the lab unmutes it. The id is `category:entityId`, so
 * the same problem on the same record stays hidden; a *different* record in the
 * same category is untouched.
 */
export function toggleMute(state: NotificationState, id: string): NotificationState {
  const muted = state.mutedIds.includes(id);
  return {
    ...state,
    mutedIds: muted
      ? state.mutedIds.filter(existing => existing !== id)
      : pushCapped(state.mutedIds, [id], MAX_MUTED_IDS),
    updatedAt: new Date().toISOString(),
  };
}

/** Bring back everything the staff member silenced. */
export function unmuteAll(state: NotificationState): NotificationState {
  return { ...state, mutedIds: [], updatedAt: new Date().toISOString() };
}

/**
 * Clear handled alerts, keeping only ids that still describe something on
 * screen. Without this, a lab that has been using the app for months would keep
 * thousands of dead ids and lose genuinely recent ones to the cap.
 */
export function pruneRead(state: NotificationState, liveIds: Iterable<string>): NotificationState {
  const live = new Set(liveIds);
  const kept = state.readIds.filter(id => live.has(id));
  if (kept.length === state.readIds.length) return state;
  return { ...state, readIds: kept, updatedAt: new Date().toISOString() };
}

/**
 * Apply persisted state to derived alerts: muted ones disappear, handled ones
 * are flagged so the badge counts only what still needs attention.
 */
export function applyState(
  items: NotificationItem[],
  state: NotificationState,
): NotificationItem[] {
  const muted = new Set(state.mutedIds);
  const read = new Set(state.readIds);
  return items
    .filter(item => !muted.has(item.id))
    .map(item => ({ ...item, read: read.has(item.id) }));
}

// ---------------------------------------------------------------------------
// Device-local cache
// ---------------------------------------------------------------------------

/** Keyed by uid so two staff members sharing a workstation stay separate. */
function localKey(uid: string): string {
  return `${LOCAL_STATE_KEY}:${uid}`;
}

export function readLocalState(uid: string | undefined): NotificationState {
  if (!uid || typeof localStorage === 'undefined') return emptyState();
  try {
    const raw = localStorage.getItem(localKey(uid));
    return raw ? parseState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function writeLocalState(uid: string | undefined, state: NotificationState): void {
  if (!uid || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(localKey(uid), JSON.stringify(state));
  } catch {
    // A full or blocked storage area only costs offline continuity.
  }
}
