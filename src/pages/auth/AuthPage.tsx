import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  Loader2,
  AlertCircle,
  Fingerprint,
  Eye,
  EyeOff,
  ArrowLeft,
  ShieldCheck,
  HelpCircle,
  Lock,
  BarChart3,
  ShieldAlert,
  RefreshCw,
} from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  useAuth,
  isValidPasscode,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  PIN_ERROR,
} from '../../contexts/AuthContext';
import { getAccount, type UnlockResult } from '../../lib/local-account';
import BrandLogo from '../../components/BrandLogo';
import { TermsSheet } from '../../components/Terms';
import { PrivacyPolicySheet } from '../../components/PrivacyPolicy';
import { ONBOARDING_ATTESTATION, TERMS_VERSION } from '../../lib/terms';
import { isNative, isShell } from '../../data';
import { cn } from '../../lib/utils';

/**
 * Offline authentication screen — no Google, no Firebase.
 *
 * Renders one of two forms based on the auth lifecycle:
 *   - `onboarding` (fresh install): create the device account (name + passcode),
 *     with an optional biometric / screen-lock unlock toggle.
 *   - `locked`: unlock with the passcode, or with biometrics when enabled.
 *
 * Every field carries a real `<label>`. These were previously placeholder-only,
 * which fails WCAG 1.3.1/3.3.2 — placeholder text disappears the moment you type
 * and TalkBack announces an unfilled "edit box" with no name, on the very first
 * screen an assistive-tech user has to operate.
 */

const inputClass =
  'h-12 w-full rounded-2xl border border-outline-variant/70 bg-surface px-4 text-[15px] text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 transition';

/** Digits or the full policy charset — the keypad follows the user's choice. */
type KeypadMode = 'digits' | 'letters';

/**
 * Full-bleed laboratory photograph behind the auth console. Served from
 * `public/` (a root-absolute path, exactly like `/brand-p.png`), so it resolves
 * on the web origin, the desktop `pathomitra://app` scheme, and the APK alike.
 * The 2 MB source PNG is shipped as an 87 KB JPEG (scripts convert at author
 * time, not build time) because it rides into every artifact.
 */
const BACKDROP_URL = '/auth-lab-bg.jpg';

/** The three reassurance rows shown beside the form on wide (desktop / web) screens. */
const FEATURES = [
  {
    icon: ShieldCheck,
    tint: 'bg-secondary/12 text-secondary',
    title: 'Patient data protection',
    body: 'Keep sensitive information safe and compliant.',
  },
  {
    icon: Lock,
    tint: 'bg-primary/10 text-primary',
    title: 'Secure access',
    body: 'Authorized users only. Your lab, your control.',
  },
  {
    icon: BarChart3,
    tint: 'bg-accent/10 text-accent',
    title: 'Reliable workflows',
    body: 'Smoother operations for better patient care.',
  },
];

function AuthBrand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandLogo className="h-9 w-9 shrink-0 shadow-card" iconClassName="h-[18px] w-[18px]" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-bold leading-tight tracking-[-0.02em] text-on-surface">
          PathoMitra
        </span>
        <span className="hidden truncate text-[9px] font-semibold uppercase leading-tight tracking-wider text-on-surface-variant sm:block">
          Lab Management Simplified
        </span>
      </div>
    </div>
  );
}

/**
 * Frosted top bar over the photograph. The back affordance lives here (not as a
 * floating pill) so it never collides with the brand lockup; neither installed
 * shell has history to return to — the APK boots straight here and the desktop
 * window rewrites its entry URL to /auth before the router exists — so the
 * arrow is dropped in both (owner report, 2026-10-12: a dead back button in
 * the MSI build). Only the web site, which can arrive from the landing page,
 * still shows it.
 */
function AuthHeader() {
  const navigate = useNavigate();
  return (
    <header className="vibrancy relative z-20 flex shrink-0 items-center justify-between gap-4 border-b border-[var(--glass-border)] px-4 py-3 sm:px-8">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {!isShell && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:scale-95"
          >
            <ArrowLeft className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}
        <AuthBrand />
      </div>
      <div className="flex shrink-0 items-center gap-4 sm:gap-6">
        <span className="hidden items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-secondary sm:flex">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Secure Workspace
        </span>
        <button
          type="button"
          onClick={() => navigate('/privacy')}
          className="flex items-center gap-1.5 rounded-full text-[13px] font-semibold text-accent transition hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="hidden sm:inline">Help &amp; Support</span>
          <span className="sm:hidden">Help</span>
        </button>
      </div>
    </header>
  );
}

