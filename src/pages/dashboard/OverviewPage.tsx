import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  collection,
  query,
  onSnapshot,
  limit,
  orderBy,
  where,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  db,
} from '../../data/fs';
import { deletePatientCascade, deleteReportCascade } from '../../lib/cascades';
import { readReports, readPatients } from '../../lib/models';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { Users, FileText, Plus, Trash2, UserPlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { listStaggerProps } from '../../lib/motion';
import { reportStatusView } from '../../lib/report-status';
import { useAuth } from '../../contexts/AuthContext';
import CountUp from '../../components/CountUp';
import {
  Button,
  Card,
  SectionTitle,
  StatusPill,
  ConfirmSheet,
  EmptyState,
  useToast,
} from '../../components/ui';

export default function OverviewPage({
  setActiveTab,
  onAddPatient,
  onManageReport,
  onCreateReportForPatient,
}: {
  setActiveTab?: (tab: string) => void;
  onAddPatient?: () => void;
  onManageReport?: (reportId: string) => void;
  onCreateReportForPatient?: (patientId: string) => void;
}) {
  const { role } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState({
    patients: 0,
    reports: 0,
    revenue: 0,
  });
  const [recentReports, setRecentReports] = useState<any[]>([]);
  const [recentPatients, setRecentPatients] = useState<any[]>([]);

  const [patientToDelete, setPatientToDelete] = useState<any | null>(null);
  const [reportToDelete, setReportToDelete] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer = 0;

    // Totals are computed by server-side aggregations. This previously opened a
    // live listener on each whole collection just to read `snapshot.size`, which
    // billed one document read per record and re-read every record whenever
    // anything in the lab changed.
    const loadStats = async () => {
      try {
        const [patients, reports, paidInvoices] = await Promise.all([
          getCountFromServer(query(collection(db, 'patients'))),
          // "Reports Finalized" counts issued reports only — drafts are excluded.
          getCountFromServer(query(collection(db, 'reports'), where('status', '==', 'final'))),
          getAggregateFromServer(query(collection(db, 'invoices'), where('status', '==', 'paid')), {
            total: sum('amount'),
          }),
        ]);
        if (cancelled) return;
        setStats({
          patients: patients.data().count,
          reports: reports.data().count,
          revenue: Number(paidInvoices.data().total ?? 0),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'stats');
      }
    };

    // The recent-activity listeners below are live; any write that can move a
    // total also changes them, so they double as the invalidation signal.
    // Debounced so a burst of saves costs one refresh, not one per write.
    const scheduleStatsRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(loadStats, 400);
    };

    void loadStats();

    const qReports = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(10));
    const unsubRecentReports = onSnapshot(
      qReports,
      s => {
        setRecentReports(readReports(s.docs));
        scheduleStatsRefresh();
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'reports');
      },
    );

    const qPatients = query(collection(db, 'patients'), orderBy('createdAt', 'desc'), limit(10));
    const unsubRecentPatients = onSnapshot(
      qPatients,
      s => {
        setRecentPatients(readPatients(s.docs));
        scheduleStatsRefresh();
      },
      error => {
        handleFirestoreError(error, OperationType.GET, 'patients');
      },
    );

    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      unsubRecentReports();
      unsubRecentPatients();
    };
  }, []);

  const combinedReports = React.useMemo(() => {
    const list = [
      ...recentReports.map(r => ({ ...r, itemType: 'report', timestamp: r.createdAt })),
      ...recentPatients
        .filter(p => !recentReports.some(r => r.patientId === p.id))
        .map(p => ({ ...p, itemType: 'patient', timestamp: p.createdAt })),
    ];
    return list
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  }, [recentReports, recentPatients]);

  const cards = [
    {
      label: 'Total Patients',
      value: stats.patients,
      icon: Users,
      tint: 'bg-chart-1/12 text-chart-1',
      meta: 'Registered in this lab',
    },
    {
      // Wording is deliberately not "Reports Finalized / Digitally signed
      // outputs": the build cannot substantiate a digital signature (see
      // lib/report-compliance.ts) and the audit (UI-P0-01) requires every
      // surface that names an operation to describe the operation the app
      // really does. "Issued" is the stored status; "Signed" is not.
      label: 'Reports Issued',
      value: stats.reports,
      icon: FileText,
      tint: 'bg-chart-2/12 text-chart-2',
      meta: 'Given to the patient or referring doctor',
    },
  ];

  return (
    // space-y-6: the same page-section rhythm every other dashboard tab uses, so
    // switching tabs does not change the vertical beat. 16px stays reserved for
    // gutters *inside* a group (the two stat tiles) and the page padding.
    <div className="space-y-6">
      {/* First-run guidance — shown only to a completely empty lab. The server
          counts can legitimately read zero for a role that may not aggregate, so
          the activity lists have the final say before claiming there is nothing. */}
      {stats.patients === 0 &&
        stats.reports === 0 &&
        recentPatients.length === 0 &&
        recentReports.length === 0 && (
          <Card pad="none" className="overflow-hidden">
            <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-accent/12 text-accent">
                <UserPlus className="h-8 w-8" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-on-surface">
                  Welcome to PathoMitra
                </h2>
                <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-on-surface-variant">
                  Your lab is set up and ready. Get started by registering your first patient, then
                  build and issue their report from their profile.
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
                {/* Single local operator: there is no guest tier to unlock, so this
                    is always the action rather than a prompt for an access code. */}
                <Button size="lg" shine onClick={() => onAddPatient && onAddPatient()}>
                  <Plus className="h-4 w-4" aria-hidden="true" /> Register first patient
                </Button>
              </div>
            </div>
          </Card>
        )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 fold:grid-cols-2 gap-4 md:gap-6">
        {cards.map((card, idx) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: Math.min(idx * 0.08, 0.32),
              type: 'spring',
              stiffness: 260,
              damping: 24,
            }}
          >
            <Card interactive className="group relative overflow-hidden">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:scale-110',
                    card.tint,
                  )}
                >
                  <card.icon className="w-6 h-6" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                    {card.label}
                  </p>
                  <h4 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-on-surface tabular-nums">
                    <CountUp value={Number(card.value)} />
                  </h4>
                </div>
                <p className="ml-auto hidden shrink-0 text-[11px] font-medium text-outline sm:block">
                  {card.meta}
                </p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patients Registry */}
        <Card pad="lg" className="flex md:min-h-[400px] flex-col">
          <SectionTitle
            title="Recent patients"
            subtitle="Newest registrations in the lab"
            action={
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => onAddPatient && onAddPatient()}>
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Register
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setActiveTab && setActiveTab('patients')}
                >
                  Manage
                </Button>
              </div>
            }
          />

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/60 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                  <th className="pb-3 pr-4 font-semibold">Patient</th>
                  <th className="pb-3 px-4 font-semibold">Details</th>
                  <th className="pb-3 px-4 font-semibold">Date</th>
                  {role !== 'guest' && (
                    <th className="pb-3 pl-4 text-right font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {recentPatients.map((patient, idx) => (
                  <motion.tr
                    key={patient.id}
                    {...listStaggerProps(idx, 10)}
                    onClick={() => setActiveTab && setActiveTab('patients')}
                    className="cursor-pointer transition-colors hover:bg-surface-container-low"
                  >
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs font-bold text-accent">
                          {patient.name ? patient.name[0].toUpperCase() : '?'}
                        </div>
                        <span className="text-sm font-semibold text-on-surface line-clamp-1">
                          {patient.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md bg-surface-container-high px-1.5 py-0.5 text-xs font-semibold text-on-surface-variant">
                          {patient.age}y
                        </span>
                        <span className="text-xs font-medium capitalize text-on-surface-variant">
                          {patient.gender}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-on-surface-variant">
                      {patient.createdAt
                        ? new Date(patient.createdAt).toLocaleDateString('en-IN')
                        : 'N/A'}
                    </td>
                    {role !== 'guest' && (
                      <td className="py-3.5 pl-4 text-right">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setPatientToDelete(patient);
                          }}
                          className="rounded-full p-2 text-on-surface-variant transition hover:bg-error-container hover:text-error cursor-pointer"
                          aria-label={`Delete ${patient.name}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </motion.tr>
                ))}
                {recentPatients.length === 0 && (
                  <tr>
                    <td
                      colSpan={role !== 'guest' ? 4 : 3}
                      className="py-8 text-center text-sm text-on-surface-variant"
                    >
                      No patients registered yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: iOS inset list */}
          <div className="md:hidden divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-[var(--elevated-border)] bg-surface-container-lowest">
            {recentPatients.map(patient => (
              <div
                key={patient.id}
                onClick={() => setActiveTab && setActiveTab('patients')}
                className="flex items-center gap-3 px-3 py-3.5 transition-colors active:bg-surface-container-high"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/12 text-sm font-bold text-accent">
                  {patient.name ? patient.name[0].toUpperCase() : '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-on-surface">
                    {patient.name}
                  </p>
                  <p className="truncate text-[13px] capitalize text-on-surface-variant">
                    {patient.age}y · {patient.gender} ·{' '}
                    {patient.createdAt
                      ? new Date(patient.createdAt).toLocaleDateString('en-IN')
                      : 'N/A'}
                  </p>
                </div>
                {role !== 'guest' && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setPatientToDelete(patient);
                    }}
                    className="rounded-full p-2.5 text-on-surface-variant hover:bg-error-container hover:text-error active:scale-95"
                    aria-label={`Delete ${patient.name}`}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            ))}
            {recentPatients.length === 0 && (
              <EmptyState
                icon={<Users className="h-7 w-7" aria-hidden="true" />}
                title="No patients yet"
                description="Register a patient to see them appear here."
                action={
                  role !== 'guest' ? (
                    <Button size="sm" onClick={() => onAddPatient && onAddPatient()}>
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Register
                    </Button>
                  ) : undefined
                }
                className="py-10"
              />
            )}
          </div>
        </Card>

        {/* Reports Registry */}
        <Card pad="lg" className="flex md:min-h-[400px] flex-col">
          <SectionTitle
            title="Reports desk"
            subtitle="Latest diagnostics and pending outputs"
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => setActiveTab && setActiveTab('reports')}
              >
                Manage
              </Button>
            }
          />

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/60 text-[11px] uppercase tracking-[0.06em] text-on-surface-variant">
                  <th className="pb-3 pr-4 font-semibold">Patient & test</th>
                  <th className="pb-3 px-4 font-semibold">Status</th>
                  {/*
                    The "Signature" column used to sit here and read
                    "Unsigned" on every row — the app has no signing service
                    (see lib/report-compliance.ts) and the `signature` field
                    is written empty, so the column could never say anything
                    useful. Deleting it removes a claim the build cannot
                    substantiate (UI-P0-01).
                  */}
                  <th className="pb-3 px-4 font-semibold">Date</th>
                  {role !== 'guest' && (
                    <th className="pb-3 pl-4 text-right font-semibold">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {combinedReports.map((item, idx) => {
                  const isReport = item.itemType === 'report';
                  const name = isReport ? item.patientName : item.name;
                  const testSub = isReport
                    ? item.testType || 'General'
                    : item.testSelection?.length > 0
                      ? item.testSelection.join(', ')
                      : 'No test selected';
                  // Same state model as the Reports tab card and the detail
                  // sheet — one source of truth for Draft / Issued / Amended
                  // so the overview cannot disagree with the record it links to.
                  const statusView = isReport
                    ? reportStatusView({ status: item.status, version: item.version })
                    : null;
                  const date = item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString('en-IN')
                    : 'N/A';

                  return (
                    <motion.tr
                      key={item.id}
                      {...listStaggerProps(idx, 10)}
                      onClick={() => {
                        if (isReport) {
                          onManageReport?.(item.id);
                        } else {
                          onCreateReportForPatient?.(item.id);
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-surface-container-low"
                    >
                      <td className="py-3.5 pr-4">
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-on-surface line-clamp-1">
                            {name}
                          </span>
                          <span className="text-xs font-medium text-on-surface-variant line-clamp-1">
                            {testSub}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {statusView ? (
                          <StatusPill tone={statusView.tone} dot>
                            {statusView.label}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral" dot>
                            Awaiting report
                          </StatusPill>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-on-surface-variant">
                        {date}
                      </td>
                      {role !== 'guest' && (
                        <td className="py-3.5 pl-4 text-right">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setReportToDelete(item);
                            }}
                            className="rounded-full p-2 text-on-surface-variant transition hover:bg-error-container hover:text-error cursor-pointer"
                            aria-label="Delete report"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </motion.tr>
                  );
                })}
                {combinedReports.length === 0 && (
                  <tr>
                    <td
                      colSpan={role !== 'guest' ? 4 : 3}
                      className="py-8 text-center text-sm text-on-surface-variant"
                    >
                      No reports yet — create one from the Reports tab
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: iOS inset list */}
          <div className="md:hidden divide-y divide-outline-variant/40 overflow-hidden rounded-2xl border border-[var(--elevated-border)] bg-surface-container-lowest">
            {combinedReports.map(item => {
              const isReport = item.itemType === 'report';
              const name = isReport ? item.patientName : item.name;
              const testSub = isReport
                ? item.testType || 'General'
                : item.testSelection?.length > 0
                  ? item.testSelection.join(', ')
                  : 'No test selected';
              const statusView = isReport
                ? reportStatusView({ status: item.status, version: item.version })
                : null;
              const date = item.createdAt
                ? new Date(item.createdAt).toLocaleDateString('en-IN')
                : 'N/A';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    if (isReport) onManageReport?.(item.id);
                    else onCreateReportForPatient?.(item.id);
                  }}
                  className="flex items-center gap-3 px-3 py-3.5 transition-colors active:bg-surface-container-high"
                >
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                      isReport
                        ? 'bg-chart-2/12 text-chart-2'
                        : 'bg-surface-container-high text-on-surface-variant',
                    )}
                  >
                    <FileText className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-on-surface">{name}</p>
                    <p className="truncate text-[13px] text-on-surface-variant">{testSub}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {statusView ? (
                        <StatusPill tone={statusView.tone} dot>
                          {statusView.label}
                        </StatusPill>
                      ) : (
                        <StatusPill tone="neutral" dot>
                          Awaiting report
                        </StatusPill>
                      )}
                      <span className="ml-auto text-xs text-on-surface-variant">{date}</span>
                    </div>
                  </div>
                  {role !== 'guest' && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setReportToDelete(item);
                      }}
                      className="rounded-full p-2.5 text-on-surface-variant hover:bg-error-container hover:text-error active:scale-95"
                      aria-label={`Delete report for ${name}`}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              );
            })}
            {combinedReports.length === 0 && (
              <EmptyState
                icon={<FileText className="h-7 w-7" aria-hidden="true" />}
                title="No reports yet"
                description="Issue a report from a patient's profile to see it here."
                action={
                  role !== 'guest' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setActiveTab && setActiveTab('reports')}
                    >
                      Go to Reports
                    </Button>
                  ) : undefined
                }
                className="py-10"
              />
            )}
          </div>
        </Card>
      </div>

      {/* Delete Patient Confirmation */}
      <ConfirmSheet
        open={!!patientToDelete}
        onClose={() => setPatientToDelete(null)}
        title="Delete patient"
        message={
          <>
            Are you sure you want to delete{' '}
            <strong className="font-semibold text-on-surface">{patientToDelete?.name}</strong>? This
            will remove their record from the registry.
          </>
        }
        onConfirm={async () => {
          if (!patientToDelete) return;
          try {
            // Cascades through the patient's reports, public mirrors, notes and
            // invoices in committed batches, so nothing is orphaned.
            await deletePatientCascade(patientToDelete.id);
            toast.success(`Removed ${patientToDelete.name}'s record`);
            setPatientToDelete(null);
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, 'patients');
            toast.error('Could not delete the patient record');
          }
        }}
      />

      {/* Delete Report Confirmation */}
      <ConfirmSheet
        open={!!reportToDelete}
        onClose={() => setReportToDelete(null)}
        title="Delete report"
        message={
          <>
            This will remove the report and its invoice for{' '}
            <strong className="font-semibold text-on-surface">
              {reportToDelete?.patientName || reportToDelete?.name}
            </strong>
            . The patient's own record is kept.
          </>
        }
        onConfirm={async () => {
          if (!reportToDelete) return;
          try {
            const isReport = reportToDelete.itemType === 'report';
            if (isReport) {
              // Deleting a report must never delete the patient: this used to
              // remove the patient record and every invoice under their name.
              await deleteReportCascade(reportToDelete.id);
              setReportToDelete(null);
              toast.success('Report deleted');
            } else {
              await deletePatientCascade(reportToDelete.id);
              setReportToDelete(null);
              toast.success('Patient and their records deleted');
            }
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, 'reports');
            toast.error('Could not delete the report');
          }
        }}
      />
    </div>
  );
}
