/**
 * ReportSettingsPanel — the redesigned report-template editor.
 *
 * Four plain-language groups (Template · Layout · Typography · Tables ·
 * Footer), slider-based controls with visible units, and progressive
 * disclosure for rarely-touched fine tuning. Every number here is reflected
 * live in <ReportPreview> through the shared layout model in lib/report-layout.
 */
import { useId, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyStart,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Table2,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { SegmentedControl, SliderField, Switch, Disclosure } from '../components/ui';
import { cn } from '../lib/utils';
import type { LabSettings } from '../lib/settings';
import {
  REPORT_FIELDS,
  sanitizeFieldValue,
  validateLayoutSettings,
  type LayoutFieldKey,
  type ReportFieldSpec,
} from '../lib/report-layout-spec';
import { safeNum } from '../lib/report-layout';

export interface ReportSettingsPanelProps {
  settings: LabSettings;
  /** Live value update — drives the preview immediately. */
  onChange: (patch: Partial<LabSettings>) => void;
  /** Same patch, for the undo/redo history (fires once a burst settles). */
  onCommit: (patch: Partial<LabSettings>) => void;
  mode: 'print' | 'share';
}

const TEMPLATES: { value: string; label: string; description: string }[] = [
  { value: 'modern', label: 'Modern', description: 'Brand letterhead, banded table header.' },
  { value: 'classic', label: 'Classic', description: 'Formal serif masthead, ruled grid.' },
  { value: 'minimalist', label: 'Minimalist', description: 'Airy layout, hairlines only.' },
  { value: 'blank', label: 'Plain pad', description: 'Content only — for pre-printed stationery.' },
];

const MARGIN_PRESETS = [
  { label: 'Standard pad', top: 50, bottom: 20, left: 8, right: 15 },
  { label: 'Minimal', top: 15, bottom: 15, left: 12, right: 12 },
  { label: 'Generous', top: 60, bottom: 30, left: 20, right: 20 },
];

/** Compact toggle row (label + purpose + switch) — never hover-dependent. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-on-surface">{label}</p>
        {description && <p className="mt-0.5 text-xs text-on-surface-variant">{description}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Collapsible tail inside a group — "less used" controls stay out of the way. */
function MoreRow({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="border-t border-outline-variant/30 pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-accent transition-colors hover:text-primary"
      >
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
        {open ? 'Hide' : label}
      </button>
      {open && (
        <div id={id} className="mt-4 space-y-5 animate-rise-in">
          {children}
        </div>
      )}
    </div>
  );
}

/** Exact millimetre entry — the numeric companion to the canvas drag guides. */
function MarginField({
  label,
  spec,
  value,
  error,
  onValue,
}: {
  label: string;
  spec: ReportFieldSpec;
  value: number;
  error?: string;
  onValue: (v: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-xs font-semibold text-on-surface-variant">
        {label}
        <span className="font-normal">mm</span>
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={e =>
          onValue(
            sanitizeFieldValue(
              spec,
              e.target.value === '' ? spec.recommended : Number(e.target.value),
            ),
          )
        }
        className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm font-semibold tabular-nums text-on-surface focus:border-accent focus:outline-none"
      />
      {error && <span className="block text-[11px] font-medium text-error">{error}</span>}
    </label>
  );
}

export function ReportSettingsPanel({
  settings,
  onChange,
  onCommit,
  mode,
}: ReportSettingsPanelProps) {
  const share = mode === 'share';
  const issues = validateLayoutSettings(settings);
  const errorFor = (key: LayoutFieldKey): string | undefined =>
    issues.find(i => i.field === key)?.message;

  const templateValue = share
    ? settings.shareTemplate || settings.reportTemplate
    : settings.reportTemplate;
  const setTemplate = (value: string) => {
    onChange(share ? { shareTemplate: value } : { reportTemplate: value });
    onCommit(share ? { shareTemplate: value } : { reportTemplate: value });
  };

  // ---- margins ------------------------------------------------------------
  const mTop = safeNum(share ? settings.shareMarginTop : settings.reportMarginTop, share ? 40 : 50);
  const mBottom = safeNum(share ? settings.shareMarginBottom : settings.reportMarginBottom, 20);
  const mLeft = safeNum(
    share ? settings.shareMarginLeft : settings.reportMarginLeft,
    share ? 15 : 8,
  );
  const mRight = safeNum(share ? settings.shareMarginRight : settings.reportMarginRight, 15);
  const sidesEqual = mLeft === mRight;
  const [linkSides, setLinkSides] = useState(sidesEqual);

  const marginPatch = (partial: Partial<LabSettings>): void => {
    onChange(partial);
    onCommit(partial);
  };

  const setSideMargins = (value: number) => {
    if (linkSides) {
      marginPatch(
        share
          ? { shareMarginLeft: value, shareMarginRight: value }
          : { reportMarginLeft: value, reportMarginRight: value },
      );
    } else {
      marginPatch(share ? { shareMarginLeft: value } : { reportMarginLeft: value });
    }
  };

  const setRightMargin = (value: number) => {
    if (linkSides) {
      setSideMargins(value);
    } else {
      marginPatch(share ? { shareMarginRight: value } : { reportMarginRight: value });
    }
  };

  const activePreset = !share
    ? MARGIN_PRESETS.findIndex(
        p => p.top === mTop && p.bottom === mBottom && p.left === mLeft && p.right === mRight,
      )
    : -1;

  const setPreset = (idx: number) => {
    const p = MARGIN_PRESETS[idx];
    if (!p) return;
    marginPatch({
      reportMarginTop: p.top,
      reportMarginBottom: p.bottom,
      reportMarginLeft: p.left,
      reportMarginRight: p.right,
    });
  };

  // ---- share background image --------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleImageFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setImageError('That file is not an image. Choose a PNG or JPG of your A4 letterhead.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setImageError('Image is larger than 4 MB. Export it at A4 size / 150 dpi and try again.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        setImageError(null);
        marginPatch({ sharingTemplateImage: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  // ---- table font sync (legacy shared field kept in step) ----------------
  const setBodyFont = (value: number) =>
    marginPatch(
      share
        ? { shareTableBodyFontSize: value }
        : { reportTableBodyFontSize: value, tableBodyFontSize: value },
    );

  const topSpec = REPORT_FIELDS[share ? 'shareMarginTop' : 'reportMarginTop'];
  const bottomSpec = REPORT_FIELDS[share ? 'shareMarginBottom' : 'reportMarginBottom'];
  const leftSpec = REPORT_FIELDS[share ? 'shareMarginLeft' : 'reportMarginLeft'];
  const rightSpec = REPORT_FIELDS[share ? 'shareMarginRight' : 'reportMarginRight'];

  return (
    <div className="space-y-4">
      {/* ---------- Template ---------- */}
      {!share && (
        <Disclosure
          title="Template"
          icon={<LayoutTemplate className="h-4 w-4" />}
          summary={TEMPLATES.find(t => t.value === templateValue)?.label}
        >
          {/* Cards size themselves from the width this column actually has, not
              from the viewport: a `sm:grid-cols-2` breakpoint fires at 640px of
              *window*, which here still left two ~105px cards and broke every
              label mid-word. `min(100%, 15rem)` also stops a single card from
              overflowing a narrower column (grid items default to min-width:auto). */}
          <div
            role="radiogroup"
            aria-label="Report template"
            className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]"
          >
            {TEMPLATES.map(t => {
              const selected = templateValue === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTemplate(t.value)}
                  className={cn(
                    'min-w-0 rounded-2xl border p-3.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/5 shadow-card'
                      : 'border-outline-variant/40 bg-surface-container-lowest hover:border-primary/40',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'grid h-4 w-4 shrink-0 place-items-center rounded-full border-2',
                        selected ? 'border-primary' : 'border-outline-variant',
                      )}
                    >
                      {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span
                      className={cn(
                        'text-sm font-bold',
                        selected ? 'text-primary' : 'text-on-surface',
                      )}
                    >
                      {t.label}
                    </span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs leading-snug text-on-surface-variant">
                    {t.description}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-on-surface-variant">
            The live preview shows exactly how each template prints — no need to guess.
          </p>
        </Disclosure>
      )}

      {/* ---------- Layout ---------- */}
      <Disclosure
        title="Layout"
        icon={<AlignHorizontalJustifyStart className="h-4 w-4" />}
        summary={`Top ${mTop} mm · bottom ${mBottom} mm · sides ${mLeft}/${mRight} mm`}
      >
        {!share && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-semibold text-on-surface-variant">Starting point</p>
            <SegmentedControl
              id="margin-preset"
              aria-label="Margin preset"
              size="sm"
              value={String(activePreset)}
              onChange={v => setPreset(Number(v))}
              items={[
                { value: '-1', label: 'Custom' },
                ...MARGIN_PRESETS.map((p, i) => ({ value: String(i), label: p.label })),
              ]}
            />
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-on-surface">Page margins</p>
            <p className="text-[11px] text-on-surface-variant">drag the guides on the preview</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MarginField
              label="Top"
              spec={topSpec}
              value={mTop}
              error={errorFor(share ? 'shareMarginTop' : 'reportMarginTop')}
              onValue={v => marginPatch(share ? { shareMarginTop: v } : { reportMarginTop: v })}
            />
            <MarginField
              label="Bottom"
              spec={bottomSpec}
              value={mBottom}
              error={errorFor(share ? 'shareMarginBottom' : 'reportMarginBottom')}
              onValue={v =>
                marginPatch(share ? { shareMarginBottom: v } : { reportMarginBottom: v })
              }
            />
            <MarginField
              label="Left"
              spec={leftSpec}
              value={mLeft}
              error={errorFor(share ? 'shareMarginLeft' : 'reportMarginLeft')}
              onValue={setSideMargins}
            />
            <MarginField
              label="Right"
              spec={rightSpec}
              value={mRight}
              error={errorFor(share ? 'shareMarginRight' : 'reportMarginRight')}
              onValue={setRightMargin}
            />
          </div>
        </div>

        {!share && (
          <ToggleRow
            label="Link side margins"
            description="Keep the left and right margins equal."
            checked={linkSides}
            onChange={v => {
              setLinkSides(v);
              if (v && mLeft !== mRight)
                marginPatch({ reportMarginLeft: mRight, reportMarginRight: mRight });
            }}
          />
        )}
      </Disclosure>

      {/* ---------- Typography (print only — shared PDFs ride on artwork) ---------- */}
      {!share && (
        <Disclosure
          title="Typography"
          icon={<Type className="h-4 w-4" />}
          summary={`Title ${settings.reportTitleFontSize} pt · text ${settings.reportTableBodyFontSize ?? 10} pt`}
        >
          <SliderField
            spec={REPORT_FIELDS.reportTitleFontSize}
            value={safeNum(settings.reportTitleFontSize, 22)}
            onChange={v => onChange({ reportTitleFontSize: v })}
            onCommit={v => marginPatch({ reportTitleFontSize: v })}
          />
          <SliderField
            spec={REPORT_FIELDS.reportTableBodyFontSize}
            value={safeNum(settings.reportTableBodyFontSize ?? settings.tableBodyFontSize, 10)}
            onChange={setBodyFont}
            onCommit={setBodyFont}
            error={errorFor('reportTableBodyFontSize')}
          />
          <MoreRow label="More text settings">
            <SliderField
              spec={REPORT_FIELDS.patientInfoFontSize}
              value={safeNum(settings.patientInfoFontSize, 10)}
              onChange={v => onChange({ patientInfoFontSize: v })}
              onCommit={v => marginPatch({ patientInfoFontSize: v })}
            />
            <SliderField
              spec={REPORT_FIELDS.notesFontSize}
              value={safeNum(settings.notesFontSize, 9)}
              onChange={v => onChange({ notesFontSize: v })}
              onCommit={v => marginPatch({ notesFontSize: v })}
            />
            <SliderField
              spec={REPORT_FIELDS.footerFontSize}
              value={safeNum(settings.footerFontSize, 10)}
              onChange={v => onChange({ footerFontSize: v })}
              onCommit={v => marginPatch({ footerFontSize: v })}
            />
          </MoreRow>
        </Disclosure>
      )}

      {/* ---------- Tables ---------- */}
      <Disclosure
        title={share ? 'Shared report text' : 'Tables'}
        icon={<Table2 className="h-4 w-4" />}
        defaultOpen={false}
        summary={
          share
            ? undefined
            : `Header ${settings.tableHeaderFontSize} pt · row height ${settings.tableCellPadding} mm`
        }
      >
        {share ? (
          <SliderField
            spec={REPORT_FIELDS.shareTableBodyFontSize}
            value={safeNum(settings.shareTableBodyFontSize ?? settings.tableBodyFontSize, 10)}
            onChange={setBodyFont}
            onCommit={setBodyFont}
          />
        ) : (
          <>
            <SliderField
              spec={REPORT_FIELDS.tableHeaderFontSize}
              value={safeNum(settings.tableHeaderFontSize, 10)}
              onChange={v => onChange({ tableHeaderFontSize: v })}
              onCommit={v => marginPatch({ tableHeaderFontSize: v })}
            />
            <SliderField
              spec={REPORT_FIELDS.tableCellPadding}
              value={safeNum(settings.tableCellPadding, 1.4)}
              onChange={v => onChange({ tableCellPadding: v })}
              onCommit={v => marginPatch({ tableCellPadding: v })}
            />
            <MoreRow label="Spacing fine-tuning">
              <SliderField
                spec={REPORT_FIELDS.patientLineHeight}
                value={safeNum(settings.patientLineHeight, 5)}
                onChange={v => onChange({ patientLineHeight: v })}
                onCommit={v => marginPatch({ patientLineHeight: v })}
              />
              <SliderField
                spec={REPORT_FIELDS.reportSectionGap}
                value={safeNum(settings.reportSectionGap, 6)}
                onChange={v => onChange({ reportSectionGap: v })}
                onCommit={v => marginPatch({ reportSectionGap: v })}
              />
            </MoreRow>
          </>
        )}
      </Disclosure>

      {/* ---------- Share artwork ---------- */}
      {share && (
        <Disclosure
          title="Background artwork"
          icon={<ImageIcon className="h-4 w-4" />}
          summary={settings.sharingTemplateImage ? 'Custom image' : 'Built-in PathoMitra template'}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-label="Upload share template background image"
            onChange={e => handleImageFile(e.target.files?.[0])}
          />
          {settings.sharingTemplateImage ? (
            <div className="flex items-center gap-4">
              <img
                src={settings.sharingTemplateImage}
                alt="Uploaded share template background"
                className="h-28 w-20 rounded-xl border border-outline-variant/40 object-cover shadow-card"
              />
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border border-outline-variant/50 px-3 py-2 text-xs font-bold text-on-surface transition-colors hover:border-primary hover:text-primary"
                >
                  Replace image
                </button>
                <button
                  type="button"
                  onClick={() => marginPatch({ sharingTemplateImage: '' })}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-error transition-colors hover:bg-error-container"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-2xl border-2 border-dashed border-outline-variant/50 bg-surface-container-lowest px-4 py-6 text-center transition-colors hover:border-primary/60"
            >
              <Upload className="h-5 w-5 text-on-surface-variant" aria-hidden="true" />
              <span className="text-sm font-bold text-on-surface">Upload A4 background</span>
              <span className="text-xs text-on-surface-variant">
                PNG or JPG up to 4 MB. Falls back to the built-in PathoMitra artwork.
              </span>
            </button>
          )}
          {imageError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-error">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {imageError}
            </p>
          )}
        </Disclosure>
      )}
    </div>
  );
}
