import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  FileText,
  BarChart3,
  PieChart,
  Settings,
  LogOut,
  Menu,
  ChevronRight,
  PanelLeftClose,
  RefreshCw,
  UserPlus,
  Microscope,
  Stethoscope,
  Moon,
  Sun,
  Search,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';
import BackButton from '../../components/BackButton';
import AvatarIcon from '../../components/AvatarIcon';
import { CommandSearch } from '../../components/CommandSearch';
import { KeyboardShortcutsDialog } from '../../components/KeyboardShortcutsDialog';
import NotificationCenter from '../../components/NotificationCenter';
import type { NotificationLink } from '../../lib/notification-engine';
import { Tooltip, useToast } from '../../components/ui';
import { readSettings, writeSettings } from '../../lib/settings';
import { useBrandLogo, DEFAULT_BRAND_LOGO_SRC, SPLASH_BRAND_LOGO_SRC } from '../../lib/brand-logo';
import { startSettingsSync } from '../../lib/settings-sync';
import { BACK_PRIORITY, useBackHandler } from '../../lib/back-button';
import { hapticTap } from '../../lib/haptics';
import { StorageModeBanner } from '../../components/StorageModeBanner';
import { runRegisteredRefreshes } from '../../lib/refresh-registry';

interface NavItem {
  id: string;
  label: string;
  icon: any;
  roles?: ('admin' | 'staff')[];
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: BarChart3 },
  { id: 'patients', label: 'Patients', icon: Users },
  { id: 'doctors', label: 'Doctors', icon: Stethoscope },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'analytics', label: 'Analytics', icon: PieChart },
  { id: 'settings', label: 'Settings', icon: Settings },
];

// Primary destinations surfaced in the mobile bottom tab bar; the rest live in
// the slide-in drawer reached from the header menu button.
const bottomNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Overview', icon: BarChart3 },
  { id: 'patients', label: 'Patients', icon: Users },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

/**
 * Shell breakpoints, kept in one place so JS and CSS cannot drift.
 *
 * `SHELL_RAIL_MQ` is the mirror of the `fold:` variant (--breakpoint-fold: 600px
 * in src/index.css): from there the nav is a persistent rail instead of a drawer
 * with a bottom tab pill. Every foldable unfolded sits in 600-770px, i.e. under
 * the old 768px `md` edge, which is why the inner screen used to render the phone
 * shell. 600 is also Android's sw600dp tablet line, and no portrait phone reaches
 * it (the widest are ~430-440px), so phones keep the drawer + pill untouched.
 *
 * `RAIL_COMPACT_MQ` is the 600-767px band: the rail is persistent, but the
 * content column is only ~400-500px behind an expanded 272px sidebar, so the
 * rail starts collapsed (84px icons) and the person reading the screen chooses
 * to open it.
 */
const SHELL_RAIL_MQ = '(min-width: 600px)';
const RAIL_COMPACT_MQ = '(min-width: 600px) and (max-width: 767px)';

