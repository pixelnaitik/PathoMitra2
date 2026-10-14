/**
 * Notification Center — the header bell and its alert panel.
 *
 * The visual surface for `lib/notification-engine`: it never decides what
 * counts as an alert, only how one looks and where it sends you. Deep links use
 * the `?report=` / `?patient=` params that `DashboardShell` already consumes, so
 * opening an alert lands on the exact record that needs work.
 *
 * Delivery is the banner preference in `useNotifications` and nothing else. The
 * Email / SMS / WhatsApp compose buttons used to sit on every alert row and on
 * the panel footer; they were removed on 2026-10-11 at the lab's request, because
 * a `mailto:` / `sms:` / `wa.me` hand-off copies the alert text — which can name
 * a patient — into a third-party messaging app. The app still sends nothing on
 * its own; it now offers no path out of the device at all.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCheck,
  FileClock,
  GitCompare,
  Hourglass,
  Receipt,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Button,
  EmptyState,
  IconButton,
  SegmentedControl,
  Sheet,
  Skeleton,
  StatusPill,
  type PillTone,
} from './ui';
import { cn } from '../lib/utils';
import { BACK_PRIORITY, useBackHandler } from '../lib/back-button';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../hooks/useNotifications';
import {
  CATEGORY_LABEL,
  formatAge,
  formatAmount,
  type NotificationCategory,
  type NotificationItem,
  type NotificationLink,
  type NotificationSeverity,
} from '../lib/notification-engine';

const SEVERITY_TONE: Record<NotificationSeverity, PillTone> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

const CATEGORY_ICON: Record<NotificationCategory, typeof Hourglass> = {
  overdue: Hourglass,
  draft: FileClock,
  amended: GitCompare,
  due: Receipt,
};

type Filter = 'all' | 'unread';

interface NotificationCenterProps {
  /** Navigates to the record behind an alert. */
  onOpen: (link: NotificationLink) => void;
  /** Opens Settings → Notifications for threshold and channel changes. */
  onOpenSettings: () => void;
}

