import { motion } from 'motion/react';
import { Button } from './ui';
import { mailto } from '../lib/contact';

export default function CTA() {
  return (
    <section className="py-24 px-6">
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-5xl mx-auto bg-primary text-on-primary rounded-[3rem] p-12 md:p-20 text-center relative overflow-hidden shadow-float"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary-container to-primary opacity-50" />
        <div className="relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold mb-8 leading-tight tracking-[-0.03em]">
            Run PathoMitra on Your Own Bench
          </h2>
          <p className="text-xl md:text-2xl opacity-80 mb-12 max-w-2xl mx-auto font-medium">
            The same patient, report and analytics console the Android app uses, with the records
            kept on the machine you are working at.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={mailto('Request a PathoMitra walkthrough')}>
              <Button
                variant="brand"
                size="lg"
                shine
                className="h-auto rounded-full bg-surface-container-lowest px-10 py-5 text-primary shadow-raised hover:bg-surface hover:shadow-float"
              >
                Talk to us
              </Button>
            </a>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
