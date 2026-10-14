import React, { useState, Suspense, lazy, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/ui';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { DURATION, EASE } from './lib/motion';
import DashboardLayout from './pages/dashboard/DashboardLayout';
import ErrorBoundary from './components/ErrorBoundary';
import TermsGate from './components/TermsGate';
import { isNative, isShell } from './data';
import { installAndroidBackButton } from './lib/back-button';
import { readSettings, SETTINGS_UPDATED_EVENT } from './lib/settings';
import { applyBrandFavicon, readBrandLogo } from './lib/brand-logo';
import { applyScreenshotProtection } from './lib/screenshot-protection';
import { useToast } from './components/ui';
import NProgress from 'nprogress';

const LandingPage = lazy(() => import('./LandingPage'));
const TechnologyPage = lazy(() => import('./pages/TechnologyPage'));
const SolutionsPage = lazy(() => import('./pages/SolutionsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const AuthPage = lazy(() => import('./pages/auth/AuthPage'));
const OverviewPage = lazy(() => import('./pages/dashboard/OverviewPage'));
const PatientsPage = lazy(() => import('./pages/dashboard/PatientsPage'));
const DoctorsPage = lazy(() => import('./pages/dashboard/DoctorsPage'));
const ReportsPage = lazy(() => import('./pages/dashboard/ReportsPage'));
const AnalyticsPage = lazy(() => import('./pages/dashboard/AnalyticsPage'));
const SettingsPage = lazy(() => import('./pages/dashboard/SettingsPage'));

// Wrapper that shows NProgress bar while a lazy chunk is loading
function ProgressSuspense({
  children,
  fullScreen = false,
}: {
  children: React.ReactNode;
  fullScreen?: boolean;
}) {
  return <Suspense fallback={<LazyFallback fullScreen={fullScreen} />}>{children}</Suspense>;
}

function LazyFallback({ fullScreen }: { fullScreen: boolean }) {
  useEffect(() => {
    NProgress.start();
    return () => {
      NProgress.done();
    };
  }, []);

  return (
    <div
      className={`animate-fade-in ${fullScreen ? 'min-h-dvh' : 'min-h-[50vh]'} bg-background p-4 md:p-8`}
    >
      {/* Skeleton — mirrors the dashboard layout so the page feels instant */}
      <div className="max-w-7xl mx-auto space-y-6" aria-busy="true" aria-label="Loading">
        <div className="grid grid-cols-2 md:grid-cols-2 gap-4 md:gap-6">
          <div className="h-24 md:h-28 skeleton-shimmer rounded-3xl" />
          <div className="h-24 md:h-28 skeleton-shimmer rounded-3xl" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 md:h-80 skeleton-shimmer rounded-4xl" />
          <div className="h-64 md:h-80 skeleton-shimmer rounded-4xl hidden lg:block" />
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-accent" aria-label="Loading" />
      </div>
    );

  // No account yet, or the session is locked — /auth owns onboarding + unlock.
  if (!user) return <Navigate to="/auth" replace />;

  return <>{children}</>;
}

const DASHBOARD_TABS = ['dashboard', 'patients', 'doctors', 'reports', 'analytics', 'settings'];

function DashboardShell() {
  // Tab lives in the URL (/dashboard/:tab) so the browser Back button and deep
  // links work properly — essential on mobile where users expect Back to go "up".
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = tabParam && DASHBOARD_TABS.includes(tabParam) ? tabParam : 'dashboard';
  const setActiveTab = (tab: string) => {
    navigate(tab === 'dashboard' ? '/dashboard' : `/dashboard/${tab}`);
  };
  const navigateWithParams = (path: string, params: Record<string, string>) => {
    navigate(`${path}?${new URLSearchParams(params).toString()}`);
  };
  const [patientsTabAction, setPatientsTabAction] = useState<string | null>(null);
  const [reportsTabAction, setReportsTabAction] = useState<string | null>(null);
  const [createReportPatientId, setCreateReportPatientId] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);

  // Deep-link actions: /dashboard/patients?action=add, /dashboard/reports?report=<id>,
  // /dashboard/reports?patient=<id>, /dashboard/settings?section=<id>.
  // Consumed once, then stripped from the URL.
  useEffect(() => {
    const action = searchParams.get('action');
    const report = searchParams.get('report');
    const patient = searchParams.get('patient');
    const section = searchParams.get('section');
    if (action === 'add') setPatientsTabAction('add');
    if (report) setReportsTabAction(report);
    if (patient) setCreateReportPatientId(patient);
    if (section) setSettingsSection(section);
    if (action || report || patient || section) {
      // Strip the consumed params — re-setting the same query would bump
      // location.key and re-trigger this effect, endlessly re-arming the action.
      const next = new URLSearchParams(location.search);
      next.delete('action');
      next.delete('report');
      next.delete('patient');
      next.delete('section');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return (
    <DashboardLayout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onRegisterPatient={() => navigateWithParams('/dashboard/patients', { action: 'add' })}
    >
      {/* Blocking overlay when the terms text no longer matches what this
          account accepted. Inside the authenticated shell, so no clinical data
          is rendered behind it while it is up. */}
      <TermsGate />
      <ProgressSuspense>
        {/* Tab switch = animated page transition. popLayout takes the outgoing
            view out of flow so the incoming page starts rising immediately —
            mode="wait" serialized exit+enter and doubled the dead time. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: DURATION.micro } }}
            transition={{ duration: DURATION.base, ease: EASE.out }}
            className="min-h-0"
          >
            {/* Per-tab boundary: one broken page must not take the whole shell
              (nav, sidebar, other tabs) down with it. */}
            <ErrorBoundary scope={`dashboard:${activeTab}`}>
              {activeTab === 'dashboard' && (
                <OverviewPage
                  setActiveTab={setActiveTab}
                  onAddPatient={() => navigateWithParams('/dashboard/patients', { action: 'add' })}
                  onManageReport={reportId =>
                    navigateWithParams('/dashboard/reports', { report: reportId })
                  }
                  onCreateReportForPatient={patientId =>
                    navigateWithParams('/dashboard/reports', { patient: patientId })
                  }
                />
              )}
              {activeTab === 'patients' && (
                <PatientsPage
                  initialAction={patientsTabAction}
                  clearAction={() => setPatientsTabAction(null)}
                />
              )}
              {activeTab === 'doctors' && <DoctorsPage />}
              {activeTab === 'reports' && (
                <ReportsPage
                  initialReportId={reportsTabAction}
                  clearAction={() => setReportsTabAction(null)}
                  initialCreateReportPatientId={createReportPatientId}
                  clearCreateAction={() => setCreateReportPatientId(null)}
                />
              )}
              {activeTab === 'analytics' && <AnalyticsPage />}
              {activeTab === 'settings' && <SettingsPage initialSection={settingsSection} />}
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </ProgressSuspense>
    </DashboardLayout>
  );
}

interface AppProps {
  onReady?: () => void;
}

/**
 * Routes Android's back gesture through the app instead of the activity.
 *
 * Renders nothing. Mounted once inside the router so it can reach `navigate`,
 * and inside ToastProvider so the "press again to exit" hint is a toast rather
 * than a dead end. On web it never attaches anything — the browser owns Back.
 */
function BackButtonController() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (!isNative) return undefined;
    let teardown: (() => void) | null = null;
    let disposed = false;
    void installAndroidBackButton({
      goBack: () => navigate(-1),
      onExitHint: message => toast.info(message, 2000),
    }).then(remove => {
      if (disposed) remove();
      else teardown = remove;
    });
    return () => {
      disposed = true;
      teardown?.();
    };
  }, [navigate, toast]);

  return null;
}

/**
 * Keeps the native window's capture protection in step with the saved setting.
 *
 * Renders nothing. The flag starts set on device (MainActivity applies it before
 * the WebView loads), so this only has to *clear* it — on first mount, and again
 * whenever Settings saves (`writeSettings` dispatches the event). Mounted at the
 * app root rather than inside the dashboard so the lock screen and the onboarding
 * flow, which both show the lab's name and account, are covered too.
 */
function ScreenshotProtectionController() {
  useEffect(() => {
    if (!isNative) return undefined;
    const apply = () => {
      void applyScreenshotProtection(readSettings().screenshotsAllowed);
    };
    apply();
    window.addEventListener(SETTINGS_UPDATED_EVENT, apply);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, apply);
  }, []);

  return null;
}

/**
 * Keeps the browser tab icon in step with the uploaded brand logo.
 *
 * Renders nothing. `index.html` ships the built-in favicons, so this only has
 * to paint over them once React knows the settings — on mount, and again
 * whenever Settings saves or another tab changes storage. Removing the logo
 * restores the shipped icons (see lib/brand-logo).
 */
function BrandFaviconController() {
  useEffect(() => {
    const apply = () => applyBrandFavicon(readBrandLogo());
    apply();
    window.addEventListener(SETTINGS_UPDATED_EVENT, apply);
    window.addEventListener('storage', apply);
    return () => {
      window.removeEventListener(SETTINGS_UPDATED_EVENT, apply);
      window.removeEventListener('storage', apply);
    };
  }, []);

  return null;
}

/**
 * Route-level page transition — each page fades through a short rise.
 * The dashboard is keyed as a single unit so its own tab transition
 * (inside DashboardShell) keeps working without remounting the shell.
 */
function AnimatedRoutes() {
  const location = useLocation();
  const routeKey = location.pathname.startsWith('/dashboard') ? 'dashboard' : location.pathname;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        // Short, near-instant exit — waiting the full entrance duration on the
        // old page makes navigation feel sluggish; the rise-in carries the rest.
        exit={{ opacity: 0, y: -8, transition: { duration: DURATION.micro } }}
        transition={{ duration: DURATION.base, ease: EASE.out }}
      >
        <Suspense fallback={<LazyFallback fullScreen />}>
          {/* The explicit location keeps the exiting page mounted (and correct)
              while the incoming page animates in. */}
          <Routes location={location}>
            {/* The installed shells (APK, desktop window) are working
                consoles, not brochures: no marketing site, every public path
                collapses onto the auth screen. The web build keeps the
                landing/technology/solutions pages. */}
            <Route path="/" element={isShell ? <Navigate to="/auth" replace /> : <LandingPage />} />
            {!isShell && <Route path="/technology" element={<TechnologyPage />} />}
            {!isShell && <Route path="/solutions" element={<SolutionsPage />} />}
            {/* Public privacy-policy URL — the link the Google Play listing points to. */}
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route
              path="/dashboard/:tab?"
              element={
                <ProtectedRoute>
                  <DashboardShell />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to={isShell ? '/auth' : '/'} replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App({ onReady }: AppProps) {
  useEffect(() => {
    // Signal that React has fully mounted — remove the HTML splash screen
    NProgress.done();
    onReady?.();
  }, [onReady]);

  return (
    // reducedMotion="user" makes every JS-driven animation (route/tab transitions,
    // Sheet springs, Switch/SegmentedControl layout motion, scroll reveals) honor the
    // OS "reduce motion" preference — matching the CSS layer in index.css.
    // The default transition keeps any animation without an explicit `transition`
    // inside the shared vocabulary instead of motion's stock 0.3s ease-out.
    <MotionConfig reducedMotion="user" transition={{ duration: DURATION.base, ease: EASE.out }}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <BackButtonController />
            <ScreenshotProtectionController />
            <BrandFaviconController />
            {/* Accessibility: keyboard users can jump straight to the content */}
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-on-primary focus:shadow-float"
            >
              Skip to content
            </a>
            <ErrorBoundary scope="app">
              <AnimatedRoutes />
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </MotionConfig>
  );
}