export default function DashboardLayout({
  children,
  activeTab,
  setActiveTab,
  onRegisterPatient,
}: {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onRegisterPatient?: () => void;
}) {
  const { user, role, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // Brand tile: the uploaded lab logo everywhere in the shell, except on the
  // logged-in home page (Overview), which follows the splash branding — the
  // PathoMitra ribbon — by owner decision (2026-10-11); see lib/brand-logo.ts.
  const brandLogo = useBrandLogo();
  const brandSrc =
    activeTab === 'dashboard' ? SPLASH_BRAND_LOGO_SRC : brandLogo || DEFAULT_BRAND_LOGO_SRC;

  // Global search + keyboard shortcuts
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Deep-link a search result to its tab + record via query params that the
  // DashboardShell consumes (report= / patient= / action=).
  const handleSearchNavigate = useCallback(
    (tab: string, id?: string) => {
      if (!id) {
        setActiveTab(tab);
        return;
      }
      const param = tab === 'reports' ? 'report' : tab === 'patients' ? 'patient' : null;
      const url = param
        ? `/dashboard/${tab}?${param}=${encodeURIComponent(id)}`
        : `/dashboard/${tab}`;
      navigate(url);
    },
    [setActiveTab, navigate],
  );

  // Listen for global search shortcuts across the dashboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lab settings and custom tests live in the encrypted on-device database, with
  // localStorage as the fast cache the UI and the pre-paint theme bootstrap read.
  // This mirror is local only — there is no backend.
  useEffect(() => {
    if (role !== 'staff' && role !== 'admin') return;
    return startSettingsSync(user?.uid);
  }, [role, user?.uid]);
  // Use matchMedia instead of window.innerWidth to avoid forced reflow on mount.
  // Queried as min-width so JS and the `fold:` CSS variant share one exact edge
  // (680px in index.css) — a max-width query would leave a fractional-pixel band
  // where the drawer nav and the bottom tab pill are both visible mid-unfold.
  const mql = window.matchMedia(SHELL_RAIL_MQ);
  const [isMobile, setIsMobile] = useState(!mql.matches);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => mql.matches && !window.matchMedia(RAIL_COMPACT_MQ).matches,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarSeed, setAvatarSeed] = useState(user?.photoURL || 'default');

  // Light/dark mode — persisted through the shared settings contract
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() =>
    readSettings().themeMode === 'dark' ? 'dark' : 'light',
  );
  const toggleThemeMode = () => {
    const s = readSettings();
    const next = s.themeMode === 'dark' ? 'light' : 'dark';
    writeSettings({ ...s, themeMode: next });
    setThemeMode(next as 'light' | 'dark');
  };

  React.useEffect(() => {
    const loadSettings = () => {
      const s = readSettings();
      if (s.avatarSeed) {
        setAvatarSeed(s.avatarSeed);
      }
      setThemeMode(s.themeMode === 'dark' ? 'dark' : 'light');
    };

    loadSettings();
    window.addEventListener('settings-updated', loadSettings);
    return () => window.removeEventListener('settings-updated', loadSettings);
  }, []);

  // Use matchMedia change event — no forced reflow
  React.useEffect(() => {
    const mql = window.matchMedia(SHELL_RAIL_MQ);
    const handleChange = (e: MediaQueryListEvent) => {
      setIsMobile(!e.matches);
      if (e.matches) setMobileMenuOpen(false);
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const handleLogout = () => logout();

  /**
   * Open the record behind an alert. Reuses the `?report=` / `?patient=`
   * deep-link params DashboardShell already consumes, so the target page
   * scrolls to and expands exactly that record.
   */
  const handleNotificationOpen = useCallback(
    (link: NotificationLink) => {
      const path = `/dashboard/${link.tab}`;
      navigate(
        link.param ? `${path}?${link.param.key}=${encodeURIComponent(link.param.value)}` : path,
      );
    },
    [navigate],
  );

  // Header gains a soft shadow once the user scrolls — subtle depth cue
  const [headerScrolled, setHeaderScrolled] = useState(false);

  // Lock the content scroll area while the mobile drawer is open
  const scrollRef = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.style.overflowY = mobileMenuOpen ? 'hidden' : 'auto';
  }, [mobileMenuOpen]);

  // Android Back closes the drawer before it leaves the page — the drawer is
  // modal in every sense that matters (scrim, scroll lock), so popping the route
  // underneath it would leave a rail floating over a different tab.
  useBackHandler(
    useCallback(() => {
      if (!mobileMenuOpen) return false;
      setMobileMenuOpen(false);
      return true;
    }, [mobileMenuOpen]),
    true,
    BACK_PRIORITY.PANEL,
  );

  // Per-tab scroll memory. Switching tabs remounts the page (App.tsx keys the
  // motion.div by activeTab), which would otherwise dump the user back to the
  // top of a long list every time they peek at another section. The onScroll
  // handler records the live position for the current tab; this effect restores
  // it when the tab becomes active again.
  const scrollPositions = useRef<Record<string, number>>({});
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = scrollPositions.current[activeTab] ?? 0;
  }, [activeTab]);

  // Pull-to-refresh (touch devices): dragging down from the top reloads the view
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  // Two extra phases keep the gesture smooth: `isDragging` disables the height
  // transition so the indicator tracks the finger 1:1, and `isPullRefreshing`
  // holds the badge open with a continuous spin while the refresh settles.
  const [isDragging, setIsDragging] = useState(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const PULL_THRESHOLD = 72;

  const handlePullTouchStart = (e: React.TouchEvent) => {
    if (isPullRefreshing) return;
    const el = scrollRef.current;
    const eligible = !!el && el.scrollTop <= 0;
    pullStartY.current = eligible ? e.touches[0].clientY : null;
    if (eligible) setIsDragging(true);
  };
  const handlePullTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current === null || mobileMenuOpen || isPullRefreshing) return;
    const el = scrollRef.current!;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0 && el.scrollTop <= 0) {
      // Rubber-band damping so the drag feels weighty
      setPullDistance(Math.min(dy * 0.5, 96));
    } else {
      pullStartY.current = null;
      setIsDragging(false);
      setPullDistance(0);
    }
  };
  const handlePullTouchEnd = async () => {
    setIsDragging(false);
    pullStartY.current = null;
    if (isPullRefreshing) return;
    if (pullDistance < PULL_THRESHOLD) {
      setPullDistance(0);
      return;
    }
    // Hold the badge open while the reloads are in flight — the indicator
    // settles when the last awaited reload resolves, not after a fixed
    // 900 ms timer. Before this, the gesture always toasted "You're up to
    // date" whether or not a handler ran, which is the exact failure mode
    // UI-P1-04 calls out (a timer presented as a completed operation).
    setIsPullRefreshing(true);
    setPullDistance(56);
    // Legacy one-shot listeners still subscribe to the CustomEvent; keep
    // dispatching it so the app refresh broadcast reaches those too.
    window.dispatchEvent(new CustomEvent('app:refresh'));
    const outcome = await runRegisteredRefreshes();
    setIsPullRefreshing(false);
    setPullDistance(0);
    if (outcome.total === 0) {
      // Nothing registered to reload — live listeners already reflect the
      // latest data, but claiming "refreshed" here would be a lie about an
      // operation that did not happen.
      toast.info('Live views update on their own');
      return;
    }
    if (outcome.rejected > 0) {
      toast.warning(
        `Refreshed ${outcome.fulfilled} of ${outcome.total} views — some data is still loading`,
      );
      return;
    }
    toast.success('Refreshed');
  };

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background">
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-[var(--scrim)] backdrop-blur-sm fold:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — Apple-style vibrancy rail */}
      <motion.aside
        initial={false}
        animate={{
          width: isMobile ? 280 : sidebarOpen ? 272 : 84,
          x: isMobile ? (mobileMenuOpen ? 0 : -300) : 0,
        }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        aria-label="Main navigation"
        className={cn(
          // pt/pb-safe: the panel is full-bleed under the status bar and the
          // gesture pill in the APK, so its own top and bottom rows need the
          // inset (the frosted background still paints behind both).
          // No `overflow-hidden` here: the outer shell already clips the
          // off-screen drawer, and keeping the rail un-clipped lets the
          // collapse toggle overhang its edge instead of being sliced in half
          // at the top-left corner in landscape.
          'vibrancy flex h-full shrink-0 flex-col border-r border-[var(--glass-border)] z-50 shadow-float fold:shadow-none',
          'fixed fold:relative rounded-r-3xl fold:rounded-r-none pt-safe pb-safe',
        )}
      >
        <div className="p-4 md:p-5 flex items-center gap-3.5">
          <div className="w-10 h-10 bg-primary rounded-[14px] flex items-center justify-center shrink-0 overflow-hidden relative shadow-card">
            <img
              src={brandSrc}
              alt="Logo"
              // Shipped art is a square full-bleed tile; an uploaded logo may
              // be any aspect ratio and must never be cropped.
              className={cn(
                'w-full h-full absolute inset-0 z-10',
                brandSrc === brandLogo ? 'object-contain p-0.5' : 'object-cover',
              )}
              onError={e => {
                e.currentTarget.style.opacity = '0';
              }}
            />
            <Microscope className="w-5 h-5 text-on-primary z-0" />
          </div>
          {(sidebarOpen || mobileMenuOpen) && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0">
              <span className="block text-[15px] font-bold tracking-[-0.02em] text-on-surface leading-tight">
                PathoMitra
              </span>
              <span className="block text-[10px] font-semibold tracking-wider uppercase text-on-surface-variant leading-tight">
                LAB MANAGEMENT SIMPLIFIED
              </span>
            </motion.span>
          )}
        </div>

        <nav
          id="main-nav"
          className="flex-1 px-3 space-y-1 mt-4 overflow-y-auto no-scrollbar"
          aria-label="Dashboard sections"
        >
          {navItems.map(item => {
            const showLabels = sidebarOpen || mobileMenuOpen;
            const button = (
              <button
                key={item.id}
                onClick={() => {
                  hapticTap();
                  setActiveTab(item.id);
                  // Use matchMedia to avoid forced reflow from window.innerWidth
                  if (!window.matchMedia(SHELL_RAIL_MQ).matches) setMobileMenuOpen(false);
                }}
                aria-label={item.label}
                aria-current={activeTab === item.id ? 'page' : undefined}
                className={cn(
                  'relative w-full flex items-center gap-3.5 h-11 px-3.5 rounded-full transition group active:scale-[0.97]',
                  activeTab === item.id
                    ? 'bg-primary text-on-primary shadow-card'
                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                )}
              >
                <item.icon
                  className={cn(
                    'w-5 h-5 shrink-0 transition-transform duration-200 group-hover:scale-110',
                    activeTab === item.id && 'scale-105',
                  )}
                  aria-hidden="true"
                />
                {showLabels && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="font-semibold text-[13.5px] text-left flex-1 truncate"
                  >
                    {item.label}
                  </motion.span>
                )}
              </button>
            );
            // Rail mode (icons only): surface the label in a hover/focus tooltip.
            return showLabels ? (
              <div key={item.id}>{button}</div>
            ) : (
              <Tooltip key={item.id} label={item.label} side="right">
                {button}
              </Tooltip>
            );
          })}
        </nav>

        <div className="p-3 md:p-4 border-t border-[var(--glass-border)] space-y-1">
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="w-full flex items-center gap-3.5 h-11 px-3.5 rounded-full text-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-colors group"
          >
            <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
            {(sidebarOpen || mobileMenuOpen) && (
              <span className="font-semibold text-[13.5px] text-left flex-1">Sign out</span>
            )}
          </button>
        </div>

        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={sidebarOpen}
          // Visual stays a compact 28px chip; the ::after expands the hit area
          // to ~44px so it clears the WCAG / Material touch-target minimum
          // without nudging the button off the rail border.
          // `top` is composed with the status-bar inset (not a fixed `top-10`):
          // absolute offsets ignore the rail's pt-safe padding, so a static
          // value slid the toggle under the clock in landscape.
          className="absolute -right-3.5 top-[calc(var(--safe-top)+1.5rem)] h-7 w-7 rounded-full bg-surface-container-lowest text-on-surface-variant shadow-raised border border-[var(--elevated-border)] items-center justify-center hidden fold:flex hover:text-on-surface after:absolute after:-inset-2 after:rounded-full after:content-['']"
        >
          {sidebarOpen ? (
            <PanelLeftClose className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      </motion.aside>

      {/* Main Content */}
      <main role="main" className="flex-1 flex flex-col h-full relative overflow-hidden min-w-0">
        <header
          role="banner"
          className={cn(
            // min-h (not h): the safe-area padding has to grow the bar instead of
            // eating into its 64px content band, or the tools slide under the clock.
            // The horizontal padding is composed with the display cutout rather than
            // paired with a `.px-safe` helper: that helper is unlayered CSS, so it
            // would silently beat `md:px-8` (see the note in src/index.css).
            'min-h-16 pt-safe vibrancy border-b border-[var(--glass-border)] flex items-center justify-between pl-[calc(1rem_+_var(--safe-left))] pr-[calc(1rem_+_var(--safe-right))] md:pl-[calc(2rem_+_var(--safe-left))] md:pr-[calc(2rem_+_var(--safe-right))] shrink-0 z-30 transition-shadow duration-300',
            headerScrolled && 'shadow-[0_6px_24px_-16px_var(--sh-2)]',
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="fold:hidden -ml-2 flex h-10 w-10 items-center justify-center rounded-full text-on-surface active:bg-surface-container-high"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="main-nav"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
            <BackButton
              className="hidden fold:flex !static !py-1 !px-3"
              onClick={activeTab === 'settings' ? () => setActiveTab('dashboard') : undefined}
            />
            <h2 className="truncate text-[17px] font-bold tracking-[-0.02em] text-on-surface capitalize hidden sm:block">
              {navItems.find(n => n.id === activeTab)?.label ?? activeTab}
            </h2>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <button
              onClick={() => setSearchOpen(true)}
              aria-label="Search (Ctrl+K)"
              title="Search  ·  Ctrl+K"
              className="flex h-10 items-center gap-2 rounded-full bg-surface-container-high/70 px-3 text-on-surface-variant transition hover:text-on-surface active:scale-95"
            >
              <Search className="w-[18px] h-[18px]" aria-hidden="true" />
              <span className="hidden text-[13px] font-semibold lg:inline">Search</span>
            </button>
            <NotificationCenter
              onOpen={handleNotificationOpen}
              onOpenSettings={() => navigate('/dashboard/settings?section=notifications')}
            />
            <button
              onClick={toggleThemeMode}
              aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high/70 text-on-surface-variant transition hover:text-on-surface active:scale-95"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={themeMode}
                  initial={{ rotate: -60, opacity: 0, scale: 0.6 }}
                  animate={{ rotate: 0, opacity: 1, scale: 1 }}
                  exit={{ rotate: 60, opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.2 }}
                  className="flex"
                >
                  {themeMode === 'dark' ? (
                    <Sun className="w-[18px] h-[18px]" aria-hidden="true" />
                  ) : (
                    <Moon className="w-[18px] h-[18px]" aria-hidden="true" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
            {/* Profile / settings affordance. This used to be a plain <div>
                wearing `role="button"` with an Enter-only key handler, so
                Space did nothing and screen readers announced a control that
                partially acted like a button (UI-P0-04). A native <button>
                gets Enter + Space, focus, and correct semantics for free. */}
            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              aria-label="Open settings"
              className="flex items-center gap-3 cursor-pointer rounded-full p-1.5 pr-1 transition-colors hover:bg-surface-container-high/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <div className="flex flex-col items-end hidden sm:flex">
                <span className="text-[13px] font-bold text-on-surface leading-tight">
                  {user?.displayName || 'Dr. Pathologist'}
                </span>
                <span className="text-[11px] text-on-surface-variant leading-tight">
                  {role === 'admin' ? 'Lab Administrator' : 'LIMS Control Panel'}
                </span>
              </div>
              <div className="w-9 h-9 rounded-full bg-surface-container border border-[var(--elevated-border)] flex items-center justify-center overflow-hidden">
                <AvatarIcon seed={avatarSeed} />
              </div>
            </button>
          </div>
        </header>

        <div
          id="main-content"
          ref={scrollRef}
          onScroll={e => {
            const el = e.target as HTMLDivElement;
            setHeaderScrolled(el.scrollTop > 4);
            scrollPositions.current[activeTab] = el.scrollTop;
          }}
          onTouchStart={handlePullTouchStart}
          onTouchMove={handlePullTouchMove}
          onTouchEnd={handlePullTouchEnd}
          className="flex-1 overflow-y-auto p-4 md:p-8 pb-28 fold:pb-8 scrollbar-hide overscroll-contain"
        >
          {/* Pull-to-refresh indicator */}
          <div
            className={cn(
              'pointer-events-none flex items-start justify-center overflow-hidden',
              // Only ease the height on release/settle; while dragging it must
              // follow the finger exactly, so no transition then.
              !isDragging && 'transition-[height] duration-300 ease-out',
            )}
            style={{ height: pullDistance }}
            aria-hidden="true"
          >
            <div
              className={cn(
                'mt-1 flex h-11 w-11 items-center justify-center rounded-full',
                'border border-outline-variant/30 bg-surface-container-lowest/90 shadow-card',
                'transition-transform duration-200 ease-out',
                pullDistance > 0 || isPullRefreshing ? 'scale-100' : 'scale-0',
              )}
            >
              <RefreshCw
                className={cn(
                  'h-5 w-5 transition-colors duration-200',
                  isPullRefreshing
                    ? 'animate-spin text-primary'
                    : pullDistance >= PULL_THRESHOLD
                      ? 'text-primary'
                      : 'text-accent',
                )}
                // Finger-tracking rotation while dragging; the continuous spin
                // (animate-spin) takes over during the refresh, so drop the
                // inline transform then to avoid fighting the keyframe.
                style={
                  isPullRefreshing ? undefined : { transform: `rotate(${pullDistance * 4}deg)` }
                }
              />
            </div>
          </div>
          <StorageModeBanner />
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>

        {/* Floating quick action — register a patient from anywhere (mobile only) */}
        <AnimatePresence>
          {onRegisterPatient && activeTab !== 'patients' && !mobileMenuOpen && (
            <motion.button
              initial={{ scale: 0, rotate: -120, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0, rotate: 120, opacity: 0 }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 380, damping: 20 }}
              onClick={onRegisterPatient}
              aria-label="Register patient"
              className="fold:hidden fixed right-[calc(1rem_+_var(--safe-right))] bottom-[calc(var(--safe-bottom)_+_5.5rem)] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-float"
            >
              <UserPlus className="w-6 h-6" aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Mobile bottom tab bar — floating rounded pill */}
        <nav
          aria-label="Primary"
          className={cn(
            'fold:hidden fixed bottom-[calc(var(--safe-bottom)_+_0.75rem)] left-[calc(0.75rem_+_var(--safe-left))] right-[calc(0.75rem_+_var(--safe-right))] z-40 bg-surface-container-lowest border border-outline-variant/40 rounded-3xl shadow-float overflow-hidden',
            // The drawer carries the same destinations and paints over the bar —
            // leaving it up just collides with the sign-out row.
            mobileMenuOpen && 'hidden',
          )}
        >
          <div className="grid grid-cols-4 h-16 px-1.5">
            {bottomNavItems.map(item => (
              <button
                key={item.id}
                onClick={() => {
                  // The tab bar is the highest-traffic control in the app and the
                  // only one that never ticked — buttons, switches and rows all do.
                  hapticTap();
                  setActiveTab(item.id);
                }}
                aria-current={activeTab === item.id ? 'page' : undefined}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-bold transition-colors min-h-11 active:scale-90',
                  // Ring drawn inward: the bar clips its children, so the default
                  // outward offset got sliced into a stray vertical line at the edge.
                  'focus-visible:[outline-offset:-3px]',
                  activeTab === item.id ? 'text-accent' : 'text-on-surface-variant',
                )}
              >
                <span className="relative flex h-8 w-8 items-center justify-center">
                  {activeTab === item.id && (
                    <motion.span
                      layoutId="bottomnav-active"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      className="absolute inset-0 rounded-full bg-accent/12"
                    />
                  )}
                  <motion.span
                    animate={
                      activeTab === item.id
                        ? { scale: [1, 0.7, 1.12, 1], y: [0, 3, -2, 0] }
                        : { scale: 1, y: 0 }
                    }
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    className="relative"
                  >
                    <item.icon className="w-[22px] h-[22px]" aria-hidden="true" />
                  </motion.span>
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      </main>

      {/* Global overlays */}
      <CommandSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSearchNavigate}
      />
      <KeyboardShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
