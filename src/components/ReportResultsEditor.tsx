/**
 * <ReportResultsEditor> — the editable body of the "Report Details" sheet.
 *
 * The sheet used to print `testSelection` as one comma-joined paragraph. On a
 * CBC + Urine Analysis report that is 50 uppercase names in an unbroken wall of
 * text, where the panels the lab actually ordered are indistinguishable from
 * their own components — and the entry grid below it repeated every name in a
 * full-width boxed field with no structure, so nothing lined up to scan.
 *
 * This re-presents the same data in the two orders a lab reads a report in:
 * the *ordered panels* as a pill summary with their parameter counts, then the
 * per-parameter grid split into one card per panel, broken up by the same
 * section bands (Physical / Chemical / Microscopical examination) the printed
 * report uses. Unit moves into the label line so a row is label + field, not
 * label + field + a third floating column.
 *
 * Presentation only: every keystroke is handed back through `onChange`, so the
 * page keeps owning derived-value recalculation (lib/report-calculations), the
 * save path and the permission check.
 */
import { useId, useMemo, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Combobox } from './ui';
import { cn } from '../lib/utils';
import { getPathologyTests, isNumericTest, type PathologyTest } from '../lib/pathology-tests';

/** One editable parameter row. */
interface LeafEntry {
  kind: 'test';
  name: string;
  unit: string;
  options?: string[];
  numeric: boolean;
}

/** A non-editable section band inside a panel (e.g. "Chemical examination"). */
interface BandEntry {
  kind: 'header';
  name: string;
}

type BlockEntry = LeafEntry | BandEntry;

/** A panel card, or the fallback bucket for tests ordered on their own. */
interface Block {
  key: string;
  title: string;
  /** False for the "Individual tests" bucket, which carries no pill count. */
  isPanel: boolean;
  entries: BlockEntry[];
}

const SINGLES_KEY = '__individual__';
const SINGLES_TITLE = 'Individual tests';

const norm = (name: string) => name.trim().toLowerCase();

/**
 * Sort the flat `testSelection` (panels, section headers and parameters, in the
 * order they were added) into one block per selected panel. Membership comes
 * from the catalogue's `includedTests` rather than from position, so a report
 * whose components were appended out of order still groups correctly; anything
 * no selected panel claims falls into the "Individual tests" bucket.
 */
function buildBlocks(selection: readonly string[]): Block[] {
  const catalog = getPathologyTests();
  const infoByName = new Map<string, PathologyTest>();
  for (const test of catalog) infoByName.set(norm(test.name), test);

  const ownerOfPanel = new Map<string, string>();
  for (const test of catalog) {
    if (!test.isGroup || !test.includedTests) continue;
    for (const member of test.includedTests) ownerOfPanel.set(norm(member), norm(test.name));
  }

  const selectedPanels = new Set(selection.map(norm).filter(name => infoByName.get(name)?.isGroup));

  const blocks: Block[] = [];
  const blockByKey = new Map<string, Block>();
  const panelBlock = (panelKey: string) => {
    let block = blockByKey.get(panelKey);
    if (!block) {
      block = { key: `panel:${panelKey}`, title: panelKey, isPanel: true, entries: [] };
      blockByKey.set(panelKey, block);
      blocks.push(block);
    }
    return block;
  };
  const singlesBlock = () => {
    let block = blockByKey.get(SINGLES_KEY);
    if (!block) {
      block = { key: SINGLES_KEY, title: SINGLES_TITLE, isPanel: false, entries: [] };
      blockByKey.set(SINGLES_KEY, block);
      blocks.push(block);
    }
    return block;
  };

  const seen = new Set<string>();
  for (const raw of selection) {
    const name = (raw || '').trim();
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));

    const info = infoByName.get(norm(name));
    if (info?.isGroup) {
      // Replaces the normalised placeholder title when the panel is created
      // before its own entry is reached (components appended out of order).
      panelBlock(norm(name)).title = name;
      continue;
    }
    const owner = ownerOfPanel.get(norm(name));
    const block = owner && selectedPanels.has(owner) ? panelBlock(owner) : singlesBlock();
    block.entries.push(
      info?.isHeader
        ? { kind: 'header', name }
        : {
            kind: 'test',
            name,
            unit: info?.unit || '',
            options: info?.options,
            numeric: isNumericTest(info),
          },
    );
  }

  // A panel named on the report but carrying no parameters would render as an
  // empty card, so it is dropped — the pill summary only counts what is here.
  return blocks.filter(block => block.entries.length > 0);
}

const FIELD_BASE =
  'test-result-input w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-[13px] font-bold text-primary transition placeholder:font-medium placeholder:text-on-surface-variant/60 focus:border-accent focus:outline-none';

