import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';

const SUPPORT_EMAIL = 'support@pathomitra.app';

const PRODUCT_LINKS = [
  { label: 'Technology', to: '/technology' },
  { label: 'Solutions', to: '/solutions' },
  // "Console", not a remote-access word — same reason index.html changed it: the
  // thing it implies (a server to reach) does not exist in this build.
  { label: 'Open the Console', to: '/auth' },
];

const RESOURCE_LINKS = [
  { label: 'Privacy Policy', to: '/privacy' },
  { label: 'Open Dashboard', to: '/dashboard' },
  { label: 'Home', to: '/' },
];

const CONTACT_LINKS = [
  { label: 'Contact Support', subject: 'Support Request' },
  { label: 'Clinical Advisory', subject: 'Clinical Advisory' },
  { label: 'Press Inquiries', subject: 'Press Inquiry' },
];

export default function Footer() {
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant/30">
      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1">
            <span className="font-black text-primary text-xl block mb-1 tracking-tighter">
              PathoMitra
            </span>
            <span className="block text-[10px] font-bold tracking-wider uppercase text-on-surface-variant mb-6">
              LAB MANAGEMENT SIMPLIFIED
            </span>
            <p className="text-sm text-on-surface-variant mb-6 leading-relaxed">
              Offline digital pathology for clinical laboratories — patient records, reports,
              referring-doctor details and lab analytics kept on the lab’s own machine.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="card-hover inline-flex items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-lowest px-4 py-2 text-xs font-semibold text-on-surface-variant shadow-card hover:text-primary"
            >
              <Mail className="w-4 h-4" aria-hidden="true" />
              {SUPPORT_EMAIL}
            </a>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Product</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {PRODUCT_LINKS.map(link => (
                <li key={link.to}>
                  <Link
                    className="hover:text-primary transition-colors hover:underline"
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Resources</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {RESOURCE_LINKS.map(link => (
                <li key={link.label}>
                  <Link
                    className="hover:text-primary transition-colors hover:underline"
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-primary mb-6">Contact</h4>
            <ul className="space-y-4 text-xs text-on-surface-variant">
              {CONTACT_LINKS.map(link => (
                <li key={link.label}>
                  <a
                    className="hover:text-primary transition-colors hover:underline"
                    href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(link.subject)}`}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-outline-variant/30 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <span className="text-xs text-on-surface-variant opacity-70">
            © 2026 PathoMitra Diagnostic Systems. Clinical Grade Precision.
          </span>
          <div className="flex items-center gap-4">
            <Link
              className="text-xs text-on-surface-variant font-medium transition-all hover:text-primary hover:underline"
              to="/privacy"
            >
              Privacy Policy
            </Link>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-xs text-on-surface-variant font-medium transition-all hover:text-primary hover:underline"
            >
              Back to top
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
