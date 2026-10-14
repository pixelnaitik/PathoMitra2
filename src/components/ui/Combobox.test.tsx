import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Combobox } from './Combobox';

const OPTIONS = ['Negative', '1:20', '1:40', '1:80', '1:160'];

function renderBox(
  props: {
    onNavigate?: (event: unknown) => void;
    onChange?: (value: string) => void;
    readOnly?: boolean;
  } = {},
) {
  const onSelect = props.onChange ?? vi.fn();
  const navigate = props.onNavigate ?? vi.fn();

  // Controlled, like the report form: the value lives with the caller.
  function Harness() {
    const [value, setValue] = useState('');
    return (
      <Combobox
        value={value}
        options={OPTIONS}
        readOnly={props.readOnly}
        ariaLabel="Result for S. typhi 'O'"
        placeholder="Select or type result..."
        onChange={next => {
          onSelect(next);
          setValue(next);
        }}
        onNavigate={navigate}
      />
    );
  }

  render(<Harness />);
  const input = screen.getByRole('combobox', { name: "Result for S. typhi 'O'" });
  return { input, onSelect, navigate };
}

afterEach(cleanup);

describe('Combobox', () => {
  it('opens a themed list of every option on focus', () => {
    const { input } = renderBox();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(OPTIONS);
  });

  it('keeps typed text as the value and says it will be saved as written', () => {
    const { input, onSelect } = renderBox();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1:320' } });

    expect(onSelect).toHaveBeenCalledWith('1:320');
    expect(screen.queryByRole('option', { name: 'Negative' })).toBeNull();
    expect(screen.getByText(/is not a listed value/)).toBeInTheDocument();
  });

  it('commits the highlighted option with Enter instead of advancing the row', () => {
    const { input, onSelect, navigate } = renderBox();
    fireEvent.focus(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith('1:20');
    expect(navigate).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('advances to the next field on Enter when the list is closed', () => {
    const { input, navigate, onSelect } = renderBox();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on Escape without changing the value', () => {
    const { input, onSelect } = renderBox();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    // aria-expanded is the source of truth; the panel itself lingers for the
    // fade-out, which never completes under jsdom.
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays inert for a read-only role', () => {
    const { input } = renderBox({ readOnly: true });
    expect(input).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /options/i })).toBeNull();

    fireEvent.focus(input);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on a click outside the control', () => {
    const { input } = renderBox();
    fireEvent.focus(input);
    fireEvent.pointerDown(document.body);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
