# PathoMitra — Design System (UI/UX)

This document describes the visual and interaction system of PathoMitra: the
aesthetic intent, the token architecture, typography, component primitives,
motion, and accessibility rules.

> **Read this before editing styles:** values are _not_ duplicated here. The
> previous revision hard-coded hexes and radii, and they drifted from the code
> within a few releases. `src/index.css` is the single source of truth for token
> **values**; this file documents the **rules** for using them. When you need a
> number, read the `@theme` / `:root` block — never copy it out of here.

## 1. Aesthetic overview & tone

**"Clinical Modern"** — trust, precision, cleanliness, speed. Quiet surfaces,
one deliberate accent, dense but breathable data layouts. Colour carries meaning
(verified / pending / error), never decoration.

- **Tone:** professional, secure, technical, calm.
- **Method:** Tailwind CSS v4, mobile-first utilities bound to semantic CSS
  custom properties. Components use semantic utilities (`bg-surface-container`,
  `text-on-surface-variant`), not raw palette values.

## 2. Token architecture

Two **orthogonal** axes, set as attributes on `<html>`:

| Axis                   | Attribute      | Values                                            |
| ---------------------- | -------------- | ------------------------------------------------- |
| Palette (brand accent) | `data-palette` | `navy` · `teal` · `amethyst` · `slate` · `maroon` |
| Mode (surface colours) | `data-theme`   | `light` · `dark`                                  |

- `:root` carries light mode + the default `navy` palette, so the first paint is
  correct with no JavaScript.
- Dark mode is driven by the **user's explicit setting**, never by the OS
  preference: `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))`.
- `src/lib/theme.ts` owns the option list (`THEME_OPTIONS`) and persistence;
  the inline bootstrap in `index.html` applies the stored choice _before_ paint,
  which is why switching themes never flashes.
- Naming follows Material 3 roles: `--primary` / `--on-primary` /
  `--primary-container` / `--on-primary-container`, plus `--secondary`,
  `--tertiary`, `--error`, and the `--surface*` / `--on-surface*` /
  `--outline*` families. Every colour has a paired `on-*` foreground token —
  always use the pair, never a colour with an assumed text tone.
- Elevation is expressed by tokens (`shadow-card`, `shadow-raised`,
  `shadow-float`) and `--radius-*` scales, not ad-hoc values.
- `.glass-card` (index.css) is the one blur/material recipe, used sparingly on
  floating headers and hero widgets. It requires transparent page backgrounds
  behind it to read as glass.

**Adding a token:** define it in `:root` _and_ in every `[data-palette=…]` /
`[data-theme='dark']` block that needs to override it. A token that exists in
only one block silently disappears in the other mode.

## 3. Typography

Single family, two roles — technical and legible, no display font.

- **Font:** Inter, loaded at weights **400 / 500 / 600 / 700** only
  (`@import` in `index.css`, `display=swap`).
- **Roles:** `--font-sans` and `--font-display` (both Inter today, separated so
  a display face can be introduced without a sweep).
- **Weights:** 400 body and labels · 500 inputs and secondary buttons ·
  600 emphasis and table headers · 700 headings, primary buttons, KPI figures.
- **Tracking:** headings use negative tracking (`tracking-[-0.02em]` /
  `tracking-tighter`); uppercase micro-labels use `tracking-[0.06em]` or wider.

> **Known gap:** `font-black` (900) appears in several places
> (`Footer`, `HowItWorks`, report status chips and section labels in
> `ReportsPage`/`SettingsPage`) but **900 is never loaded**, so those render at 700. Either drop `font-black` for `font-bold` or add the weight to the import;
> do not leave it as an unintended no-op, and do not re-add 900 casually — the
> weight list was deliberately trimmed for LCP.

## 4. Layout, spacing, shape

- **Shell:** `src/pages/dashboard/DashboardLayout.tsx` owns navigation and the
  content frame. There is no separate `Sidebar.tsx`. Desktop shows the persistent
  side navigation; mobile collapses to a compact bar/drawer with the same tab set.
- **Canvas:** content columns cap at `max-w-7xl` so wide monitors do not stretch
  forms; grids use `gap-4`/`gap-6`.
- **Radius:** soft and structural — cards at `--radius-3xl`/`2xl`, controls
  pill-shaped or `xl`. Corner radii stay inside a page; mixing radii scales on
  adjacent elements is the fastest way to make a screen look assembled.
- **Breakpoints:** mobile-first. Write the base style for phones, then add `md:`
  and `lg:` — never the reverse.

## 5. Component primitives (`src/components/ui`)

Import from the `components/ui` barrel. Route pages compose these; they should
not re-implement a control that already exists there.

