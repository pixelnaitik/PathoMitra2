import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_MUTED_IDS,
  MAX_READ_IDS,
  applyState,
  emptyState,
  markRead,
  parseState,
  pruneRead,
  readLocalState,
  toggleMute,
  unmuteAll,
  writeLocalState,
  type NotificationState,
} from './notification-state';
import type { NotificationItem } from './notification-engine';

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'overdue:p1',
    category: 'overdue',
    severity: 'warning',
    title: 'Asha Rao is still awaiting a report',
    body: '2 tests collected 30h ago',
    entityName: 'Asha Rao',
    entityId: 'p1',
    ageHours: 30,
    timestamp: '2026-03-14T06:00:00.000Z',
    link: { tab: 'reports' },
    ...overrides,
  };
}

const ids = (count: number, prefix = 'id'): string[] =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

beforeEach(() => {
  localStorage.clear();
});

describe('parseState', () => {
  it('reads a well-formed document', () => {
    const state = parseState({ readIds: ['a'], mutedIds: ['b'], updatedAt: '2026-01-01' });
    expect(state).toEqual({ readIds: ['a'], mutedIds: ['b'], updatedAt: '2026-01-01' });
  });

  it('returns an empty state for missing, malformed or non-object input', () => {
    expect(parseState(undefined)).toEqual(emptyState());
    expect(parseState(null)).toEqual(emptyState());
    expect(parseState('nope')).toEqual(emptyState());
    expect(parseState({ readIds: 'not-a-list' })).toEqual(emptyState());
  });

  it('drops duplicates and non-string entries instead of failing the whole doc', () => {
    const state = parseState({ readIds: ['a', 'a', '', 7, 'b'], mutedIds: [] });
    expect(state.readIds).toEqual(['a', 'b']);
  });

  it('caps each list at its ceiling, keeping the newest ids', () => {
    const state = parseState({ readIds: ids(MAX_READ_IDS + 50, 'r'), mutedIds: [] });
    expect(state.readIds).toHaveLength(MAX_READ_IDS);
    expect(state.readIds[state.readIds.length - 1]).toBe(`r${MAX_READ_IDS + 49}`);
  });

  it('tolerates a document missing updatedAt', () => {
    expect(parseState({ readIds: ['a'] }).updatedAt).toBe('');
  });
});

describe('markRead', () => {
  it('adds ids without repeating them', () => {
    const next = markRead(markRead(emptyState(), ['a', 'b']), ['b', 'c']);
    expect(next.readIds).toEqual(['a', 'b', 'c']);
  });

  it('un-mutes an alert the staff member just handled', () => {
    const muted = toggleMute(emptyState(), 'a');
    expect(markRead(muted, ['a']).mutedIds).toEqual([]);
  });

  it('is a no-op when there is nothing to add', () => {
    const state: NotificationState = { readIds: ['a'], mutedIds: [], updatedAt: 'x' };
    expect(markRead(state, [])).toBe(state);
  });

  it('bounds the ledger by dropping the oldest entries', () => {
    const state = markRead(emptyState(), ids(MAX_READ_IDS, 'old'));
    const next = markRead(state, ['fresh']);
    expect(next.readIds).toHaveLength(MAX_READ_IDS);
    expect(next.readIds).toContain('fresh');
    expect(next.readIds).not.toContain('old0');
  });
});

describe('toggleMute', () => {
  it('mutes then unmutes the same alert id', () => {
    const once = toggleMute(emptyState(), 'draft:r1');
    expect(once.mutedIds).toEqual(['draft:r1']);
    expect(toggleMute(once, 'draft:r1').mutedIds).toEqual([]);
  });

  it('bounds the muted list the same way', () => {
    const state = markRead(emptyState(), []);
    let mutated = state;
    for (const id of ids(MAX_MUTED_IDS + 5, 'm')) mutated = toggleMute(mutated, id);
    expect(mutated.mutedIds).toHaveLength(MAX_MUTED_IDS);
  });

  it('clears every silence', () => {
    const state = toggleMute(toggleMute(emptyState(), 'a'), 'b');
    expect(unmuteAll(state).mutedIds).toEqual([]);
  });
});

describe('pruneRead', () => {
  it('drops ids that no longer describe anything on screen', () => {
    const state = markRead(markRead(emptyState(), ['a', 'ghost']), []);
    expect(pruneRead(state, ['a']).readIds).toEqual(['a']);
  });

  it('returns the same object when nothing changed', () => {
    const state = markRead(emptyState(), ['a']);
    expect(pruneRead(state, ['a'])).toBe(state);
  });
});

describe('applyState', () => {
  const items = [item(), item({ id: 'draft:r9', category: 'draft' })];

  it('hides muted alerts entirely', () => {
    const state = toggleMute(emptyState(), 'draft:r9');
    expect(applyState(items, state).map(i => i.id)).toEqual(['overdue:p1']);
  });

  it('flags handled alerts so only real work is counted', () => {
    const state = markRead(emptyState(), ['overdue:p1']);
    const [first] = applyState(items, state);
    expect(first.read).toBe(true);
    expect(applyState(items, state)[1].read).toBe(false);
  });

  it('does not mutate the incoming items', () => {
    applyState(items, markRead(emptyState(), ['overdue:p1']));
    expect(items[0].read).toBeUndefined();
  });
});

describe('device-local cache', () => {
  it('round-trips per user', () => {
    const state = markRead(emptyState(), ['a']);
    writeLocalState('uid-1', state);
    expect(readLocalState('uid-1').readIds).toEqual(['a']);
  });

  it('keeps two staff members on one workstation separate', () => {
    writeLocalState('uid-1', markRead(emptyState(), ['a']));
    expect(readLocalState('uid-2').readIds).toEqual([]);
  });

  it('is empty for an anonymous session or corrupted cache', () => {
    expect(readLocalState(undefined)).toEqual(emptyState());
    localStorage.setItem('pathologyos_notification_state:uid-9', 'broken{');
    expect(readLocalState('uid-9')).toEqual(emptyState());
  });
});
