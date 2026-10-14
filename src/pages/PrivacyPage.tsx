import Header from '../components/Header';
import Footer from '../components/Footer';
import { motion } from 'motion/react';
import { PrivacyPolicyContent } from '../components/PrivacyPolicy';

/**
 * Public privacy-policy page. This is the URL that goes into the Google Play
 * store listing, so it must be reachable on the web build (it is intentionally
 * not routed in the offline APK).
 */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background selection:bg-secondary-container selection:text-on-secondary-container">
      <Header />
      <main className="pt-24 pb-16">
        <div className="max-w-3xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-12"
          >
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
              Legal
            </span>
            <h1 className="mt-3 text-4xl md:text-5xl font-bold text-on-surface tracking-[-0.03em] mb-6">
              Privacy Policy
            </h1>
          </motion.div>
          <div className="bg-surface-container-lowest rounded-3xl p-8 md:p-12 border border-outline-variant/30 shadow-card">
            <PrivacyPolicyContent />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
