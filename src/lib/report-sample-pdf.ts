/**
 * Sample report PDF — renders the *current* (possibly unsaved) layout settings
 * through jsPDF with sample content, so "Preview PDF" in Settings shows a real
 * PDF export instead of an HTML approximation.
 *
 * Shares src/lib/report-layout.ts with the live A4 preview and reads the same
 * resolved numbers (margins, pt sizes, mm gaps, column split, palette) that the
 * patient-report generator in ReportsPage consumes, keeping all three in sync.
 */
import { THEME_OPTIONS } from './theme';
import type { LabSettings } from './settings';
import { previewPdf } from './native-print';
import { A4, buildReportPalette, getColumnWidths, resolveReportLayout } from './report-layout';

const SAMPLE_ROWS: [string, string, string, string, 'up' | 'down' | 'normal'][] = [
  ['Hemoglobin', '14.2', 'g/dL', '13.0 – 17.0', 'normal'],
  ['WBC Count', '12,500', '/cumm', '4,000 – 11,000', 'up'],
  ['Platelet Count', '1.5', 'lakhs', '1.5 – 4.0', 'normal'],
  ['RBC Count', '3.9', 'mill/cumm', '4.5 – 5.5', 'down'],
  ['PCV / Haematocrit', '42', '%', '40 – 50', 'normal'],
];