export default function NotificationCenter({ onOpen, onOpenSettings }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const { role } = useAuth();
  const notifications = useNotifications();
  const { items, summary, prefs, loading, refreshing, error, lastCheckedAt, mutedCount } =
    notifications;

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter(item => !item.read) : items),
    [items, filter],
  );

  // Back closes the bell panel instead of leaving the dashboard — registered
  // above the guest early-return so the hook order stays identical on every path.
  useBackHandler(
    useCallback(() => {
      if (!open) return false;
      setOpen(false);
      return true;
    }, [open]),
    open,
    BACK_PRIORITY.PANEL,
  );

  // Guests cannot read patients, reports or invoices, so there is genuinely
  // nothing for them to be alerted about — an empty bell would be a lie.
  const canSeeAlerts = role === 'staff' || role === 'admin';

  if (!canSeeAlerts) return null;

  const openSettings = () => {
    setOpen(false);
    onOpenSettings();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          summary.unread > 0
            ? `Notifications, ${summary.unread} unread`
            : 'Notifications, nothing outstanding'
        }
        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-high/70 text-on-surface-variant transition hover:text-on-surface active:scale-95"
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        {summary.unread > 0 && (
          <span
            className={cn(
              'animate-pop-in absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-on-primary shadow-card',
              summary.critical > 0 ? 'bg-error' : 'bg-accent',
            )}
          >
            {summary.unread > 9 ? '9+' : summary.unread}
          </span>
        )}
        {summary.critical > 0 && (
          <span
            aria-hidden="true"
            className="animate-soft-pulse absolute -left-0.5 top-1 h-2 w-2 rounded-full bg-error"
          />
        )}
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        width="lg"
        title="Notifications"
        description={
          lastCheckedAt
            ? `Last checked ${new Date(lastCheckedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
            : 'Overdue samples, unissued drafts, amendments and unpaid dues'
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] text-on-surface-variant">
              {mutedCount > 0 && (
                <button
                  type="button"
                  onClick={notifications.clearMuted}
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-semibold transition hover:bg-surface-container-high"
                >
                  <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
                  {mutedCount} silenced — unmute
                </button>
              )}
              <button
                type="button"
                onClick={openSettings}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-semibold transition hover:bg-surface-container-high"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Alert settings
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                onClick={notifications.markAllRead}
                disabled={summary.unread === 0}
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                Mark all read
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <div className="flex items-center gap-3">
            <SegmentedControl
              id="notification-filter"
              aria-label="Filter alerts"
              size="sm"
              className="max-w-[260px]"
              value={filter}
              onChange={value => setFilter(value)}
              items={[
                { value: 'all', label: `All ${summary.total}` },
                { value: 'unread', label: `Unread ${summary.unread}` },
              ]}
            />
            <IconButton
              label="Check again"
              size="sm"
              variant="neutral"
              onClick={notifications.refresh}
              className="ml-auto"
            >
              <RefreshCw
                className={cn('h-4 w-4', refreshing && 'animate-spin')}
                aria-hidden="true"
              />
            </IconButton>
          </div>

          {summary.total > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
              {summary.critical > 0 && (
                <StatusPill tone="error" dot>
                  {summary.critical} critical
                </StatusPill>
              )}
              {summary.warning > 0 && (
                <StatusPill tone="warning" dot>
                  {summary.warning} warning
                </StatusPill>
              )}
              {summary.info > 0 && <StatusPill tone="info">{summary.info} notices</StatusPill>}
              {summary.dueAmount > 0 && (
                <StatusPill tone="neutral">
                  {formatAmount(summary.dueAmount)} outstanding
                </StatusPill>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-2xl border border-error/25 bg-error-container px-4 py-3 text-[13px] font-semibold text-on-error-container"
            >
              {error}
            </p>
          )}

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-16" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              icon={<CheckCheck className="h-7 w-7" aria-hidden="true" />}
              title={summary.total === 0 ? 'Nothing needs attention' : 'Every alert is marked read'}
              description={
                summary.total === 0
                  ? `No overdue samples, unissued drafts, amendments or unpaid invoices in the records we check. Preferences apply: ${Object.values(prefs.categories).filter(Boolean).length} of 4 alert types are on.`
                  : 'Switch the filter back to All to see what is still open.'
              }
              action={
                <Button variant="outline" onClick={notifications.refresh} loading={refreshing}>
                  Check again
                </Button>
              }
            />
          ) : (
            <>
              {!prefs.channels.desktop && (
                <p className="rounded-2xl border border-outline-variant/60 bg-surface-container-low px-4 py-3 text-[12.5px] leading-relaxed text-on-surface-variant">
                  Alert banners are switched off, so nothing reaches you outside this panel. Turn
                  them on in Settings → Notifications for a system notice whenever something is late
                  or amended.
                </p>
              )}
              <ul className="space-y-2.5">
                {visible.map((item, index) => (
                  <AlertRow
                    key={item.id}
                    item={item}
                    index={index}
                    onOpen={() => {
                      notifications.markRead(item.id);
                      onOpen(item.link);
                      setOpen(false);
                    }}
                    onHandled={() => notifications.markRead(item.id)}
                    onMute={() => notifications.toggleMute(item.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function AlertRow({
  item,
  index,
  onOpen,
  onHandled,
  onMute,
}: {
  item: NotificationItem;
  index: number;
  onOpen: () => void;
  onHandled: () => void;
  onMute: () => void;
}) {
  const Icon = CATEGORY_ICON[item.category];
  const tone = SEVERITY_TONE[item.severity];

  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.22 }}
      className={cn(
        'flex gap-3 rounded-3xl border bg-surface-container-lowest p-3.5 transition-shadow',
        item.read
          ? 'border-[var(--elevated-border)] opacity-70'
          : 'border-[var(--elevated-border)] shadow-card',
        item.severity === 'critical' && !item.read && 'border-error/35',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
          tone === 'error' && 'bg-error-container text-on-error-container',
          tone === 'warning' && 'bg-warning-container text-on-warning-container',
          tone === 'info' && 'bg-info-container text-on-info-container',
        )}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[14px] font-bold leading-snug tracking-[-0.01em] text-on-surface">
            {item.title}
          </p>
          <StatusPill tone={tone} className="shrink-0">
            {item.severity}
          </StatusPill>
        </div>

        <p className="mt-1 text-[12.5px] leading-relaxed text-on-surface-variant">{item.body}</p>

        <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] font-semibold text-on-surface-variant">
          <span>{CATEGORY_LABEL[item.category]}</span>
          <span aria-hidden="true">·</span>
          <span>{formatAge(item.ageHours)} old</span>
          {item.amount !== undefined && (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatAmount(item.amount)}</span>
            </>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="brand" onClick={onOpen}>
            Open
          </Button>
          {!item.read && (
            <Button size="sm" variant="ghost" onClick={onHandled}>
              Done
            </Button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onMute}
              aria-label={`Silence ${CATEGORY_LABEL[item.category].toLowerCase()} alerts for ${item.entityName}`}
              title="Silence this alert"
              className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
            >
              <BellOff className="h-4 w-4" />
            </button>
          </span>
        </div>
      </div>
    </motion.li>
  );
}
