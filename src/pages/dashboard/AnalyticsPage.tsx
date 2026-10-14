import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
  LabelList,
} from 'recharts';
import { Users, Activity, TestTube, FileText } from 'lucide-react';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  db,
  type QueryConstraint,
} from '../../data/fs';
import { readPatients, readReports, type PatientRecord, type ReportRecord } from '../../lib/models';
import { handleFirestoreError, OperationType } from '../../lib/firestore-errors';
import { cn } from '../../lib/utils';
import { expandTestSelection, findTestInfo } from '../../lib/pathology-tests';
import { groupByDoctorName } from '../../lib/doctor-registry';
import { CalendarRangePicker, Card, SectionTitle, toIsoDay } from '../../components/ui';
import { localDayStartIso, localDayEndIso } from '../../lib/date-range';
import { useRefreshHandler } from '../../hooks/useRefreshHandler';

/** Reads a CSS custom property from <html> so charts follow the active palette + color mode. */
const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Light-mode fallbacks, used only for the very first paint before the effect resolves the real vars.
const CHART_FALLBACK = {
  c1: '#0a6cbe',
  c2: '#0e8c7f',
  c3: '#7c4dff',
  c4: '#e8930c',
  c5: '#d64550',
  c6: '#3fa45b',
  grid: '#d2d2d7',
  tick: '#6e6e73',
  surface: '#ffffff',
  border: '#d2d2d7',
  onSurface: '#1d1d1f',
};

const DAY_MS = 86_400_000;

type TrendGrain = 'day' | 'week' | 'month';

interface TrendPoint {
  /** Stable bucket key — the ISO day the bucket starts on, never its label. */
  key: string;
  /** Axis label. */
  name: string;
  reports: number;
  tests: number;
}

/**
 * Grain for a window: daily to ~3 months, weekly to ~2 years, monthly beyond.
 *
 * Chosen so the axis stays readable *without* discarding data. The previous
 * implementation capped the series at 90 daily points, so a year-long window
 * quietly drew about a quarter of itself and the KPI totals below dropped the
 * rest with no indication on screen.
 */
function trendGrainFor(daySpan: number): TrendGrain {
  if (daySpan <= 92) return 'day';
  if (daySpan <= 730) return 'week';
  return 'month';
}

/** The bucket a day belongs to, keyed and labelled for the chosen grain. */
function bucketFor(day: Date, grain: TrendGrain): TrendPoint {
  const start = new Date(day);
  if (grain === 'week') start.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  if (grain === 'month') start.setDate(1);
  return {
    key: toIsoDay(start),
    name:
      grain === 'day'
        ? start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
        : grain === 'week'
          ? `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} +wk`
          : start.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }),
    reports: 0,
    tests: 0,
  };
}

/**
 * Tests a report contributes: the ordered panels expanded into their members, so
 * a CBC counts as the ~20 tests it actually reports rather than as "1".
 *
 * `testSelection` mixes panel names with their components, so counting the list
 * length meant the same figure could be booking lines or result lines depending
 * on the document — month-to-month comparisons were meaningless. Documents with
 * no ordered list (older records) fall back to what was recorded, so a report
 * with results is never counted as zero tests.
 */
function testCountFor(report: ReportRecord): number {
  const expanded = expandTestSelection(report.testSelection ?? []);
  return expanded.length || Object.keys(report.resultData ?? {}).length;
}

