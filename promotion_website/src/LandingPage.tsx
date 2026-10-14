import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import Header from './components/Header';
import Hero from './components/Hero';
import Features from './components/Features';
import HowItWorks from './components/HowItWorks';
import Trust from './components/Trust';
import CTA from './components/CTA';
import Footer from './components/Footer';

/**
 * Shared scroll-reveal wrapper — every marketing section enters with the same
 * short rise + fade, triggered once, with an optional stagger offset.
 */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-90px' }}
      transition={{ duration: 0.65, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background font-sans text-on-surface selection:bg-accent/20">
      <Header />
      <main id="main-content">
        <Hero />
        <Reveal>
          <Features />
        </Reveal>
        <Reveal delay={0.06}>
          <HowItWorks />
        </Reveal>
        <Reveal delay={0.06}>
          <Trust />
        </Reveal>
        <Reveal delay={0.06}>
          <CTA />
        </Reveal>
      </main>
      <Footer />
    </div>
  );
}
