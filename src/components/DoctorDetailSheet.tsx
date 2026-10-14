/**
 * <DoctorDetailSheet> — read-only referral profile for a single doctor.
 *
 * Opens when a doctor row is tapped. A date-range picker scopes the whole view
 * to a period; inside it the sheet shows the patients referred by this doctor
 * in that window, a summary of the tests conducted on their behalf over the
 * same window, and a few aggregate stats (visits, panels, out-of-range results,
 * most-ordered tests) so the doctor's activity reads as a trend, not a list.
 *
 * Reports are streamed with a `createdAt`-bounded subscription that lives only
 * while the sheet is open, so the window the picker sets is the window the
 * queries actually return.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { collection, db, onSnapshot, orderBy, query, where } from '../data/fs';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { readReports, ageAsNumber, type PatientRecord, type ReportRecord } from '../lib/models';
import { resolveValueStatus, collapseToProfiles } from '../lib/pathology-tests';
import { createdAtRangeFilters } from '../lib/date-range';
import { cn } from '../lib/utils';
import { PatientDetailSheet } from './PatientDetailSheet';
import { Activity, CalendarRange, FileText, Stethoscope, Users, FlaskConical } from 'lucide-react';
import {
  CalendarRangePicker,
  Card,
  EmptyState,
  ListGroup,
  ListRow,
  Sheet,
  StatusPill,
  toIsoDay,
} from './ui';

export interface DoctorDetailTarget {
  id: string;
  name: string;
  phone?: string;
}

/** Months shown in the referral trend. Six is wide enough to see a direction
 *  and narrow enough that every bar is still readable on a phone. */
const TREND_MONTHS = 6;

