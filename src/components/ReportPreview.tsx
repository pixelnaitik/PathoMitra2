import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut, AlertTriangle, Scan, FileDown } from 'lucide-react';
import { THEME_OPTIONS } from '../lib/theme';
import type { LabSettings } from '../lib/settings';
import {
  A4,
  MM_TO_PX_BASE,
  PT_TO_MM,
  buildReportPalette,
  resolveReportLayout,
  validateMargins,
  type ReportPalette,
  type ResolvedReportLayout,
} from '../lib/report-layout';
import { REPORT_FIELDS, sanitizeFieldValue, type LayoutFieldKey } from '../lib/report-layout-spec';

type Rgb = [number, number, number];
type ZoomMode = 'fit' | number;

type MarginSide = 'top' | 'bottom' | 'left' | 'right';

/** Which LabSettings key each canvas guide edits, per preview mode. */
const MARGIN_SIDE_KEYS = {
  print: {
    top: 'reportMarginTop',
    bottom: 'reportMarginBottom',
    left: 'reportMarginLeft',
    right: 'reportMarginRight',
  },
  share: {
    top: 'shareMarginTop',
    bottom: 'shareMarginBottom',
    left: 'shareMarginLeft',
    right: 'shareMarginRight',
  },
} as const;

const rgba = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

interface Props {
  settings: LabSettings;
  /** 'print' uses reportMargin* / report* values; 'share' uses the shareTemplate variants. */
  mode?: 'print' | 'share';
  onModeChange?: (mode: 'print' | 'share') => void;
  /** Opens the real-PDF sample rendered with the current (possibly unsaved) settings. */
  onPreviewPdf?: () => void;
  /**
   * Direct margin editing on the canvas. Fires with commit=false on every drag
   * move (live preview) and commit=true once on release (single undo step).
   */
  onMarginChange?: (patch: Partial<LabSettings>, commit: boolean) => void;
}

const SAMPLE_ROWS: [string, string, string, string, 'up' | 'down' | 'normal'][] = [
  ['Hemoglobin', '14.2', 'g/dL', '13.0 – 17.0', 'normal'],
  ['WBC Count', '12,500', '/cumm', '4,000 – 11,000', 'up'],
  ['Platelet Count', '1.5', 'lakhs', '1.5 – 4.0', 'normal'],
  ['RBC Count', '3.9', 'mill/cumm', '4.5 – 5.5', 'down'],
  ['PCV / Haematocrit', '42', '%', '40 – 50', 'normal'],
];

