/**
 * <ReportViewerDashboard> — the read-only "viewing dashboard" for a report.
 *
 * Tapping a report card (or its Preview action) used to jump straight to a
 * generated PDF, which is what a *patient* receives but a poor way for the lab
 * to read a result on a phone: no paging, no zoom, no flag overview. This is
 * the in-app reading surface instead — masthead with the test title and
 * patient line, a flag summary strip, then the results laid out as
 * Parameter / Observed value / Ref. range / Flag tables grouped by category,
 * with out-of-range values coloured and chip-flagged the way the printed
 * report flags them.
 *
 * Everything is derived from the same catalogue the PDF generator uses
 * (lib/pathology-tests), so a value can never be flagged differently on
 * screen than on paper. Output actions (print / PDF / download / share) are
 * delegated to the page, which already owns the jsPDF pipeline.
 */
import { useMemo, useState } from 'react';
import {
  Download,
  FileDown,
  FileSignature,
  FlaskConical,
  PencilLine,
  Printer,
  Share2,
} from 'lucide-react';
import { Button, Sheet, StatusPill } from './ui';
import { cn } from '../lib/utils';
import { findTestInfo, resolveReferenceRange } from '../lib/pathology-tests';
import { ageAsNumber, type PatientRecord, type ReportRecord } from '../lib/models';
import { buildReportLegalLines, resolveSigner } from '../lib/report-compliance';
import { readSettings } from '../lib/settings';
import { useAuth } from '../contexts/AuthContext';

/** What the page's PDF pipeline should do when an action button is tapped. */
export type ViewerOutput = 'print' | 'pdf' | 'download' | 'share';

type Flag = 'high' | 'low' | 'normal';

interface ResultRow {
  name: string;
  category: string;
  value: string;
  unit: string;
  refLabel: string;
  flag: Flag | null;
  /** Group / header entries from the test catalogue, rendered as band rows. */
  group: boolean;
  notes?: string;
}

const FLAG_STYLE: Record<Flag, { chip: string; value: string; label: string }> = {
  high: { chip: 'border-error/50 text-error', value: 'text-error', label: 'HIGH' },
  low: { chip: 'border-warning/60 text-warning', value: 'text-warning', label: 'LOW' },
  normal: { chip: 'border-success/50 text-success', value: 'text-success', label: 'NORMAL' },
};

/**
 * Flag a numeric result against its reference range.
 *
 * Only the first number in the cell is considered ("1.2 - 3.4" style text
 * results and free text stay unflagged), and a range with neither bound
 * (text-only ranges like "Negative") never flags — matching how the PDF
 * renderer treats them.
 */
function flagFor(value: string, ref: { min?: number; max?: number } | null): Flag | null {
  if (!ref || (ref.min === undefined && ref.max === undefined)) return null;
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (ref.max !== undefined && n > ref.max) return 'high';
  if (ref.min !== undefined && n < ref.min) return 'low';
  return 'normal';
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: Flag | 'neutral';
}) {
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low px-3 py-2.5 text-center">
      <p
        className={cn(
          'text-lg font-black tabular-nums leading-tight',
          tone === 'high' && 'text-error',
          tone === 'low' && 'text-warning',
          tone === 'normal' && 'text-success',
          tone === 'neutral' && 'text-on-surface',
        )}
      >
        {value}
      </p>
      <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
        {label}
      </p>
    </div>
  );
}

export interface ReportViewerDashboardProps {
  /** The report on screen, or null while closed (the sheet animates out). */
  report: ReportRecord | null;
  /** Registered patient, for age/gender-specific reference ranges. */
  patient?: PatientRecord;
  onClose: () => void;
  /** Opens the editable Report Details sheet for this report. */
  onEdit: () => void;
  onOutput: (action: ViewerOutput) => void;
}