function FeaturePanel() {
  return (
    <section className="flex min-w-0 flex-col justify-center px-6 py-8 md:flex-1 md:px-0 md:py-0">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.32em] text-on-surface-variant">
        PathoMitra
      </p>
      <h1 className="text-[34px] font-extrabold leading-[1.05] tracking-[-0.03em] text-on-surface sm:text-[40px] lg:text-[44px] xl:text-[52px]">
        Your lab.
        <br />
        <span className="text-secondary">Securely connected.</span>
      </h1>
      <p className="mt-5 max-w-md text-[15px] font-medium leading-relaxed text-on-surface-variant">
        Protect patient records, ensure data security and keep your lab workflows running smoothly
        with PathoMitra.
      </p>
      <ul className="mt-9 space-y-6">
        {FEATURES.map(feature => (
          <li key={feature.title} className="flex items-start gap-4">
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                feature.tint,
              )}
            >
              <feature.icon className="h-[22px] w-[22px]" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[15px] font-bold text-on-surface">{feature.title}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-on-surface-variant">
                {feature.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Auth console shell. A laboratory photograph fills the frame; a theme-aware
 * veil (light wash / dark scrim) keeps both the marketing copy and the form card
 * legible over it. On `md` and up (desktop app + most laptop/tablet windows) the
 * marketing panel sits left and the form card right; on the web build for
 * phones the panel stacks above the card. On the APK the panel is not rendered
 * at all (owner decision 2026-10-13) — the phone screen is the unlock card's.
 *
 * The shell scrolls rather than clipping: the create-account card is 550-700px
 * tall, so any viewport shorter than it (landscape phones, the APK with the IME
 * raised) must still reach every field.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-background font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('${BACKDROP_URL}')` }}
      />
      {/* Light-mode wash: near-solid behind the marketing copy on the left —
          the headline sitting over the microscope itself read as "text on top
          of the image" (owner report, 2026-10-12) — easing off towards the
          right so the photo still shows and the white card separates. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/92 to-white/55 dark:hidden"
      />
      {/* Dark-mode scrim so the (light) token text keeps contrast over the photo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-neutral-950 via-neutral-950/92 to-neutral-950/55 dark:block"
      />
      {/* Extra flattening on phones, where the marketing copy + card stack on the photo. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-background/75 md:hidden"
      />

      <AuthHeader />

      <main className="relative z-10 flex flex-1 flex-col md:px-8 lg:px-12">
        {/* Centred pair, not edge-pinned columns: at desktop widths the old
            layout pushed the copy to the far left and the card to the far
            right, leaving a dead strip of photo between them (owner:
            "why so much space in between"). The max-w container gives both
            sides equal breathing room and keeps the pair symmetric. */}
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-stretch gap-2 py-6 md:flex-row md:items-center md:gap-10 md:py-0 lg:gap-14">
          {/* The marketing panel — "PATHOMITRA / Your lab. Securely connected."
              plus the three feature rows — is a website/PC-app affordance only
              (owner decision 2026-10-13): on the phone it just pushed the
              unlock card down, so it is dropped on the native shell. The
              `!isShell` back-button gate above already covers both installed
              shells; this one is Android-only, so desktop keeps the panel. */}
          {!isNative && <FeaturePanel />}
          <div className="flex w-full items-center justify-center px-5 py-8 sm:px-8 md:w-auto md:flex-none md:basis-[440px] md:px-0">
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="w-full max-w-md overflow-hidden rounded-4xl border border-[var(--elevated-border)] bg-surface-container-lowest/95 shadow-float backdrop-blur-xl"
            >
              <div className="flex flex-col p-8 md:p-10">
                <div className="relative mb-5 self-center">
                  {/* Static halo — stillness reads calmer than a perpetual pulse on a
                      screen people hold a finger against. */}
                  <div className="absolute inset-0 scale-125 rounded-full bg-accent/15 blur-xl" />
                  <div className="relative z-10 flex h-14 w-14 items-center justify-center overflow-hidden rounded-[20px] bg-primary text-on-primary shadow-raised">
                    <BrandLogo className="h-full w-full" iconClassName="h-7 w-7" />
                  </div>
                </div>
                {children}
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  );
}

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2.5 rounded-xl bg-error-container px-3 py-2.5 text-[13px] font-medium leading-snug text-on-error-container"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
      <span>{message}</span>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
  className,
}: {
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-on-surface-variant',
        className,
      )}
    >
      {children}
    </label>
  );
}

/**
 * Switches between the numeric keypad (what a bench wants for a 4–6 digit PIN)
 * and the full charset needed for a longer alphanumeric passcode. The policy
 * accepts both, so the input must not filter out characters it allows.
 */
function KeypadToggle({ mode, onChange }: { mode: KeypadMode; onChange: (m: KeypadMode) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(mode === 'digits' ? 'letters' : 'digits')}
      className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {mode === 'digits' ? 'Use letters too' : 'Digits only'}
    </button>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  onEnter,
  mode = 'digits',
  maxLength = 12,
  invalid = false,
  hint,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete?: string;
  onEnter?: () => void;
  /** 'digits' restricts entry and raises the numeric keypad. */
  mode?: KeypadMode;
  maxLength?: number;
  invalid?: boolean;
  /** Visible helper text, also wired to the field via aria-describedby. */
  hint?: string;
  /** Sits on the label row opposite the label — keypad mode switch, etc. */
  action?: React.ReactNode;
}) {
  const [reveal, setReveal] = useState(false);
  // A masked field can't be a plain number input, so we keep password/text type
  // and lean on inputMode="numeric" (the reliable way to raise the numpad in the
  // Android WebView) plus a digit filter that only applies in 'digits' mode.
  const numeric = mode === 'digits';
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {(action || hintId) && (
          // Wraps rather than overflows: label + mode switch + hint already fill
          // the row at 390px, and a 320px phone would push the hint off the card.
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5">
            {action}
            {hintId && (
              <span id={hintId} className="text-[11px] leading-snug text-on-surface-variant">
                {hint}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="relative">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          inputMode={numeric ? 'numeric' : 'text'}
          pattern={numeric ? '[0-9]*' : undefined}
          maxLength={maxLength}
          enterKeyHint={onEnter ? 'go' : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={hintId}
          onChange={e => {
            const raw = e.target.value;
            onChange(
              numeric ? raw.replace(/\D/g, '').slice(0, maxLength) : raw.slice(0, maxLength),
            );
          }}
          onKeyDown={e => {
            if (numeric && !e.metaKey && !e.ctrlKey && e.key.length === 1 && !/\d/.test(e.key)) {
              e.preventDefault();
            }
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          placeholder={placeholder}
          className={cn(
            inputClass,
            'pr-12',
            // The wide tracking is here to breathe space between the masked
            // bullets — but it also applied to the placeholder, which rendered it
            // as "E n t e r  y o u r  P I N". Keep the spacing for the value,
            // drop it for the prompt.
            numeric &&
              'text-center text-xl font-semibold tracking-[0.3em] placeholder:text-[15px] placeholder:font-normal placeholder:tracking-normal',
          )}
        />
        <button
          type="button"
          onClick={() => setReveal(r => !r)}
          aria-label={reveal ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={reveal}
          className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-outline transition hover:bg-surface-container-low hover:text-on-surface-variant"
        >
          {reveal ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

function CreateAccountForm() {
  const { createAccount, biometricAvailable } = useAuth();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [enableBio, setEnableBio] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [mode, setMode] = useState<KeypadMode>('digits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!isValidPasscode(password)) {
      setError(PIN_ERROR);
      return;
    }
    if (password !== confirm) {
      setError('Passcodes do not match.');
      return;
    }
    setBusy(true);
    try {
      await createAccount(name, password, enableBio, acceptedTerms);
    } catch (e) {
      setError((e as Error).message || 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="mb-7 text-center">
        <h2 className="mb-1.5 text-[28px] font-bold leading-none tracking-[-0.03em] text-on-surface">
          Set up PathoMitra
        </h2>
        <p className="px-2 text-sm font-medium leading-relaxed text-on-surface-variant">
          Create the passcode that protects this device. Everything stays on-device — no account, no
          cloud.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="space-y-3.5">
        <div>
          {/* Owner ask 2026-10-14: this field carries the LAB identity, not a
              person's name — label and placeholder say so. 'organization' is the
              correct autofill token for it (was 'name'). */}
          <FieldLabel htmlFor="account-name">Lab name</FieldLabel>
          <input
            id="account-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Enter your lab name"
            autoComplete="organization"
            className={inputClass}
          />
        </div>
        <PasswordField
          id="create-passcode"
          label="Passcode"
          value={password}
          onChange={setPassword}
          placeholder={
            mode === 'digits' ? `Create a ${MIN_PIN_LENGTH}+ digit PIN` : 'Create a passcode'
          }
          autoComplete="new-password"
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
          hint={`${MIN_PIN_LENGTH}–12 digits, or 6+ characters`}
          action={<KeypadToggle mode={mode} onChange={setMode} />}
        />
        <PasswordField
          id="confirm-passcode"
          label="Confirm passcode"
          value={confirm}
          onChange={setConfirm}
          placeholder="Re-enter it"
          autoComplete="new-password"
          onEnter={submit}
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
        />

        {biometricAvailable && (
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-outline-variant/60 bg-surface p-3.5">
            <input
              type="checkbox"
              checked={enableBio}
              onChange={e => setEnableBio(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
            />
            <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
              <Fingerprint className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              Enable biometric / screen-lock unlock
            </span>
          </label>
        )}

        {/* Required, never pre-checked. This is the point where the operator
            takes on responsibility for the accreditation text they will print and
            for the patient data they will process. */}
        <div className="rounded-2xl border border-outline-variant/60 bg-surface p-3.5">
          <label className="flex min-h-12 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={e => setAcceptedTerms(e.target.checked)}
              aria-describedby="terms-links"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--md-sys-color-primary,#0a5ea6)]"
            />
            <span className="text-xs leading-relaxed text-on-surface">
              {ONBOARDING_ATTESTATION}
            </span>
          </label>
          <div id="terms-links" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 pl-8">
            <button
              type="button"
              onClick={() => setShowTerms(true)}
              className="text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Read the Terms (v{TERMS_VERSION})
            </button>
            <button
              type="button"
              onClick={() => setShowPrivacy(true)}
              className="text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Read the Privacy Policy
            </button>
          </div>
        </div>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={submit}
          disabled={
            busy || !name.trim() || !isValidPasscode(password) || !confirm || !acceptedTerms
          }
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-on-primary shadow-card transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Creating…' : 'Create account'}
        </motion.button>
      </div>

      <TermsSheet open={showTerms} onClose={() => setShowTerms(false)} />
      <PrivacyPolicySheet open={showPrivacy} onClose={() => setShowPrivacy(false)} />
    </Shell>
  );
}

/** Render a lockout wait as "2 min" / "45 sec" for the error line. */
function formatWait(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds} sec`;
}

function UnlockForm() {
  const { unlockWithPassword, unlockWithBiometric, biometricEnabled, user } = useAuth();
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<KeypadMode>('digits');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const prompted = useRef(false);
  /**
   * The account's display name for the "Welcome back, Naitik" greeting
   * (owner ask, 2026-10-12). Read straight from the local account — the auth
   * context keeps `user` null while locked, and the name is not a secret:
   * it is the lab's own operator, already printed on every report.
   */
  const [accountName, setAccountName] = useState('');

  useEffect(() => {
    let active = true;
    void getAccount()
      .then(account => {
        if (active && account?.name) setAccountName(account.name.split(/\s+/)[0]);
      })
      .catch(() => {
        /* greeting stays generic if the secure store is unreadable */
      });
    return () => {
      active = false;
    };
  }, []);

  const waitSeconds = lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0;
  const locked = waitSeconds > 0;

  // Tick the lockout countdown once per second while it is running.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  /**
   * Surface the verifier's result. A lockout never says whether the last PIN was
   * right, and the field stops accepting input while locked — the delay itself is
   * enforced in lib/local-account, so this is presentation, not the control.
   */
  const applyResult = (result: UnlockResult) => {
    if (result.ok) {
      setError(null);
      setLockedUntil(0);
      setPassword('');
      return;
    }
    if (result.reason === 'locked') {
      setLockedUntil(result.unlocksAt);
      setNow(Date.now());
      setError(`Too many attempts. Try again in ${formatWait(result.waitSeconds)}.`);
      return;
    }
    setLockedUntil(0);
    setError(
      result.attemptsLeft > 0
        ? `Incorrect passcode. ${result.attemptsLeft} ${
            result.attemptsLeft === 1 ? 'attempt' : 'attempts'
          } left before a delay.`
        : 'Incorrect passcode.',
    );
  };

  const doPassword = async () => {
    setError(null);
    if (locked || !isValidPasscode(password)) return;
    setBusy(true);
    try {
      applyResult(await unlockWithPassword(password));
    } finally {
      setBusy(false);
    }
  };

  const doBiometric = async () => {
    setError(null);
    const ok = await unlockWithBiometric();
    if (!ok) setError('Biometric unlock did not succeed. Use your passcode.');
  };

  // Offer the biometric prompt once on arrival when it's enabled.
  useEffect(() => {
    if (biometricEnabled && !prompted.current) {
      prompted.current = true;
      void doBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricEnabled]);

  return (
    <Shell>
      <div className="mb-7 text-center">
        <h2 className="mb-1.5 text-[28px] font-bold leading-none tracking-[-0.03em] text-on-surface">
          Welcome back{accountName ? `, ${accountName}` : ''}
        </h2>
        <p className="px-2 text-sm font-medium leading-relaxed text-on-surface-variant">
          {user?.displayName ? `Signed in as ${user.displayName}. ` : ''}Unlock to open the lab.
        </p>
      </div>

      <ErrorNote message={error} />

      <div className="space-y-4">
        <PasswordField
          id="unlock-passcode"
          label="Passcode"
          value={password}
          onChange={setPassword}
          placeholder={mode === 'digits' ? 'Enter your PIN' : 'Enter your passcode'}
          autoComplete="current-password"
          onEnter={doPassword}
          mode={mode}
          maxLength={MAX_PIN_LENGTH}
          invalid={Boolean(error)}
          hint={locked ? `Locked for ${formatWait(waitSeconds)}` : undefined}
          action={<KeypadToggle mode={mode} onChange={setMode} />}
        />

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="button"
          onClick={doPassword}
          disabled={busy || locked || !isValidPasscode(password)}
          className={cn(
            'flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition',
            // A 50%-opacity brand button reads as a rendering fault. A neutral
            // resting state reads as "waiting for your passcode" instead.
            busy || locked || !isValidPasscode(password)
              ? 'cursor-not-allowed bg-surface-container-high text-on-surface-variant'
              : 'bg-primary text-on-primary shadow-raised hover:brightness-110',
          )}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Unlocking…' : locked ? `Locked · ${formatWait(waitSeconds)}` : 'Unlock'}
        </motion.button>

        {biometricEnabled && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            type="button"
            onClick={doBiometric}
            disabled={locked}
            className={cn(
              // Quiet text action: a second full-size pill competed with Unlock
              // for the same "press me" signal.
              'mx-auto flex h-10 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-semibold transition',
              locked
                ? 'cursor-not-allowed text-on-surface-variant/60'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
            )}
          >
            <Fingerprint className="h-[18px] w-[18px] shrink-0 text-accent" aria-hidden="true" />
            Use biometric / screen lock
          </motion.button>
        )}
      </div>
    </Shell>
  );
}

export default function AuthPage() {
  const { status, user } = useAuth();

  if (status === 'unlocked' || user) return <Navigate to="/dashboard" replace />;

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-accent" aria-label="Loading" />
      </div>
    );
  }

  // Secure storage could not be read on boot. Do NOT offer account creation —
  // that is the path that would overwrite an account we merely failed to see.
  // Fail closed: explain, and give a retry that re-runs the boot read.
  if (status === 'error') {
    return (
      <Shell>
        <div role="alert" aria-live="assertive" className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error-container/60">
            <ShieldAlert className="h-6 w-6 text-on-error-container" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold text-on-surface">Secure storage unavailable</h1>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            PathoMitra could not read this device&apos;s protected storage, so it cannot tell
            whether a lab account is already set up. Your records have <strong>not</strong> been
            removed. Creating a new account is disabled until the storage can be read again, so
            nothing existing is overwritten.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition active:scale-[0.98]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  return status === 'onboarding' ? <CreateAccountForm /> : <UnlockForm />;
}