| Primitive                                                       | Use                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `Button`, `IconButton`                                          | Variants `brand`/`primary`/…, sizes, optional `shine`.       |
| `Card`, `SectionTitle`                                          | Surface panels with controlled padding.                      |
| `SegmentedControl`                                              | Mutually exclusive view switching (shared-layout indicator). |
| `Sheet`, `ConfirmSheet`                                         | Bottom/side panels for forms and destructive confirmations.  |
| `Field`, `TextInput`, `TextArea`, `Select`, `CONTROL_BASE`      | Labelled inputs and the shared control styling.              |
| `Combobox`                                                      | Searchable single-select with keyboard navigation.           |
| `SliderField`                                                   | Numeric layout settings with live validation.                |
| `CalendarRangePicker`, `presetRange`, `toIsoDay`                | Date range selection and day bucketing.                      |
| `SearchField`, `ListRow`, `ListGroup`, `EmptyState`, `Skeleton` | List construction and loading/empty states.                  |
| `StatusPill`                                                    | Report/verification status with a semantic tone.             |
| `Switch`, `Disclosure`, `Tooltip`                               | Binary settings, progressive disclosure, hover hints.        |
| `ToastProvider`, `useToast`                                     | Non-blocking success/failure feedback.                       |

**List filtering:** pages that list Firestore documents share
`hooks/useCollectionList` (cursor-paginated, live first page, server-side
`where()` filters) and format `createdAt` with `lib/date-range` + `toIsoDay`.
Use those instead of hand-rolled filtering so date boundaries cannot drift.

## 6. UX engineering

- **High-speed data entry:** result inputs in `ReportsPage` listen to `onKeyDown`
  and `Enter` / `ArrowUp` / `ArrowDown` move focus between fields, so a
  pathologist never leaves the keyboard.
- **In-range feedback:** values outside their reference range flag themselves in
  the UI and are re-rendered as bold text with a drawn arrow in the PDF.
- **Destructive actions** always go through `ConfirmSheet`, name the object being
  deleted, and state whether the change is reversible.
- **Loaders:** `lucide-react` spinners and `Skeleton`, never static "Loading…" text. The
  app is offline by construction (no network permission), so there is no reconnect/sync
  banner — degraded-connectivity messaging was removed with `ConnectionBanner`.
- **Errors:** `ErrorBoundary` is scoped per dashboard tab, so one broken page
  cannot take the shell down. `handleFirestoreError` turns SDK codes into
  lab-staff-readable sentences.

## 7. Accessibility

- **Keyboard:** a "Skip to content" link is the first focusable element, and
  `index.css` sets one global `:focus-visible` ring
  (`outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit`)
  so keyboard focus is always visible and on-brand without per-component
  utilities. Do not suppress it with `outline-none`; if a control needs a
  different shape, style `:focus-visible` for that control instead.
- **Semantics:** `<nav>`, `<header>`, `<main>`, `<section>`; `aria-label` on
  icon-only controls (`aria-label={`Edit ${name}`}`), `aria-busy` on loading
  regions, `role="alert"` on error text, `aria-hidden` on decorative SVG/glow.
- **Contrast:** the shipped pairings exceed WCAG AA; navy-on-white text pairs
  exceed AAA. Verify any new colour pair, and check dark mode separately — a
  contrast pass in one mode says nothing about the other.
- **Motion:** `MotionConfig reducedMotion="user"` plus the CSS
  `prefers-reduced-motion` block in `index.css`. Respect both when adding motion.
- **Touch:** primary controls target ≥ 44 px (`h-11`/`h-12`).

## 8. Animation & motion design

The library is **`motion`** (`motion/react`) — the successor package to
`framer-motion`; the old name is not a dependency.

`src/lib/motion.ts` is the only place durations, easings and springs are
declared: `EASE.out` / `EASE.overshoot`, `DURATION.micro|fast|base|soft`,
`SPRING.press|snappy|shell|card`, and `listStagger` / `listStaggerProps`.

- **Never inline a magic duration or easing** in a component — import from the
  vocabulary, or add a new named entry there.
- **Route and tab transitions** rise 10–12 px while fading in. Dashboard tabs use
  `mode="popLayout"` so the incoming page starts moving immediately instead of
  waiting for the exit.
- **Staggered lists** cap at `MAX_STAGGER_DELAY` (0.45 s): an uncapped
  `index * step` makes row 40 arrive two seconds late.
- **Animate only `transform` and `opacity`** for anything that moves on screen;
  `will-change` sparingly and never permanently.
- Micro-interactions use press-scale (`whileTap={{ scale: 0.98 }}`) so a click
  feels acknowledged before the network round-trip finishes.

## 9. PDF export design system

The generated report follows its own printable rules, shared with the live A4
preview through `src/lib/report-layout.ts` (geometry, clamping, printable area,
column widths, QR position) so **the preview cannot disagree with the PDF**:

- **Font:** `helvetica` — always available in PDF readers, no embedding.
- **Page:** A4, 210 × 297 mm; margins come from the lab's saved layout settings
  with `getPrintableArea()` validating them (`RECOMMENDED_LAYOUT_DEFAULTS` is
  what "Reset to recommended" restores).
- **Colour:** near-grayscale for results, muted brand dark for headings — chosen
  for printer economy and contrast, not for screen.
- **Hierarchy:** patient metadata anchors the top of every page; tests are
  grouped by `isGroup` so the paper mirrors the screen.
- **Templates:** `modern`, `classic`, `minimalist`, and `blank` (for
  pre-printed letterheads, which deliberately omits drawn header graphics so
  nothing overlaps the stationery).
