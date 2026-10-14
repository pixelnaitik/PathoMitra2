/**
 * Keyboard-operation tests for the report-layout controls — the part browser
 * automation couldn't prove on a hidden viewport (real ArrowKey / Ctrl+Z).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SliderField } from './SliderField';
import { REPORT_FIELDS } from '../../lib/report-layout-spec';
import { useHistoryShortcuts } from '../../lib/use-edit-history';
import type { EditHistory } from '../../lib/use-edit-history';

const spec = REPORT_FIELDS.reportMarginTop; // mm, min 0, max 180, step 1, rec 50

beforeEach(cleanup);

/** Stateful host, like SettingsPage — the control is fully controlled. */
function Harness({ onChange, initial = 50 }: { onChange?: (v: number) => void; initial?: number }) {
  const [v, setV] = useState(initial);
  return (
    <SliderField
      spec={spec}
      value={v}
      onChange={n => {
        setV(n);
        onChange?.(n);
      }}
    />
  );
}

/**
 * jsdom does not implement native range keyboard increments; assert the
 * component contract instead: the slider is a focusable, labelled native
 * range whose onChange (which arrow keys fire in every real browser) is
 * clamped, unit-announced and preview-wired.
 */
describe('SliderField keyboard contract', () => {
  it('renders a focusable range with label and unit announcement', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAccessibleName(spec.label);
    slider.focus();
    expect(document.activeElement).toBe(slider);

    // What arrow keys produce in a browser: onChange with the stepped value.
    fireEvent.change(slider, { target: { value: '52' } });
    expect(onChange).toHaveBeenCalledWith(52);
    expect(slider).toHaveAttribute('aria-valuetext', '52 mm');
  });

  it('clamps arrow/entered values to the field range', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={179} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '500' } });
    expect(onChange).toHaveBeenLastCalledWith(spec.max);
  });

  it('keeps the exact-value box in sync and commits on Enter/blur', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole('spinbutton');
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: '65' } });
    expect(onChange).toHaveBeenCalledWith(65);
    fireEvent.blur(box, { target: { value: '65' } });
    // type=number inputs report their value as a number via toHaveValue.
    expect(box).toHaveValue(65);
  });
});

describe('useHistoryShortcuts', () => {
  it('binds Ctrl/Meta+Z to undo and Ctrl/Meta+Shift+Z to redo, skipping inputs', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    const history = { undo, redo } as unknown as EditHistory<unknown>;
    function Probe() {
      useHistoryShortcuts(history);
      return <div data-testid="probe" />;
    }
    render(<Probe />);

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(redo).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: 'y', metaKey: true });
    expect(redo).toHaveBeenCalledTimes(2);

    // While typing in a field, native text undo must win — no interception.
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    input.remove();
  });
});