const rgbaStr = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})` as const;

/**
 * Build the sample PDF and show it to the user.
 *
 * Opening is delegated to `previewPdf` because the sample is generated in the
 * same places the real report is: the APK WebView has no PDF viewer and swallows
 * `window.open`, so only the native-aware helper can land it on screen (the
 * device's PDF viewer app there, a browser tab here). Pass the preview panel's
 * mode so the PDF is drawn with the margins / template currently on screen.
 *
 * Returns a message when the preview could not open in a tab, else null.
 */
export async function openSampleReportPdf(
  settings: LabSettings,
  mode: 'print' | 'share' = 'print',
): Promise<string | null> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const L = resolveReportLayout(settings, mode);
  const { margins: m, printable } = L;
  if (!printable.valid)
    return 'Margins leave no printable area — fix the highlighted values first.';

  const themeHex = (THEME_OPTIONS.find(t => t.id === L.themeId) || THEME_OPTIONS[0]).previewColor;
  const P = buildReportPalette(themeHex, L.template);
  const legacy = L.template === 'blank';
  const serifFont = L.template === 'classic' ? ('times' as const) : ('helvetica' as const);

  const filename = `PathoMitra — sample report (${mode}).pdf`;
  const doc = new jsPDF();
  doc.setProperties({ title: filename });

  // Share mode carries the uploaded full-bleed background, like the live preview
  // and the real share PDF do. A malformed data URI must not eat the preview.
  if (mode === 'share' && settings.sharingTemplateImage) {
    try {
      const uri = settings.sharingTemplateImage;
      const format = uri.substring(uri.indexOf('/') + 1, uri.indexOf(';')).toUpperCase();
      doc.addImage(uri, format === 'PNG' ? 'PNG' : 'JPEG', 0, 0, A4.widthMm, A4.heightMm);
    } catch (err) {
      console.error('Failed to draw sharing template image', err);
    }
  }

  // ---- Header -------------------------------------------------------------
  let y = m.top;
  const right = A4.widthMm - m.right;
  if (L.template === 'minimalist') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(L.titleFont - 3);
    doc.setTextColor(rgbaStr(P.INK));
    doc.text(L.labName, m.left, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(Math.max(6.5, L.titleFont - 11));
    doc.setTextColor(rgbaStr(P.INK_SOFT));
    doc.text('D I G I T A L   P A T H O L O G Y   R E P O R T', m.left, y + 5);
    doc.setDrawColor(rgbaStr(P.HAIRLINE));
    doc.setLineWidth(0.2);
    doc.line(m.left, y + 8.5, right, y + 8.5);
    y += L.sectionGapMm + 4;
  } else if (L.template === 'classic') {
    doc.setDrawColor(rgbaStr(P.BLACK));
    doc.setLineWidth(0.9);
    doc.line(m.left - 5, y - 3, right + 5, y - 3);
    doc.setLineWidth(0.2);
    doc.line(m.left - 5, y - 1.4, right + 5, y - 1.4);
    doc.setFont('times', 'bold');
    doc.setFontSize(L.titleFont + 2);
    doc.setTextColor(0);
    doc.text(L.labName.toUpperCase(), 105, y + 5.5, { align: 'center' });
    doc.setFont('times', 'italic');
    doc.setFontSize(Math.max(8, L.titleFont - 8));
    doc.setTextColor(60, 60, 60);
    doc.text(L.legal.tagline, 105, y + 11, { align: 'center' });
    doc.setLineWidth(0.2);
    doc.line(m.left - 5, y + 13.5, right + 5, y + 13.5);
    doc.setLineWidth(0.9);
    doc.line(m.left - 5, y + 15.1, right + 5, y + 15.1);
    y += L.sectionGapMm * 2 + 9;
  } else if (L.template === 'modern') {
    doc.setFillColor(rgbaStr(P.BRAND));
    doc.roundedRect(m.left, y - 4.2, 1.7, 10.5, 0.85, 0.85, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(L.titleFont);
    doc.setTextColor(rgbaStr(P.BRAND_DARK));
    doc.text(L.labName, m.left + 4.6, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(Math.max(6.5, L.titleFont - 11));
    doc.setTextColor(rgbaStr(P.INK_SOFT));
    doc.text('DIGITAL PATHOLOGY REPORT', m.left + 4.8, y + 5.2);
    doc.setFontSize(8);
    doc.text('Report No. A1B2C3D4', right, y - 1, { align: 'right' });
    doc.setTextColor(rgbaStr(P.BRAND));
    doc.setFont('helvetica', 'bold');
    doc.text('FINAL', right, y + 5.2, { align: 'right' });
    doc.setDrawColor(rgbaStr(P.HAIRLINE));
    doc.setLineWidth(0.3);
    doc.line(m.left, y + 9, right, y + 9);
    y += L.sectionGapMm * 1.5 + 6;
  } else {
    y += L.sectionGapMm;
  }

  // ---- Patient block ------------------------------------------------------
  const startY = y + 4;
  const lh = L.patientLineHeightMm;
  const boxTop = startY - 12;
  const boxHeight = lh * 2 + 15;

  if (L.template === 'modern') {
    doc.setFillColor(rgbaStr(P.BRAND_TINT));
    doc.setDrawColor(rgbaStr(P.BRAND_TINT2));
    doc.setLineWidth(0.25);
    doc.roundedRect(m.left - 5, boxTop, printable.width + 10, boxHeight, 2.6, 2.6, 'FD');
  } else if (L.template === 'classic') {
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(m.left - 5, boxTop, printable.width + 10, boxHeight, 'S');
    doc.setLineWidth(0.15);
    doc.rect(m.left - 3.8, boxTop + 1.2, printable.width + 7.6, boxHeight - 2.4, 'S');
  } else if (L.template === 'minimalist') {
    doc.setDrawColor(rgbaStr(P.HAIRLINE));
    doc.setLineWidth(0.2);
    doc.line(m.left - 5, boxTop + boxHeight + 1, right + 5, boxTop + boxHeight + 1);
  }

  const labelCol = legacy ? P.BLACK : P.INK_SOFT;
  const valueCol = legacy ? P.BLACK : P.INK;
  const drawLabel = () => {
    doc.setFont(serifFont === 'times' ? 'times' : 'helvetica', 'bold');
    doc.setFontSize(L.patientFont);
    doc.setTextColor(rgbaStr(labelCol));
    if (!legacy) doc.setCharSpace(0.25);
  };
  const drawValue = () => {
    doc.setFont(serifFont === 'times' ? 'times' : 'helvetica', 'normal');
    doc.setFontSize(L.patientFont);
    doc.setTextColor(rgbaStr(valueCol));
    doc.setCharSpace(0);
  };

  drawLabel();
  doc.text('Patient Name', m.left, startY);
  doc.text('Ref By', m.left, startY + lh);
  doc.text('Patient ID', m.left, startY + lh * 2);
  drawValue();
  doc.text(': John Doe', m.left + 27, startY);
  doc.text(': Dr. A. Smith', m.left + 27, startY + lh);
  doc.text(': P-0A1B2C3D', m.left + 27, startY + lh * 2);
  drawLabel();
  doc.text('Age', m.left + 97, startY);
  doc.text('Sex', m.left + 97, startY + lh);
  doc.text('Reported on', m.left + 97, startY + lh * 2);
  drawValue();
  doc.text(': 35 Years', m.left + 120, startY);
  doc.text(': Male', m.left + 120, startY + lh);
  doc.text(': 12-09-2026 10:42 AM', m.left + 120, startY + lh * 2);

  // ---- Column header band -------------------------------------------------
  const [c0, c1, c2, c3] = getColumnWidths(printable.width);
  const headerY = startY + lh * 3 + L.sectionGapMm + 5;
  if (!legacy && L.template !== 'classic') {
    if (L.template === 'modern') {
      doc.setFillColor(rgbaStr(P.BRAND_DARK));
      doc.roundedRect(m.left - 5, headerY - 6.2, printable.width + 10, 9.5, 1.6, 1.6, 'F');
      doc.setTextColor(255, 255, 255);
    } else {
      doc.setDrawColor(rgbaStr(P.HAIRLINE));
      doc.setLineWidth(0.2);
      doc.line(m.left, headerY - 5, right, headerY - 5);
      doc.setTextColor(rgbaStr(P.INK_SOFT));
    }
    doc.setFontSize(L.tableHeaderFont);
    doc.setFont('helvetica', 'bold');
    doc.setCharSpace(0.4);
  } else {
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(m.left, headerY - 5, right, headerY - 5);
    doc.setFontSize(L.tableHeaderFont);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
  }
  doc.text('TEST DESCRIPTION', m.left + 1.5, headerY);
  doc.text('RESULT', m.left + c0 + 1.5, headerY);
  doc.text('UNITS', m.left + c0 + c1 + 1.5, headerY);
  doc.text('REFERENCE RANGE', m.left + c0 + c1 + c2 + 1.5, headerY);
  doc.setCharSpace(0);

  // ---- Results table ------------------------------------------------------
  autoTable(doc, {
    startY: headerY + 3,
    margin: { top: headerY + 3, left: m.left, right: m.right, bottom: m.bottom },
    theme: !legacy && L.template === 'classic' ? 'grid' : 'plain',
    showHead: false,
    body: [
      [
        {
          content: 'HAEMATOLOGY',
          colSpan: 4,
          styles: {
            fontStyle: 'bold',
            halign: L.template === 'modern' ? 'left' : 'center',
            fillColor: L.template === 'modern' ? P.BRAND_SOFT : (false as never),
            textColor: legacy
              ? P.BLACK
              : L.template === 'modern'
                ? P.BRAND_DARK
                : L.template === 'classic'
                  ? P.BLACK
                  : P.INK_SOFT,
            cellPadding: {
              top: Math.max(2, L.tableCellPaddingMm * 2.5),
              bottom: Math.max(2, L.tableCellPaddingMm * 2.5),
              left: 2,
            },
          },
        },
      ],
      ...SAMPLE_ROWS.map(r => [
        r[0],
        {
          content: r[1] + (r[4] === 'up' ? ' ↑' : r[4] === 'down' ? ' ↓' : ''),
          styles:
            r[4] !== 'normal'
              ? {
                  fontStyle: 'bold' as const,
                  textColor: r[4] === 'up' ? ([176, 42, 58] as [number, number, number]) : P.BRAND,
                }
              : {},
        },
        r[2],
        r[3],
      ]),
    ],
    styles: {
      cellPadding: L.tableCellPaddingMm,
      fontSize: L.tableBodyFont,
      ...(legacy
        ? { textColor: [0, 0, 0] as [number, number, number] }
        : { font: 'helvetica', textColor: P.INK }),
    },
    columnStyles: {
      0: { cellWidth: c0 },
      1: { cellWidth: c1 },
      2: { cellWidth: c2 },
      3: { cellWidth: c3 },
    },
  });

  // ---- Notes, footer, page number ----------------------------------------
  let finalY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY +
    Math.max(L.sectionGapMm, 8);
  doc.setDrawColor(rgbaStr(P.HAIRLINE));
  doc.setLineWidth(legacy ? 0.5 : 0.2);
  doc.line(m.left, finalY, right, finalY);
  finalY += 8;
  doc.setFontSize(L.notesFont);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(rgbaStr(legacy ? P.BLACK : P.BRAND_DARK));
  doc.text('NOTE —', m.left, finalY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(rgbaStr(legacy ? P.BLACK : P.INK));
  finalY += 4;
  const note = doc.splitTextToSize(
    'Sample content — raised WBC count with left shift is consistent with an acute bacterial infection. Correlate with culture & sensitivity.',
    printable.width,
  );
  doc.text(note, m.left, finalY);
  finalY += note.length * 4.5 + 6;

  // Credential / issuance / disclaimer lines, taken from the same resolved
  // layout the live preview and the patient PDF use. The sample previously
  // printed "Certified Diagnostic Pathology Laboratory" unconditionally, which
  // is a claim about the laboratory rather than a layout setting.
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(Math.max(7, L.footerFont - 2));
  doc.setTextColor(rgbaStr(P.INK_SOFT));
  const closing = [
    L.legal.accreditation,
    L.legal.licence,
    L.legal.signer,
    L.legal.disclaimer,
  ].filter(Boolean);
  closing.forEach((line, i) => {
    doc.text(line, m.left, finalY + i * 4.2);
  });
  finalY += closing.length * 4.2 + 2;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(L.footerFont);
  doc.setTextColor(rgbaStr(legacy ? P.BLACK : P.INK_SOFT));
  doc.text(legacy ? '*** End of Report ***' : '— End of Report —', 105, finalY, {
    align: 'center',
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(Math.max(8, L.footerFont - 2));
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${pages}`, 105, A4.heightMm - 11, { align: 'center' });
  }

  return previewPdf(doc, filename);
}