/** `YYYY-MM` bucket key for a date, in local time. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function matchesDoctor(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Registration day of a patient, as a comparable `YYYY-MM-DD`. */
function inPeriod(iso: string | undefined, from: string, to: string): boolean {
  if (!iso) return true;
  const day = toIsoDay(new Date(iso));
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

export function DoctorDetailSheet({
  doctor,
  patients,
  initialFrom = '',
  initialTo = '',
  onClose,
}: {
  doctor: DoctorDetailTarget | null;
  patients: PatientRecord[];
  initialFrom?: string;
  initialTo?: string;
  onClose: () => void;
}) {
  const [fromDate, setFromDate] = useState(initialFrom);
  const [toDate, setToDate] = useState(initialTo);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  // The parent keys this sheet by doctor id, so a new selection remounts it
  // with a clean slate; the picker's onChange handler flips `loading` (an event
  // callback), keeping the effect body free of synchronous setState.
  const [loading, setLoading] = useState(true);
  // Tapping a referred patient opens their own record sheet on top of this one.
  const [openPatient, setOpenPatient] = useState<PatientRecord | null>(null);

  // Re-scope the subscription whenever the doctor or the period changes. The
  // bounds are the local day's first/last ms (see createdAtRangeFilters) so the
  // window matches the calendar grid the picker paints.
  useEffect(() => {
    if (!doctor) return;
    const path = 'reports';
    const { since, until } = createdAtRangeFilters(fromDate, toDate);
    const constraints = [orderBy('createdAt', 'desc')];
    if (since) constraints.unshift(where('createdAt', '>=', since));
    if (until) constraints.unshift(where('createdAt', '<=', until));
    const unsubscribe = onSnapshot(
      query(collection(db, path), ...constraints),
      snapshot => {
        setReports(readReports(snapshot.docs));
        setLoading(false);
      },
      error => {
        handleFirestoreError(error, OperationType.GET, path);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [doctor, fromDate, toDate]);

  // Every patient this doctor has ever referred — used to attribute reports,
  // since a report in the window may belong to a patient registered earlier.
  const referredPatients = useMemo(
    () => (doctor ? patients.filter(p => matchesDoctor(p.doctorName, doctor.name)) : []),
    [patients, doctor],
  );
  const referredIds = useMemo(() => new Set(referredPatients.map(p => p.id)), [referredPatients]);

  const patientsInPeriod = useMemo(
    () => referredPatients.filter(p => inPeriod(p.createdAt, fromDate, toDate)),
    [referredPatients, fromDate, toDate],
  );

  const reportsInPeriod = useMemo(
    () => reports.filter(r => referredIds.has(r.patientId)),
    [reports, referredIds],
  );

  // Flatten results once — reused by the KPIs and the out-of-range tally.
  // Tests are counted at the *profile* level (a CBC panel is one test, not its
  // ~28 member parameters), matching how the patient timeline displays them.
  const { testCount, abnormalCount, topTests } = useMemo(() => {
    const patientById = new Map(referredPatients.map(p => [p.id, p]));
    let tests = 0;
    let abnormal = 0;
    const tally = new Map<string, number>();
    for (const report of reportsInPeriod) {
      const profiles = collapseToProfiles(report.testSelection);
      for (const name of profiles) {
        tally.set(name, (tally.get(name) ?? 0) + 1);
      }
      tests += profiles.length;
      const patient = patientById.get(report.patientId);
      const age = patient ? ageAsNumber(patient) : undefined;
      for (const [name, value] of Object.entries(report.resultData ?? {})) {
        const { status } = resolveValueStatus(name, value, age, patient?.gender);
        if (status === 'low' || status === 'high') abnormal += 1;
      }
    }
    const top = Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    return { testCount: tests, abnormalCount: abnormal, topTests: top };
  }, [reportsInPeriod, referredPatients]);

  const maxTop = topTests[0]?.[1] ?? 1;

  /**
   * Referrals per calendar month, oldest → newest. Deliberately scoped to the
   * doctor and *not* to the date picker: a trend that reshapes itself because
   * you narrowed the window below it isn't a trend, it's a restatement of the
   * number already shown in the Patients tile.
   */
  const referralTrend = useMemo(() => {
    const now = new Date();
    const buckets = Array.from({ length: TREND_MONTHS }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1 - i), 1);
      return {
        key: monthKey(d),
        label: d.toLocaleDateString('en-IN', { month: 'short' }),
        count: 0,
      };
    });
    const byKey = new Map(buckets.map(b => [b.key, b]));
    for (const patient of referredPatients) {
      if (!patient.createdAt) continue;
      const d = new Date(patient.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const bucket = byKey.get(monthKey(d));
      if (bucket) bucket.count += 1;
    }
    const current = buckets[buckets.length - 1].count;
    const previous = buckets[buckets.length - 2]?.count ?? 0;
    return {
      buckets,
      current,
      previous,
      delta: current - previous,
      previousLabel: buckets[buckets.length - 2]?.label ?? 'last month',
    };
  }, [referredPatients]);

  const maxTrend = Math.max(1, ...referralTrend.buckets.map(b => b.count));

  return (
    <Sheet
      open={!!doctor}
      onClose={onClose}
      width="lg"
      title={doctor?.name}
      description={doctor?.phone ? doctor.phone : doctor ? 'Referral activity' : undefined}
    >
      {!doctor ? null : (
        <div className="space-y-5 pb-2">
          <CalendarRangePicker
            fromDate={fromDate}
            toDate={toDate}
            onChange={({ fromDate: from, toDate: to }) => {
              setLoading(true);
              setFromDate(from);
              setToDate(to);
            }}
            className="z-30"
          />

          {/* Aggregate stats for the selected period */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              icon={<Users className="h-4 w-4" />}
              label="Patients"
              value={patientsInPeriod.length}
            />
            <Stat
              icon={<FileText className="h-4 w-4" />}
              label="Reports"
              value={reportsInPeriod.length}
            />
            <Stat icon={<FlaskConical className="h-4 w-4" />} label="Tests" value={testCount} />
            <Stat
              icon={<Activity className="h-4 w-4" />}
              label="Out of range"
              value={abnormalCount}
              tone={abnormalCount > 0 ? 'warning' : 'neutral'}
            />
          </div>

          {/* Referral trend — answers "is this doctor sending more or less than
              last month?" without leaving the sheet. Bars are relative to the
              busiest month in view, so the shape reads before the numbers do. */}
          <Card pad="sm" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                Referrals · last {TREND_MONTHS} months
              </h3>
              <StatusPill
                tone={
                  referralTrend.delta > 0
                    ? 'success'
                    : referralTrend.delta < 0
                      ? 'warning'
                      : 'neutral'
                }
                dot
              >
                {referralTrend.delta > 0
                  ? `+${referralTrend.delta} vs last month`
                  : referralTrend.delta < 0
                    ? `${referralTrend.delta} vs last month`
                    : 'Same as last month'}
              </StatusPill>
            </div>
            <div
              role="img"
              aria-label={`Patients referred per month: ${referralTrend.buckets
                .map(b => `${b.label} ${b.count}`)
                .join(', ')}`}
              className="flex items-end gap-2"
            >
              {referralTrend.buckets.map((bucket, index) => {
                const isCurrentMonth = index === referralTrend.buckets.length - 1;
                // A zero month still gets a stub so the axis reads as six months,
                // not as a chart that stopped early.
                const height = bucket.count
                  ? Math.max(16, Math.round((bucket.count / maxTrend) * 100))
                  : 4;
                return (
                  <div
                    key={bucket.key}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                  >
                    <span className="h-3 text-[10px] font-semibold tabular-nums text-on-surface-variant">
                      {bucket.count > 0 ? bucket.count : ''}
                    </span>
                    <div className="flex h-16 w-full items-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{
                          duration: 0.45,
                          ease: [0.22, 1, 0.36, 1],
                          delay: index * 0.04,
                        }}
                        className={cn(
                          'w-full rounded-t-md',
                          isCurrentMonth ? 'bg-accent' : 'bg-accent/25',
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-[10px] font-medium',
                        isCurrentMonth ? 'text-on-surface' : 'text-on-surface-variant',
                      )}
                    >
                      {bucket.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-on-surface-variant">
              {referralTrend.current} referred this month, {referralTrend.previous} in{' '}
              {referralTrend.previousLabel}.
            </p>
          </Card>

          {/* Most-ordered tests — the trend view */}
          {topTests.length > 0 && (
            <Card pad="sm" className="space-y-2.5">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                Most ordered tests
              </h3>
              <ul className="space-y-2">
                {topTests.map(([name, count]) => (
                  <li key={name} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="truncate font-semibold text-on-surface">{name}</span>
                      <span className="shrink-0 tabular-nums text-on-surface-variant">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.round((count / maxTop) * 100)}%` }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full rounded-full bg-accent"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Patients referred in the period */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant">
                <Stethoscope className="h-3.5 w-3.5" />
                Patients referred {fromDate || toDate ? 'in period' : 'all time'}
              </h3>
              <StatusPill tone="neutral">{patientsInPeriod.length}</StatusPill>
            </div>
            {loading ? (
              <p
                role="status"
                className="py-6 text-center text-sm font-semibold text-on-surface-variant"
              >
                Loading activity…
              </p>
            ) : patientsInPeriod.length === 0 ? (
              <Card pad="none">
                <EmptyState
                  icon={<CalendarRange className="h-7 w-7" />}
                  title="No referrals in this period"
                  description="Widen the date range to see this doctor's referral history."
                />
              </Card>
            ) : (
              <ListGroup>
                {patientsInPeriod.map(patient => {
                  const visits = reportsInPeriod.filter(r => r.patientId === patient.id).length;
                  return (
                    <ListRow
                      key={patient.id}
                      onClick={() => setOpenPatient(patient)}
                      leading={
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-[15px] font-bold text-accent">
                          {patient.name[0]}
                        </span>
                      }
                      title={patient.name}
                      subtitle={`${patient.age}y · ${patient.gender} · ${
                        patient.createdAt
                          ? new Date(patient.createdAt).toLocaleDateString('en-IN')
                          : '—'
                      }`}
                      trailing={
                        <StatusPill tone={visits > 0 ? 'accent' : 'neutral'}>
                          {visits} report{visits === 1 ? '' : 's'}
                        </StatusPill>
                      }
                    />
                  );
                })}
              </ListGroup>
            )}
          </div>
        </div>
      )}
      {/* Sheet portals its children to <body>, so the patient record paints on
          top of this one, and the back handler keeps the most recently opened
          overlay above the other — Back closes the patient, not the doctor. */}
      <PatientDetailSheet
        key={openPatient?.id}
        patient={openPatient}
        onClose={() => setOpenPatient(null)}
      />
    </Sheet>
  );
}

function Stat({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <Card
      pad="sm"
      className={tone === 'warning' && value > 0 ? 'bg-warning-container/40' : undefined}
    >
      <div className="flex items-center gap-2 text-on-surface-variant">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em]">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-[-0.02em] text-on-surface">
        {value}
      </p>
    </Card>
  );
}