function PanelPill({ name, count }: { name: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-2.5 py-1 text-[10.5px] font-black uppercase tracking-wide text-primary">
      <span className="truncate">{name}</span>
      {count > 0 && (
        <span className="shrink-0 rounded-full bg-surface-container-lowest/80 px-1.5 text-[9.5px] font-extrabold tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
}

function TestPill({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-outline-variant/40 bg-surface-container-high px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-on-surface-variant">
      <span className="truncate">{name}</span>
    </span>
  );
}

export interface ReportResultsEditorProps {
  /** Panels, section headers and parameters exactly as stored on the report. */
  testSelection: readonly string[];
  /** Free-text fallback for legacy reports that never recorded a selection. */
  testType?: string;
  results: Record<string, string>;
  /** View-only role: fields render but cannot be written. */
  readOnly?: boolean;
  onChange: (testName: string, value: string) => void;
  /** Enter / arrow navigation between result fields, owned by the page. */
  onNavigate?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function ReportResultsEditor({
  testSelection,
  testType,
  results,
  readOnly = false,
  onChange,
  onNavigate,
}: ReportResultsEditorProps) {
  const fieldIdBase = useId();
  const blocks = useMemo(() => buildBlocks(testSelection || []), [testSelection]);

  const paramCount = useMemo(
    () =>
      blocks.reduce((sum, block) => sum + block.entries.filter(e => e.kind === 'test').length, 0),
    [blocks],
  );
  const panels = blocks.filter(b => b.isPanel);
  const singles = blocks.find(b => !b.isPanel);

  if (blocks.length === 0) {
    return (
      <p className="text-sm text-on-surface-variant">
        {testType || 'No tests recorded on this report yet.'}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* What was ordered — panels first, then anything picked on its own */}
      <section aria-label="Ordered tests">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
          <h4 className="text-xs font-black uppercase text-primary">Test Info</h4>
          <p className="text-[11px] font-semibold tabular-nums text-on-surface-variant">
            {panels.length} {panels.length === 1 ? 'panel' : 'panels'} · {paramCount} parameters
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {panels.map(panel => (
            <PanelPill
              key={panel.key}
              name={panel.title}
              count={panel.entries.filter(e => e.kind === 'test').length}
            />
          ))}
          {singles?.entries
            .filter((e): e is LeafEntry => e.kind === 'test')
            .map(entry => (
              <TestPill key={entry.name} name={entry.name} />
            ))}
        </div>
      </section>

      {/* What gets filled in — one card per panel, section bands inside it */}
      <section aria-label="Results">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0.5">
          <h4 className="text-xs font-black uppercase text-primary">Results</h4>
          {readOnly && (
            <p className="text-[11px] font-semibold text-on-surface-variant">View only</p>
          )}
        </div>
        <div className="space-y-4">
          {blocks.map((block, blockIndex) => (
            <section key={block.key} aria-label={block.title}>
              <h5
                className={cn(
                  'mb-1.5 px-1 text-[11px] font-black uppercase tracking-widest',
                  block.isPanel ? 'text-primary' : 'text-on-surface-variant',
                )}
              >
                {block.title}
                {block.isPanel && (
                  <span className="ml-1.5 font-bold tabular-nums text-on-surface-variant">
                    {block.entries.filter(e => e.kind === 'test').length}
                  </span>
                )}
              </h5>
              <div className="divide-y divide-outline-variant/15 overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
                {block.entries.map((entry, entryIndex) => {
                  const rowKey = `${blockIndex}-${entryIndex}`;
                  if (entry.kind === 'header') {
                    return (
                      <p
                        key={rowKey}
                        className="bg-surface-container-low/70 px-3 py-1.5 text-[10.5px] font-black uppercase tracking-wider text-secondary"
                      >
                        {entry.name}
                      </p>
                    );
                  }
                  const fieldId = `${fieldIdBase}-${rowKey}`;
                  const value = results[entry.name] ?? '';
                  return (
                    <div key={rowKey} className="px-3 py-2">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <label
                          htmlFor={fieldId}
                          className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-on-surface"
                        >
                          {entry.name}
                          {entry.unit && (
                            <span className="ml-1.5 text-[10px] font-bold text-on-surface-variant">
                              {entry.unit}
                            </span>
                          )}
                        </label>
                        <div className="w-full shrink-0 sm:w-44">
                          {entry.options?.length ? (
                            <Combobox
                              inputClassName={FIELD_BASE}
                              value={String(value)}
                              options={entry.options}
                              placeholder="Select or type…"
                              ariaLabel={`Result for ${entry.name}`}
                              readOnly={readOnly}
                              onChange={next => onChange(entry.name, next)}
                              onNavigate={onNavigate}
                            />
                          ) : (
                            <input
                              id={fieldId}
                              type="text"
                              inputMode={entry.numeric ? 'decimal' : undefined}
                              aria-label={`Result for ${entry.name}`}
                              value={String(value)}
                              readOnly={readOnly}
                              onChange={e => onChange(entry.name, e.target.value)}
                              onKeyDown={onNavigate}
                              placeholder="Enter result…"
                              className={cn(FIELD_BASE, readOnly && 'bg-surface-container-low')}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
