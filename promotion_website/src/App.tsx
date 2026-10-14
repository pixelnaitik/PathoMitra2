import { MotionConfig } from 'motion/react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './LandingPage';
import TechnologyPage from './pages/TechnologyPage';
import SolutionsPage from './pages/SolutionsPage';
import PrivacyPage from './pages/PrivacyPage';
import { scrollToId } from './lib/scroll';

/**
 * Static brochure router.
 *
 * HashRouter (not BrowserRouter) on purpose: a static-only build has no server to
 * rewrite deep links back to index.html, and `#/technology` resolves from a plain
 * file, a subfolder, or object storage with no SPA fallback rule. There is no
 * `/auth` route and no protected route — every page here is public.
 */
export default function App() {
  return (
    // reducedMotion="user" makes the JS scroll-reveals and entrance animations
    // honour the OS "reduce motion" preference, matching the CSS layer in
    // index.css. The default transition keeps any animation without an explicit
    // `transition` inside the shared vocabulary instead of motion's stock easing.
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
      {/* Accessibility: keyboard users can jump straight to the content */}
      <a
        href="#main-content"
        onClick={e => {
          // The router owns the fragment, so scroll programmatically instead of
          // letting the hash be read as a route change.
          e.preventDefault();
          scrollToId('main-content');
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-5 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-on-primary focus:shadow-float"
      >
        Skip to content
      </a>
      <HashRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/technology" element={<TechnologyPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </MotionConfig>
  );
}
