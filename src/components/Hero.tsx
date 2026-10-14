import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowRight, MousePointerClick, ShieldCheck } from 'lucide-react';
import { Button, StatusPill } from './ui';

const KPIS = [
  {
    label: 'Reports today',
    value: '128',
    delta: '+12.4%',
    tint: 'text-chart-1',
    bar: 'bg-chart-1',
  },
  {
    label: 'Avg turnaround',
    value: '4.2h',
    delta: '-38% QoQ',
    tint: 'text-chart-2',
    bar: 'bg-chart-2',
  },
  {
    label: 'Awaiting sign-off',
    value: '7',
    delta: '3 urgent',
    tint: 'text-chart-4',
    bar: 'bg-chart-4',
  },
];

const QUEUE = [
  { id: 'PL-20418', test: 'CBC + Differential', tone: 'success', label: 'Verified', time: '09:41' },
  {
    id: 'PL-20417',
    test: 'Histopathology · Breast',
    tone: 'accent',
    label: 'Signed',
    time: '09:26',
  },
  { id: 'PL-20416', test: 'Lipid profile', tone: 'warning', label: 'Pending', time: '09:12' },
  {
    id: 'PL-20415',
    test: 'Immunochemistry · Ki-67',
    tone: 'neutral',
    label: 'In analysis',
    time: '08:57',
  },
] as const;

const MIX = [
  { label: 'Heme', pct: 82, bar: 'bg-chart-1' },
  { label: 'Cyto', pct: 61, bar: 'bg-chart-2' },
  { label: 'Bio', pct: 44, bar: 'bg-chart-3' },
  { label: 'Micro', pct: 28, bar: 'bg-chart-4' },
];

/** Pure-SVG trend chart — no images, no chart lib, palette-aware via CSS vars. */
function Sparkline() {
  return (
    <svg
      viewBox="0 0 320 120"
      preserveAspectRatio="none"
      className="h-28 w-full sm:h-32"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[26, 56, 86].map(y => (
        <line
          key={y}
          x1="0"
          y1={y}
          x2="320"
          y2={y}
          stroke="var(--outline-variant)"
          strokeWidth="1"
          strokeDasharray="2 6"
        />
      ))}
      <path
        d="M0 96 C22 88 38 66 60 70 S98 96 122 78 S162 36 186 44 S226 70 252 52 S292 26 320 20 L320 120 L0 120 Z"
        fill="url(#hero-area)"
      />
      <path
        d="M0 96 C22 88 38 66 60 70 S98 96 122 78 S162 36 186 44 S226 70 252 52 S292 26 320 20"
        stroke="var(--chart-1)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M0 108 C26 104 44 92 68 94 S110 106 138 96 S182 74 210 78 S258 92 286 76 S308 62 320 58"
        stroke="var(--chart-2)"
        strokeWidth="1.75"
        strokeDasharray="5 5"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  );
}

