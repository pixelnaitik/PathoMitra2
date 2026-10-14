import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowRight, Menu, Microscope, X } from 'lucide-react';
import { useBrandLogo, DEFAULT_BRAND_LOGO_SRC } from '../lib/brand-logo';
import { cn } from '../lib/utils';
import { Button } from './ui';

const NAV_LINKS = [
  { label: 'Technology', to: '/technology' },
  { label: 'Solutions', to: '/solutions' },
];

/** Logo tile + wordmark — mirrors the dashboard sidebar treatment. */
function Brand({ onNavigate }: { onNavigate?: () => void }) {
  // Uploaded lab logo when one is saved, otherwise the shipped microscope art.
  const brandLogo = useBrandLogo();
  return (
    <Link
      to="/"
      onClick={onNavigate}
      aria-label="PathoMitra — home"
      className="group flex min-w-0 shrink-0 items-center gap-2.5"
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-primary text-on-primary shadow-card transition-transform duration-300 group-hover:scale-105">
        <img
          src={brandLogo ?? DEFAULT_BRAND_LOGO_SRC}
          alt=""
          aria-hidden="true"
          // The shipped art is a square full-bleed tile; an uploaded logo may
          // be any aspect ratio and must never be cropped.
          className={cn(
            'absolute inset-0 z-10 h-full w-full',
            brandLogo ? 'object-contain p-0.5' : 'object-cover',
          )}
          onError={e => {
            e.currentTarget.style.opacity = '0';
          }}
        />
        <Microscope className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div className="flex flex-col min-w-0">
        <span className="truncate text-[15px] font-bold tracking-[-0.02em] text-on-surface leading-tight">
          PathoMitra
        </span>
        <span className="hidden sm:block text-[9px] font-semibold tracking-wider uppercase text-on-surface-variant leading-tight">
          LAB MANAGEMENT SIMPLIFIED
        </span>
      </div>
    </Link>
  );
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Header gains a soft shadow once the page scrolls — subtle depth cue
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'vibrancy sticky top-0 z-50 w-full border-b border-[var(--glass-border)] transition-shadow duration-300',
        scrolled && 'shadow-[0_8px_30px_-18px_var(--sh-2)]',
      )}
    >
      <nav className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-8">
          <Brand />
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className="nav-underline rounded-full px-3 py-1.5 text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <Link to="/auth">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/dashboard">
            <Button variant="brand" size="sm" shine>
              Open dashboard
              <ArrowRight className="h-3.5 w-3.5 icon-slide" aria-hidden="true" />
            </Button>
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-high md:hidden"
        >
          {open ? (
            <X className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Menu className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </nav>

      {/* Mobile dropdown panel */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="overflow-hidden border-surface-container-lowest bg-surface-container-lowest md:hidden"
          >
            <div className="px-4 pb-5 pt-2">
              {NAV_LINKS.map((link, i) => (
                <motion.div
                  key={link.to}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 * i + 0.05 }}
                >
                  <Link
                    to={link.to}
                    onClick={close}
                    className="group flex items-center justify-between border-b border-outline-variant/50 py-3.5 text-[15px] font-medium text-on-surface"
                  >
                    {link.label}
                    <ArrowRight className="h-4 w-4 text-outline icon-slide" aria-hidden="true" />
                  </Link>
                </motion.div>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link to="/auth" onClick={close}>
                  <Button variant="outline" fullWidth>
                    Sign in
                  </Button>
                </Link>
                <Link to="/dashboard" onClick={close}>
                  <Button variant="brand" fullWidth shine>
                    Dashboard
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
