/**
 * The report issuance / amendment workflow, expressed as pure domain rules.
 *
 * Why this lives here rather than in the React screen: the two most dangerous
 * clinical guarantees in the app — that an *incomplete* report can never become
 * a issued final, and that an *issued* report can never be silently overwritten
 * — used to be decided by whichever button a screen happened to render. A second
 * entry point (or a future screen) could walk straight past them. The invariants
 * belong in one place every write path must go through, so they hold regardless
 * of UI. `lib/models.ts` still owns the document shape; this owns the *rules*
 * about changing it.
 */
import { toReportDoc, toReportUpdateDoc, type ReportStatus } from './models';

/** The mutable clinical content of a report (everything except status/version). */
export interface ReportContent {
  patientId: string;
  patientName: string;
  resultData: Record<string, unknown>;
  signature: string;
  createdAt: string;
  createdBy: string;
  testType?: string;
  testSelection?: string[];
}

/** A stored report as the write layer needs to see it. */
export interface StoredReport extends ReportContent {
  id: string;
  status: ReportStatus;
  version?: number;
}

/** Expands an ordered panel to its member tests (supplied to keep this pure). */
export type ExpandNames = (names: readonly string[]) => string[];

/** One step of the write plan — the store-agnostic shape a caller commits. */
export type ReportWriteOp =
  | { entity: 'reports'; id: string; value: Record<string, unknown> }
  | { entity: 'reportVersions'; id: string; value: Record<string, unknown> };

export interface ReportWritePlan {
  ok: boolean;
  /** Ordered operations to run as one unit when `ok`. Empty when rejected/no-op. */
  ops: ReportWriteOp[];
  error?: string;
  /** Required results that were blank, when a finalization was rejected. */
  missing?: string[];
  /** This write amends an already-issued report (a prior version is retained). */
  amended?: boolean;
  /** This write promotes/creates a final report. */
  issuing?: boolean;
  nextVersion?: number;
}

/** A recorded value is a non-empty string, a finite number, a boolean, or an object. */
function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/**
 * The ordered tests (panels expanded to members) that still have no value.
 *
 * A blank string is *not* a result — the editor inserts them only to satisfy the
 * document shape, so treating them as complete was the gap that let an empty
 * report issue as a clinical final.
 */
export function findMissingResults(content: ReportContent, expandNames: ExpandNames): string[] {
  const leaves = expandNames(content.testSelection ?? []);
  return leaves.filter(name => !hasValue(content.resultData[name]));
}

/**
 * True when the editable content differs from what is stored.
 *
 * "Changed" is deliberately about the clinical payload (results + what was
 * ordered), not metadata: saving an issued report with nothing different must not
 * mint a new version or fire an amendment alert.
 */
export function isReportContentChanged(existing: StoredReport, next: ReportContent): boolean {
  const existingLeaves = Object.keys(existing.resultData);
  const nextLeaves = Object.keys(next.resultData);
  if (existingLeaves.length !== nextLeaves.length) return true;
  for (const key of nextLeaves) {
    if (!hasValue(existing.resultData[key]) !== !hasValue(next.resultData[key])) return true;
    if (String(existing.resultData[key] ?? '') !== String(next.resultData[key] ?? '')) return true;
  }
  const a = existing.testSelection ?? [];
  const b = next.testSelection ?? [];
  if (a.length !== b.length) return true;
  return a.some((name, i) => name !== b[i]);
}

const priorSnapshotId = (reportId: string, version: number): string => `${reportId}__v${version}`;

/** A complete, attributable record of the version being replaced. */
function buildPriorSnapshot(
  existing: StoredReport,
  existingVersion: number,
  nextVersion: number,
  reason: string,
  operator: string,
  now: string,
): Record<string, unknown> {
  return {
    reportId: existing.id,
    patientId: existing.patientId,
    version: existingVersion,
    ...toReportDoc({ ...existing, status: 'final', version: existingVersion }),
    supersededBy: nextVersion,
    supersededAt: now,
    supersededByOperator: operator,
    supersededReason: reason,
    capturedAt: now,
    capturedBy: operator,
  };
}

