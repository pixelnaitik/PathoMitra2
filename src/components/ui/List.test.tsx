import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ListRow } from './List';
import { IconButton } from './Button';

/**
 * UI-P0-04 — the mobile list row must expose one primary button (open the
 * detail sheet) plus sibling action buttons (Edit / Delete). Previously the
 * row was a fake `role="button"` wrapper and the two action buttons sat
 * inside it, which produced:
 *   - invalid HTML (a <button> cannot nest another)
 *   - a single Tab stop for a row that offers three actions
 *   - TalkBack reading the wrapper name instead of "patient name, then Edit,
 *     then Delete" as separate announcements
 *
 * This test pins the NEW structure so a future change that regresses back
 * to a wrapper fails loudly.
 */
afterEach(cleanup);

function RowHarness() {
  const [opened, setOpened] = useState<string | null>(null);
  const [editTapped, setEditTapped] = useState(false);
  return (
    <div>
      <ListRow
        title="Asha Rao"
        subtitle="34y · F · 12 May 2026"
        primaryLabel="View Asha Rao's history"
        onClick={() => setOpened('asha')}
        trailing={
          <>
            <IconButton label="Edit Asha Rao" size="sm" onClick={() => setEditTapped(true)}>
              <span data-testid="edit-icon">E</span>
            </IconButton>
            <IconButton label="Delete Asha Rao" size="sm" onClick={vi.fn()}>
              <span data-testid="delete-icon">D</span>
            </IconButton>
          </>
        }
      />
      <p data-testid="opened">{opened ?? 'none'}</p>
      <p data-testid="edit">{editTapped ? 'yes' : 'no'}</p>
    </div>
  );
}

describe('ListRow split-mode accessibility contract', () => {
  it('renders a real primary <button> (not a role="button" div) when onClick + trailing are both set', () => {
    render(<RowHarness />);
    // The primary opens the detail — it is a native button so Enter + Space
    // work for free and assistive tech sees one button (not two nested ones).
    const primary = screen.getByRole('button', { name: "View Asha Rao's history" });
    expect(primary.tagName).toBe('BUTTON');
    // No wrapper div carrying role="button" is allowed to survive:
    expect(document.querySelector('[role="button"]')).toBeNull();
  });

  it('exposes Edit and Delete as sibling buttons with their own accessible names', () => {
    render(<RowHarness />);
    // Screen readers should see three named buttons, not one button that
    // contains two unlabeled icon spans.
    const edit = screen.getByRole('button', { name: 'Edit Asha Rao' });
    const del = screen.getByRole('button', { name: 'Delete Asha Rao' });
    expect(edit).toBeInTheDocument();
    expect(del).toBeInTheDocument();
    // Neither should be a descendant of the primary — that was the nesting
    // failure mode.
    const primary = screen.getByRole('button', { name: "View Asha Rao's history" });
    expect(primary.contains(edit)).toBe(false);
    expect(primary.contains(del)).toBe(false);
  });

  it('activating the primary opens the record; activating Edit does NOT (no accidental open)', () => {
    render(<RowHarness />);
    fireEvent.click(screen.getByRole('button', { name: "View Asha Rao's history" }));
    expect(screen.getByTestId('opened')).toHaveTextContent('asha');

    cleanup();
    render(<RowHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Asha Rao' }));
    // The edit handler ran...
    expect(screen.getByTestId('edit')).toHaveTextContent('yes');
    // ...and the detail sheet did NOT open as a side-effect.
    expect(screen.getByTestId('opened')).toHaveTextContent('none');
  });

  it('keeps the whole row a single button when there are no trailing actions', () => {
    render(
      <ListRow
        title="Plain row"
        subtitle="no actions"
        primaryLabel="Open plain row"
        onClick={vi.fn()}
      />,
    );
    // Only one button in the DOM for this row.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open plain row' })).toBeInTheDocument();
  });
});
