import Header from '../components/Header';
import Footer from '../components/Footer';
import { motion } from 'motion/react';
import { Smartphone, Activity, Sparkles, Server } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function SolutionsPage() {
  return (
    <div className="min-h-dvh bg-background selection:bg-secondary-container selection:text-on-secondary-container">
      <Header />
      <main className="pt-24 pb-16">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto mb-20"
          >
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
              Solutions
            </span>
            <h1 className="mt-3 text-4xl md:text-6xl font-bold text-on-surface tracking-[-0.03em] mb-6">
              A Seamless Technology Platform for Your Lab
            </h1>
            <p className="text-lg text-on-surface-variant font-medium">
              PathoMitra provides modern, fast, and secure tools designed specifically for
              pathologists and clinical laboratories to manage patient records, reports and
              analytics on the laboratory’s own machine.
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-8 mb-24">
            {/* Solution 1 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-surface-container-lowest p-10 rounded-3xl border border-outline-variant/30 shadow-card relative overflow-hidden group hover:border-primary-container transition-colors"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                <Server className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-surface-container rounded-2xl flex items-center justify-center mb-6">
                  <Activity className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-2xl font-bold text-on-surface mb-4">
                  Streamlined Lab Operations
                </h3>
                <p className="text-on-surface-variant mb-6 leading-relaxed">
                  Streamline your day-to-day operations with an easy-to-use interface. Manage
                  patient registrations, generate instant reports, and manage operations without
                  needing in-house IT staff.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    'No server to buy, install or maintain',
                    'Encrypted on-device records in the Android app',
                    'Lightning-fast data entry',
                    'PIN lock everywhere, biometric unlock on Android',
                  ].map((item, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 text-sm font-medium text-on-surface-variant"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>

            {/* Solution 2 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              viewport={{ once: true }}
              className="bg-primary text-on-primary p-10 rounded-3xl shadow-raised relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                <Smartphone className="w-32 h-32 text-on-primary" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-surface-container-lowest/10 rounded-2xl flex items-center justify-center mb-6">
                  <Sparkles className="w-7 h-7 text-on-primary" />
                </div>
                <h3 className="text-2xl font-bold text-on-primary mb-4">
                  Modern Patient Experience
                </h3>
                <p className="text-on-primary/80 mb-6 leading-relaxed">
                  Hand over a report that reads as well as it prints. Every PDF carries the name of
                  the operator who issued it and the time it was issued, and you decide how it
                  reaches the patient.
                </p>
                <ul className="space-y-3 mb-8">
                  {[
                    'Share by SMS, email or WhatsApp from the app',
                    'Operator name and issue time printed on each report',
                    'Clean, modern PDF report designs',
                    'Referring-doctor details captured with every patient',
                  ].map((item, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 text-sm font-medium text-on-primary/90"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary-container" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>

          {/* CTA embedded */}
          <div className="bg-surface-container-low rounded-3xl p-12 text-center border border-outline-variant/30">
            <h2 className="text-3xl font-bold tracking-[-0.03em] text-on-surface mb-4">
              Ready to explore PathoMitra?
            </h2>
            <p className="text-on-surface-variant mb-8 max-w-2xl mx-auto">
              Open the same patient, report and analytics console that runs on the bench. The first
              account you create is the only one, everything is stored locally, and the app sends
              nothing to a server.
            </p>
            <Link to="/auth">
              <Button
                variant="brand"
                size="lg"
                shine
                className="h-auto rounded-full px-8 py-4 text-lg shadow-raised"
              >
                Open the Console
              </Button>
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