export default function AnalyticsPage() {
  const [fromDate, setFromDate] = useState(() => {
    // default to 7 days ago
    const d = new Date();
    d.setDate(d.getDate() - 7);
    // `toIsoDay` formats the *local* day. `toISOString().split('T')[0]` would
    // convert to UTC first, so before 05:30 IST the default range would end
    // yesterday and today's reports would fall out of their own chart.
    return toIsoDay(d);
  });
  const [toDate, setToDate] = useState(() => toIsoDay(new Date()));

  const [reports, setReports] = useState<ReportRecord[]>([]);
  /**
   * Patients *registered* inside the selected window. This is not the same
   * population as the reports in the window — a returning patient was registered
   * months ago — so it is never used as a denominator for report activity. See
   * `roster` for the whole-register read, and `patientsTested` for who the
   * reports in range actually belong to.
   */
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  /**
   * Every registered patient, read once. The referral join (which doctor sent
   * whom) needs patients that are not in the date window, and "registered
   * patients" has to mean the whole register — the windowed read used to silently
   * turn every returning patient into "Unknown Doctor".
   */
  const [roster, setRoster] = useState<PatientRecord[]>([]);

  // Chart colors are resolved from CSS custom properties (never at module scope —
  // getComputedStyle would break SSR/tests) and re-read whenever the palette or
  // color mode changes.
  const [chartColors, setChartColors] = useState<Record<string, string>>({});

  useEffect(() => {
    const readChartColors = () => {
      setChartColors({
        c1: cssVar('--chart-1'),
        c2: cssVar('--chart-2'),
        c3: cssVar('--chart-3'),
        c4: cssVar('--chart-4'),
        c5: cssVar('--chart-5'),
        c6: cssVar('--chart-6'),
        grid: cssVar('--outline-variant'),
        tick: cssVar('--on-surface-variant'),
        surface: cssVar('--surface-container-lowest'),
        border: cssVar('--outline-variant'),
        onSurface: cssVar('--on-surface'),
      });
    };
    readChartColors();
    window.addEventListener('settings-updated', readChartColors);
    return () => window.removeEventListener('settings-updated', readChartColors);
  }, []);

  const cc = (key: keyof typeof CHART_FALLBACK) => chartColors[key] || CHART_FALLBACK[key];
  const pieColors = [cc('c1'), cc('c2'), cc('c3'), cc('c4'), cc('c5'), cc('c6')];
  const tooltipContentStyle = {
    backgroundColor: cc('surface'),
    borderColor: cc('border'),
    borderWidth: 1,
    borderRadius: 16,
    color: cc('onSurface'),
    boxShadow: '0 16px 40px -12px rgb(0 0 0 / 0.25)',
    fontSize: 12,
  };

  useEffect(() => {
    // Charts only ever aggregate the selected window, so the window is what gets
    // read. Both collections used to be streamed in full into memory for every
    // visit to this page, billed per document on every change in the lab.
    const withinRange = (field: string): QueryConstraint[] => {
      const constraints: QueryConstraint[] = [];
      // Local-day bounds, because the aggregation below buckets by `toIsoDay`.
      // `${fromDate}T00:00:00.000Z` is UTC midnight, which in UTC+5:30 excludes
      // everything created before 05:30 — the chart's own dots and totals then
      // disagreed with the rows it had actually read.
      const since = localDayStartIso(fromDate);
      const until = localDayEndIso(toDate);
      if (since) constraints.push(where(field, '>=', since));
      if (until) constraints.push(where(field, '<=', until));
      return constraints;
    };

    const unsubReports = onSnapshot(
      query(collection(db, 'reports'), ...withinRange('createdAt')),
      s => setReports(readReports(s.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'reports'),
    );

    const unsubPatients = onSnapshot(
      query(collection(db, 'patients'), ...withinRange('createdAt')),
      s => setPatients(readPatients(s.docs)),
      error => handleFirestoreError(error, OperationType.GET, 'patients'),
    );

    return () => {
      unsubReports();
      unsubPatients();
    };
  }, [fromDate, toDate]);

  useEffect(() => {
    // One-shot read of the whole register, refreshed with the rest of the app on
    // pull-to-refresh. A listener would re-stream every patient on every write
    // anywhere in the lab, which this page only needs for a name lookup.
    let cancelled = false;
    const loadRoster = () =>
      getDocs(query(collection(db, 'patients')))
        .then(snapshot => {
          if (!cancelled) setRoster(readPatients(snapshot.docs));
        })
        .catch(error => handleFirestoreError(error, OperationType.GET, 'patients'));
    void loadRoster();
    return () => {
      cancelled = true;
    };
  }, [reports]);
  // Pull-to-refresh now flows through the shared registry, so the gesture
  // awaits the roster read and can honestly say "refreshed" or report which
  // view failed instead of a fixed-delay toast.
  useRefreshHandler(() =>
    getDocs(query(collection(db, 'patients')))
      .then(snapshot => setRoster(readPatients(snapshot.docs)))
      .catch(error => handleFirestoreError(error, OperationType.GET, 'patients')),
  );

  const activeReportDates = useMemo(() => {
    return new Set(reports.filter(r => r.createdAt).map(r => toIsoDay(new Date(r.createdAt))));
  }, [reports]);

  const { filteredReports, draftsInRange } = useMemo(() => {
    // Analytics counts *issued* reports. A draft is work in progress that has not
    // left the lab, so including it inflated "Total Reports — finalized in
    // selected range" while the label promised otherwise.
    //
    // Defensive re-check on the local day: a document whose `createdAt` cannot be
    // parsed must not silently land inside every range.
    const inRange = reports.filter(r => {
      if (!r.createdAt) return false;
      const createdAtStr = toIsoDay(new Date(r.createdAt));
      if (fromDate && createdAtStr < fromDate) return false;
      if (toDate && createdAtStr > toDate) return false;
      return true;
    });
    const issued = inRange.filter(r => r.status === 'final');

    return { filteredReports: issued, draftsInRange: inRange.length - issued.length };
  }, [reports, fromDate, toDate]);

  /**
   * The trend series for both volume charts, bucketed at the grain the window
   * needs and keyed by ISO day so no two buckets can merge or be dropped.
   */
  const trend = useMemo(() => {
    const start = new Date(fromDate || toDate || Date.now());
    const end = new Date(toDate || fromDate || Date.now());
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    if (end < start) end.setTime(start.getTime());

    const daySpan = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
    const grain = trendGrainFor(daySpan);

    const buckets = new Map<string, TrendPoint>();
    const cursor = new Date(start);
    if (grain === 'week') cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    if (grain === 'month') cursor.setDate(1);

    // 400 buckets is far beyond any readable axis; it exists so a mistyped range
    // cannot build an unbounded array, and every report still lands in a bucket.
    for (let guard = 0; cursor <= end && guard < 400; guard++) {
      const point = bucketFor(cursor, grain);
      buckets.set(point.key, point);
      if (grain === 'day') cursor.setDate(cursor.getDate() + 1);
      else if (grain === 'week') cursor.setDate(cursor.getDate() + 7);
      else cursor.setMonth(cursor.getMonth() + 1);
    }
    if (buckets.size === 0) {
      const only = bucketFor(start, grain);
      buckets.set(only.key, only);
    }

    filteredReports.forEach(r => {
      if (!r.createdAt) return;
      const point = buckets.get(bucketFor(new Date(r.createdAt), grain).key);
      if (!point) return;
      point.reports += 1;
      point.tests += testCountFor(r);
    });

    return { points: [...buckets.values()], grain };
  }, [filteredReports, fromDate, toDate]);

  const trendData = trend.points;
  const trendGrain = trend.grain;

  /**
   * Distinct patients the issued reports in range belong to. This — not the
   * registration window — is the population every per-patient figure here needs.
   */
  const patientsTested = useMemo(
    () => new Set(filteredReports.map(r => r.patientId).filter(Boolean)).size,
    [filteredReports],
  );

  // Both breakdown charts used to share one dataset bucketed by `testType`, which
  // most reports never carry — so each rendered a single "Other" shape. Categories
  // come from the test catalogue; volume from the tests actually ordered, with
  // group headers left out because their members are counted individually.
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReports.forEach(r => {
      (r.testSelection || []).forEach(name => {
        const category = findTestInfo(name)?.category || 'Other';
        counts[category] = (counts[category] || 0) + 1;
      });
    });

    return Object.keys(counts)
      .map(k => ({ name: k, value: counts[k] }))
      .sort((a, b) => b.value - a.value);
  }, [filteredReports]);

  const topTestsData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReports.forEach(r => {
      (r.testSelection || []).forEach(name => {
        const info = findTestInfo(name);
        if (info?.isGroup || info?.isHeader) return;
        counts[name] = (counts[name] || 0) + 1;
      });
    });

    return Object.keys(counts)
      .map(k => ({ name: k, value: counts[k] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredReports]);

  /**
   * Reports per patient inside the window.
   *
   * Labelled for what it measures. This used to read "New vs recurring
   * patients", but a patient with one report here is not new to the lab — they
   * may have been registered years ago and simply visited once this month, and
   * the underlying read included drafts as well.
   */
  const patientInsightsData = useMemo(() => {
    let single = 0;
    let multiple = 0;
    const counts: Record<string, number> = {};
    filteredReports.forEach(r => {
      if (r.patientId) {
        counts[r.patientId] = (counts[r.patientId] || 0) + 1;
      }
    });

    Object.values(counts).forEach(c => {
      if (c > 1) multiple++;
      else single++;
    });

    if (single === 0 && multiple === 0) return [{ name: 'No reports in range', value: 1 }];

    return [
      { name: 'One report', value: single },
      { name: 'Multiple reports', value: multiple },
    ];
  }, [filteredReports]);

  const topDoctors = useMemo(() => {
    // A report carries no doctor — the referral lives on the patient. Joining
    // through `patientId` is what makes this chart more than one "Unknown
    // Doctor" bar.
    //
    // The join reads the whole register (`roster`), not the date window: the
    // patients who generate reports this month were mostly registered long ago,
    // so joining through the windowed read labelled nearly every referral
    // "Unknown Doctor" and ranked that as the top referrer.
    //
    // Grouped on `doctorNameKey`, not the raw string: `DR MANOJ KUMAR`,
    // `DR.MANOJ KUMAR` and `Dr. Manoj Kumar (MBBS)` are one person to the lab and
    // used to be three bars here, each under-counting the doctor's real referrals.
    const doctorByPatient = new Map(roster.map(p => [p.id, p.doctorName || 'Unknown Doctor']));
    return groupByDoctorName(filteredReports, report => doctorByPatient.get(report.patientId))
      .map(group => ({
        name: group.name,
        patients: new Set(group.members.map(member => member.patientId).filter(Boolean)).size,
        reports: group.members.length,
      }))
      .sort((a, b) => b.reports - a.reports)
      .slice(0, 5);
  }, [filteredReports, roster]);

  const totalReports = trendData.reduce((acc, curr) => acc + curr.reports, 0);
  const totalTests = trendData.reduce((acc, curr) => acc + curr.tests, 0);
  /** Registrations opened inside the window — a different thing from activity. */
  const newRegistrations = patients.length;

  return (
    <div className="space-y-6">
      <Card
        pad="md"
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
      >
        <div>
          <h2 className="text-2xl font-bold tracking-[-0.03em] text-on-surface">Dashboard</h2>
          <p className="text-sm text-on-surface-variant">Overview of your lab performance</p>
          {draftsInRange > 0 && (
            <p className="mt-1 text-xs text-on-surface-variant">
              {draftsInRange} draft{draftsInRange === 1 ? '' : 's'} in this window{' '}
              {draftsInRange === 1 ? 'is' : 'are'} still unissued, so{' '}
              {draftsInRange === 1 ? 'it is' : 'they are'} not counted below.
            </p>
          )}
        </div>

        <CalendarRangePicker
          fromDate={fromDate}
          toDate={toDate}
          activeDates={activeReportDates}
          onChange={({ fromDate: from, toDate: to }) => {
            setFromDate(from);
            setToDate(to);
          }}
          className="z-30 w-full sm:w-64"
        />
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 fold:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total Reports',
            value: totalReports.toLocaleString(),
            sub: 'issued reports in this range',
            icon: FileText,
            tint: 'bg-chart-1/12 text-chart-1',
          },
          {
            label: 'Total Tests',
            value: totalTests.toLocaleString(),
            sub: 'individual tests (panels expanded)',
            icon: TestTube,
            tint: 'bg-chart-2/12 text-chart-2',
          },
          {
            label: 'Patients Tested',
            value: patientsTested.toLocaleString(),
            sub:
              newRegistrations > 0
                ? `${newRegistrations} newly registered`
                : 'distinct patients served',
            icon: Users,
            tint: 'bg-chart-3/12 text-chart-3',
          },
          {
            label: 'Avg Tests/Patient',
            // Same window on both sides, and the divisor is the number of tested
            // patients. This used to be `totalTests / patients.length` guarded by
            // `totalReports > 0` — the wrong operand — so a range holding reports
            // but no *new* registrations divided by zero and rendered the literal
            // word "Infinity" on a clinical KPI card.
            value: patientsTested > 0 ? (totalTests / patientsTested).toFixed(1) : '0',
            sub: 'tests per tested patient',
            icon: Activity,
            tint: 'bg-chart-4/12 text-chart-4',
          },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 260, damping: 24 }}
            className="flex"
          >
            <Card className="flex w-full flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                    {kpi.label}
                  </p>
                  <h4 className="mt-1 text-[28px] font-bold leading-tight tracking-[-0.03em] text-on-surface tabular-nums">
                    {kpi.value}
                  </h4>
                </div>
                <div
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                    kpi.tint,
                  )}
                >
                  <kpi.icon className="w-5 h-5" aria-hidden="true" />
                </div>
              </div>
              <p className="text-[11px] font-medium text-on-surface-variant">{kpi.sub}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Report Volume Trend */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-[360px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle
              title="Report Volume Trend"
              action={
                <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                  {trendGrain === 'day' ? 'Daily' : trendGrain === 'week' ? 'Weekly' : 'Monthly'}
                </span>
              }
            />
            <div
              className="flex-1 w-full min-h-0"
              // UI-P1-07 — the chart's mouse tooltip is invisible to keyboard
              // and screen-reader users, and the canvas renders as a
              // unlabeled SVG. Naming the figure and stating the trend
              // summary in text gives AT users the same "what does this
              // show" answer without needing to hover a data point.
              role="img"
              aria-label={`Report volume across the selected range, shown per ${trendGrain}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorReports" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cc('c1')} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={cc('c1')} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={cc('grid')}
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                  />
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Area
                    type="monotone"
                    dataKey="reports"
                    stroke={cc('c1')}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorReports)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        {/* Test Volume Trend */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="h-[360px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle
              title="Test Volume Trend"
              action={
                <span className="shrink-0 rounded-full bg-surface-container px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                  {trendGrain === 'day' ? 'Daily' : trendGrain === 'week' ? 'Weekly' : 'Monthly'}
                </span>
              }
            />
            <div
              className="flex-1 w-full min-h-0"
              role="img"
              aria-label={`Test volume across the selected range, shown per ${trendGrain}`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cc('c2')} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={cc('c2')} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke={cc('grid')}
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: cc('tick') }}
                  />
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Area
                    type="monotone"
                    dataKey="tests"
                    stroke={cc('c2')}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorTests)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Row 3: Splits & Tops */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-1 h-[320px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Test Category Distribution" />
            <div
              className="flex-1 w-full relative flex items-center justify-center min-h-0"
              role="img"
              aria-label={`Test category distribution across ${categoryData.length} categories in the selected range${categoryData[0] ? `, largest is ${categoryData[0].name} with ${categoryData[0].value}` : ''}`}
            >
              {categoryData.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      innerRadius={54}
                      outerRadius={74}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={tooltipContentStyle} />
                    {/* Legend under the ring: a right-side vertical legend used to
                        squeeze the donut into the left half of the card and the
                        entries overlapped the ring itself (owner: "fix analytics
                        ui"). Bottom-horizontal keeps both readable. */}
                    <Legend
                      layout="horizontal"
                      verticalAlign="bottom"
                      align="center"
                      iconType="circle"
                      wrapperStyle={{ fontSize: '12px', color: cc('tick'), paddingTop: 6 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
              {categoryData.length > 0 && (
                // Offset by the legend row so the text sits in the ring's true
                // centre, not the container's — the old `pr-[100px]` hack left
                // "HAEMATOLO…" clipped across the donut edge.
                <div className="pointer-events-none absolute inset-x-0 top-0 bottom-9 flex flex-col items-center justify-center">
                  <span
                    className="max-w-[130px] truncate px-2 text-center text-[13px] font-semibold text-on-surface"
                    title={categoryData[0].name}
                  >
                    {categoryData[0].name}
                  </span>
                  <span className="text-xs text-on-surface-variant">Top Category</span>
                </div>
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 h-[320px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Top Tests by Volume" />
            <div
              className="flex-1 w-full min-h-0"
              role="img"
              aria-label={`Top ${topTestsData.length} tests by volume in the selected range${topTestsData[0] ? `, most-ordered is ${topTestsData[0].name} with ${topTestsData[0].value}` : ''}`}
            >
              {topTestsData.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-on-surface-variant">No data available</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topTestsData}
                    layout="vertical"
                    margin={{ top: 0, right: 30, left: 30, bottom: 0 }}
                    barSize={12}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      horizontal={false}
                      stroke={cc('grid')}
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      type="number"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: cc('tick') }}
                      // Counts are whole tests — the default 0/0.25/0.5/0.75/1
                      // scale read like a bug even when it was only one report.
                      allowDecimals={false}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: cc('onSurface') }}
                      width={130}
                      // Long catalogue names ("ABSOLUTE EOSINOPHILL COUNT")
                      // wrapped into the bars; a clipped tick plus the full
                      // name in the tooltip keeps the axis on one line each.
                      tickFormatter={(value: string) =>
                        value.length > 20 ? `${value.slice(0, 19)}…` : value
                      }
                    />
                    <RechartsTooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={tooltipContentStyle}
                    />
                    <Bar dataKey="value" fill={cc('c3')} radius={[0, 6, 6, 0]}>
                      <LabelList
                        dataKey="value"
                        position="right"
                        style={{ fontSize: 11, fill: cc('tick') }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Row 4: Patient Insights & Doctors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="lg:col-span-1 h-[300px]"
        >
          <Card pad="lg" className="flex h-full flex-col">
            <SectionTitle title="Patient Insights" subtitle="Reports per patient in range" />
            <div
              className="flex-1 w-full relative flex items-center justify-center min-h-0"
              role="img"
              aria-label={`Patient insights: ${roster.length} registered patients split by reports per patient in the selected range`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={patientInsightsData}
                    innerRadius={48}
                    outerRadius={66}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    <Cell fill={cc('c2')} />
                    <Cell fill={cc('c1')} />
                    <Cell fill={cc('grid')} />
                  </Pie>
                  <RechartsTooltip contentStyle={tooltipContentStyle} />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    iconType="circle"
                    wrapperStyle={{ fontSize: '12px', color: cc('tick'), paddingTop: 6 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-x-0 top-0 bottom-9 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-on-surface tabular-nums">
                  {roster.length.toLocaleString()}
                </span>
                <span className="text-[9px] uppercase tracking-[0.08em] text-on-surface-variant">
                  Registered patients
                </span>
              </div>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="lg:col-span-2 h-[300px]"
        >
          <Card pad="lg" className="flex h-full flex-col overflow-hidden">
            <SectionTitle title="Top Referring Doctors" subtitle="Ranked by reports generated" />
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant w-1/2 text-left">
                      Doctor
                    </th>
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Patients
                    </th>
                    <th className="pb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-on-surface-variant text-right">
                      Reports Generated
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40">
                  {topDoctors.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-sm text-on-surface-variant">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    topDoctors.map((doc, idx) => (
                      <tr key={idx} className="transition-colors hover:bg-surface-container-low/50">
                        <td className="py-3 text-sm font-semibold text-on-surface text-left">
                          {doc.name}
                        </td>
                        <td className="py-3 text-sm text-on-surface-variant text-right tabular-nums">
                          {doc.patients}
                        </td>
                        <td className="py-3 text-sm font-medium text-on-surface text-right tabular-nums">
                          {doc.reports}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