/**
 * Decide — and gate — a single report write.
 *
 * Rules, in order of severity:
 *  - Nothing may end up `final` while a required result is blank.
 *  - An issued (`final`) report cannot be converted back to a `draft`.
 *  - Editing an issued report requires a reason and *retains the prior version*
 *    (a `reportVersions` snapshot written before the live row changes), so no
 *    operator can overwrite the only stored copy of what was handed out.
 *  - A new (draft) report may be created incomplete; only issuing is gated.
 *
 * The `history → report` operation order is intentional: on a store without a
 * cross-collection transaction (the desktop adapter), the prior copy is durably
 * saved before the live row is touched, so the sole previous version is never
 * lost even if the second step fails.
 */
export function planReportWrite(args: {
  existing: StoredReport | null;
  /** Required when `existing` is null — the id the caller generated for a new report. */
  newId?: string;
  next: ReportContent & { status: ReportStatus };
  reason?: string;
  operator: string;
  now: string;
  expandNames: ExpandNames;
}): ReportWritePlan {
  const { existing, next, operator, now, expandNames } = args;
  const id = existing?.id ?? args.newId;
  if (!id) {
    return { ok: false, ops: [], error: 'A new report needs an id before it can be written.' };
  }

  const missing = next.status === 'final' ? findMissingResults(next, expandNames) : [];
  if (next.status === 'final' && missing.length > 0) {
    return {
      ok: false,
      ops: [],
      missing,
      error:
        `Cannot issue: ${missing.length} result${missing.length === 1 ? '' : 's'} ` +
        `still blank (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}). ` +
        'Fill every ordered test, or keep it as a draft.',
    };
  }

  // Brand-new report.
  if (!existing) {
    const value = toReportDoc({ ...next, version: 1 });
    return { ok: true, ops: [{ entity: 'reports', id, value }], issuing: next.status === 'final' };
  }

  const existingVersion = Math.max(1, Number(existing.version) || 1);

  // Amending an already-issued report.
  if (existing.status === 'final') {
    if (next.status === 'draft') {
      return {
        ok: false,
        ops: [],
        error: 'An issued report cannot be turned back into a draft. Amend it instead.',
      };
    }
    if (!isReportContentChanged(existing, next)) {
      return { ok: true, ops: [], amended: false }; // nothing to persist
    }
    const reason = (args.reason ?? '').trim();
    if (!reason) {
      return {
        ok: false,
        ops: [],
        error: 'An amendment to an issued report must state a reason.',
      };
    }
    const nextVersion = existingVersion + 1;
    return {
      ok: true,
      amended: true,
      nextVersion,
      ops: [
        {
          entity: 'reportVersions',
          id: priorSnapshotId(existing.id, existingVersion),
          value: buildPriorSnapshot(existing, existingVersion, nextVersion, reason, operator, now),
        },
        {
          entity: 'reports',
          id: existing.id,
          value: {
            ...toReportUpdateDoc({ ...next, version: existingVersion }, existingVersion),
            updatedBy: operator,
            updatedAt: now,
            amendReason: reason,
          },
        },
      ],
    };
  }

  // Editing a draft (optionally promoting it to final — already gated above).
  const nextVersion = existingVersion + 1;
  const value: Record<string, unknown> = {
    ...toReportUpdateDoc({ ...next, version: existingVersion }, existingVersion),
    updatedBy: operator,
    updatedAt: now,
  };
  const reason = (args.reason ?? '').trim();
  if (reason) value.amendReason = reason;
  return {
    ok: true,
    issuing: next.status === 'final',
    nextVersion,
    ops: [{ entity: 'reports', id: existing.id, value }],
  };
}
