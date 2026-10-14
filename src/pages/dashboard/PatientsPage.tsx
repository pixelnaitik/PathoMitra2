import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  where,
  getDocs,
  setDoc,
  limit,
  db,
} from '../../data/fs';
import { deletePatientCascade } from '../../lib/cascades';
import {
  allocatePatientId,
  findProbableDuplicates,
  normalisePhone,
  validatePatientForm,
  type ProbableDuplicate,
} from '../../lib/patient-registry';
import { useCollectionList, type ListFilter } from '../../hooks/useCollectionList';
import { createdAtRangeFilters } from '../../lib/date-range';
import {
  readPatients,
  toPatientDoc,
  toPatientUpdateDoc,
  operatorStamp,
  type PatientRecord,
} from '../../lib/models';
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/export-csv';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import {
  Search,
  Plus,
  UserPlus,
  FileSpreadsheet,
  Loader2,
  Trash2,
  Edit2,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { listStaggerProps } from '../../lib/motion';
import { useAuth } from '../../contexts/AuthContext';
import {
  Button,
  Card,
  IconButton,
  Sheet,
  ConfirmSheet,
  StatusPill,
  SearchField,
  Field,
  TextInput,
  TextArea,
  Select,
  ListGroup,
  ListRow,
  EmptyState,
  CalendarRangePicker,
  Skeleton,
  toIsoDay,
  useToast,
} from '../../components/ui';

import {
  getPathologyTests,
  getSearchableTests,
  searchPathologyTests,
} from '../../lib/pathology-tests';
import { DEFAULT_DOCTORS } from '../../lib/doctors';
import { doctorMatchesQuery, doctorNameKey } from '../../lib/doctor-registry';
import { PatientDetailSheet } from '../../components/PatientDetailSheet';