export function ReportViewerDashboard({
  report,
  patient,
  onClose,
  onEdit,
  onOutput,
}: ReportViewerDashboardProps) {
  const { user } = useAuth();

  // Keep the last report rendered while the sheet animates out, so the exit
  // transition does not flash an empty panel. Adjusting state during render
  // is the documented pattern for remembering a previous prop value.
  const [cached, setCached] = useState<ReportRecord | null>(report);
  if (report && report !== cached) setCached(report);
  const shown = report ?? cached;

  const rows = useMemo<ResultRow[]>(() => {
    if (!shown) return [];
    const age = patient ? ageAsNumber(patient) : undefined;
    const gender = patient?.gender;
    // Ordered panels *plus* every value that was actually recorded.
    //
    // Deriving the rows from `testSelection` alone meant a result stored under a
    // key that is not in that list was invisible here — and on the printed
    // report, which builds its table the same way. A lab could look at a report
    // on screen, see nothing unusual, and hand over a document missing a value
    // that exists in the database.
    const names = [
      ...(shown.testSelection || []),
      ...Object.keys(shown.resultData ?? {}).filter(
        key => !(shown.testSelection || []).includes(key),
      ),
    ];
    return names.map<ResultRow>(name => {
      const info = findTestInfo(name);
      const category = info?.category || 'General';
      if (info?.isGroup || info?.isHeader) {
        return { name, category, value: '', unit: '', refLabel: '', flag: null, group: true };
      }
      const value = String(shown.resultData?.[name] ?? '').trim();
      const range = resolveReferenceRange(info?.ranges, age, gender);
      const notes = [...(info?.notes || []), info?.clinicalSignificance || '']
        .filter(Boolean)
        .join(' ');
      return {
        name,
        category,
        value,
        unit: info?.unit || '',
        refLabel: range.label,
        flag: value ? flagFor(value, range.values) : null,
        group: false,
        notes,
      };
    });
  }, [shown, patient]);

  const sections = useMemo(() => {
    const map = new Map<string, ResultRow[]>();
    for (const row of rows) {
      const list = map.get(row.category);
      if (list) list.push(row);
      else map.set(row.category, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  const counts = useMemo(() => {
    const leaves = rows.filter(r => !r.group);
    return {
      total: leaves.filter(r => r.value).length,
      high: leaves.filter(r => r.flag === 'high').length,
      low: leaves.filter(r => r.flag === 'low').length,
      normal: leaves.filter(r => r.flag === 'normal').length,
    };
  }, [rows]);

  const notes = useMemo(() => rows.filter(r => !r.group && r.notes), [rows]);

  const meta = useMemo(() => {
    if (!shown) return null;
    const s = readSettings();
    const signer = resolveSigner(shown);
    const legal = buildReportLegalLines({
      accreditationBody: s.accreditationBody,
      accreditationNumber: s.accreditationNumber,
      licenceNumber: s.licenceNumber,
      accreditationAttestedAt: s.accreditationAttestedAt,
      signerName: signer,
      signedAt: shown.updatedAt || shown.createdAt,
    });
    const groups = (shown.testSelection || [])
      .map(name => findTestInfo(name))
      .filter(info => info?.isGroup)
      .map(info => info?.name || '');
    return {
      labName: s.labName || 'PathoMitra Lab',
      title: shown.testType || (groups.length ? groups.join(' + ') : 'Pathology Report'),
      signer,
      legalLines: [legal.accreditation, legal.licence, legal.disclaimer].filter(Boolean),
    };
  }, [shown, user]);

  if (!shown || !meta) return null;

  const draft = shown.status === 'draft';
  const age = patient ? ageAsNumber(patient) : undefined;
  const genderInitial = (patient?.gender || 'other').charAt(0).toUpperCase();
  const patientLine =
    `Patient: ${shown.patientName}` +
    (patient ? ` (${age ?? patient.age}/${genderInitial})` : '') +
    ` • Sample #${shown.id.slice(0, 8).toUpperCase()}` +
    ` • ${formatDate(shown.createdAt)}` +
    (patient?.doctorName ? ` • Dr ${patient.doctorName}` : '');

  return (
    <Sheet
      open={!!report}
      onClose={onClose}
      width="xl"
      title={shown.patientName}
      description={meta.title}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PencilLine className="w-4 h-4" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOutput('print')}>
            <Printer className="w-4 h-4" /> Print
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOutput('download')}>
            <Download className="w-4 h-4" /> Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={draft}
            title={draft ? 'Issue the report to share it' : 'Share report'}
            onClick={() => onOutput('share')}
          >
            <Share2 className="w-4 h-4" /> Share
          </Button>
          <Button variant="brand" size="sm" onClick={() => onOutput('pdf')}>
            <FileDown className="w-4 h-4" /> Open PDF
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2 pt-1">
        {/* Masthead — what this document is, who it belongs to */}
        <header className="rounded-2xl border border-primary/25 bg-primary-container/30 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-on-primary shadow-card">
              <FlaskConical className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                {meta.labName}
              </p>
              <h3 className="mt-0.5 text-[15px] font-black leading-snug tracking-[-0.01em] text-primary sm:text-base">
                {meta.title}
              </h3>
              <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-on-surface-variant sm:text-xs">
                {patientLine}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {draft ? (
                <StatusPill tone="warning" dot>
                  Draft
                </StatusPill>
              ) : (
                <StatusPill tone="success" dot>
                  Final
                </StatusPill>
              )}
              {Number(shown.version) > 1 && (
                <StatusPill tone="info">v{Number(shown.version)} amended</StatusPill>
              )}
            </div>
          </div>
        </header>

        {/* Flag summary — the abnormal count is the first thing a clinician wants */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Parameters" value={counts.total} tone="neutral" />
          <StatTile label="Normal" value={counts.normal} tone="normal" />
          <StatTile label="High" value={counts.high} tone="high" />
          <StatTile label="Low" value={counts.low} tone="low" />
        </div>

        {/* Results, grouped the same way the printed report groups them */}
        {sections.map(([category, categoryRows]) => (
          <section key={category} aria-label={`${category} results`}>
            <h4 className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-widest text-on-surface-variant">
              {category}
            </h4>
            <div className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
              <table className="w-full border-separate border-spacing-0 text-left">
                <thead>
                  <tr className="bg-surface-container-high/60 text-[10.5px] font-black uppercase tracking-wider text-on-surface-variant sm:text-[11px]">
                    <th scope="col" className="px-3 py-2.5 font-black">
                      Parameter
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-black">
                      Observed value
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-black">
                      Ref. range
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-black">
                      Flag
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categoryRows.map(row =>
                    row.group ? (
                      <tr key={row.name}>
                        <td
                          colSpan={4}
                          className="border-t border-outline-variant/20 bg-surface-container-low/70 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-secondary"
                        >
                          {row.name}
                        </td>
                      </tr>
                    ) : (
                      <tr key={row.name} className="align-top">
                        <td className="border-t border-outline-variant/15 px-3 py-2.5 text-[12.5px] font-semibold leading-snug text-on-surface sm:text-sm">
                          {row.name}
                        </td>
                        <td className="border-t border-outline-variant/15 px-3 py-2.5">
                          {row.value ? (
                            <span
                              className={cn(
                                'text-[12.5px] font-extrabold tabular-nums sm:text-sm',
                                row.flag ? FLAG_STYLE[row.flag].value : 'text-on-surface',
                              )}
                            >
                              {row.value}
                              {row.unit && (
                                <span className="ml-1 text-[10.5px] font-bold text-on-surface-variant">
                                  {row.unit}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-[12.5px] text-on-surface-variant sm:text-sm">
                              —
                            </span>
                          )}
                        </td>
                        <td className="border-t border-outline-variant/15 px-3 py-2.5 text-[11.5px] font-medium tabular-nums text-on-surface-variant sm:text-xs">
                          {row.refLabel || '—'}
                        </td>
                        <td className="border-t border-outline-variant/15 px-3 py-2.5 text-right">
                          {row.flag ? (
                            <span
                              className={cn(
                                'inline-flex rounded-full border bg-surface-container-lowest px-2 py-0.5 text-[9.5px] font-black tracking-wider',
                                FLAG_STYLE[row.flag].chip,
                              )}
                            >
                              {FLAG_STYLE[row.flag].label}
                            </span>
                          ) : (
                            <span className="text-[10px] text-on-surface-variant">—</span>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {/* Catalogue notes worth reading alongside the numbers */}
        {notes.length > 0 && (
          <section aria-label="Notes and clinical significance">
            <h4 className="mb-1.5 px-1 text-[11px] font-black uppercase tracking-widest text-on-surface-variant">
              Notes & clinical significance
            </h4>
            <div className="space-y-2 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
              {notes.map(row => (
                <p key={row.name} className="text-[12px] leading-relaxed text-on-surface-variant">
                  <span className="font-bold text-on-surface">{row.name}: </span>
                  {row.notes}
                </p>
              ))}
            </div>
          </section>
        )}

        {/* Issue & compliance block. Named "issue" not "signature" because
            the build produces no verifiable digital signature (see
            lib/report-compliance.ts) — the section describes who pressed
            "Issue" and when, not an assurance a third party could check. */}
        <section
          aria-label="Issue details"
          className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4"
        >
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'grid h-9 w-9 shrink-0 place-items-center rounded-full',
                draft
                  ? 'bg-warning-container text-on-warning-container'
                  : 'bg-success-container text-on-success-container',
              )}
            >
              <FileSignature className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-on-surface">
                {draft
                  ? 'Not yet issued'
                  : // The build writes no verifiable signature (see
                    // lib/report-compliance.ts); `meta.signer` is the
                    // display name captured at issue time. Saying "Issued
                    // by" describes the operation the app really does.
                    `Issued by ${meta.signer || 'the lab operator'}`}
              </p>
              <p className="text-[11px] text-on-surface-variant">
                {draft
                  ? 'Draft — results can still change before issue'
                  : `${formatDate(shown.updatedAt || shown.createdAt)} • v${Number(shown.version) || 1}`}
                {shown.amendReason ? ` • ${shown.amendReason}` : ''}
              </p>
            </div>
          </div>
          {meta.legalLines.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-outline-variant/20 pt-3">
              {meta.legalLines.map(line => (
                <li key={line} className="text-[10.5px] leading-relaxed text-on-surface-variant">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}
