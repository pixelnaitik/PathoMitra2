import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { CalendarRangePicker, presetRange, toIsoDay } from './CalendarRangePicker';

const now = new Date();
/** `YYYY-MM-DD` for a day of the month currently being rendered. */
const iso = (day: number) => toIsoDay(new Date(now.getFullYear(), now.getMonth(), day));

function renderPicker(props: { fromDate?: string; toDate?: string } = {}) {
  const onChange = vi.fn();
  const initial = { fromDate: props.fromDate ?? '', toDate: props.toDate ?? '' };

  // Controlled, exactly like the list pages: the picker's own range logic depends
  // on what it emitted last, so an uncontrolled harness would not show it.
  function Harness() {
    const [range, setRange] = useState(initial);
    return (
      <CalendarRangePicker
        fromDate={range.fromDate}
        toDate={range.toDate}
        onChange={next => {
          onChange(next);
          setRange(next);
        }}
      />
    );
  }

  const view = render(<Harness />);
  const trigger = screen.getByRole('button', { name: /Filter by date range/i });
  return {
    onChange,
    trigger,
    open: () => fireEvent.click(trigger),
    clickDay: (index: number) =>
      fireEvent.click(view.container.querySelectorAll('[data-day]')[index]),
  };
}

afterEach(cleanup);

describe('CalendarRangePicker', () => {
  it('puts the active range on the trigger, so a filter is never invisible', () => {
    const { trigger } = renderPicker({ fromDate: iso(1) });
    expect(trigger).toHaveAttribute('aria-label', expect.stringContaining('From'));
  });

  it('says "All Dates" while no range is applied', () => {
    const { trigger } = renderPicker();
    expect(trigger).toHaveAttribute('aria-label', expect.stringContaining('All Dates'));
  });

  it('opens an accessible panel', () => {
    const { open } = renderPicker();
    expect(screen.queryByRole('dialog')).toBeNull();
    open();
    expect(screen.getByRole('dialog', { name: 'Choose date range' })).toBeInTheDocument();
  });

  it('starts a range on the first pick and closes it on the second', () => {
    const { open, clickDay, onChange } = renderPicker();
    open();

    clickDay(4);
    expect(onChange).toHaveBeenLastCalledWith({ fromDate: iso(5), toDate: '' });

    clickDay(8);
    expect(onChange).toHaveBeenLastCalledWith({ fromDate: iso(5), toDate: iso(9) });
  });

  it('moves the start when the next pick is earlier than the open start', () => {
    const { open, clickDay, onChange } = renderPicker({ fromDate: iso(12) });
    open();

    clickDay(2);
    expect(onChange).toHaveBeenLastCalledWith({ fromDate: iso(3), toDate: '' });
  });

  it('applies presets and clears the filter', () => {
    const { open, onChange } = renderPicker({ fromDate: iso(3), toDate: iso(9) });
    open();

    fireEvent.click(screen.getByRole('button', { name: '7 Days' }));
    expect(onChange).toHaveBeenLastCalledWith(presetRange('7days'));

    // A preset dismisses the panel, so clearing means opening it again.
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Clear Filter' }));
    expect(onChange).toHaveBeenLastCalledWith({ fromDate: '', toDate: '' });
  });

  it('marks the selected edges for assistive tech', () => {
    const { open } = renderPicker({ fromDate: iso(5), toDate: iso(9) });
    open();
    const days = screen.getAllByRole('button', { name: /2026|2025/ });
    const pressed = days.filter(day => day.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(2);
  });

  it('builds preset ranges from the local calendar, not UTC', () => {
    const today = presetRange('today');
    expect(today.fromDate).toBe(toIsoDay(new Date()));
    expect(today.toDate).toBe(toIsoDay(new Date()));
    expect(presetRange('thisMonth').fromDate).toBe(iso(1));
  });

  it('clamps the popover to the viewport so a 320 px phone cannot lose a day column (UI-P1-02)', () => {
    // The panel used to be `absolute right-0 w-80` (a fixed 320 px popover).
    // On a 320 px viewport with page gutters that clipped the day grid.
    // The contract now: the popover stretches to its trigger on phones and
    // caps its width against the viewport at every size. We test the class
    // contract (the geometry itself is a CSS concern verified by visual QA).
    const { open } = renderPicker();
    open();
    const panel = screen.getByRole('dialog', { name: 'Choose date range' });
    const classes = panel.getAttribute('class') ?? '';
    // Full-width on phones, right-anchored at sm+, viewport-clamped always.
    expect(classes).toContain('left-0');
    expect(classes).toContain('right-0');
    expect(classes).toMatch(/sm:left-auto/);
    expect(classes).toMatch(/sm:w-80/);
    expect(classes).toMatch(/max-w-\[calc\(100vw-1rem\)\]/);
    // The old hard-coded `w-80` without a responsive prefix must be gone.
    expect(classes).not.toMatch(/(^|\s)w-80(\s|$)/);
  });
});
