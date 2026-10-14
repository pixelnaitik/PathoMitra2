import { motion } from 'motion/react';

const steps = [
  {
    number: '01',
    title: 'Register the Patient',
    description:
      'Capture patient details, referral doctor and the tests ordered. Records go straight into the encrypted database on this device.',
  },
  {
    number: '02',
    title: 'Enter Findings',
    description:
      'Type results against a curated pathology catalogue with units and reference ranges, with calculated indices like the CBC ratios filling in as you go.',
  },
  {
    number: '03',
    title: 'Issue the Report',
    description:
      'Check the live A4 layout, then print, save or share the PDF. It carries your name and the issue time; amending a final report raises its version and records your reason.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="py-24 px-6 bg-surface-container-lowest overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
            How it works
          </span>
          <h2 className="mt-3 text-3xl md:text-4xl font-bold tracking-[-0.03em] text-on-surface mb-4">
            3 Steps From Reception to Signed Report
          </h2>
          <p className="text-on-surface-variant">
            Built for the day-to-day bench workflow, and it keeps running when the lab loses its
            connection.
          </p>
        </div>

        <div className="relative flex flex-col md:flex-row justify-between items-start gap-12">
          {/* Connector Line (Desktop) — draws itself as the section enters */}
          <motion.div
            className="hidden md:block absolute top-24 left-0 w-full h-[2px] bg-surface-container-low z-0 origin-left"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            viewport={{ once: true }}
          />

          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: index * 0.16, ease: [0.22, 1, 0.36, 1] }}
              viewport={{ once: true, amount: 0.4 }}
              className="flex-1 text-center relative z-10 group"
            >
              <div className="w-16 h-16 rounded-2xl bg-surface-container-lowest border-2 border-primary-container flex items-center justify-center text-primary-container font-black text-xl mx-auto mb-8 shadow-card group-hover:bg-primary-container group-hover:text-on-primary-container transition-all transform group-hover:scale-110">
                {step.number}
              </div>
              <h4 className="text-xl font-bold text-on-surface mb-3">{step.title}</h4>
              <p className="text-sm text-on-surface-variant px-4 leading-relaxed">
                {step.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