export default function PatientsPage({
  initialAction,
  clearAction,
}: {
  initialAction?: string | null;
  clearAction?: () => void;
}) {
  const { role, user } = useAuth();
  const toast = useToast();
  const [doctors, setDoctors] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<any>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientRecord | null>(null);

  useEffect(() => {
    if (initialAction === 'add') {
      setIsModalOpen(true);
      clearAction?.();
    }
  }, [initialAction, clearAction]);

  const [testSearchQuery, setTestSearchQuery] = useState('');
  const [isTestDropdownOpen, setIsTestDropdownOpen] = useState(false);
  const [testActiveIdx, setTestActiveIdx] = useState(0);
  const testListRef = useRef<HTMLDivElement>(null);
  const [isDoctorDropdownOpen, setIsDoctorDropdownOpen] = useState(false);
  const [isAddingDoctor, setIsAddingDoctor] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState<any>(null);

  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: 'male',
    phone: '',
    doctorName: '',
    address: '',
    testSelection: [] as string[],
  });

  /**
   * Selected panels (CBC, URINE ANALYSIS, LIPID PROFILE …) render as ONE chip
   * with a member count, expandable on demand — the stored selection still
   * carries every member (reports, results and billing read that list), so
   * this is a display fold, not a data change. Without it a single CBC filled
   * twenty chips and the sheet scrolled forever.
   */
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const testChips = useMemo(() => {
    const catalogue = getPathologyTests();
    const selected = formData.testSelection;
    const groups = selected
      .map(name => catalogue.find(t => t.name === name && t.isGroup && t.includedTests?.length))
      .filter((t): t is NonNullable<typeof t> => Boolean(t));
    const memberOf = new Map<string, string>();
    for (const group of groups) {
      for (const member of group.includedTests ?? []) memberOf.set(member, group.name);
    }
    return {
      groups: groups.map(group => ({
        name: group.name,
        members: (group.includedTests ?? []).filter(m => selected.includes(m)),
      })),
      singles: selected.filter(t => !memberOf.has(t) && !groups.some(g => g.name === t)),
    };
  }, [formData.testSelection]);

  // Registration range is evaluated by Firestore, so the page window already
  // holds what the filter asks for instead of filtering whatever was loaded.
  // The bounds are the local day's first and last millisecond — matching the
  // `toIsoDay` grouping the calendar dots use — not UTC midnight.
  const patientFilters = useMemo<ListFilter[]>(() => {
    const list: ListFilter[] = [];
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    if (since) list.push({ field: 'createdAt', op: '>=', value: since });
    if (until) list.push({ field: 'createdAt', op: '<=', value: until });
    return list;
  }, [fromDate, toDate]);

  // Live first page + cursor-loaded older pages, replacing the subscription that
  // used to keep every patient ever registered in memory.
  const patientsList = useCollectionList({
    path: 'patients',
    map: readPatients,
    pageSize: 25,
    filters: patientFilters,
    onError: error => handleFirestoreError(error, OperationType.GET, 'patients'),
  });
  const patients = patientsList.items;

  const activePatientDates = useMemo(() => {
    // Local day, matching the calendar grid the dots are painted into.
    return new Set(patients.filter(p => p.createdAt).map(p => toIsoDay(new Date(p.createdAt))));
  }, [patients]);

  useEffect(() => {
    const qDocs = query(collection(db, 'doctors'), orderBy('createdAt', 'desc'));
    const unsubDocs = onSnapshot(
      qDocs,
      snapshot => {
        setDoctors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'doctors');
      },
    );

    return () => {
      unsubDocs();
    };
  }, []);

  const addNewDoctor = async (name: string) => {
    if (!name.trim()) return;
    setIsAddingDoctor(true);
    try {
      await addDoc(collection(db, 'doctors'), {
        name: name.trim(),
        createdAt: new Date().toISOString(),
      });
      setFormData(prev => ({ ...prev, doctorName: name.trim() }));
      setIsDoctorDropdownOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'doctors');
    } finally {
      setIsAddingDoctor(false);
    }
  };

  const [formError, setFormError] = useState('');

  /**
   * A parked duplicate warning: the form is valid, but something already in the
   * store looks like the same person. The operator answers it, and a confirmed
   * registration continues into `savePatient`.
   */
  const [duplicateCheck, setDuplicateCheck] = useState<ProbableDuplicate[] | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const invalid = validatePatientForm(formData);
    if (invalid) {
      setFormError(invalid);
      return;
    }

    // A second record for the same patient is the one mistake that cannot be
    // undone later by editing a field — it splits one person's history in two,
    // and each half looks complete on its own. Checked against the most recent
    // registrations, which is where a duplicate realistically comes from.
    if (!editingPatient) {
      const recentSnapshot = await getDocs(
        query(collection(db, 'patients'), orderBy('createdAt', 'desc'), limit(500)),
      );
      const matches = findProbableDuplicates(formData, readPatients(recentSnapshot.docs));
      if (matches.length > 0) {
        setDuplicateCheck(matches);
        return;
      }
    }

    await savePatient();
  };

  /** The write itself, once the form is valid and any duplicate warning was answered. */
  const savePatient = async () => {
    const path = 'patients';
    setFormError('');
    try {
      if (editingPatient) {
        await updateDoc(doc(db, path, editingPatient.id), toPatientUpdateDoc(formData));

        // Sync the ordered-panel list onto the patient's DRAFTS only.
        //
        // This loop used to touch every report under the patient, issued ones
        // included. A `final` report is a document that has already left the lab
        // (lib/models.ts: immutable without an amendment entry), so rewriting its
        // `testSelection` changed what a handed-over report claims was ordered,
        // bumped its version, and made the alert engine announce "Amended report"
        // for every one of them — because correcting a phone number is not an
        // amendment. Amending an issued report stays deliberate: it happens in the
        // report editor, which records a reason.
        try {
          const q = query(
            collection(db, 'reports'),
            where('patientId', '==', editingPatient.id),
            where('status', '==', 'draft'),
          );
          const querySnapshot = await getDocs(q);

          for (const reportDoc of querySnapshot.docs) {
            const currentReport = reportDoc.data();
            try {
              await updateDoc(doc(db, 'reports', reportDoc.id), {
                testSelection: formData.testSelection,
                version: (Number(currentReport.version) || 1) + 1,
                updatedBy: operatorStamp(user),
                updatedAt: new Date().toISOString(),
              });
            } catch (reportSyncErr) {
              console.error('Failed to update report', reportDoc.id, reportSyncErr);
            }
          }
        } catch (syncErr) {
          console.error('Failed to sync drafts: ', syncErr);
        }
      } else {
        // Registration number comes from the per-month sequence held in the
        // `meta` store: ordered, and collision-free by construction (the
        // allocator still probes each candidate). It replaces `YYMM` + three
        // random digits, which ran out at a few hundred registrations a month
        // and failed with "could not allocate a unique patient id" while a
        // patient stood at the counter. See lib/patient-registry.
        const patientId = await allocatePatientId();

        await setDoc(
          doc(db, path, patientId),
          toPatientDoc({ ...formData, createdAt: new Date().toISOString() }),
        );
      }
      setIsModalOpen(false);
      resetForm();
      setDuplicateCheck(null);
      toast.success(
        editingPatient ? `${formData.name}'s record updated.` : `${formData.name} registered.`,
      );
    } catch (err) {
      setFormError('Failed to save patient.');
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch (e) {
        // Logged
      }
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      age: '',
      gender: 'male',
      phone: '',
      doctorName: '',
      address: '',
      testSelection: [],
    });
    setExpandedGroups([]);
    setEditingPatient(null);
    setFormError('');
  };

  // Name, registration number, phone digits and age are all matchable, and every
  // word typed has to appear somewhere on the record — "rao asha" finds Asha Rao.
  // Searching only the name is what made a staff member read a patient number out
  // to a colleague instead of looking it up.
  const deferredSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const filteredPatients = useMemo(() => {
    if (!deferredSearch) return patients;
    const terms = deferredSearch.split(/\s+/).filter(Boolean);
    return patients.filter(p => {
      const haystack = [
        p.name,
        p.id,
        p.phone ?? '',
        normalisePhone(p.phone),
        String(p.age ?? ''),
        p.doctorName ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [patients, deferredSearch]);

  const searching = deferredSearch.length > 0 && filteredPatients.length === 0;
  // The old 250-record walk ceiling is gone on purpose: the local store already
  // holds the whole collection in memory, so walking further costs a re-slice and
  // nothing else — while the cap silently guaranteed that an older patient could
  // never be found by search at all.
  const scanning = searching && patientsList.hasMore;

  useEffect(() => {
    if (!scanning || patientsList.loadingMore) return;
    void patientsList.loadMore();
  }, [scanning, patientsList]);

  const CSV_COLUMNS: CsvColumn<PatientRecord>[] = [
    { label: 'Patient ID', value: p => p.id },
    { label: 'Name', value: p => p.name },
    { label: 'Age', value: p => p.age },
    { label: 'Gender', value: p => p.gender },
    { label: 'Phone', value: p => p.phone || '' },
    { label: 'Doctor', value: p => p.doctorName || '' },
    { label: 'Registered', value: p => p.createdAt },
  ];

  const exportFilteredCsv = async () => {
    if (filteredPatients.length === 0) {
      toast.warning('Nothing to export — widen the filter first.');
      return;
    }
    try {
      const message = await downloadCsv(
        `pathomitra-patients-${toIsoDay(new Date())}.csv`,
        toCsv(CSV_COLUMNS, filteredPatients),
      );
      toast.success(message ?? `Exported ${filteredPatients.length} patients to CSV.`);
    } catch (err) {
      console.error('Error writing the CSV export:', err);
      toast.error('Could not write the CSV on this device.');
    }
  };

  const filteredAvailableTests = useMemo(
    () =>
      searchPathologyTests(
        testSearchQuery,
        getSearchableTests(formData.testSelection, testSearchQuery),
      ),
    [formData.testSelection, testSearchQuery],
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
        addTest(picked.name);
      }
    }
  };

  const addTest = (test: string) => {
    const testInfo = getPathologyTests().find(t => t.name === test);
    let testsToAdd = [test];
    if (testInfo?.isGroup && testInfo.includedTests) {
      testsToAdd = [test, ...testInfo.includedTests];
    }

    // Auto-add Direct and Indirect Bilirubin when Total Serum Bilirubin is selected
    if (test === 'Total Serum Bilirubin') {
      testsToAdd = ['Total Serum Bilirubin', 'Direct Bilirubin', 'Indirect Bilirubin'];
    }

    setFormData(prev => {
      const newAdditions = testsToAdd.filter(t => !prev.testSelection.includes(t));
      return {
        ...prev,
        testSelection: [...prev.testSelection, ...newAdditions],
      };
    });
    setTestSearchQuery('');
    setIsTestDropdownOpen(false);
  };

  const removeTest = (test: string) => {
    const testInfo = getPathologyTests().find(t => t.name === test);
    let toRemove = [test];
    if (testInfo?.isGroup && testInfo.includedTests) {
      toRemove = [...toRemove, ...testInfo.includedTests];
    }
    setFormData(prev => ({
      ...prev,
      testSelection: prev.testSelection.filter(t => !toRemove.includes(t)),
    }));
  };

  /**
   * Suggestions: the lab's own register first, then the seeded list, folded on
   * `doctorNameKey` so one doctor cannot appear as `DR MANOJ KUMAR`,
   * `DR.MANOJ KUMAR` and `Dr. Manoj Kumar (MBBS)` in the same dropdown. Choosing a
   * suggestion still stores the name string (a patient carries `doctorName`, not a
   * doctor id), which is exactly why the spelling has to be stable here rather than
   * patched up at read time.
   */
  const allDoctors = React.useMemo(() => {
    const byKey = new Map<string, { id: string; name: string }>();
    for (const doctor of doctors) {
      const key = doctorNameKey(doctor.name);
      if (key && !byKey.has(key)) byKey.set(key, { id: doctor.id, name: doctor.name });
    }
    for (const name of DEFAULT_DOCTORS) {
      const key = doctorNameKey(name);
      if (key && !byKey.has(key)) byKey.set(key, { id: `default_${name}`, name });
    }
    return [...byKey.values()];
  }, [doctors]);

  const filteredDoctorsDropdown = allDoctors.filter(doctor =>
    doctorMatchesQuery(doctor.name, formData.doctorName),
  );

  const showAddDoctorButton =
    formData.doctorName.trim().length > 0 &&
    !allDoctors.some(d => d.name.toLowerCase() === formData.doctorName.trim().toLowerCase());

  const openEditForm = (patient: any) => {
    setEditingPatient(patient);
    setFormData({
      name: patient.name || '',
      age: patient.age ? patient.age.toString() : '',
      gender: patient.gender || 'male',
      phone: patient.phone || '',
      doctorName: patient.doctorName || '',
      address: patient.address || '',
      testSelection: patient.testSelection || [],
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-col sm:flex-row flex-1 max-w-lg items-stretch gap-2">
          <SearchField
            className="flex-1"
            placeholder="Search patients by name..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onClear={() => setSearchTerm('')}
            aria-label="Search patients by name"
          />

          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            activeDates={activePatientDates}
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
            <Button variant="brand" size="lg" shine onClick={() => setIsModalOpen(true)}>
              <UserPlus className="w-5 h-5" />
              Register Patient
            </Button>
          )}
        </div>
      </div>

      {patientsList.loading && (
        <Card pad="none">
          <div className="p-6 space-y-4" aria-busy="true" aria-label="Loading patients">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Card>
      )}

      {scanning && (
        <p
          role="status"
          className="flex items-center justify-center gap-2 py-4 text-sm font-semibold text-on-surface-variant"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Searching older records…
        </p>
      )}

      {!patientsList.loading && !scanning && filteredPatients.length === 0 ? (
        <Card pad="none">
          <EmptyState
            icon={<UserPlus className="h-7 w-7" />}
            title={deferredSearch ? `No patient matches “${searchTerm.trim()}”` : 'No patients yet'}
            description={
              deferredSearch
                ? 'Nothing matched in the loaded records. Clear the filter, or widen the registration range.'
                : 'Register your first patient to start issuing reports.'
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
              ) : undefined
            }
          />
        </Card>
      ) : filteredPatients.length > 0 ? (
        <>
          <Card pad="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-surface-container-low/60 border-b border-outline-variant/40">
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Name
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Age / Gender
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                      Registered
                    </th>
                    <th className="px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {filteredPatients.map((patient, idx) => (
                    <motion.tr
                      key={patient.id}
                      {...listStaggerProps(idx)}
                      aria-selected={selectedPatient?.id === patient.id}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-surface-container-low',
                        selectedPatient?.id === patient.id &&
                          'bg-accent/8 ring-1 ring-inset ring-accent/40',
                      )}
                      onClick={() => setSelectedPatient(patient)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent font-bold">
                            {patient.name[0]}
                          </div>
                          <span className="font-semibold text-on-surface">{patient.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <StatusPill tone="neutral">{patient.age}y</StatusPill>
                          <StatusPill tone="accent" className="capitalize">
                            {patient.gender}
                          </StatusPill>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-on-surface-variant">
                        {new Date(patient.createdAt).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          {role !== 'guest' && (
                            <>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  openEditForm(patient);
                                }}
                                aria-label={`Edit ${patient.name}`}
                                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-accent/12 hover:text-accent"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setPatientToDelete(patient);
                                }}
                                aria-label={`Delete ${patient.name}`}
                                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile inset list — edit/delete actions, staggered entrance.
              The row is a primary button (name / history opens the detail
              sheet) plus sibling action buttons (Edit, Delete). Previously
              the whole row was a fake `role="button"` wrapper and the two
              action buttons sat inside it: invalid nesting, awkward Tab
              order, and TalkBack announced the wrapper as a single control
              rather than naming the patient, then each action separately
              (UI-P0-04). */}
          <div className="md:hidden">
            <ListGroup>
              {filteredPatients.map((patient, pIdx) => (
                <motion.div
                  key={patient.id}
                  {...listStaggerProps(pIdx)}
                  className={cn(
                    'transition-colors',
                    selectedPatient?.id === patient.id && 'bg-accent/8',
                  )}
                >
                  <ListRow
                    leading={
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-[15px] font-bold text-accent">
                        {patient.name[0]}
                      </span>
                    }
                    title={patient.name}
                    subtitle={`${patient.age}y · ${patient.gender} · ${new Date(patient.createdAt).toLocaleDateString('en-IN')}`}
                    primaryLabel={`View ${patient.name}'s history`}
                    onClick={() => setSelectedPatient(patient)}
                    trailing={
                      role !== 'guest' ? (
                        <>
                          <IconButton
                            label={`Edit ${patient.name}`}
                            size="sm"
                            className="text-on-surface-variant hover:bg-accent/12 hover:text-accent"
                            onClick={e => {
                              e.stopPropagation();
                              openEditForm(patient);
                            }}
                          >
                            <Edit2 className="w-4 h-4" />
                          </IconButton>
                          <IconButton
                            label={`Delete ${patient.name}`}
                            size="sm"
                            className="text-on-surface-variant hover:bg-error-container hover:text-error"
                            onClick={e => {
                              e.stopPropagation();
                              setPatientToDelete(patient);
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </IconButton>
                        </>
                      ) : undefined
                    }
                  />
                </motion.div>
              ))}
            </ListGroup>
          </div>
        </>
      ) : null}

      {/* Older pages load on demand; a search walks through all of them, because
          the local store already holds the whole collection in memory. */}
      {!patientsList.loading && patientsList.hasMore && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="outline"
            loading={patientsList.loadingMore}
            onClick={() => void patientsList.loadMore()}
          >
            {deferredSearch ? 'Keep searching older records' : 'Load older records'}
          </Button>
          <span className="text-xs text-on-surface-variant">
            {patients.length} patients loaded in this session
          </span>
        </div>
      )}

      {!patientsList.loading && !patientsList.hasMore && deferredSearch && (
        <p className="text-center text-xs text-on-surface-variant">
          {patients.length} patient{patients.length === 1 ? '' : 's'} searched — nothing matched
          that. Try fewer letters, or part of a patient number.
        </p>
      )}

      {/* Register / edit patient sheet */}
      <Sheet
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingPatient ? 'Edit patient' : 'Register patient'}
        width="md"
        footer={
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="patient-form" variant="brand" size="lg" fullWidth>
              {editingPatient ? 'Save Changes' : 'Register'}
            </Button>
          </div>
        }
      >
        <form id="patient-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          {formError && (
            <div
              role="alert"
              className="rounded-xl bg-error-container px-4 py-3 text-sm font-semibold text-on-error-container"
            >
              {formError}
            </div>
          )}
          <Field label="Full Name" required>
            <TextInput
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Patient Name"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Age" required>
              <TextInput
                type="number"
                inputMode="numeric"
                value={formData.age}
                onChange={e => setFormData({ ...formData, age: e.target.value })}
                placeholder="Age"
              />
            </Field>
            <Field label="Gender">
              <Select
                value={formData.gender}
                onChange={e => setFormData({ ...formData, gender: e.target.value })}
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>

          <Field label="Referred By (Doctor Name)">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
              <TextInput
                type="text"
                value={formData.doctorName}
                onChange={e => {
                  setFormData({ ...formData, doctorName: e.target.value });
                  setIsDoctorDropdownOpen(true);
                }}
                onFocus={() => setIsDoctorDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsDoctorDropdownOpen(false), 200)}
                className="pl-10"
                placeholder="Search or add doctor (e.g. Dr. Rahul Pande)"
              />

              {isDoctorDropdownOpen && (
                <div className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-[var(--elevated-border)] rounded-2xl shadow-float max-h-48 overflow-y-auto top-full left-0">
                  {filteredDoctorsDropdown.length > 0
                    ? filteredDoctorsDropdown.map(docItem => (
                        <button
                          key={docItem.id}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            setFormData({ ...formData, doctorName: docItem.name });
                            setIsDoctorDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-3 text-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors border-b border-outline-variant/40 last:border-0"
                        >
                          {docItem.name}
                        </button>
                      ))
                    : !showAddDoctorButton && (
                        <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/40 last:border-0">
                          No matching doctors found.
                        </div>
                      )}

                  {showAddDoctorButton && (
                    <button
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        addNewDoctor(formData.doctorName);
                      }}
                      disabled={isAddingDoctor}
                      className="w-full text-left px-4 py-3 text-sm font-bold text-accent hover:bg-accent/12 transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      {isAddingDoctor ? 'Adding...' : `Add "${formData.doctorName}" as new doctor`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </Field>
          <Field label="Address">
            <TextArea
              value={formData.address}
              onChange={e => setFormData({ ...formData, address: e.target.value })}
              placeholder="Patient Address"
            />
          </Field>
          <Field label="Test Selection">
            <div className="space-y-2">
              {formData.testSelection.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {testChips.groups.map(group => {
                    const open = expandedGroups.includes(group.name);
                    return (
                      <React.Fragment key={group.name}>
                        <span className="flex items-center gap-0.5 rounded-full bg-primary/12 py-0.5 pr-1 text-xs font-bold text-primary">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedGroups(prev =>
                                prev.includes(group.name)
                                  ? prev.filter(n => n !== group.name)
                                  : [...prev, group.name],
                              )
                            }
                            aria-expanded={open}
                            className="flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 transition-colors hover:bg-primary/10"
                          >
                            {group.name}
                            <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold leading-tight">
                              {group.members.length}
                            </span>
                            {open ? (
                              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTest(group.name)}
                            aria-label={`Remove ${group.name}`}
                            className="rounded-full p-1 transition-colors hover:bg-error-container hover:text-error"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                        {open &&
                          group.members.map(member => (
                            <span
                              key={member}
                              className="flex items-center gap-1 rounded-full bg-accent/12 px-2.5 py-0.5 text-[11px] font-medium text-accent"
                            >
                              {member}
                              <button
                                type="button"
                                onClick={() => removeTest(member)}
                                aria-label={`Remove ${member}`}
                                className="rounded-full p-0.5 transition-colors hover:bg-error-container hover:text-error"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))}
                      </React.Fragment>
                    );
                  })}
                  {testChips.singles.map(test => (
                    <span
                      key={test}
                      className="flex items-center gap-1 rounded-full bg-accent/12 px-2.5 py-0.5 text-[11px] font-medium text-accent"
                    >
                      {test}
                      <button
                        type="button"
                        onClick={() => removeTest(test)}
                        aria-label={`Remove ${test}`}
                        className="rounded-full p-0.5 transition-colors hover:bg-error-container hover:text-error"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <SearchField
                  role="combobox"
                  aria-expanded={isTestDropdownOpen}
                  aria-controls="patient-test-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    isTestDropdownOpen && filteredAvailableTests[activeTestIdx]
                      ? `patient-test-opt-${activeTestIdx}`
                      : undefined
                  }
                  value={testSearchQuery}
                  onChange={e => {
                    setTestSearchQuery(e.target.value);
                    setTestActiveIdx(0);
                    setIsTestDropdownOpen(true);
                  }}
                  onFocus={() => setIsTestDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setIsTestDropdownOpen(false), 150)}
                  onClear={() => setTestSearchQuery('')}
                  onKeyDown={handleTestKeyDown}
                  placeholder="Search and add tests..."
                  aria-label="Search and add tests"
                />

                {isTestDropdownOpen && (
                  <div
                    ref={testListRef}
                    id="patient-test-listbox"
                    role="listbox"
                    aria-label="Available tests"
                    className="absolute z-50 w-full mt-1 bg-surface-container-lowest border border-[var(--elevated-border)] rounded-2xl shadow-float max-h-48 overflow-y-auto top-full left-0"
                  >
                    {filteredAvailableTests.length > 0 ? (
                      filteredAvailableTests.map((test, idx) => (
                        <button
                          key={test.id}
                          id={`patient-test-opt-${idx}`}
                          role="option"
                          aria-selected={idx === activeTestIdx}
                          type="button"
                          onMouseDown={e => {
                            e.preventDefault();
                            addTest(test.name);
                          }}
                          onMouseEnter={() => setTestActiveIdx(idx)}
                          className={cn(
                            'w-full text-left px-4 py-3 text-sm font-medium transition-colors border-b border-outline-variant/40 last:border-0',
                            idx === activeTestIdx
                              ? 'bg-surface-container-low text-on-surface'
                              : 'text-on-surface hover:bg-surface-container-low',
                          )}
                        >
                          {test.name}
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-on-surface-variant text-center border-b border-outline-variant/40 last:border-0">
                        No unselected tests found.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Field>
        </form>
      </Sheet>

      <ConfirmSheet
        open={!!duplicateCheck}
        onClose={() => setDuplicateCheck(null)}
        onConfirm={() => void savePatient()}
        title="Possible duplicate patient"
        confirmLabel="Register as a new patient"
        message={
          <>
            <p>
              This looks like it could be the same person as{' '}
              <strong className="font-semibold text-on-surface">
                {duplicateCheck?.length} existing record{duplicateCheck?.length === 1 ? '' : 's'}
              </strong>
              . Registering them again splits one patient's history across two files.
            </p>
            <ul className="mt-3 space-y-1.5">
              {(duplicateCheck ?? []).slice(0, 4).map(match => (
                <li key={match.id} className="text-xs text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{match.name}</span> · #{match.id}{' '}
                  <span className="font-mono">({match.reason})</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-on-surface-variant">
              If it is the same person, close this and open the existing record instead.
            </p>
          </>
        }
      />

      <ConfirmSheet
        open={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        title="Delete Patient"
        message={`Are you sure you want to delete ${patientToDelete?.name}? This action cannot be undone.`}
        onConfirm={async () => {
          if (!patientToDelete) return;
          const path = 'patients';
          try {
            const patientId = patientToDelete.id;

            // Removes the patient together with their reports, public mirrors,
            // staff notes and invoices in committed batches, so a partial
            // failure cannot leave orphaned records behind.
            await deletePatientCascade(patientId);

            setPatientToDelete(null);
            toast.success(`${patientToDelete.name} and their records removed.`);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
            toast.error('Delete failed — nothing was removed.');
          }
        }}
      />

      {/* Read-only timeline: every report for the patient, grouped by day */}
      <PatientDetailSheet
        key={selectedPatient?.id ?? 'none'}
        patient={selectedPatient}
        onClose={() => setSelectedPatient(null)}
        onEdit={role !== 'guest' ? openEditForm : undefined}
      />
    </div>
  );
}