/** CSS/SVG product mock — replaces the old external placeholder screenshot. */
function ProductMock() {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-[var(--elevated-border)] bg-surface-container-lowest shadow-float">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-outline-variant/50 bg-surface-container-low px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-chart-5/60" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-4/60" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-chart-6/60" aria-hidden="true" />
        <span className="ml-3 hidden rounded-full bg-surface-container-high px-3 py-1 text-[10px] font-medium text-on-surface-variant sm:block">
          app.pathomitra.app/dashboard
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className="animate-soft-pulse h-1.5 w-1.5 rounded-full bg-success"
            aria-hidden="true"
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
            Live
          </span>
        </span>
      </div>

      <div className="space-y-3 p-3 sm:p-5">
        {/* KPI tiles */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {KPIS.map(kpi => (
            <div
              key={kpi.label}
              className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
                {kpi.label}
              </p>
              <div className="mt-1.5 flex items-end justify-between gap-2">
                <span className={`text-2xl font-bold tracking-[-0.03em] ${kpi.tint}`}>
                  {kpi.value}
                </span>
                <span className="text-[11px] font-medium text-on-surface-variant">{kpi.delta}</span>
              </div>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                <span
                  className={`block h-full rounded-full ${kpi.bar} opacity-70`}
                  style={{ width: kpi.label === 'Reports today' ? '72%' : '48%' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {/* Area chart */}
          <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4 lg:col-span-3">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold tracking-[-0.01em] text-on-surface">
                Report volume · 30 days
              </p>
              <StatusPill tone="info">Peak Fri</StatusPill>
            </div>
            <Sparkline />
          </div>

          {/* Section mix */}
          <div className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4 lg:col-span-2">
            <p className="text-[13px] font-semibold tracking-[-0.01em] text-on-surface">
              Workload by section
            </p>
            <div className="mt-3.5 space-y-3">
              {MIX.map(row => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-[11px] font-medium text-on-surface-variant">
                    {row.label}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high">
                    <span
                      className={`block h-full rounded-full ${row.bar}`}
                      style={{ width: `${row.pct}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hairline case table */}
        <div className="overflow-hidden rounded-2xl border border-outline-variant/50">
          <div className="flex items-center justify-between bg-surface-container-low px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">
            <span>Recent cases</span>
            <span>Status</span>
          </div>
          {QUEUE.map(row => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 border-t border-outline-variant/40 bg-surface-container-lowest px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-on-surface">
                  {row.test}
                </p>
                <p className="text-[11px] text-on-surface-variant">
                  {row.id}
                  <span className="mx-1.5 text-on-surface-variant">·</span>
                  {row.time}
                </p>
              </div>
              {row.tone === 'neutral' ? (
                <span
                  className="skeleton-shimmer h-6 w-24 shrink-0 rounded-full"
                  aria-hidden="true"
                />
              ) : (
                <StatusPill tone={row.tone} dot>
                  {row.label}
                </StatusPill>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  // Decorative infinite float loops should fully stop for users who prefer
  // reduced motion — MotionConfig alone won't halt a repeating keyframe.
  const reduceMotion = useReducedMotion();
  const floatA = reduceMotion ? undefined : { y: [0, -10, 0] };
  const floatB = reduceMotion ? undefined : { y: [0, 8, 0] };
  return (
    <section className="relative overflow-hidden px-6 pb-28 pt-16 sm:pt-24 lg:pb-36">
      {/* Aurora — soft brand glows, palette + mode aware */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-44 left-1/2 h-[560px] w-[860px] -translate-x-1/2 rounded-full bg-accent/10 blur-[130px]" />
        <div className="absolute -left-32 top-40 h-[380px] w-[380px] rounded-full bg-secondary/10 blur-[110px]" />
        <div className="absolute -right-24 top-24 h-[380px] w-[380px] rounded-full bg-primary/10 blur-[110px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <motion.span
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-2 rounded-full bg-accent/12 px-3.5 py-1.5 text-[11px] font-bold tracking-wider uppercase text-accent"
        >
          <span
            className="animate-soft-pulse h-1.5 w-1.5 rounded-full bg-accent"
            aria-hidden="true"
          />
          LAB MANAGEMENT SIMPLIFIED
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.05 }}
          className="mt-6 text-5xl font-bold leading-[1.04] tracking-[-0.04em] text-on-surface sm:text-6xl lg:text-7xl"
        >
          Precision pathology,
          <br className="hidden sm:block" />{' '}
          <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            beautifully simple.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-on-surface-variant"
        >
          PathoMitra runs the whole bench-to-report workflow — intake, results, digital sign-off and
          sealed PDF delivery — in one fast, offline-ready console built for clinical teams.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <Link to="/auth">
            <Button variant="brand" size="lg" shine>
              Get started
              <ArrowRight className="h-4 w-4 icon-slide" aria-hidden="true" />
            </Button>
          </Link>
          <a href="#how">
            <Button variant="outline" size="lg">
              <MousePointerClick className="h-4 w-4" aria-hidden="true" />
              See how it works
            </Button>
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-6 text-[12px] font-medium text-on-surface-variant"
        >
          Runs offline · No setup · Encrypted on-device records
        </motion.p>
      </div>

      {/* Product mock */}
      <motion.div
        initial={{ opacity: 0, y: 44 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.3, ease: 'easeOut' }}
        className="relative z-10 mx-auto mt-16 max-w-5xl sm:mt-20"
      >
        <div
          aria-hidden="true"
          className="absolute -inset-x-8 -top-8 bottom-0 rounded-[3.5rem] bg-gradient-to-tr from-primary/10 via-accent/5 to-secondary/10 blur-3xl"
        />
        <div className="relative">
          <ProductMock />

          {/* Floating verification chip */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1, duration: 0.5 }}
            className="absolute -bottom-7 left-2 sm:-left-8"
          >
            <motion.div
              animate={floatA}
              transition={
                reduceMotion ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' }
              }
              className="glass-card rounded-2xl border p-3 shadow-raised"
            >
              <StatusPill tone="success" dot>
                <ShieldCheck className="-ml-0.5 mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Encrypted on this device
              </StatusPill>
              <p className="mt-1.5 font-mono text-[10px] text-on-surface-variant">
                SQLCipher · no network
              </p>
            </motion.div>
          </motion.div>

          {/* Floating turnaround chip */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.15, duration: 0.5 }}
            className="absolute -top-6 right-2 hidden sm:-right-6 sm:block"
          >
            <motion.div
              animate={floatB}
              transition={
                reduceMotion ? undefined : { duration: 7, repeat: Infinity, ease: 'easeInOut' }
              }
              className="glass-card rounded-full px-4 py-2 shadow-raised"
            >
              <span className="text-[11px] font-semibold tracking-[-0.01em] text-on-surface">
                Turnaround ↓ 38% this quarter
              </span>
            </motion.div>
          </motion.div>
        </div>
      </motion.div>
    </section>
  );
}