export default function ReportPreview({
  settings,
  mode: modeProp,
  onModeChange,
  onPreviewPdf,
  onMarginChange,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<ZoomMode>('fit');
  const [internalMode, setInternalMode] = useState<'print' | 'share'>('print');
  const mode = modeProp ?? internalMode;
  const setMode = (m: 'print' | 'share') => (onModeChange ? onModeChange(m) : setInternalMode(m));

  const L = useMemo(() => resolveReportLayout(settings, mode), [settings, mode]);
  const issues = useMemo(() => validateMargins(L.margins), [L.margins]);
  const hasError = issues.some(i => i.level === 'error');

  // Brand palette — the exact ramp the PDF generator draws with (report-layout).
  const colors = useMemo<ReportPalette>(() => {
    const brandHex = (THEME_OPTIONS.find(t => t.id === L.themeId) || THEME_OPTIONS[0]).previewColor;
    return buildReportPalette(brandHex, L.template);
  }, [L.themeId, L.template]);

  // Measure the scroll area so "fit" is exact and re-fits on resize.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const cr = entries[0].contentRect;
      setBox({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pageW100 = A4.widthMm * MM_TO_PX_BASE;
  const pageH100 = A4.heightMm * MM_TO_PX_BASE;
  const PAD = 40;

  const fitScale = useMemo(() => {
    if (!box.w) return 0.45;
    const widthFit = (box.w - PAD) / pageW100;
    // Only honour the measured height when it is within a sane, bounded range;
    // otherwise fall back to width so an unbounded (auto) container can't inflate
    // the scale into a feedback loop.
    const heightFit = box.h && box.h > 100 && box.h < 2000 ? (box.h - PAD) / pageH100 : widthFit;
    return Math.max(0.05, Math.min(widthFit, heightFit));
  }, [box.w, box.h, pageW100, pageH100]);

  const scale = zoom === 'fit' ? fitScale : zoom;
  // The page is always laid out at 100% and shrunk with one CSS transform.
  // Scaling font sizes arithmetically instead (mm() * scale) produces sub-pixel
  // text that Android WebView inflates and overlaps at fit-zoom (~30% on phones).
  const mm = (v: number) => v * MM_TO_PX_BASE;
  const pt = (v: number) => v * PT_TO_MM * MM_TO_PX_BASE;
  /** Screen-space size (px) converted into page space so UI chrome stays a
      constant physical size at any zoom. */
  const ui = (v: number) => v / scale;

  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const base = zoom === 'fit' ? fitScale : zoom;
      setZoom(Math.min(4, Math.max(0.1, Math.round((base + dir * 0.1) * 100) / 100)));
    },
    [zoom, fitScale],
  );

  const serif = L.template === 'classic';
  const fontFamily = serif ? '"Times New Roman", Times, serif' : 'Helvetica, Arial, sans-serif';

  // Share mode can show the uploaded full-bleed template background.
  const shareImage = mode === 'share' ? settings.sharingTemplateImage || '' : '';
  const showImage = !!shareImage;

  // Column widths come from the shared layout model (same math as the PDF).
  const pw = L.printable.width;
  const colw = L.columns;

  // ---- direct margin editing on the canvas -------------------------------
  const [dragSide, setDragSide] = useState<MarginSide | null>(null);
  const dragRef = useRef<{
    side: MarginSide;
    startClient: number;
    startValue: number;
    lastValue: number;
    mmPerPx: number;
  } | null>(null);

  const marginKey = (side: MarginSide): LayoutFieldKey =>
    MARGIN_SIDE_KEYS[mode === 'share' ? 'share' : 'print'][side];

  /** Clamp to the field range AND keep the printable area valid while dragging. */
  const clampMargin = (side: MarginSide, raw: number): number => {
    let v = raw;
    if (side === 'top') v = Math.min(v, 277 - L.margins.bottom);
    else if (side === 'bottom') v = Math.min(v, 277 - L.margins.top);
    else if (side === 'left') v = Math.min(v, 180 - L.margins.right);
    else v = Math.min(v, 180 - L.margins.left);
    return sanitizeFieldValue(REPORT_FIELDS[marginKey(side)], v);
  };

  const applyMargin = (side: MarginSide, value: number, commit: boolean) => {
    onMarginChange?.({ [marginKey(side)]: value } as Partial<LabSettings>, commit);
  };

  const onHandleDown = (side: MarginSide) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onMarginChange) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const page = pageRef.current;
    if (!page) return;
    e.preventDefault();
    const rect = page.getBoundingClientRect();
    const horizontal = side === 'left' || side === 'right';
    const startValue = L.margins[side];
    dragRef.current = {
      side,
      startClient: horizontal ? e.clientX : e.clientY,
      startValue,
      lastValue: startValue,
      mmPerPx: (horizontal ? A4.widthMm : A4.heightMm) / (horizontal ? rect.width : rect.height),
    };
    setDragSide(side);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
  };

  const onHandleMove = (side: MarginSide) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.side !== side) return;
    const horizontal = side === 'left' || side === 'right';
    const delta = ((horizontal ? e.clientX : e.clientY) - d.startClient) * d.mmPerPx;
    // Top/left guides grow with the drag direction; bottom/right shrink.
    const sign = side === 'top' || side === 'left' ? 1 : -1;
    const next = clampMargin(side, d.startValue + sign * delta);
    if (next !== d.lastValue) {
      d.lastValue = next;
      applyMargin(side, next, false);
    }
  };

  const onHandleUp = (side: MarginSide) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.side !== side) return;
    dragRef.current = null;
    setDragSide(null);
    applyMargin(side, d.lastValue, true);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleKey = (side: MarginSide) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onMarginChange) return;
    const horizontal = side === 'left' || side === 'right';
    const plus = horizontal ? 'ArrowRight' : 'ArrowDown';
    const minus = horizontal ? 'ArrowLeft' : 'ArrowUp';
    if (e.key !== plus && e.key !== minus) return;
    e.preventDefault();
    const dir = (e.key === plus ? 1 : -1) * (side === 'top' || side === 'left' ? 1 : -1);
    const step = e.shiftKey ? 5 : 1;
    applyMargin(side, clampMargin(side, L.margins[side] + dir * step), true);
  };

  const HANDLE_HIT = 14;
  const handleStyle = (side: MarginSide): React.CSSProperties => {
    const t = mm(L.margins.top);
    const b = mm(L.margins.top) + mm(L.printable.height);
    const l = mm(L.margins.left);
    const r = mm(L.margins.left) + mm(pw);
    const pageW = mm(A4.widthMm);
    const pageH = mm(A4.heightMm);
    const hit = ui(HANDLE_HIT);
    const base: React.CSSProperties = {
      position: 'absolute',
      touchAction: 'none',
      zIndex: 5,
    };
    if (side === 'top')
      return {
        ...base,
        left: l,
        width: r - l,
        top: Math.max(0, t - hit / 2),
        height: hit,
        cursor: 'ns-resize',
      };
    if (side === 'bottom')
      return {
        ...base,
        left: l,
        width: r - l,
        top: Math.min(pageH - hit, b - hit / 2),
        height: hit,
        cursor: 'ns-resize',
      };
    if (side === 'left')
      return {
        ...base,
        top: t,
        height: b - t,
        left: Math.max(0, l - hit / 2),
        width: hit,
        cursor: 'ew-resize',
      };
    return {
      ...base,
      top: t,
      height: b - t,
      left: Math.min(pageW - hit, r - hit / 2),
      width: hit,
      cursor: 'ew-resize',
    };
  };

  const dragBandStyle = (side: MarginSide): React.CSSProperties => {
    const t = mm(L.margins.top);
    const b = mm(L.margins.top) + mm(L.printable.height);
    const l = mm(L.margins.left);
    const r = mm(L.margins.left) + mm(pw);
    const rects: Record<MarginSide, React.CSSProperties> = {
      top: { top: 0, left: 0, width: mm(A4.widthMm), height: t },
      bottom: { top: b, left: 0, width: mm(A4.widthMm), height: mm(A4.heightMm) - b },
      left: { top: t, left: 0, width: l, height: b - t },
      right: { top: t, left: r, width: mm(A4.widthMm) - r, height: b - t },
    };
    return {
      position: 'absolute',
      pointerEvents: 'none',
      background: 'rgba(37,99,235,0.08)',
      ...rects[side],
    };
  };

  const marginHandle = (side: MarginSide) => {
    const active = dragSide === side;
    const spec = REPORT_FIELDS[marginKey(side)];
    return (
      <div
        key={side}
        role="slider"
        tabIndex={0}
        aria-label={`${side} margin — drag or use arrow keys`}
        aria-orientation={side === 'left' || side === 'right' ? 'horizontal' : 'vertical'}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={L.margins[side]}
        aria-valuetext={`${L.margins[side]} millimetres`}
        onPointerDown={onHandleDown(side)}
        onPointerMove={onHandleMove(side)}
        onPointerUp={onHandleUp(side)}
        onPointerCancel={onHandleUp(side)}
        onKeyDown={onHandleKey(side)}
        className="outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
        style={handleStyle(side)}
      >
        <span
          className={`pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums transition-colors ${
            active
              ? 'border-primary bg-primary text-on-primary shadow-card'
              : 'border-primary/60 bg-surface'
          }`}
          style={
            active
              ? { height: ui(20), minWidth: ui(56), fontSize: ui(10) }
              : { height: ui(14), width: ui(36), fontSize: ui(10) }
          }
        >
          {active ? `${L.margins[side]} mm` : ''}
        </span>
      </div>
    );
  };

  const zoomIdle = 'text-primary hover:bg-surface-container-high';
  const guideColor = 'rgba(37,99,235,0.30)';
  const guideH = (top: number, left: number, width: number): React.CSSProperties => ({
    position: 'absolute',
    top: top - ui(0.5),
    left,
    width,
    height: ui(1),
    background: guideColor,
    pointerEvents: 'none',
  });
  const guideV = (left: number, top: number, height: number): React.CSSProperties => ({
    position: 'absolute',
    left: left - ui(0.5),
    top,
    width: ui(1),
    height,
    background: guideColor,
    pointerEvents: 'none',
  });
  const bandLabel = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: ui(9),
    fontWeight: 600,
    letterSpacing: '0.03em',
    color: 'rgba(100,116,139,0.95)',
    pointerEvents: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  });

  return (
    <section className="flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-lowest shadow-card overflow-hidden">
      {/* Toolbar */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5 border-b border-outline-variant/40 bg-gradient-to-b from-surface-container-low to-surface-container-lowest">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-primary/10 text-primary shrink-0">
            <Scan className="w-4 h-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <p className="text-[13px] font-bold text-primary">Live A4 Preview</p>
            <p className="text-[10px] text-on-surface-variant tabular-nums tracking-wide">
              A4 portrait · 210 × 297 mm
            </p>
          </div>
          <span className="ml-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-bold shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <div className="inline-flex rounded-lg border border-outline-variant/50 bg-surface-container p-0.5 text-[11px] font-semibold">
            {(['print', 'share'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-md capitalize transition-colors ${
                  mode === m
                    ? 'bg-primary text-on-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
                title={`${m} template layout`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Zoom controls. They were `h-8 w-8` (32px), which passes WCAG 2.2's
              24px AA minimum but sits well under Android's 48dp guidance for a
              target a lab user taps repeatedly while squinting at an A4 page. */}
          <div className="inline-flex items-center rounded-lg border border-outline-variant/50 bg-surface-container overflow-hidden">
            <button
              onClick={() => setZoom('fit')}
              title="Fit to screen"
              aria-label="Fit report to screen"
              aria-pressed={zoom === 'fit'}
              className={`grid place-items-center h-11 w-12 transition-colors ${zoom === 'fit' ? 'bg-primary text-on-primary' : zoomIdle}`}
            >
              <Maximize2 className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="w-px h-5 bg-outline-variant/50" aria-hidden="true" />
            <button
              onClick={() => zoomStep(-1)}
              title="Zoom out"
              aria-label="Zoom out"
              className={`grid place-items-center h-11 w-11 transition-colors ${zoomIdle}`}
            >
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setZoom(1)}
              title="Reset to 100%"
              aria-label={`Reset zoom, currently ${Math.round(scale * 100)} percent`}
              className="grid place-items-center h-11 min-w-[52px] px-1 text-[11px] font-bold tabular-nums text-primary hover:bg-surface-container-high transition-colors"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              onClick={() => zoomStep(1)}
              title="Zoom in"
              aria-label="Zoom in"
              className={`grid place-items-center h-11 w-11 transition-colors ${zoomIdle}`}
            >
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {onPreviewPdf && (
            <button
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-on-primary text-[11px] font-bold hover:brightness-110 active:scale-[0.98] transition"
            >
              <FileDown className="w-3.5 h-3.5" /> PDF
            </button>
          )}
        </div>
      </header>

      {/* Validation feedback */}
      {issues.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-2 space-y-1 bg-surface-container-low border-b border-outline-variant/30"
        >
          {issues.map((issue, i) => (
            <p
              key={i}
              className={`flex items-start gap-1.5 text-[11px] font-semibold ${
                issue.level === 'error' ? 'text-error' : 'text-amber-600'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {issue.message}
            </p>
          ))}
        </div>
      )}

      {/* Canvas workspace. maxHeight keeps the measured box independent of the page
          size, preventing a fit-scale feedback loop (page → container → page). */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-3 sm:p-6"
        style={{
          minHeight: 420,
          maxHeight: '82vh',
          backgroundColor: '#e8ecf1',
          backgroundImage: 'radial-gradient(rgba(15,23,42,0.07) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        {/* Layout box occupies the scaled size; the page itself is laid out at
            100% and shrunk with a transform so text never re-flows per zoom. */}
        <div
          className="relative mx-auto shrink-0"
          style={{ width: mm(A4.widthMm) * scale, height: mm(A4.heightMm) * scale }}
        >
          <div
            ref={pageRef}
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: mm(A4.widthMm),
              height: mm(A4.heightMm),
              transform: `scale(${scale})`,
              borderRadius: 3,
              boxShadow:
                '0 0 0 1px rgba(15,23,42,0.10), 0 12px 24px -10px rgba(15,23,42,0.35), 0 30px 60px -25px rgba(15,23,42,0.28)',
              fontFamily,
              color: rgba(colors.INK),
              WebkitTextSizeAdjust: '100%',
              textSizeAdjust: '100%',
              background: showImage
                ? `#eef2f7 url(${shareImage}) center / 100% 100% no-repeat`
                : '#eef2f7',
            }}
          >
            {hasError ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                {/* Counter the page transform so the message stays screen-sized. */}
                <div
                  className="flex flex-col items-center gap-2 text-error"
                  style={{ transform: `scale(${ui(1)})` }}
                >
                  <AlertTriangle className="w-6 h-6" />
                  <p className="text-sm font-bold">Invalid margins — no printable area.</p>
                </div>
              </div>
            ) : (
              <>
                {/* Printable area */}
                <div
                  className="absolute overflow-hidden"
                  style={{
                    top: mm(L.margins.top),
                    left: mm(L.margins.left),
                    width: mm(pw),
                    height: mm(L.printable.height),
                    background: showImage ? 'transparent' : '#fff',
                    boxShadow: 'inset 0 0 0 1px rgba(15,23,42,0.06)',
                  }}
                >
                  <ReportBody L={L} colors={colors} mm={mm} pt={pt} serif={serif} colw={colw} />
                </div>

                {/* Margin guide lines */}
                <span style={guideH(mm(L.margins.top), mm(L.margins.left), mm(pw))} />
                <span
                  style={guideH(
                    mm(L.margins.top) + mm(L.printable.height),
                    mm(L.margins.left),
                    mm(pw),
                  )}
                />
                <span
                  style={guideV(mm(L.margins.left), mm(L.margins.top), mm(L.printable.height))}
                />
                <span
                  style={guideV(
                    mm(L.margins.left) + mm(pw),
                    mm(L.margins.top),
                    mm(L.printable.height),
                  )}
                />

                {/* Margin measurements (only when the band is wide enough on screen) */}
                {mm(L.margins.top) >= ui(22) && (
                  <span
                    style={bandLabel({
                      top: 0,
                      left: mm(L.margins.left),
                      width: mm(pw),
                      height: mm(L.margins.top),
                    })}
                  >
                    {L.margins.top} mm
                  </span>
                )}
                {mm(L.margins.bottom) >= ui(22) && (
                  <span
                    style={bandLabel({
                      top: mm(L.margins.top) + mm(L.printable.height),
                      left: mm(L.margins.left),
                      width: mm(pw),
                      height: mm(L.margins.bottom),
                    })}
                  >
                    {L.margins.bottom} mm
                  </span>
                )}
                {mm(L.margins.left) >= ui(30) && (
                  <span
                    style={bandLabel({
                      top: mm(L.margins.top),
                      left: 0,
                      width: mm(L.margins.left),
                      height: mm(L.printable.height),
                    })}
                  >
                    {L.margins.left} mm
                  </span>
                )}
                {mm(L.margins.right) >= ui(30) && (
                  <span
                    style={bandLabel({
                      top: mm(L.margins.top),
                      left: mm(L.margins.left) + mm(pw),
                      width: mm(L.margins.right),
                      height: mm(L.printable.height),
                    })}
                  >
                    {L.margins.right} mm
                  </span>
                )}

                {/* Draggable margin guides — direct manipulation replaces the sliders */}
                {onMarginChange && (
                  <>
                    {dragSide && <span style={dragBandStyle(dragSide)} />}
                    {(['top', 'bottom', 'left', 'right'] as const).map(marginHandle)}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 px-3.5 py-2 text-[11px] border-t border-outline-variant/40 bg-surface-container-low">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-high text-primary font-semibold shrink-0">
            {mode === 'share' ? 'Share' : 'Print'} template
          </span>
          <span className="hidden sm:inline truncate text-on-surface-variant">
            {onMarginChange ? 'Drag the guides on the page to set margins' : 'Live sample'}
          </span>
        </div>
        <span className="shrink-0 tabular-nums text-on-surface-variant">
          {pw.toFixed(0)} × {L.printable.height.toFixed(0)} mm printable
        </span>
      </footer>
    </section>
  );
}

/* ---- Document body, positioned in mm exactly like the jsPDF flow ---- */
function ReportBody({
  L,
  colors,
  mm,
  pt,
  serif,
  colw,
}: {
  L: ResolvedReportLayout;
  colors: ReportPalette;
  mm: (v: number) => number;
  pt: (v: number) => number;
  serif: boolean;
  colw: readonly number[];
}) {
  const gap = mm(L.sectionGapMm);
  const [c0, c1, c2, c3] = colw.map(mm);

  const header = () => {
    if (L.template === 'blank') return null;
    if (L.template === 'classic') {
      return (
        <div
          style={{
            textAlign: 'center',
            borderBottom: `2px solid ${rgba(colors.BRAND_DARK)}`,
            paddingBottom: gap,
          }}
        >
          <div style={{ borderTop: `1px solid ${rgba(colors.BRAND_DARK)}`, paddingTop: mm(2) }}>
            <h1
              style={{
                fontSize: pt(L.titleFont + 2),
                fontWeight: 700,
                color: rgba(colors.BRAND_DARK),
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                margin: 0,
              }}
            >
              {L.labName}
            </h1>
            <p
              style={{
                fontSize: pt(Math.max(8, L.titleFont - 8)),
                fontStyle: 'italic',
                color: rgba(colors.INK_SOFT),
                margin: `${mm(1.5)}px 0`,
              }}
            >
              {L.legal.tagline}
            </p>
          </div>
        </div>
      );
    }
    if (L.template === 'minimalist') {
      return (
        <div
          style={{
            borderBottom: `1px solid ${rgba(colors.HAIRLINE)}`,
            paddingBottom: gap,
          }}
        >
          <h1
            style={{
              fontSize: pt(L.titleFont - 3),
              fontWeight: 700,
              color: rgba(colors.INK),
              margin: 0,
            }}
          >
            {L.labName}
          </h1>
          <p
            style={{
              fontSize: pt(Math.max(6.5, L.titleFont - 11)),
              letterSpacing: '0.22em',
              color: rgba(colors.INK_SOFT),
              margin: `${mm(1)}px 0 0`,
            }}
          >
            D I G I T A L&nbsp;&nbsp;P A T H O L O G Y&nbsp;&nbsp;R E P O R T
          </p>
        </div>
      );
    }
    // modern
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: `1px solid ${rgba(colors.HAIRLINE)}`,
          paddingBottom: gap,
        }}
      >
        <div style={{ display: 'flex', gap: mm(2.5) }}>
          <span
            style={{
              width: mm(1.7),
              alignSelf: 'stretch',
              background: rgba(colors.BRAND),
              borderRadius: mm(0.85),
            }}
          />
          <div>
            <h1
              style={{
                fontSize: pt(L.titleFont),
                fontWeight: 700,
                color: rgba(colors.BRAND_DARK),
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {L.labName}
            </h1>
            <p
              style={{
                fontSize: pt(Math.max(6.5, L.titleFont - 11)),
                letterSpacing: '0.14em',
                color: rgba(colors.INK_SOFT),
                margin: `${mm(1)}px 0 0`,
              }}
            >
              DIGITAL PATHOLOGY REPORT
            </p>
          </div>
        </div>
        <div
          style={{
            textAlign: 'right',
            fontSize: pt(8),
            color: rgba(colors.INK_SOFT),
            lineHeight: 1.5,
          }}
        >
          <div>Report No. A1B2C3D4</div>
          <div style={{ fontWeight: 700, color: rgba(colors.BRAND) }}>FINAL</div>
        </div>
      </div>
    );
  };

  const rowH = mm(L.patientLineHeightMm);

  const patientBox = () => {
    const boxStyle: React.CSSProperties = {
      marginTop: gap,
      padding: mm(2.5),
      fontSize: pt(L.patientFont),
      borderRadius: L.template === 'modern' ? mm(2.6) : 0,
      background: L.template === 'modern' ? rgba(colors.BRAND_TINT) : 'transparent',
      border:
        L.template === 'modern'
          ? `1px solid ${rgba(colors.BRAND_TINT2)}`
          : L.template === 'classic'
            ? `1px solid ${rgba(colors.BRAND_DARK, 0.6)}`
            : 'none',
      borderBottom: L.template === 'minimalist' ? `1px solid ${rgba(colors.HAIRLINE)}` : undefined,
      position: 'relative',
    };
    const Row = ({ k, v }: { k: string; v: string }) => (
      <div
        style={{
          height: rowH,
          display: 'flex',
          gap: mm(2),
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: rgba(colors.INK_SOFT),
            minWidth: mm(26),
          }}
        >
          {k}
        </span>
        <span style={{ color: rgba(colors.INK) }}>: {v}</span>
      </div>
    );
    return (
      <div style={boxStyle}>
        <div style={{ display: 'flex', gap: mm(6) }}>
          <div style={{ flex: 1 }}>
            <Row k="Patient Name" v="John Doe" />
            <Row k="Ref By" v="Dr. A. Smith" />
            <Row k="Patient ID" v="P-0A1B2C3D" />
          </div>
          <div style={{ flex: 1 }}>
            <Row k="Age" v="35 Years" />
            <Row k="Sex" v="Male" />
            <Row k="Reported on" v="12-09-2026 10:42 AM" />
          </div>
        </div>
      </div>
    );
  };

  const categoryBand = () => (
    <div
      style={{
        marginTop: gap,
        fontSize: pt(L.tableBodyFont),
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: rgba(colors.BRAND_DARK),
        background: L.template === 'modern' ? rgba(colors.BRAND_SOFT) : 'transparent',
        padding: `${mm(Math.max(1.5, L.tableCellPaddingMm * 1.6))}px ${mm(2)}px`,
        borderRadius: L.template === 'modern' ? mm(1) : 0,
      }}
    >
      Haematology
    </div>
  );

  const bandStyle: React.CSSProperties = {
    background: L.template === 'modern' ? rgba(colors.BRAND_DARK) : 'transparent',
    color: L.template === 'modern' ? '#fff' : rgba(colors.INK_SOFT),
    fontWeight: 700,
    letterSpacing: '0.04em',
    padding: `${mm(L.tableCellPaddingMm)}px ${mm(2)}px`,
    display: 'flex',
    fontSize: pt(L.tableHeaderFont),
    borderTop: L.template !== 'modern' ? `1px solid ${rgba(colors.HAIRLINE)}` : undefined,
    borderBottom: `1px solid ${rgba(colors.HAIRLINE)}`,
    borderRadius: L.template === 'modern' ? mm(1.6) : undefined,
  };

  const table = () => (
    <div style={{ marginTop: mm(2), width: '100%' }}>
      <div style={bandStyle}>
        <span style={{ width: c0 }}>TEST DESCRIPTION</span>
        <span style={{ width: c1 }}>RESULT</span>
        <span style={{ width: c2 }}>UNITS</span>
        <span style={{ width: c3 }}>REFERENCE RANGE</span>
      </div>
      {SAMPLE_ROWS.map((r, i) => {
        const arrow = r[4] === 'up' ? '↑' : r[4] === 'down' ? '↓' : '';
        const abnormal = r[4] !== 'normal';
        const cell = mm(L.tableCellPaddingMm);
        const base: React.CSSProperties = {
          display: 'flex',
          fontSize: pt(L.tableBodyFont),
          padding: `${cell}px ${mm(1.5)}px`,
          borderBottom: `1px solid ${rgba(colors.HAIRLINE, 0.5)}`,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        };
        return (
          <div key={i} style={base}>
            <span style={{ width: c0, color: rgba(colors.INK) }}>{r[0]}</span>
            <span
              style={{
                width: c1,
                fontWeight: abnormal ? 700 : 400,
                color: abnormal ? rgba(colors.BRAND_DARK) : rgba(colors.INK),
              }}
            >
              {r[1]}{' '}
              {arrow && (
                <span style={{ color: r[4] === 'up' ? '#b02a3a' : rgba(colors.BRAND) }}>
                  {arrow}
                </span>
              )}
            </span>
            <span style={{ width: c2, color: rgba(colors.INK_SOFT) }}>{r[2]}</span>
            <span style={{ width: c3, color: rgba(colors.INK_SOFT) }}>{r[3]}</span>
          </div>
        );
      })}
    </div>
  );

  const notes = () => (
    <div
      style={{
        marginTop: gap,
        paddingTop: gap,
        borderTop: `1px solid ${rgba(colors.HAIRLINE)}`,
        fontSize: pt(L.notesFont),
        color: rgba(colors.INK),
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: 0, fontWeight: 700, color: rgba(colors.BRAND_DARK) }}>NOTE —</p>
      <p style={{ margin: `${mm(1)}px 0` }}>
        Raised WBC count with left shift is consistent with an acute bacterial infection.
      </p>
      <p style={{ margin: 0, fontWeight: 700, color: rgba(colors.BRAND_DARK) }}>
        Clinical significance —
      </p>
      <p style={{ margin: `${mm(1)}px 0 0` }}>
        Correlate with culture &amp; sensitivity and clinical findings before initiating therapy.
      </p>
    </div>
  );

  const footer = () => (
    <>
      {/* Credential + issuance block, mirroring the generated PDF so what the
          lab sees in preview is what the patient receives. Nothing here is
          printed unless the operator supplied and attested it. */}
      <div
        style={{
          marginTop: gap * 1.5,
          fontSize: pt(Math.max(7, L.footerFont - 2)),
          fontStyle: 'italic',
          color: rgba(colors.INK_SOFT),
          lineHeight: 1.5,
        }}
      >
        {[L.legal.accreditation, L.legal.licence, L.legal.signer, L.legal.disclaimer]
          .filter(Boolean)
          .map(line => (
            <p key={line} style={{ margin: 0 }}>
              {line}
            </p>
          ))}
      </div>
      <div
        style={{
          marginTop: gap,
          textAlign: 'center',
          fontSize: pt(L.footerFont),
          letterSpacing: serif ? '0.05em' : '0.2em',
          color: rgba(colors.INK_SOFT),
        }}
      >
        {L.template === 'blank' ? '*** End of Report ***' : '— End of Report —'}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: mm(2),
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: pt(Math.max(8, L.footerFont - 2)),
          color: 'rgb(120,120,120)',
        }}
      >
        Page 1 of 1
      </div>
    </>
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      {header()}
      {patientBox()}
      {L.template !== 'blank' && categoryBand()}
      {table()}
      {notes()}
      {footer()}
    </div>
  );
}
