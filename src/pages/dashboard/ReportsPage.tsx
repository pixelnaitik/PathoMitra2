import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  db,
} from '../../data/fs';
import { deleteReportCascade } from '../../lib/cascades';
import { useCollectionList, type ListFilter } from '../../hooks/useCollectionList';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { useAuth } from '../../contexts/AuthContext';
import {
  FilePlus,
  Search,
  FileSpreadsheet,
  FileSignature,
  Printer,
  Download,
  ShieldCheck,
  X,
  Plus,
  // Per-status card icon: the check-circle used to sit on every report (draft
  // or issued) and read as a success mark regardless of state. The state model
  // in lib/report-status maps each view status to its own glyph.
  Send,
  GitCompare,
  FileClock,
  AlertCircle,
  Loader2,
  Trash2,
  MoreVertical,
  Share2,
  Eye,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { reportStatusView, ISSUE_REPORT_LABEL, SAVE_DRAFT_LABEL } from '../../lib/report-status';
import {
  CalendarRangePicker,
  Card,
  Combobox,
  EmptyState,
  SearchField,
  Sheet,
  ConfirmSheet,
  Button,
  Skeleton,
  StatusPill,
  toIsoDay,
  useToast,
} from '../../components/ui';

import {
  getSearchableTests,
  resolveReferenceRange,
  findTestInfo,
  searchPathologyTests,
  isNumericTest,
  expandTestSelection,
  type PathologyTest,
} from '../../lib/pathology-tests';
import { recalculateCBC } from '../../lib/report-calculations';
import { THEME_OPTIONS } from '../../lib/theme';
import { readSettings } from '../../lib/settings';
import { getPrintableArea, getColumnWidths } from '../../lib/report-layout';
import {
  buildReportLegalLines,
  resolveSigner,
  type ReportLegalInput,
} from '../../lib/report-compliance';
import { pdfToBase64, printPdf, previewPdf, savePdf, sharePdf } from '../../lib/native-print';
import { getShellKind, hasShellOutput } from '../../lib/native-files';
import { FILE_CHANNEL_ID, showBannerWithPermission } from '../../lib/desktop-notifications';
import { ReportViewerDashboard } from '../../components/ReportViewerDashboard';
import { PrintDialog, type PrintJob } from '../../components/PrintDialog';
import { ReportResultsEditor } from '../../components/ReportResultsEditor';
import { createdAtRangeFilters } from '../../lib/date-range';
import { generateDefaultTemplateImage } from '../../lib/default-template';
import {
  readReports,
  readPatients,
  ageAsNumber,
  operatorStamp,
  type PatientRecord,
  type ReportRecord,
  type ReportStatus,
} from '../../lib/models';
import { findMissingResults, planReportWrite, type ReportWriteOp } from '../../lib/report-workflow';
import { downloadCsv, toCsv } from '../../lib/export-csv';
import { normalisePhone } from '../../lib/patient-registry';

/** A report plus the staff-only note hydrated from `reportNotes`. */
type SelectedReport = ReportRecord & { privateNotes?: string };

/** One card in the mixed grid: an existing report, or a patient still waiting for one. */
type ListEntry =
  | (ReportRecord & { itemType: 'report'; timestamp: string })
  | (PatientRecord & { itemType: 'patient'; timestamp: string });

/**
 * `resultData` is validated loosely at the boundary (legacy documents hold
 * numbers, blanks and the occasional object), while the derived-value math works
 * on strings only. Coerce once here instead of at every keystroke.
 */
const asResultMap = (data: Record<string, unknown> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(data ?? {}).map(([key, value]) => [key, String(value ?? '')]));

/** Older forms saved names with stray padding; announcements must not repeat it. */
const spokenName = (name: string | undefined) => (name || '').trim() || 'this report';

export default function ReportsPage({
  initialReportId,
  clearAction,
  initialCreateReportPatientId,
  clearCreateAction,
}: {
  initialReportId?: string | null;
  clearAction?: () => void;
  initialCreateReportPatientId?: string | null;
  clearCreateAction?: () => void;
}) {
  const { user, role } = useAuth();
  const toast = useToast();
  /** Guests are told the records are view-only; the UI must not offer writes. */
  const canEdit = role !== 'guest';
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<SelectedReport | null>(null);
  // The read-only viewing dashboard: card taps and Preview land here, while the
  // editable Report Details sheet is reached through Edit / Finish draft.
  const [viewerReport, setViewerReport] = useState<ReportRecord | null>(null);
  /** The Windows print sheet's document — set by the Print action, cleared on close. */
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [reportToDelete, setReportToDelete] = useState<ReportRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingResults, setSavingResults] = useState(false);
  // P0.4: an edit to an already-issued report must carry an amendment reason, so
  // the change is attributable. Kept in state (not just the function argument)
  // so an inline field-level error can name it without discarding typed values.
  const [amendReason, setAmendReason] = useState('');
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Row menus: dismiss on any outside click or Escape, and only while a menu is
  // actually open — the listener used to run for the whole life of the page.
  useEffect(() => {
    if (!activeMenuId) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      setActiveMenuId(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [activeMenuId]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.target instanceof HTMLSelectElement) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const inputs = Array.from(
            document.querySelectorAll('.test-result-input'),
          ) as HTMLElement[];
          const currentIndex = inputs.indexOf(e.target as HTMLElement);
          if (currentIndex !== -1 && currentIndex + 1 < inputs.length) {
            inputs[currentIndex + 1].focus();
          }
        }
        return;
      }

      const inputs = Array.from(document.querySelectorAll('.test-result-input')) as HTMLElement[];
      const currentIndex = inputs.indexOf(e.target as HTMLElement);
      if (currentIndex !== -1) {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
          e.preventDefault();
          const nextInput = inputs[currentIndex + 1];
          if (nextInput) nextInput.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prevInput = inputs[currentIndex - 1];
          if (prevInput) prevInput.focus();
        }
      }
    }
  };

  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [isPatientDropdownOpen, setIsPatientDropdownOpen] = useState(false);
  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [isTestDropdownOpen, setIsTestDropdownOpen] = useState(false);
  const [testActiveIdx, setTestActiveIdx] = useState(0);
  const testListRef = useRef<HTMLDivElement>(null);

  const [newReport, setNewReport] = useState({
    patientId: '',
    testSelection: [] as string[],
    results: {} as Record<string, string>,
  });

  // UI-P0-02 — the "review" the audit asks for is not a separate screen; it
  // is the composer telling the operator, live, which ordered tests still
  // have no value so the Issue action cannot fire while the clinical payload
  // is incomplete. The old behaviour was: leave the button enabled, let the
  // submit path throw "Cannot issue: N ordered tests still has no value", and
  // hope the operator read the error panel. Same rules as `handleCreateReport`
  // uses at submit time, computed from the same source (`findMissingResults`)
  // so the preconditions on the button and the preconditions inside the
  // handler can never disagree.
  const composerMissing = useMemo(() => {
    if (!isModalOpen || newReport.testSelection.length === 0) return [];
    return findMissingResults(
      {
        patientId: newReport.patientId,
        patientName: '',
        resultData: newReport.results,
        signature: '',
        createdAt: '',
        createdBy: '',
        testSelection: newReport.testSelection,
      },
      expandTestSelection,
    );
  }, [isModalOpen, newReport.patientId, newReport.testSelection, newReport.results]);

  const filteredAvailableTests = useMemo(
    () =>
      searchPathologyTests(
        testSearchQuery,
        getSearchableTests(newReport.testSelection, testSearchQuery),
      ),
    [newReport.testSelection, testSearchQuery],
  );
  // Clamp where it is read so narrowing the list can never strand the highlight
  // past the end — avoids a reset-in-effect (which would cascade a render).
  const activeTestIdx = filteredAvailableTests.length
    ? Math.min(testActiveIdx, filteredAvailableTests.length - 1)
    : 0;

  // Arrow-key navigation must keep the highlighted test visible.
  useEffect(() => {
    if (!isTestDropdownOpen) return;
    const el = testListRef.current?.children[activeTestIdx] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [activeTestIdx, isTestDropdownOpen]);

  const addReportTest = (test: PathologyTest) => {
    let testsToAdd = [test.name];
    if (test.isGroup && test.includedTests) testsToAdd = [test.name, ...test.includedTests];
    const newAdditions = testsToAdd.filter(t => !newReport.testSelection.includes(t));
    if (newAdditions.length > 0) {
      setNewReport({
        ...newReport,
        testSelection: [...newReport.testSelection, ...newAdditions],
      });
    }
    setTestSearchQuery('');
    setIsTestDropdownOpen(false);
  };

  const handleTestKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isTestDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsTestDropdownOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      setIsTestDropdownOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setTestActiveIdx(Math.min(activeTestIdx + 1, filteredAvailableTests.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setTestActiveIdx(Math.max(activeTestIdx - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const picked = filteredAvailableTests[activeTestIdx];
      if (picked) {
        e.preventDefault();
        addReportTest(picked);
      }
    }
  };

  // Date bounds go to Firestore, so filtering narrows what is *read* instead of
  // narrowing whatever happens to be loaded. `createdAt` is a full ISO string,
  // and the picker selects a *local* calendar day — the same day the calendar
  // dots are grouped by — so the bounds come from lib/date-range rather than a
  // hand-padded `${day}T00:00:00.000Z`, which silently means UTC midnight and
  // would drop early-morning reports into the previous day.
  const reportFilters = useMemo<ListFilter[]>(() => {
    const list: ListFilter[] = [];
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    if (since) list.push({ field: 'createdAt', op: '>=', value: since });
    if (until) list.push({ field: 'createdAt', op: '<=', value: until });
    return list;
  }, [fromDate, toDate]);

  // Live, cursor-paginated window over `reports`. This used to subscribe to the
  // entire collection, so every edit anywhere in the lab re-read every report
  // ever created. `map: readReports` also validates each document at the
  // boundary instead of letting a malformed one surface mid-render.
  const reportsList = useCollectionList<ReportRecord>({
    path: 'reports',
    map: readReports,
    pageSize: 25,
    filters: reportFilters,
    onError: error => handleFirestoreError(error, OperationType.GET, 'reports'),
  });
  const reports = reportsList.items;

  useEffect(() => {
    if (initialReportId && reports.length > 0) {
      const foundReport = reports.find(r => r.id === initialReportId);
      if (foundReport) {
        setViewerReport({ ...foundReport });
        clearAction?.();
      }
    }
  }, [initialReportId, reports, clearAction]);

  // Private notes live in the staff-only reportNotes collection; hydrate the
  // selected report with its note when opened. Guests cannot read that
  // collection, so asking only produces a permission error in the console.
  useEffect(() => {
    const reportId = selectedReport?.id;
    if (!reportId || !canEdit) return;
    let cancelled = false;
    getDoc(doc(db, 'reportNotes', reportId))
      .then(noteDoc => {
        if (cancelled || !noteDoc.exists()) return;
        const note = noteDoc.data().note || '';
        setSelectedReport((current: any) =>
          current && current.id === reportId ? { ...current, privateNotes: note } : current,
        );
      })
      .catch(err => console.error('Failed to load report note:', err));
    return () => {
      cancelled = true;
    };
  }, [selectedReport?.id, canEdit]);

  useEffect(() => {
    if (initialCreateReportPatientId && patients.length > 0) {
      const foundPatient = patients.find(p => p.id === initialCreateReportPatientId);
      if (foundPatient) {
        setNewReport({
          patientId: foundPatient.id,
          testSelection: foundPatient.testSelection || [],
          results: {},
        });
        setPatientSearchQuery(foundPatient.name);
        setIsModalOpen(true);
        clearCreateAction?.();
      }
    }
  }, [initialCreateReportPatientId, patients, clearCreateAction]);

  useEffect(() => {
    const path = 'patients';
    // Ordered by name for the patient picker, which filters this list
    // client-side — so it is deliberately not paginated.
    const q = query(collection(db, path), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        setPatients(readPatients(snapshot.docs));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );
    return () => unsubscribe();
  }, []);

  /**
   * Commit a domain write plan as one unit.
   *
   * The plan from `planReportWrite` is executed through `writeBatch` so the
   * amendment-history row and the report row land together (a real SQLCipher
   * transaction on the native store). Reports merge (so an immutable field like
   * `createdBy` is never blanked by a patch); history rows are written whole.
   */
  const commitReportOps = async (ops: ReportWriteOp[]): Promise<void> => {
    if (ops.length === 0) return;
    const batch = writeBatch(db);
    for (const op of ops) {
      const ref = doc(collection(db, op.entity), op.id);
      if (op.entity === 'reports') batch.set(ref, op.value, { merge: true });
      else batch.set(ref, op.value);
    }
    await batch.commit();
  };

  const handleCreateReport = async (e: React.FormEvent, status: ReportStatus = 'final') => {
    e.preventDefault();
    setLoading(true);
    setModalError(null);
    try {
      if (!newReport.patientId) {
        throw new Error('No patient selected. Please search and select a patient first.');
      }

      // Ensure all selected tests have at least an empty string entry if not filled, to prevent undefined values in Firestore
      const sanitizedResults: Record<string, string> = {};
      newReport.testSelection.forEach(testName => {
        const testInfo = findTestInfo(testName);
        if (!testInfo?.isGroup && !testInfo?.isHeader) {
          sanitizedResults[testName] = newReport.results[testName] || '';
        }
      });

      const patient = patients.find(p => p.id === newReport.patientId);
      const timestamp = new Date().toISOString();
      const patientName = patient?.name || 'Unknown';

      // Offline: no signing service, no patient-facing QR mirror, no billing.
      // The report is written straight to the encrypted local store. The
      // `signature` column holds the issuing operator's display name — the
      // printable signer — rather than being left empty while the document
      // claimed an electronic verification that never happened.
      const reportRef = doc(collection(db, 'reports'));
      const content = {
        patientId: newReport.patientId,
        patientName,
        resultData: sanitizedResults,
        signature: (user?.displayName ?? '').slice(0, 128),
        createdAt: timestamp,
        createdBy: operatorStamp(user),
        testSelection: newReport.testSelection,
      };
      // P0.5: the issuance gate is a domain rule, not a button. A blank value is
      // not a result — so an ordered panel member with nothing recorded blocks
      // issuing. A draft saves incomplete; only a complete report can be final.
      if (status === 'final') {
        const missing = findMissingResults(content, expandTestSelection);
        if (missing.length > 0) {
          throw new Error(
            `Cannot issue: ${missing.length} ordered test${missing.length === 1 ? '' : 's'} ` +
              `still has no value (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}). ` +
              'Fill every result, or save as a draft.',
          );
        }
      }
      const plan = planReportWrite({
        existing: null,
        newId: reportRef.id,
        next: { ...content, status },
        operator: operatorStamp(user),
        now: timestamp,
        expandNames: expandTestSelection,
      });
      if (!plan.ok) throw new Error(plan.error ?? 'Report could not be saved.');
      await commitReportOps(plan.ops);

      setIsModalOpen(false);
      setNewReport({ patientId: '', testSelection: [], results: {} });
      setPatientSearchQuery('');
      setTestSearchQuery('');
      setModalError(null);
      toast.success(
        status === 'final'
          ? `Report issued for ${patientName}.`
          : `Draft saved for ${patientName}.`,
      );
    } catch (err: any) {
      console.error(err);
      setModalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Persist edited results through the report-workflow domain rules.
   *
   * The decision (may this issue? does it need a reason? must the prior version
   * be retained?) is made once, in `planReportWrite`. This screen only collects
   * input, runs the plan, and reports the outcome — it cannot walk past a rule.
   */
  const handleSaveResults = async (reasonOverride?: string, issue = false) => {
    if (!selectedReport) return;
    setSavingResults(true);
    setDetailError(null);
    const target = selectedReport;
    try {
      const now = new Date().toISOString();
      const targetStatus: ReportStatus =
        issue && target.status === 'draft' ? 'final' : target.status;
      const content = {
        patientId: target.patientId,
        patientName: target.patientName,
        resultData: target.resultData,
        signature: target.signature,
        createdAt: target.createdAt,
        createdBy: target.createdBy,
        testType: target.testType,
        testSelection: target.testSelection ?? [],
      };
      const plan = planReportWrite({
        existing: { ...content, id: target.id, status: target.status, version: target.version },
        next: { ...content, status: targetStatus },
        reason: reasonOverride ?? amendReason,
        operator: operatorStamp(user),
        now,
        expandNames: expandTestSelection,
      });
      if (!plan.ok) {
        // A domain rule refused the write. Keep the sheet open and every value
        // already entered; only tell the operator what is blocking them.
        setDetailError(plan.error ?? 'The report could not be saved.');
        return;
      }
      await commitReportOps(plan.ops);
      setSelectedReport(null);
      setAmendReason('');
      toast.success(
        plan.amended
          ? `Report amended (v${plan.nextVersion}).`
          : plan.issuing
            ? `Report issued for ${target.patientName}.`
            : 'Results saved.',
      );
      // Updating UI is handled by the local store subscription
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'reports');
      toast.error('Saving failed — the report was left unchanged.');
    } finally {
      setSavingResults(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedReport) return;
    setSavingNote(true);
    try {
      // Private notes live in a staff-only collection, never on the publicly
      // readable report document.
      await setDoc(doc(db, 'reportNotes', selectedReport.id), {
        reportId: selectedReport.id,
        note: selectedReport.privateNotes || '',
        updatedAt: new Date().toISOString(),
      });
      setSelectedReport(null);
      toast.success('Private note saved.');
      // Updating UI is handled by onSnapshot
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'reports');
    } finally {
      setSavingNote(false);
    }
  };

  const patient_report = async (
    report: any,
    action: 'print' | 'preview' | 'download' | 'share' = 'print',
  ) => {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const patient = patients.find(p => p.id === report.patientId) || {
      name: report.patientName,
      age: 'N/A',
      gender: 'N/A',
      doctorName: 'Self',
      id: report.patientId || '',
      createdAt: report.createdAt,
    };

    // Filename carries the report's identity, not only the patient's name.
    // `<name>_lab_report.pdf` meant two patients with the same name wrote over
    // each other's file, a v2 amendment silently replaced the v1 that had already
    // been handed over, and the patient's name appeared in a path that Windows
    // indexes and any file browser shows. The name stays inside the document.
    const reportVersion = Number(report.version) || 1;
    const issuedDay = toIsoDay(
      new Date(report.updatedAt || report.createdAt || new Date().toISOString()),
    );
    const filename = `PathoMitra-${issuedDay}-${String(report.id || 'draft').slice(-6)}-v${reportVersion}.pdf`;

    // Get template, margins and typography from centrally-managed lab settings
    const s = readSettings();
    const template =
      action === 'share'
        ? s.shareTemplate || s.reportTemplate || 'blank'
        : s.reportTemplate || 'blank';
    const labName = s.labName
      ? template === 'classic'
        ? s.labName.toUpperCase()
        : s.labName
      : 'PathoMitra Report';

    // Credential / issuance wording for this document. Derived, never typed
    // inline: an accreditation only prints when the operator has attested it,
    // and the signature line says what actually happened rather than claiming
    // a verification service this offline build does not have.
    // The signer is whoever issued the stored report, not whoever is viewing
    // it — printing the current operator's name on a colleague's report would
    // be a fresh misattribution.
    const legalInput: ReportLegalInput = {
      accreditationBody: s.accreditationBody,
      accreditationNumber: s.accreditationNumber,
      licenceNumber: s.licenceNumber,
      accreditationAttestedAt: s.accreditationAttestedAt,
      signerName: resolveSigner(report),
      signedAt: report.updatedAt || report.createdAt,
    };
    const legal = buildReportLegalLines(legalInput);

    // ---- Premium PDF palette ------------------------------------------------
    // Brand RGB is derived from the lab's active web palette so printed reports
    // match the product identity. 'blank' keeps the legacy rendering exactly.
    type Rgb = [number, number, number];
    const legacy = template === 'blank';
    const brandHex = (THEME_OPTIONS.find(t => t.id === (s.themeId || 'navy')) || THEME_OPTIONS[0])
      .previewColor;
    const hexToRgb = (hex: string): Rgb => {
      const m = hex.replace('#', '');
      return [
        parseInt(m.slice(0, 2), 16),
        parseInt(m.slice(2, 4), 16),
        parseInt(m.slice(4, 6), 16),
      ];
    };
    const mixWhite = (rgb: Rgb, amt: number): Rgb => [
      Math.round(rgb[0] + (255 - rgb[0]) * amt),
      Math.round(rgb[1] + (255 - rgb[1]) * amt),
      Math.round(rgb[2] + (255 - rgb[2]) * amt),
    ];
    const BRAND = hexToRgb(brandHex);
    const BRAND_DARK: Rgb = [
      Math.round(BRAND[0] * 0.62),
      Math.round(BRAND[1] * 0.62),
      Math.round(BRAND[2] * 0.62),
    ];
    const BRAND_TINT = mixWhite(BRAND, 0.93); // patient-box fill
    const BRAND_TINT2 = mixWhite(BRAND, 0.8); // patient-box border / rules
    const BRAND_SOFT = mixWhite(BRAND, 0.86); // category band
    const INK: Rgb = [29, 29, 31];
    const INK_SOFT: Rgb = [102, 102, 109];
    const BLACK: Rgb = [0, 0, 0];
    const HAIRLINE: Rgb = legacy ? BLACK : mixWhite(BRAND, 0.72);
    const labelCol = legacy ? BLACK : INK_SOFT;
    const valueCol = legacy ? BLACK : INK;
    // --------------------------------------------------------------------------
    const customMarginTop = action === 'share' ? s.shareMarginTop : s.reportMarginTop;
    const customMarginBottom = action === 'share' ? s.shareMarginBottom : s.reportMarginBottom;
    const customMarginLeft = action === 'share' ? s.shareMarginLeft : s.reportMarginLeft;
    const customMarginRight = action === 'share' ? s.shareMarginRight : s.reportMarginRight;
    const reportTitleFontSize = s.reportTitleFontSize;
    const patientInfoFontSize = s.patientInfoFontSize;
    const patientLineHeight = s.patientLineHeight;
    const reportSectionGap = s.reportSectionGap;
    const tableHeaderFontSize = s.tableHeaderFontSize;
    const tableBodyFontSize =
      action === 'share'
        ? (s.shareTableBodyFontSize ?? s.tableBodyFontSize ?? 10)
        : (s.reportTableBodyFontSize ?? s.tableBodyFontSize ?? 10);
    const tableCellPadding = s.tableCellPadding;
    const notesFontSize = s.notesFontSize;
    const footerFontSize = s.footerFontSize;
    let sharingTemplateImage = s.sharingTemplateImage || '';

    if (action === 'share' && !sharingTemplateImage) {
      try {
        const loadDefaultShareImage = (): Promise<string> => {
          return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg'));
              } else {
                resolve(generateDefaultTemplateImage(labName, legalInput));
              }
            };
            img.onerror = () => {
              resolve(generateDefaultTemplateImage(labName, legalInput));
            };
            img.src = '/default-share-template.png';
          });
        };
        sharingTemplateImage = await loadDefaultShareImage();
      } catch (e) {
        console.error('Failed to load default sharing template background', e);
        sharingTemplateImage = generateDefaultTemplateImage(labName, legalInput);
      }
    } else if (!sharingTemplateImage) {
      try {
        sharingTemplateImage = generateDefaultTemplateImage(labName, legalInput);
      } catch (e) {
        console.error('Failed to generate default sharing template background', e);
      }
    }

    // Wrapped PDF generation logic to support standard rendering and Option C compact rendering
    const generatePdf = (compactMode: boolean = false) => {
      const doc = new jsPDF();
      doc.setProperties({
        title: filename,
      });

      // Apply compacted parameters if compactMode is enabled
      let cellPadding = tableCellPadding;
      let bodyFontSize = tableBodyFontSize;
      let sectionGap = reportSectionGap;
      let ptLineHeight = patientLineHeight;
      let mTop = customMarginTop;
      let mBottom = customMarginBottom;
      const mLeft = customMarginLeft;
      const mRight = customMarginRight;

      if (compactMode) {
        cellPadding = Math.max(0.6, tableCellPadding - 0.45);
        bodyFontSize = Math.max(7.5, tableBodyFontSize - 0.7);
        sectionGap = Math.max(3, reportSectionGap - 2);
        ptLineHeight = Math.max(4.0, patientLineHeight - 1.0);
        mTop = Math.max(25, customMarginTop - 8);
        mBottom = Math.max(12, customMarginBottom - 5);
      }

      // Shared with the live A4 preview (src/lib/report-layout) so the printed
      // PDF and the Settings preview always agree on the printable width.
      const totalWidth = getPrintableArea({
        top: mTop,
        bottom: mBottom,
        left: mLeft,
        right: mRight,
      }).width;
      const [col0Width, col1Width, col2Width, col3Width] = getColumnWidths(totalWidth);

      // Function to draw the complete header including lab name, patient info, and table columns header
      const drawFullHeader = () => {
        // Draw custom background template when sharing if provided
        if (action === 'share' && sharingTemplateImage) {
          try {
            const format = sharingTemplateImage
              .substring(sharingTemplateImage.indexOf('/') + 1, sharingTemplateImage.indexOf(';'))
              .toUpperCase();
            doc.addImage(sharingTemplateImage, format === 'PNG' ? 'PNG' : 'JPEG', 0, 0, 210, 297);
          } catch (e) {
            console.error('Failed to draw sharing template image', e);
          }
        }

        let currentY = mTop;

        // 1. Lab Header
        if (template === 'minimalist') {
          // Editorial: quiet wordmark, wide-tracked descriptor, single hairline
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(reportTitleFontSize - 3);
          doc.setTextColor(INK[0], INK[1], INK[2]);
          doc.text(labName, mLeft, currentY);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.max(6.5, reportTitleFontSize - 11));
          doc.setTextColor(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2]);
          doc.text('D I G I T A L   P A T H O L O G Y   R E P O R T', mLeft, currentY + 5);
          doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
          doc.setLineWidth(0.2);
          doc.line(mLeft, currentY + 8.5, 210 - mRight, currentY + 8.5);
          currentY += sectionGap + 4;
        } else if (template === 'classic') {
          // Formal: double rules framing a centered serif masthead
          doc.setDrawColor(BLACK[0], BLACK[1], BLACK[2]);
          doc.setLineWidth(0.9);
          doc.line(mLeft - 5, currentY - 3, 210 - mRight + 5, currentY - 3);
          doc.setLineWidth(0.2);
          doc.line(mLeft - 5, currentY - 1.4, 210 - mRight + 5, currentY - 1.4);
          doc.setFont('times', 'bold');
          doc.setFontSize(reportTitleFontSize + 2);
          doc.setTextColor(0, 0, 0);
          doc.text(labName, 105, currentY + 5.5, { align: 'center' });
          doc.setFont('times', 'italic');
          doc.setFontSize(Math.max(8, reportTitleFontSize - 8));
          doc.setTextColor(60, 60, 60);
          doc.text(legal.tagline, 105, currentY + 11, {
            align: 'center',
          });
          doc.setLineWidth(0.2);
          doc.line(mLeft - 5, currentY + 13.5, 210 - mRight + 5, currentY + 13.5);
          doc.setLineWidth(0.9);
          doc.line(mLeft - 5, currentY + 15.1, 210 - mRight + 5, currentY + 15.1);
          currentY += sectionGap * 2 + 9;
        } else if (template === 'blank') {
          currentY += sectionGap;
        } else {
          // Modern: accent keystone, left wordmark, right meta, full-bleed hairline
          doc.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
          doc.roundedRect(mLeft, currentY - 4.2, 1.7, 10.5, 0.85, 0.85, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(reportTitleFontSize);
          doc.setTextColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
          doc.text(labName, mLeft + 4.6, currentY);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(Math.max(6.5, reportTitleFontSize - 11));
          doc.setTextColor(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2]);
          doc.text('DIGITAL PATHOLOGY REPORT', mLeft + 4.8, currentY + 5.2);
          // Right-aligned report meta
          doc.setFontSize(8);
          doc.text(
            `Report No. ${(report.id || '').substring(0, 8).toUpperCase() || 'N/A'}`,
            210 - mRight,
            currentY - 1,
            { align: 'right' },
          );
          doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
          doc.setFont('helvetica', 'bold');
          const printableStatus =
            report.status === 'draft'
              ? 'DRAFT — NOT ISSUED'
              : report.status === 'final'
                ? 'FINAL'
                : 'STATUS UNCONFIRMED';
          doc.text(printableStatus, 210 - mRight, currentY + 5.2, { align: 'right' });
          doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
          doc.setLineWidth(0.3);
          doc.line(mLeft, currentY + 9, 210 - mRight, currentY + 9);
          currentY += sectionGap * 1.5 + 6;
        }

        // 2. Patient Details
        const startY = currentY + 4;
        const lh = ptLineHeight;

        const ptNameLines = doc.splitTextToSize(`: ${patient.name || ''}`, totalWidth * (55 / 180));
        const nameHeightOffset = (ptNameLines.length - 1) * ptLineHeight;

        const boxTop = startY - 12;
        const boxHeight = lh * 2 + nameHeightOffset + 15;

        if (template === 'modern') {
          doc.setFillColor(BRAND_TINT[0], BRAND_TINT[1], BRAND_TINT[2]);
          doc.setDrawColor(BRAND_TINT2[0], BRAND_TINT2[1], BRAND_TINT2[2]);
          doc.setLineWidth(0.25);
          doc.roundedRect(mLeft - 5, boxTop, totalWidth + 10, boxHeight, 2.6, 2.6, 'FD');
        } else if (template === 'classic') {
          doc.setDrawColor(0);
          doc.setLineWidth(0.5);
          doc.rect(mLeft - 5, boxTop, totalWidth + 10, boxHeight, 'S');
          doc.setLineWidth(0.15);
          doc.rect(mLeft - 3.8, boxTop + 1.2, totalWidth + 7.6, boxHeight - 2.4, 'S');
        } else if (template === 'minimalist') {
          doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
          doc.setLineWidth(0.2);
          doc.line(mLeft - 5, boxTop + boxHeight + 1, 210 - mRight + 5, boxTop + boxHeight + 1);
        }

        doc.setFontSize(patientInfoFontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(labelCol[0], labelCol[1], labelCol[2]);
        if (!legacy) doc.setCharSpace(0.25);

        const drawLabel = () => {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(labelCol[0], labelCol[1], labelCol[2]);
          doc.setCharSpace(legacy ? 0 : 0.25);
        };
        const drawValue = () => {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(valueCol[0], valueCol[1], valueCol[2]);
          doc.setCharSpace(0);
        };

        // Left column
        drawLabel();
        doc.text('Patient Name', mLeft, startY);
        drawValue();
        doc.text(ptNameLines, mLeft + 27, startY);

        drawLabel();
        doc.text('Ref By', mLeft, startY + lh + nameHeightOffset);
        doc.text('Patient ID', mLeft, startY + lh * 2 + nameHeightOffset);

        drawValue();
        doc.text(`: ${patient.doctorName || 'Self'}`, mLeft + 27, startY + lh + nameHeightOffset);
        doc.text(
          `: ${patient.id ? patient.id.substring(0, 8).toUpperCase() : 'N/A'}`,
          mLeft + 27,
          startY + lh * 2 + nameHeightOffset,
        );

        // Middle column (Age, Sex, Reported on) - shifted slightly to the right
        const formatDateTime = (isoString: string) => {
          if (!isoString) return '';
          const d = new Date(isoString);
          return `${d.toLocaleDateString('en-IN').replace(/\//g, '-')} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
        };

        drawLabel();

        doc.text('Age', mLeft + 97, startY);
        doc.text('Sex', mLeft + 97, startY + lh + nameHeightOffset);
        doc.text('Reported on', mLeft + 97, startY + lh * 2 + nameHeightOffset);

        drawValue();

        doc.text(`: ${patient.age} Years`, mLeft + 120, startY);
        doc.text(
          `: ${patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}`,
          mLeft + 120,
          startY + lh + nameHeightOffset,
        );
        const repDate = formatDateTime(report.createdAt);
        doc.text(`: ${repDate}`, mLeft + 120, startY + lh * 2 + nameHeightOffset);

        // 4. Table Columns Header
        const columnsHeaderY =
          startY + Math.max(lh * 3, lh * 2 + nameHeightOffset) + sectionGap + 5;

        const headerX0 = mLeft + 1.5;
        const headerX1 = mLeft + col0Width + 1.5;
        const headerX2 = mLeft + col0Width + col1Width + 1.5;
        const headerX3 = mLeft + col0Width + col1Width + col2Width + 1.5;

        if (!legacy && template !== 'classic') {
          // Solid brand band with reversed type (modern) / airy hairlines (minimalist)
          if (template === 'modern') {
            doc.setFillColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
            doc.roundedRect(mLeft - 5, columnsHeaderY - 6.2, totalWidth + 10, 9.5, 1.6, 1.6, 'F');
            doc.setTextColor(255, 255, 255);
          } else {
            doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
            doc.setLineWidth(0.2);
            doc.line(mLeft, columnsHeaderY - 5, 210 - mRight, columnsHeaderY - 5);
            doc.setTextColor(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2]);
          }
          doc.setFontSize(tableHeaderFontSize);
          doc.setFont('helvetica', 'bold');
          doc.setCharSpace(0.4);
          doc.text('TEST DESCRIPTION', headerX0, columnsHeaderY);
          doc.text('RESULT', headerX1, columnsHeaderY);
          doc.text('UNITS', headerX2, columnsHeaderY);
          doc.text('REFERENCE RANGE', headerX3, columnsHeaderY);
          doc.setCharSpace(0);
          if (template === 'minimalist') {
            doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
            doc.line(mLeft, columnsHeaderY + 2, 210 - mRight, columnsHeaderY + 2);
          }
        } else {
          doc.setDrawColor(0);
          doc.setLineWidth(0.5);
          doc.line(mLeft, columnsHeaderY - 5, 210 - mRight, columnsHeaderY - 5);

          doc.setFontSize(tableHeaderFontSize);
          doc.setFont('helvetica', 'bold');
          doc.setCharSpace(0);
          doc.setTextColor(0);

          doc.text('TEST DESCRIPTION', headerX0, columnsHeaderY);
          doc.text('RESULT', headerX1, columnsHeaderY);
          doc.text('UNITS', headerX2, columnsHeaderY);
          doc.text('REFERENCE RANGE', headerX3, columnsHeaderY);
          doc.line(mLeft, columnsHeaderY + 2, 210 - mRight, columnsHeaderY + 2);
        }

        return columnsHeaderY + 3; // return finalY to start writing table rows
      };

      // Draw the first page header immediately
      let finalY = drawFullHeader();

      const pagesWithHeader = new Set<number>();
      pagesWithHeader.add((doc.internal as any).getCurrentPageInfo().pageNumber);

      const onDidDrawPage = () => {
        const pageNum = (doc.internal as any).getCurrentPageInfo().pageNumber;
        if (!pagesWithHeader.has(pageNum)) {
          drawFullHeader();
          pagesWithHeader.add(pageNum);
        }
      };

      // Use the finalY from full header as our top margin, so subsequent pages start correctly below the header
      const autoTableMarginTop = finalY;

      // Group tests by category
      const testsByCategory: Record<string, string[]> = {};

      (report.testSelection || []).forEach((testName: string) => {
        if (
          testName === 'DIFFERENTIAL COUNT WBC' ||
          testName === 'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT'
        ) {
          return;
        }
        const testInfo = findTestInfo(testName);
        const category = testInfo?.category || 'GENERAL';
        if (!testsByCategory[category]) testsByCategory[category] = [];
        testsByCategory[category].push(testName);
      });

      if (report.resultData) {
        Object.keys(report.resultData).forEach(testName => {
          if (
            testName === 'DIFFERENTIAL COUNT WBC' ||
            testName === 'DIFFERENTIAL LEUCOCYTE ABSOLUTE COUNT'
          ) {
            return;
          }
          if (!(report.testSelection || []).includes(testName)) {
            const testInfo = findTestInfo(testName);
            const category = testInfo?.category || 'GENERAL';
            if (!testsByCategory[category]) testsByCategory[category] = [];
            testsByCategory[category].push(testName);
          }
        });
      }

      const buildTableDataForCategories = (categoriesList: string[]) => {
        const data: any[] = [];
        categoriesList.forEach(category => {
          if (!testsByCategory[category] || testsByCategory[category].length === 0) return;

          // Add Category Header
          const catStyles: any = {
            fontStyle: 'bold',
            cellPadding: {
              top: Math.max(1.5, cellPadding * 2.5),
              bottom: Math.max(1.5, cellPadding * 2.5),
              left: 2,
            },
            halign: 'center',
          };
          if (legacy) {
            catStyles.fillColor = false;
            catStyles.textColor = [0, 0, 0];
          } else if (template === 'classic') {
            catStyles.fillColor = false;
            catStyles.textColor = [0, 0, 0];
            catStyles.lineWidth = { top: 0.15, bottom: 0.15, left: 0, right: 0 };
            catStyles.lineColor = [0, 0, 0];
          } else if (template === 'modern') {
            catStyles.fillColor = BRAND_SOFT;
            catStyles.textColor = BRAND_DARK;
            catStyles.halign = 'left';
            catStyles.cellPadding = {
              top: Math.max(2, cellPadding * 2.6),
              bottom: Math.max(2, cellPadding * 2.6),
              left: 3,
            };
          } else {
            // minimalist: airy small-caps label, hairline above
            catStyles.fillColor = false;
            catStyles.textColor = INK_SOFT;
            catStyles.halign = 'left';
            catStyles.lineWidth = { top: 0.2, bottom: 0, left: 0, right: 0 };
            catStyles.lineColor = HAIRLINE;
            catStyles.cellPadding = {
              top: Math.max(2.6, cellPadding * 3.4),
              bottom: Math.max(1.2, cellPadding * 1.4),
              left: 0,
            };
          }
          data.push([{ content: category.toUpperCase(), colSpan: 4, styles: catStyles }]);

          // Add tests for this category
          testsByCategory[category].forEach(testName => {
            const testInfo = findTestInfo(testName);
            if (testInfo?.isGroup || testInfo?.isHeader) {
              let groupFill: any = false;
              let groupText: Rgb;
              if (legacy) {
                groupFill = testInfo.isGroup ? [248, 250, 252] : false;
                groupText = [11, 60, 93];
              } else if (template === 'classic') {
                groupFill = false;
                groupText = [0, 0, 0];
              } else if (template === 'modern') {
                groupFill = testInfo.isGroup ? BRAND_TINT : false;
                groupText = BRAND_DARK;
              } else {
                groupText = BRAND;
              }
              data.push([
                {
                  content: testName,
                  colSpan: 4,
                  styles: {
                    fontStyle: 'bold',
                    fillColor: groupFill,
                    textColor: groupText,
                    cellPadding: {
                      top: Math.max(1.5, cellPadding * 1.8),
                      bottom: Math.max(1.5, cellPadding * 1.8),
                      left: 2,
                    },
                    halign: testInfo.isGroup
                      ? legacy || template === 'classic' || template === 'modern'
                        ? 'center'
                        : 'left'
                      : 'left',
                  },
                },
              ]);
              return;
            }

            const result = report.resultData[testName] || '';
            const range = resolveReferenceRange(
              testInfo?.ranges,
              ageAsNumber(patient),
              patient.gender,
            );
            const refRangeLabel = range.label;
            const refValues = range.values;
            const unit = testInfo?.unit || '';
            const method = testInfo?.method ? `\nMethod: ${testInfo.method}` : '';

            let formattedResult: any = result;
            if (result && refValues && !isNaN(Number(result))) {
              const numResult = Number(result);
              let isBold = false,
                suffix = '';
              if (refValues.min !== undefined && numResult < refValues.min) {
                isBold = true;
                suffix = '__DOWN__';
              } else if (refValues.max !== undefined && numResult > refValues.max) {
                isBold = true;
                suffix = '__UP__';
              }
              if (isBold)
                formattedResult = { content: result + suffix, styles: { fontStyle: 'bold' } };
            }
            data.push([testName + method, formattedResult, unit, refRangeLabel]);
          });
        });
        return data;
      };

      const commonTableOpts = {
        theme: (!legacy && template === 'classic' ? 'grid' : 'plain') as 'grid' | 'plain',
        showHead: false,
        pageBreak: 'auto' as const,
        margin: { top: autoTableMarginTop, left: mLeft, right: mRight, bottom: mBottom },
        styles: {
          cellPadding: cellPadding,
          fontSize: bodyFontSize,
          textColor: 0,
          ...(legacy
            ? {}
            : template === 'classic'
              ? { lineColor: [190, 196, 202] as Rgb, lineWidth: 0.1 }
              : { font: 'helvetica', textColor: INK }),
        },
        columnStyles: {
          0: { cellWidth: col0Width },
          1: { cellWidth: col1Width },
          2: { cellWidth: col2Width },
          3: { cellWidth: col3Width },
        },
        didParseCell: function (data: any) {
          if (data.section === 'body' && data.column.index === 1) {
            if (data.cell.raw && typeof data.cell.raw === 'object' && 'content' in data.cell.raw) {
              const content = String((data.cell.raw as any).content);
              if (content.includes('__UP__')) {
                data.cell.text[0] = content.replace('__UP__', '').trim();
                (data.cell as any).drawArrow = 'up';
              } else if (content.includes('__DOWN__')) {
                data.cell.text[0] = content.replace('__DOWN__', '').trim();
                (data.cell as any).drawArrow = 'down';
              }
            }
          }
          // Modern/minimalist: soften reference + unit columns
          if (
            !legacy &&
            template !== 'classic' &&
            data.section === 'body' &&
            (data.column.index === 2 || data.column.index === 3)
          ) {
            data.cell.styles.textColor = INK_SOFT;
          }
        },
        didDrawCell: function (data: any) {
          // Hairline row separators for the airy templates
          if (
            !legacy &&
            template !== 'classic' &&
            data.section === 'body' &&
            data.column.index === 3
          ) {
            doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
            doc.setLineWidth(0.1);
            doc.line(
              mLeft,
              data.cell.y + data.cell.height,
              210 - mRight,
              data.cell.y + data.cell.height,
            );
          }
          if (data.section === 'body' && data.column.index === 1 && (data.cell as any).drawArrow) {
            const isHigh = (data.cell as any).drawArrow === 'up';
            doc.setFontSize(bodyFontSize + 0.8);
            doc.setFont('helvetica', 'bold');
            const textWidth = doc.getTextWidth(data.cell.text[0] || '');
            let padding = 3;
            if (typeof data.cell.styles.cellPadding === 'number') {
              padding = data.cell.styles.cellPadding;
            } else if (
              data.cell.styles.cellPadding &&
              typeof data.cell.styles.cellPadding === 'object'
            ) {
              padding = (data.cell.styles.cellPadding as any).left || 3;
            }
            const x = data.cell.x + padding + textWidth + 3;
            const y = data.cell.y + data.cell.height / 2;

            const arrowCol: Rgb =
              !legacy && template !== 'classic' ? (isHigh ? [176, 42, 58] : BRAND) : BLACK;
            doc.setFillColor(arrowCol[0], arrowCol[1], arrowCol[2]);
            doc.setDrawColor(arrowCol[0], arrowCol[1], arrowCol[2]);
            doc.setLineWidth(0.4);
            const w = 1.0;
            const hh = 1.2;

            if (isHigh) {
              doc.line(x + w / 2, y + 1.5, x + w / 2, y - 1.5 + hh);
              doc.triangle(x, y - 1.5 + hh, x + w / 2, y - 1.5, x + w, y - 1.5 + hh, 'FD');
            } else {
              doc.line(x + w / 2, y - 1.5, x + w / 2, y + 1.5 - hh);
              doc.triangle(x, y + 1.5 - hh, x + w / 2, y + 1.5, x + w, y + 1.5 - hh, 'FD');
            }
          }
        },
        didDrawPage: onDidDrawPage,
      };

      const availableCategories = Object.keys(testsByCategory);
      const blocks: { categories: string[] }[] = [];

      const otherCategories = availableCategories.filter(
        c => c !== 'HAEMATOLOGY' && c !== 'CLINICAL PATHOLOGY',
      );
      if (otherCategories.length > 0) {
        blocks.push({ categories: otherCategories });
      }

      if (availableCategories.includes('HAEMATOLOGY')) {
        blocks.push({ categories: ['HAEMATOLOGY'] });
      }

      if (availableCategories.includes('CLINICAL PATHOLOGY')) {
        blocks.push({ categories: ['CLINICAL PATHOLOGY'] });
      }

      let isFirstBlock = true;
      blocks.forEach(block => {
        const blockData = buildTableDataForCategories(block.categories);
        if (blockData.length === 0) return;

        if (!isFirstBlock) {
          doc.addPage();
          const newPageNum = (doc.internal as any).getCurrentPageInfo().pageNumber;
          finalY = drawFullHeader();
          pagesWithHeader.add(newPageNum);
        } else {
          isFirstBlock = false;
        }

        autoTable(doc, {
          startY: finalY,
          body: blockData,
          ...commonTableOpts,
        });
        finalY = (doc as any).lastAutoTable.finalY + Math.max(sectionGap, 8);
      });

      // Keep track of which page the last actual test row rendered on
      const lastTestPage = (doc.internal as any).getCurrentPageInfo().pageNumber;

      finalY += 4;

      const checkPageBreak = (neededHeight: number) => {
        if (finalY + neededHeight > 297 - mBottom) {
          doc.addPage();
          const pageNum = (doc.internal as any).getCurrentPageInfo().pageNumber;
          if (!pagesWithHeader.has(pageNum)) {
            drawFullHeader();
            pagesWithHeader.add(pageNum);
          }
          finalY = autoTableMarginTop + 2;
        }
      };

      checkPageBreak(5);
      doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
      doc.setLineWidth(legacy ? 0.5 : 0.2);
      doc.line(mLeft, finalY, 210 - mRight, finalY);
      finalY += 10;

      // Draw clinical significance or notes
      const testsWithNotes = (report.testSelection || [])
        .map((t: string) => findTestInfo(t))
        .filter((t: any) => t?.notes || t?.clinicalSignificance);

      if (testsWithNotes.length > 0) {
        doc.setFontSize(notesFontSize);
        testsWithNotes.forEach((testInfo: any) => {
          doc.setFont('helvetica', 'bold');
          doc.setCharSpace(0);

          if (testInfo.notes && testInfo.notes.length > 0) {
            checkPageBreak(5 + testInfo.notes.length * 4.5);
            if (legacy) {
              doc.setTextColor(0);
              doc.text('NOTE-', mLeft, finalY);
            } else {
              doc.setTextColor(BRAND_DARK[0], BRAND_DARK[1], BRAND_DARK[2]);
              doc.text('NOTE —', mLeft, finalY);
            }
            finalY += 4;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(legacy ? 0 : INK[0], legacy ? 0 : INK[1], legacy ? 0 : INK[2]);
            testInfo.notes.forEach((note: string) => {
              doc.text(note, mLeft, finalY);
              finalY += 4.5;
            });
            finalY += 2;
          }

          if (testInfo.clinicalSignificance) {
            const splitText = doc.splitTextToSize(testInfo.clinicalSignificance, totalWidth);
            checkPageBreak(8 + splitText.length * 4.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(
              legacy ? 0 : BRAND_DARK[0],
              legacy ? 0 : BRAND_DARK[1],
              legacy ? 0 : BRAND_DARK[2],
            );
            doc.text(legacy ? 'Clinical significance :' : 'Clinical significance —', mLeft, finalY);
            finalY += 4;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(legacy ? 0 : INK[0], legacy ? 0 : INK[1], legacy ? 0 : INK[2]);
            doc.text(splitText, mLeft, finalY);
            finalY += splitText.length * 4.5 + 5;
          }
        });

        checkPageBreak(5);
        doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2]);
        doc.setLineWidth(legacy ? 0.5 : 0.2);
        doc.line(mLeft, finalY, 210 - mRight, finalY);
        finalY += 10;
      }

      checkPageBreak(10);

      // Issuance record, any attested credential, and the professional-use
      // disclaimer. Printed on the document itself so a patient or referring
      // doctor can see who issued it and that it is not externally verifiable.
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(Math.max(7, footerFontSize - 2));
      doc.setTextColor(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2]);
      const closingLines = [
        legal.accreditation,
        legal.licence,
        legal.signer,
        legal.disclaimer,
      ].filter(Boolean);
      closingLines.forEach((line, i) => {
        doc.text(line, mLeft, finalY + i * 4.2);
      });
      finalY += closingLines.length * 4.2 + 2;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(footerFontSize);
      if (!legacy) {
        doc.setTextColor(INK_SOFT[0], INK_SOFT[1], INK_SOFT[2]);
        doc.setCharSpace(0.3);
        doc.text('— End of Report —', 105, finalY, { align: 'center' });
        doc.setCharSpace(0);
      } else {
        doc.text('*** End of Report ***', 105, finalY, { align: 'center' });
      }

      return { doc, lastTestPage };
    };

    // First Rendering Pass (Standard settings)
    const firstPass = generatePdf(false);
    let doc = firstPass.doc;
    const { lastTestPage } = firstPass;
    const totalPages = (doc.internal as any).getNumberOfPages();

    // Option C: If only "End of Report" or note sections spilled over onto a new page,
    // re-run in compactMode to auto-shrink the vertical coordinates and pull them back onto the preceding page.
    if (totalPages > 1 && lastTestPage === totalPages - 1) {
      const compacted = generatePdf(true);
      doc = compacted.doc;
    }

    // Draw page numbers for all pages of the final selected PDF document
    const finalTotalPages = (doc.internal as any).getNumberOfPages();
    for (let i = 1; i <= finalTotalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(Math.max(8, footerFontSize - 2));
      doc.setTextColor(100, 100, 100);
      doc.text(`Page ${i} of ${finalTotalPages}`, 105, 297 - 11, { align: 'center' });
    }

    if (action === 'print') {
      // Windows gets the app's own print sheet: printer, page range, copies,
      // orientation and a live preview, spooled through webContents.print().
      // On the APK this raises the system print sheet (printers + "Save as
      // PDF"); in a browser it keeps opening the autoPrint blob in a tab.
      if (getShellKind() === 'desktop') {
        setPrintJob({ title: `Report — ${patient.name}`, filename, pdfBase64: pdfToBase64(doc) });
        return;
      }
      try {
        await printPdf(doc, filename);
      } catch (err) {
        console.error('Error opening the print dialog:', err);
        toast.error('Could not open the print dialog. Use Download instead.');
      }
    } else if (action === 'preview') {
      // In a browser the PDF opens in a new tab; on the APK previewPdf writes
      // the file and hands it to the device's own PDF viewer (Chrome, Drive,
      // an OEM reader), falling back to the print sheet only when the device
      // has no PDF-capable app at all.
      try {
        const message = await previewPdf(doc, filename);
        // Non-null only when the tab was refused — the file was downloaded then,
        // so this is a detour to report, not a failure.
        if (message) toast.warning(message);
      } catch (err) {
        console.error('Error opening the report preview:', err);
        toast.error('Could not open the report preview. Use Download instead.');
      }
    } else if (action === 'share') {
      // The WebView has no `navigator.share` and ignores `window.open`, so the
      // old Web-Share-plus-wa.me fallback did nothing at all on a phone. On
      // device the PDF is written to storage and handed to the system sheet,
      // where the user picks the real destination (WhatsApp, Drive, email…).
      try {
        const message = await sharePdf(
          doc,
          filename,
          'Diagnostic Report',
          `Diagnostic report for ${patient.name}`,
        );
        // Non-null only for outcomes worth a word: saved-but-no-share-target, or
        // a browser that had to download instead. A dismissed sheet is null.
        if (message) toast.info(message);
      } catch (err) {
        console.error('Error sharing report:', err);
        toast.error('Could not share the report. Use Download instead.');
      }
    } else {
      // Download. `doc.save()` is silently dead in the WebView — including from
      // the two error toasts above that tell the user to use it — so on device
      // the file goes through the Filesystem plugin and names where it landed.
      try {
        const message = await savePdf(doc, filename);
        if (message) toast.success(message);
        // A toast is gone in three seconds and the operator is usually already
        // looking at the next screen, so on a device the same receipt is posted to
        // the notification shade — named by file, which is what gets checked before
        // anything is printed. A browser download needs neither: its own bar says
        // it, and prompting for notification permission for that would be noise.
        if (hasShellOutput()) {
          void showBannerWithPermission({
            key: `download:${filename}`,
            title: 'Downloaded',
            body: message ?? filename,
            channelId: FILE_CHANNEL_ID,
          });
        }
      } catch (err) {
        console.error('Error saving the report:', err);
        toast.error('Could not save the report to this device.');
      }
    }
  };

  // Days that actually hold activity, for the calendar dots. `toIsoDay` is the
  // local day — the same one the grid and the range filter compare against, so
  // an evening record cannot be painted into the wrong box.
  const activeReportDates = useMemo(
    () => new Set(reports.filter(r => r.createdAt).map(r => toIsoDay(new Date(r.createdAt)))),
    [reports],
  );

  const combinedList = useMemo<ListEntry[]>(
    () =>
      [
        ...reports.map((r): ListEntry => ({ ...r, itemType: 'report', timestamp: r.createdAt })),
        ...patients
          .filter(p => !reports.some(r => r.patientId === p.id))
          .map((p): ListEntry => ({ ...p, itemType: 'patient', timestamp: p.createdAt })),
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [reports, patients],
  );

  // What is left for the client is the substring match. Every word typed has to
  // appear somewhere on the row, and the row is matched on more than the name: a
  // patient's registration number, a report id, a phone in any formatting and the
  // ordered panel/test names all identify a report at the bench, and none of them
  // used to be searchable — "Filter by patient name" was the only door.
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const filteredCombinedList = useMemo(() => {
    const terms = deferredSearch.split(/\s+/).filter(Boolean);
    return combinedList.filter(item => {
      if (terms.length > 0) {
        const haystack = [
          item.itemType === 'report' ? item.patientName : item.name || '',
          item.id,
          item.itemType === 'report' ? item.patientId : '',
          'phone' in item ? (item.phone ?? '') : '',
          'phone' in item ? normalisePhone(String(item.phone ?? '')) : '',
          item.testType ?? '',
          ...(item.testSelection ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!terms.every(term => haystack.includes(term))) return false;
      }
      if (!item.createdAt) return true;
      const day = toIsoDay(new Date(item.createdAt));
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      return true;
    });
  }, [combinedList, deferredSearch, fromDate, toDate]);

  // An empty window used to look like an empty lab: searching for last month's
  // patient returned "no results" because only the newest page was loaded, and the
  // walk stopped at 250 records — so a settled lab's older history was simply
  // unfindable. The local store keeps the collection in memory already, so walking
  // the rest costs a re-slice and nothing else.
  const scanning =
    deferredSearch.length > 0 && filteredCombinedList.length === 0 && reportsList.hasMore;

  useEffect(() => {
    if (!scanning || reportsList.loadingMore) return;
    void reportsList.loadMore();
  }, [scanning, reportsList]);

  const exportFilteredCsv = async () => {
    if (filteredCombinedList.length === 0) {
      toast.warning('Nothing to export — widen the filter first.');
      return;
    }
    const csv = toCsv<ListEntry>(
      [
        {
          label: 'Type',
          value: item => (item.itemType === 'report' ? 'Report' : 'Awaiting report'),
        },
        {
          label: 'Patient',
          value: item => (item.itemType === 'report' ? item.patientName : item.name),
        },
        { label: 'Status', value: item => (item.itemType === 'report' ? item.status : 'pending') },
        { label: 'Tests', value: item => (item.testSelection || []).join(' | ') },
        { label: 'Date', value: item => item.createdAt },
        { label: 'Record ID', value: item => item.id },
      ],
      filteredCombinedList,
    );
    try {
      const message = await downloadCsv(`pathomitra-reports-${toIsoDay(new Date())}.csv`, csv);
      toast.success(message ?? `Exported ${filteredCombinedList.length} records to CSV.`);
    } catch (err) {
      console.error('Error writing the CSV export:', err);
      toast.error('Could not write the CSV on this device.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-md gap-2">
          <SearchField
            className="flex-1"
            placeholder="Filter by name, patient number, report id or test…"
            aria-label="Filter reports by patient name"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            onClear={() => setSearchTerm('')}
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activeReportDates}
            onChange={({ fromDate: from, toDate: to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30 w-full sm:w-60"
          />
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
          <Button variant="outline" size="sm" onClick={exportFilteredCsv}>
            <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
          {role !== 'guest' && (
            // The shared <Button> so this toolbar matches the identical
            // "Export CSV + primary CTA" row on the Patients and Doctors tabs.
            <Button variant="brand" size="lg" shine onClick={() => setIsModalOpen(true)}>
              <FilePlus className="w-5 h-5" aria-hidden="true" />
              New Report
            </Button>
          )}
        </div>
      </div>

      {reportsList.loading && (
        <div
          className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-3 gap-6"
          aria-busy="true"
          aria-label="Loading reports"
        >
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6"
            >
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="mt-4 h-5 w-2/3" />
              <Skeleton className="mt-2 h-3.5 w-1/3" />
              <Skeleton className="mt-6 h-3 w-full" />
            </div>
          ))}
        </div>
      )}

      {/* A listener failure must be visible: silently showing an empty list in a
          lab that has records is worse than admitting the read failed. */}
      {!reportsList.loading && reportsList.error && reports.length === 0 && (
        <Card pad="none">
          <EmptyState
            icon={<AlertCircle className="h-7 w-7" />}
            title="Reports could not be loaded"
            description={`${reportsList.error} — your data is safe; reloading will try again.`}
            action={
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        </Card>
      )}

      {!reportsList.loading && scanning && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-on-surface-variant"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Searching older records…
        </p>
      )}

      {!reportsList.loading && filteredCombinedList.length === 0 && !scanning && (
        <Card pad="none">
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title={deferredSearch ? `No record matches “${searchTerm.trim()}”` : 'No reports yet'}
            description={
              deferredSearch
                ? 'Nothing matched in the loaded records. Narrow the date range, or clear the filter to browse everything.'
                : 'Register a patient, then build their first issued report.'
            }
            action={
              deferredSearch ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm('');
                    setFromDate('');
                    setToDate('');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                role !== 'guest' && (
                  <Button onClick={() => setIsModalOpen(true)}>
                    <FilePlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    New report
                  </Button>
                )
              )
            }
          />
        </Card>
      )}

      {filteredCombinedList.length > 0 && (
        <div className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCombinedList.map((item, idx) => {
            if (item.itemType === 'report') {
              const report = item;
              // One source of truth for every state visual on the card. Before
              // this, the same Draft card wore a check-circle "success" mark,
              // a green test-type pill that read as an issued badge, AND a
              // small amber "Draft" pill lower down — three different visual
              // answers to "has this report gone out?". The state model picks
              // the icon, tone, label and distribution gate from one lookup.
              const statusView = reportStatusView({
                status: report.status,
                version: report.version,
              });
              const StatusIcon =
                statusView.icon === 'draft'
                  ? FileClock
                  : statusView.icon === 'amended'
                    ? GitCompare
                    : Send;
              const statusTint =
                statusView.tone === 'warning'
                  ? 'bg-warning-container text-on-warning-container'
                  : statusView.tone === 'info'
                    ? 'bg-info-container text-on-info-container'
                    : 'bg-success-container text-on-success-container';
              return (
                <motion.div
                  key={`report-${report.id}`}
                  onClick={() => setViewerReport({ ...report })}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{
                    delay: Math.min(idx * 0.04, 0.5),
                    type: 'spring',
                    stiffness: 260,
                    damping: 24,
                  }}
                  className="cursor-pointer bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-card hover:shadow-raised transition-shadow relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full -mr-8 -mt-8 transition duration-300 group-hover:scale-150 group-hover:bg-accent/10" />

                  <div className="flex justify-between items-start mb-6 relative z-20">
                    <div
                      className={cn(
                        'w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner',
                        statusTint,
                      )}
                      aria-hidden="true"
                    >
                      <StatusIcon className="w-6 h-6" />
                    </div>
                    <div className="flex items-center gap-2">
                      {/* The old pill printed the test type against a hard-coded
                          success container — every card looked issued-green. The
                          state pill is now the only upper-right badge, and it
                          reads from the same statusView that drives the icon. */}
                      <StatusPill tone={statusView.tone} dot>
                        {statusView.label}
                        {statusView.icon === 'amended' && ` v${Number(report.version) || 2}`}
                      </StatusPill>
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={`More actions for ${spokenName(report.patientName)}`}
                          aria-haspopup="menu"
                          aria-expanded={activeMenuId === report.id}
                          onClick={e => {
                            e.stopPropagation();
                            setActiveMenuId(activeMenuId === report.id ? null : report.id);
                          }}
                          className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        <AnimatePresence>
                          {activeMenuId === report.id && (
                            <motion.div
                              role="menu"
                              aria-label="Report actions"
                              initial={{ opacity: 0, scale: 0.95, y: -10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -10 }}
                              className="absolute right-0 top-full mt-2 w-44 bg-surface-container-lowest/90 backdrop-blur-md rounded-xl shadow-float border border-outline-variant/20 overflow-hidden z-30"
                            >
                              {report.status === 'draft' && (
                                <button
                                  role="menuitem"
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setSelectedReport({ ...report });
                                    setActiveMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-3 text-sm font-bold text-secondary hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                                >
                                  <FileSignature className="w-4 h-4 text-on-surface-variant" />
                                  Finish draft
                                </button>
                              )}
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setViewerReport({ ...report });
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                              >
                                <Eye className="w-4 h-4 text-on-surface-variant" />
                                Preview
                              </button>
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  patient_report(report, 'download');
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-2 border-b border-outline-variant/10"
                              >
                                <Download className="w-4 h-4 text-on-surface-variant" />
                                Download
                              </button>
                              <button
                                role="menuitem"
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  setReportToDelete(report);
                                  setActiveMenuId(null);
                                }}
                                className="w-full text-left px-4 py-3 text-sm font-bold text-error hover:bg-error-container/20 transition-colors flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1 mb-6 relative z-10">
                    <h3 className="text-xl font-bold text-primary truncate">
                      {report.patientName}
                    </h3>
                    {/* Test type moved here from the removed upper-right badge so
                        the card still tells the operator what panel was ordered.
                        The status pill sits top-right and reads from the same
                        state model as the icon — no duplicate Draft / Issued
                        chip further down the card. */}
                    <p className="text-xs text-on-surface-variant font-medium">
                      {statusView.description}
                    </p>
                    {report.testType && (
                      <p className="text-[13px] font-semibold text-on-surface-variant truncate">
                        {report.testType}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10 relative z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter">
                        Patient ID
                      </span>
                      <span className="text-xs font-mono font-bold text-primary">
                        {report.patientId
                          ? report.patientId.length > 10
                            ? report.patientId.substring(0, 8) + '...'
                            : report.patientId
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        aria-label={`View report for ${spokenName(report.patientName)}`}
                        onClick={() => setViewerReport({ ...report })}
                        className="p-2 bg-surface-container hover:bg-primary-container hover:text-on-primary-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20"
                        title="View report"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Print report for ${spokenName(report.patientName)}`}
                        onClick={() => patient_report(report, 'print')}
                        className="p-2 bg-surface-container hover:bg-primary-container hover:text-on-primary-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20"
                        title="Print report"
                      >
                        <Printer className="w-5 h-5" />
                      </button>
                      {/* A draft has no patient-facing copy at all: sharing it would put an
                    unverifiable report in front of the patient, so the action is
                    disabled rather than silently producing a different PDF. */}
                      <button
                        type="button"
                        disabled={report.status === 'draft'}
                        aria-label={
                          report.status === 'draft'
                            ? 'Share is unavailable until the report is issued'
                            : `Share report for ${spokenName(report.patientName)}`
                        }
                        onClick={() => patient_report(report, 'share')}
                        className={cn(
                          'p-2 bg-surface-container hover:-translate-y-0.5 rounded-xl transition shadow-card z-20',
                          report.status === 'draft'
                            ? 'opacity-40 cursor-not-allowed text-on-surface-variant'
                            : 'hover:bg-secondary text-secondary hover:text-on-secondary',
                        )}
                        title={
                          report.status === 'draft'
                            ? 'Issue the report to share it'
                            : 'Share Report'
                        }
                      >
                        <Share2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            } else {
              const patient = item;
              return (
                <motion.div
                  key={`patient-${patient.id}`}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: Math.min(idx * 0.04, 0.5),
                    type: 'spring',
                    stiffness: 260,
                    damping: 24,
                  }}
                  onClick={() => {
                    setNewReport({
                      patientId: patient.id,
                      testSelection: patient.testSelection || [],
                      results: {},
                    });
                    setPatientSearchQuery(patient.name);
                    setIsModalOpen(true);
                  }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                  className="cursor-pointer bg-surface-container-lowest p-6 rounded-3xl border border-secondary/30 shadow-card hover:shadow-raised transition-shadow relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-secondary/5 rounded-full -mr-8 -mt-8 transition duration-300 group-hover:scale-150 group-hover:bg-secondary/10" />

                  <div className="flex justify-between items-start mb-6 relative z-10">
                    <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center text-secondary shadow-inner">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <span className="px-3 py-1 bg-error-container/50 text-error font-black text-xs uppercase tracking-widest rounded-full">
                      Awaiting Report
                    </span>
                  </div>

                  <div className="space-y-1 mb-6 relative z-10">
                    <h3 className="text-xl font-bold text-primary truncate">{patient.name}</h3>
                    <p className="text-xs text-on-surface-variant font-medium">
                      Age: {patient.age}y • Gender:{' '}
                      {patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1)}{' '}
                      {(patient.testSelection?.length ?? 0) > 0
                        ? `• Tests: ${patient.testSelection?.length}`
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10 relative z-10">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-on-surface-variant uppercase tracking-tighter">
                        Registered
                      </span>
                      <span className="text-xs font-mono font-bold text-primary">
                        {new Date(patient.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <button className="text-xs font-bold bg-secondary text-on-secondary px-3 py-1.5 rounded-lg flex items-center gap-1 shadow-card">
                      <Plus className="w-3 h-3" /> Fill Details
                    </button>
                  </div>
                </motion.div>
              );
            }
          })}
        </div>
      )}

      {/* Older reports are fetched on demand: the live subscription only holds
          the most recent page, so the list cannot grow without bound. */}
      {!reportsList.loading && reportsList.hasMore && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            loading={reportsList.loadingMore}
            onClick={() => void reportsList.loadMore()}
          >
            {deferredSearch ? 'Keep searching older records' : 'Load older records'}
          </Button>
          <span className="text-xs text-on-surface-variant">
            {reports.length} reports loaded in this session
          </span>
        </div>
      )}

      {!scanning && !reportsList.loading && !reportsList.hasMore && (
        <p className="text-center text-xs text-on-surface-variant">
          {deferredSearch
            ? `${reports.length + patients.length} record${reports.length + patients.length === 1 ? '' : 's'} searched — nothing matched that`
            : `${reports.length} report${reports.length === 1 ? '' : 's'} loaded in this session`}
        </p>
      )}

      {/* Create Report Modal */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setNewReport({ patientId: '', testSelection: [], results: {} });
          setPatientSearchQuery('');
          setTestSearchQuery('');
          setModalError(null);
        }}
        title="Generate Diagnostic Report"
        width="lg"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
            <Button
              variant="outline"
              className="w-full sm:flex-1"
              onClick={() => {
                setIsModalOpen(false);
                setNewReport({ patientId: '', testSelection: [], results: {} });
                setPatientSearchQuery('');
                setTestSearchQuery('');
                setModalError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:flex-1"
              disabled={!newReport.patientId || loading}
              onClick={e => handleCreateReport(e, 'draft')}
            >
              <span className="truncate">{SAVE_DRAFT_LABEL}</span>
            </Button>
            <Button
              type="submit"
              form="create-report-form"
              variant="brand"
              className="w-full sm:flex-1"
              loading={loading}
              disabled={!newReport.patientId || composerMissing.length > 0}
              title={
                composerMissing.length > 0
                  ? `Enter a value for ${composerMissing.length} pending test${composerMissing.length === 1 ? '' : 's'} before issuing, or Save as draft`
                  : undefined
              }
            >
              {!loading && <Send className="h-5 w-5 shrink-0" aria-hidden="true" />}
              <span className="truncate">
                {composerMissing.length > 0
                  ? `Issue report (${composerMissing.length} incomplete)`
                  : ISSUE_REPORT_LABEL}
              </span>
            </Button>
          </div>
        }
      >
        <form id="create-report-form" onSubmit={handleCreateReport} className="space-y-6">
          {modalError && (
            <div className="p-4 bg-error-container border border-error/30 text-on-error-container rounded-2xl flex items-start gap-2.5 shadow-card text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-error" />
              <div className="flex-1">
                <h5 className="font-bold">Could not issue the report</h5>
                <p className="text-xs mt-0.5 opacity-90">{modalError}</p>
              </div>
              <button
                type="button"
                onClick={() => setModalError(null)}
                className="p-1 hover:bg-error-container rounded"
              >
                <X className="w-4 h-4 text-error" />
              </button>
            </div>
          )}
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="space-y-1 flex-1 relative">
                <label
                  htmlFor="report-patient-search"
                  className="text-xs font-black text-primary uppercase ml-1"
                >
                  Search & Select Patient
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                  <input
                    id="report-patient-search"
                    required={!newReport.patientId}
                    type="text"
                    value={patientSearchQuery}
                    onChange={e => {
                      setPatientSearchQuery(e.target.value);
                      setIsPatientDropdownOpen(true);
                      if (newReport.patientId) {
                        setNewReport({ ...newReport, patientId: '' });
                      }
                    }}
                    onFocus={() => setIsPatientDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsPatientDropdownOpen(false), 200)}
                    className="w-full pl-9 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition font-bold text-primary"
                    placeholder="Type to search patients..."
                  />
                  {isPatientDropdownOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-float max-h-48 overflow-y-auto top-full left-0">
                      {(() => {
                        const filteredPatients = patients.filter(p =>
                          p.name.toLowerCase().includes(patientSearchQuery.toLowerCase()),
                        );
                        return filteredPatients.length > 0 ? (
                          filteredPatients.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onMouseDown={e => {
                                e.preventDefault();
                                setNewReport({
                                  ...newReport,
                                  patientId: p.id,
                                  testSelection: p.testSelection || [],
                                });
                                setPatientSearchQuery(p.name);
                                setIsPatientDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-surface-container-low transition-colors border-b border-outline-variant/5 last:border-0"
                            >
                              <div className="flex justify-between items-center">
                                <span className="font-bold">{p.name}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/5 last:border-0">
                            No patients found.
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1 md:w-1/3 relative">
                <label className="text-xs font-black text-primary uppercase ml-1">
                  Add Additional Test
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={isTestDropdownOpen}
                    aria-controls="report-test-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      isTestDropdownOpen && filteredAvailableTests[activeTestIdx]
                        ? `report-test-opt-${activeTestIdx}`
                        : undefined
                    }
                    aria-label="Search and add tests"
                    value={testSearchQuery}
                    onChange={e => {
                      setTestSearchQuery(e.target.value);
                      setTestActiveIdx(0);
                      setIsTestDropdownOpen(true);
                    }}
                    onFocus={() => setIsTestDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsTestDropdownOpen(false), 150)}
                    onKeyDown={handleTestKeyDown}
                    className="w-full pl-9 pr-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition font-bold text-primary"
                    placeholder="Search and add tests..."
                  />

                  {isTestDropdownOpen && (
                    <div
                      ref={testListRef}
                      id="report-test-listbox"
                      role="listbox"
                      aria-label="Available tests"
                      className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-float max-h-48 overflow-y-auto top-full left-0"
                    >
                      {filteredAvailableTests.length > 0 ? (
                        filteredAvailableTests.map((test, idx) => (
                          <button
                            key={test.id}
                            id={`report-test-opt-${idx}`}
                            role="option"
                            aria-selected={idx === activeTestIdx}
                            type="button"
                            onMouseDown={e => {
                              e.preventDefault();
                              addReportTest(test);
                            }}
                            onMouseEnter={() => setTestActiveIdx(idx)}
                            className={cn(
                              'w-full text-left px-4 py-3 text-sm font-medium transition-colors border-b border-outline-variant/5 last:border-0',
                              idx === activeTestIdx
                                ? 'bg-surface-container-low text-on-surface'
                                : 'text-on-surface hover:bg-surface-container-low',
                            )}
                          >
                            {test.name}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/5 last:border-0">
                          No tests found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
                <h4 className="text-sm font-bold text-primary">Test Results Data</h4>
              </div>

              {/* UI-P0-02 review strip. Sits ABOVE the results grid so the
                  operator sees "what is still missing" before scanning the
                  inputs, and disappears the moment every value is filled. A
                  failed submit used to be the only signal; this makes the
                  precondition visible without needing to press the button
                  first. The list is capped because a 30-parameter profile
                  can produce a long block; the count is always visible. */}
              {composerMissing.length > 0 && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-2xl border border-warning/40 bg-warning-container px-4 py-3 text-[13px] leading-relaxed text-on-warning-container"
                >
                  <p className="font-bold">
                    {composerMissing.length} result{composerMissing.length === 1 ? '' : 's'} still
                    empty — issue is blocked
                  </p>
                  <p className="mt-1 opacity-90">
                    {composerMissing.slice(0, 8).join(', ')}
                    {composerMissing.length > 8 ? ` +${composerMissing.length - 8} more` : ''}
                  </p>
                  <p className="mt-1 text-[12px] opacity-80">
                    Fill every value to issue the report, or Save as draft to continue later.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                {newReport.testSelection.length === 0 && (
                  <div className="p-4 text-center text-sm text-on-surface-variant bg-surface-container-low rounded-xl">
                    No tests selected. Please select a patient or add tests above.
                  </div>
                )}

                {newReport.testSelection.map(testName => {
                  const testInfo = findTestInfo(testName);
                  // If it's a Group or Header, just show it distinctively without input
                  if (testInfo?.isGroup || testInfo?.isHeader) {
                    return (
                      <div
                        key={testName}
                        className={`flex justify-between items-center p-3 mt-4 rounded-lg border-l-4 ${testInfo.isGroup ? 'bg-primary/10 border-primary' : 'bg-surface-container-low border-outline-variant/50'}`}
                      >
                        <h4 className="font-bold text-primary text-sm uppercase tracking-wider">
                          {testName}
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            let toRemove = [testName];
                            if (testInfo.isGroup && testInfo.includedTests) {
                              toRemove = [...toRemove, ...testInfo.includedTests];
                            }
                            setNewReport({
                              ...newReport,
                              testSelection: newReport.testSelection.filter(
                                t => !toRemove.includes(t),
                              ),
                            });
                          }}
                          className="p-1 text-primary opacity-50 hover:bg-primary hover:text-on-primary rounded transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  }

                  // Try to get patient to determine reference range
                  const patient = patients.find(p => p.id === newReport.patientId);
                  const resolvedRange = testInfo
                    ? resolveReferenceRange(
                        testInfo.ranges,
                        patient ? ageAsNumber(patient) : undefined,
                        patient?.gender,
                      )
                    : null;
                  const rangeLabel = resolvedRange?.label ?? '';
                  const refValues = resolvedRange?.values ?? null;
                  const enteredValue = newReport.results[testName] || '';

                  let valueStatus: 'normal' | 'low' | 'high' | null = null;
                  if (enteredValue && refValues && !isNaN(Number(enteredValue))) {
                    const numVal = Number(enteredValue);
                    if (refValues.min !== undefined && numVal < refValues.min) {
                      valueStatus = 'low';
                    } else if (refValues.max !== undefined && numVal > refValues.max) {
                      valueStatus = 'high';
                    } else {
                      valueStatus = 'normal';
                    }
                  }

                  return (
                    <div
                      key={testName}
                      className="flex flex-col gap-2 p-4 bg-surface-container-low rounded-xl border border-outline-variant/30 relative group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center flex-wrap gap-2">
                            <label className="text-sm font-bold text-primary">{testName}</label>
                            {valueStatus && (
                              <StatusPill
                                tone={
                                  valueStatus === 'high'
                                    ? 'error'
                                    : valueStatus === 'low'
                                      ? 'warning'
                                      : 'success'
                                }
                                dot
                              >
                                {valueStatus === 'high'
                                  ? 'High'
                                  : valueStatus === 'low'
                                    ? 'Low'
                                    : 'Normal'}
                              </StatusPill>
                            )}
                          </div>
                          {testInfo && (
                            <div className="text-xs text-on-surface-variant mt-0.5">
                              <span className="font-medium">Ref:</span> {rangeLabel} {testInfo.unit}
                              {patient && resolvedRange && resolvedRange.kind !== 'none' && (
                                <span className="ml-1 text-xs bg-secondary-container/10 text-secondary px-1 rounded font-medium">
                                  (Adjusted for{' '}
                                  {patient.gender === 'male'
                                    ? 'Male'
                                    : patient.gender === 'female'
                                      ? 'Female'
                                      : patient.gender}
                                  {' • '}
                                  {patient.age} Yrs)
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setNewReport({
                              ...newReport,
                              testSelection: newReport.testSelection.filter(t => t !== testName),
                            })
                          }
                          className="p-1.5 text-error opacity-50 hover:bg-error-container hover:opacity-100 rounded-lg transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1 w-full min-w-0">
                        {testInfo?.options ? (
                          <Combobox
                            className="min-w-0 flex-1"
                            inputClassName="test-result-input w-full px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition font-bold text-primary"
                            value={newReport.results[testName] || ''}
                            options={testInfo.options}
                            placeholder="Select or type result..."
                            ariaLabel={`Result for ${testName}`}
                            onChange={next => {
                              const nextResults = recalculateCBC(newReport.results, testName, next);
                              setNewReport({
                                ...newReport,
                                results: nextResults,
                              });
                            }}
                            onNavigate={handleInputKeyDown}
                          />
                        ) : (
                          <input
                            type="text"
                            inputMode={isNumericTest(testInfo) ? 'decimal' : undefined}
                            aria-label={`Result for ${testName}`}
                            value={newReport.results[testName] || ''}
                            onChange={e => {
                              const nextResults = recalculateCBC(
                                newReport.results,
                                testName,
                                e.target.value,
                              );
                              setNewReport({
                                ...newReport,
                                results: nextResults,
                              });
                            }}
                            onKeyDown={handleInputKeyDown}
                            className="test-result-input flex-1 min-w-0 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition font-bold text-primary"
                            placeholder={`Enter result...`}
                          />
                        )}
                        {testInfo?.unit && (
                          <span
                            className="text-xs font-bold text-on-surface-variant w-16 px-1 text-right shrink-0 truncate select-none animate-fade-in"
                            title={testInfo.unit}
                          >
                            {testInfo.unit}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-4 bg-secondary/10 rounded-2xl flex gap-4 items-start">
            <ShieldCheck className="w-6 h-6 text-secondary shrink-0" aria-hidden="true" />
            <div>
              <h5 className="text-xs font-bold text-on-surface mb-1">Stored on this device</h5>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Saving writes this dataset to the encrypted database on this device, linked to this
                patient and to {user?.displayName || 'you'} as the issuing operator. A finalised
                report can still be amended from the report view; each amendment raises its version
                number and records your reason.
              </p>
            </div>
          </div>
        </form>
      </Sheet>
      {/* Read-only viewing dashboard — card taps and Preview land here */}
      <ReportViewerDashboard
        report={viewerReport}
        patient={viewerReport ? patients.find(p => p.id === viewerReport.patientId) : undefined}
        onClose={() => setViewerReport(null)}
        onEdit={() => {
          if (viewerReport) setSelectedReport({ ...viewerReport });
          setViewerReport(null);
        }}
        onOutput={action => {
          // 'pdf' is the generated document in the device viewer / browser tab.
          if (viewerReport) patient_report(viewerReport, action === 'pdf' ? 'preview' : action);
        }}
      />
      {/* The Windows print sheet — desktop only, and it renders nothing at all
          on the other shells, so the APK/web print paths are untouched. */}
      <PrintDialog
        open={!!printJob}
        job={printJob}
        onClose={() => setPrintJob(null)}
        onPrinted={() => toast.success('Report sent to the printer.')}
      />
      {/* Report Details Modal */}
      <Sheet
        open={!!selectedReport}
        onClose={() => {
          setSelectedReport(null);
          setAmendReason('');
          setDetailError(null);
        }}
        title={selectedReport ? `Report Details: ${selectedReport.patientName}` : 'Report Details'}
        description={
          selectedReport
            ? selectedReport.status === 'draft'
              ? 'Draft — not issued yet, so nothing has been printed as final.'
              : `Issued v${Number(selectedReport.version) || 1}` +
                (selectedReport.updatedAt
                  ? ` · amended ${new Date(selectedReport.updatedAt).toLocaleDateString('en-IN')}`
                  : '') +
                (selectedReport.amendReason ? ` · ${selectedReport.amendReason}` : '')
            : undefined
        }
        width="lg"
      >
        {selectedReport && (
          <div className="space-y-6">
            <div>
              <ReportResultsEditor
                testSelection={selectedReport.testSelection || []}
                testType={selectedReport.testType}
                results={asResultMap(selectedReport.resultData)}
                readOnly={!canEdit}
                onChange={(testName, next) =>
                  setSelectedReport({
                    ...selectedReport,
                    resultData: recalculateCBC(
                      asResultMap(selectedReport.resultData),
                      testName,
                      next,
                    ),
                  })
                }
                onNavigate={handleInputKeyDown}
              />
              {canEdit && (
                <div className="mt-3">
                  {detailError && (
                    <p
                      role="alert"
                      className="mb-3 flex items-start gap-2 rounded-lg bg-error-container/60 px-3 py-2 text-xs font-medium text-on-error-container"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{detailError}</span>
                    </p>
                  )}
                  {/* P0.4: editing a report that is already issued is an amendment
                      — it must state a reason, and the prior version is retained. */}
                  {selectedReport.status === 'final' && (
                    <div className="mb-3">
                      <label
                        htmlFor="amend-reason"
                        className="text-xs font-black text-primary uppercase mb-1 block"
                      >
                        Amendment reason (required)
                      </label>
                      <input
                        id="amend-reason"
                        type="text"
                        value={amendReason}
                        onChange={e => setAmendReason(e.target.value)}
                        placeholder="Why is this issued report being changed?"
                        className="w-full text-sm px-4 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:border-accent focus:outline-none transition"
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      onClick={() => handleSaveResults()}
                      disabled={savingResults}
                      className="px-4 py-2 bg-secondary text-on-secondary text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                    >
                      {savingResults ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : selectedReport.status === 'final' ? (
                        'Save amendment'
                      ) : (
                        'Save Results'
                      )}
                    </button>
                    {/* Drafts have no patient-facing copy and no signature of
                          record: issuing is the step that makes the report real. */}
                    {selectedReport.status === 'draft' && (
                      <button
                        onClick={() => handleSaveResults(undefined, true)}
                        disabled={savingResults}
                        className="px-4 py-2 bg-primary-container text-on-primary-container text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                      >
                        <FileSignature className="w-4 h-4" aria-hidden="true" />
                        Issue &amp; sign report
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {canEdit && (
              <div>
                <h4
                  id="private-notes-label"
                  className="text-xs font-black text-primary uppercase mb-2"
                >
                  Private Notes (Staff Only)
                </h4>
                <textarea
                  aria-labelledby="private-notes-label"
                  value={selectedReport.privateNotes || ''}
                  onChange={e =>
                    setSelectedReport({ ...selectedReport, privateNotes: e.target.value })
                  }
                  placeholder="Add private staff notes here..."
                  className="w-full text-sm px-4 py-3 bg-surface-container-low border border-outline-variant/30 rounded-xl focus:border-accent focus:outline-none transition min-h-[120px] resize-y"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={handleSaveNote}
                    disabled={savingNote}
                    className="px-4 py-2 bg-primary-container text-on-primary-container text-sm font-bold rounded-lg hover:opacity-90 transition flex items-center gap-2"
                  >
                    {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Note'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={!!reportToDelete}
        onClose={() => setReportToDelete(null)}
        onConfirm={async () => {
          if (!reportToDelete) return;
          try {
            // Report + patient-facing mirror + staff note + invoice, committed
            // together. The patient's own record is never touched.
            await deleteReportCascade(reportToDelete.id);
            setReportToDelete(null);
            toast.success(`Report for ${reportToDelete.patientName} deleted.`);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, 'reports');
            toast.error('Delete failed — nothing was removed.');
          }
        }}
        title="Delete Report"
        confirmLabel="Delete"
        message={
          reportToDelete
            ? `Are you sure you want to delete the report for ${reportToDelete.patientName}? This action cannot be undone.`
            : ''
        }
      />
    </div>
  );
}
