import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ReportResultsEditor } from './ReportResultsEditor';

/**
 * The shape a report actually stores after CBC + Urine Analysis are added: the
 * panel names, the section headers, and every component, all flattened into one
 * list in the order they were picked.
 */
const SELECTION = [
  'Blood Sugar Fasting',
  'Parasites MP / MF',
  'CBC (COMPLETE BLOOD COUNT)',
  'WHITE CELL COUNT(TC)',
  'DIFFERENTIAL COUNT WBC',
  'NEUTROPHIL',
  'URINE ANALYSIS',
  'PHYSICAL EXAMINATION',
  'Quantity',
  'Colour',
];

function renderEditor(props: Partial<ComponentProps<typeof ReportResultsEditor>> = {}) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <ReportResultsEditor
      testSelection={SELECTION}
      results={{ 'WHITE CELL COUNT(TC)': '6.2' }}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

afterEach(cleanup);

describe('ReportResultsEditor', () => {
  it('summarises the ordered panels instead of dumping the whole selection', () => {
    renderEditor();
    const summary = screen.getByRole('region', { name: 'Ordered tests' });
    expect(summary).toHaveTextContent('2 panels');
    expect(summary).toHaveTextContent('6 parameters');
    // The old UI joined all 10 names into one paragraph; the summary must not.
    expect(summary.textContent).not.toMatch(/NEUTROPHIL, Quantity/);
  });

  it('separates panel components from tests ordered on their own', () => {
    renderEditor();
    // Components belong to their panel card, not the "Individual tests" bucket.
    expect(screen.getByRole('textbox', { name: 'Result for NEUTROPHIL' })).toBeInTheDocument();
    const individual = screen.getByRole('region', { name: 'Individual tests' });
    expect(individual).toHaveTextContent('Blood Sugar Fasting');
    expect(individual).toHaveTextContent('Parasites MP / MF');
    expect(individual).not.toHaveTextContent('NEUTROPHIL');
  });

  it('keeps section headers as bands and never as entry fields', () => {
    renderEditor();
    const urine = screen.getByRole('region', { name: 'URINE ANALYSIS' });
    expect(urine).toHaveTextContent('PHYSICAL EXAMINATION');
    expect(screen.queryByRole('textbox', { name: 'Result for PHYSICAL EXAMINATION' })).toBeNull();
    expect(
      screen.queryByRole('textbox', { name: 'Result for CBC (COMPLETE BLOOD COUNT)' }),
    ).toBeNull();
  });

  it('offers the suggested list for categorical results only', () => {
    renderEditor();
    // Colour has options in the catalogue; a numeric parameter does not.
    expect(screen.getByRole('combobox', { name: 'Result for Colour' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Result for WHITE CELL COUNT(TC)' })).toBeNull();
  });

  it('reports the edited parameter by name so the page can recalculate', () => {
    const { onChange } = renderEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Result for NEUTROPHIL' }), {
      target: { value: '58' },
    });
    expect(onChange).toHaveBeenCalledWith('NEUTROPHIL', '58');
  });

  it('shows the stored value and blocks writes for a view-only role', () => {
    renderEditor({ readOnly: true });
    const input = screen.getByRole('textbox', { name: 'Result for WHITE CELL COUNT(TC)' });
    expect(input).toHaveValue('6.2');
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByText('View only')).toBeInTheDocument();
  });

  it('falls back to the free-text test type when nothing was recorded', () => {
    renderEditor({ testSelection: [], testType: 'Random blood sugar' });
    expect(screen.getByText('Random blood sugar')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
