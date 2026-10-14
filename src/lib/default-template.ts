/**
 * Generates an elegant, high-fidelity default sharing template background for reports.
 * Drawn entirely via HTML5 Canvas to produce a crisp, high-resolution A4-proportioned image.
 * This ensures that a gorgeous, professional default layout is available on all devices out-of-the-box.
 *
 * The footer states only what the build can substantiate. It used to print
 * "NABL ACCREDITED LAB • ISO 9001:2015 CERTIFIED REPORT" and "This document is
 * electronically verified. No physical signature required.", over a shield
 * watermark with "authenticity rings" — while the app has no signing service,
 * no verification endpoint and writes an empty `signature` column. Accreditation
 * now comes from the operator's attested settings and prints nothing at all
 * unless they have asserted it; see lib/report-compliance.ts.
 */
import { buildReportLegalLines, type ReportLegalInput } from './report-compliance';

/** Greedy word wrap for canvas text, which has no native multiline support. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Ellipsise rather than silently dropping the tail of a legal sentence.
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    const overflow = words.join(' ').slice(lines.join(' ').length).trim();
    if (overflow) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s?\S*$/, '')}…`;
  }
  return lines;
}

export function generateDefaultTemplateImage(
  labName = 'Laboratory',
  legalInput: ReportLegalInput = {},
): string {
  // Use high-resolution coordinates for sharp text and lines on A4 paper printing.
  const width = 1200;
  const height = 1697; // Ratio 1 : 1.414 (standard ISO A4)

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return '';
  }

  // 1. Solid Pure White Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 2. Executive Header Band (Pacific Blue ramp matching the web palette)
  const topBarHeight = 45;
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#08477e'); // Deep navy
  gradient.addColorStop(0.55, '#0a5ea6'); // Pacific blue
  gradient.addColorStop(1, '#0e8c7f'); // Clinical teal

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, topBarHeight);

  // Hairline accent divider below the band
  ctx.fillStyle = '#12b8a6'; // Refined teal accent
  ctx.fillRect(0, topBarHeight, width, 3);

  // 3. Molecular node lattice in the top-right (clinical network motif)
  ctx.strokeStyle = 'rgba(18, 184, 166, 0.18)';
  ctx.lineWidth = 1.5;

  const drawNode = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  const nodes: [number, number][] = [
    [1100, 84],
    [1146, 110],
    [1054, 110],
    [1100, 136],
  ];
  nodes.forEach(([x, y]) => drawNode(x, y, 5));
  ctx.beginPath();
  ctx.moveTo(1100, 84);
  ctx.lineTo(1054, 110);
  ctx.lineTo(1100, 136);
  ctx.lineTo(1146, 110);
  ctx.closePath();
  ctx.moveTo(1054, 110);
  ctx.lineTo(1146, 110);
  ctx.stroke();

  // 4. Double-lined Outer Frame Border (Sophisticated styling)
  // Heights leave the bottom clear of the enlarged legal footer ribbon below.
  ctx.strokeStyle = 'rgba(8, 71, 126, 0.10)';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(24, 65, width - 48, height - 190);

  ctx.strokeStyle = 'rgba(8, 71, 126, 0.04)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(32, 73, width - 64, height - 206);

  // 5. Soft diagonal signature wash behind the content area (decorative only).
  // Formerly a shield with a medical cross and three "concentric authenticity
  // rings" printed under the findings — visual language that implies the
  // document was checked by someone. It was not, so it is gone.
  const centerX = width / 2;
  const centerY = height / 2;
  const wash = ctx.createRadialGradient(centerX, centerY, 40, centerX, centerY, 420);
  wash.addColorStop(0, 'rgba(8, 71, 126, 0.020)');
  wash.addColorStop(1, 'rgba(8, 71, 126, 0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);

  // 6. Premium Decorative Side Accents
  // Left side color-ribbon accent (clinical gradient vertical bar)
  const accentGradient = ctx.createLinearGradient(0, 150, 0, 1500);
  accentGradient.addColorStop(0, 'rgba(8, 71, 126, 0.05)');
  accentGradient.addColorStop(0.5, 'rgba(18, 184, 166, 0.14)');
  accentGradient.addColorStop(1, 'rgba(8, 71, 126, 0.05)');

  ctx.fillStyle = accentGradient;
  ctx.fillRect(8, 150, 6, height - 300);

  // Right side color-ribbon accent
  ctx.fillRect(width - 14, 150, 6, height - 300);

  // 7. Footer — lab identity, attested credentials, issuance statement.
  const legal = buildReportLegalLines(legalInput);
  const footerStart = height - 104;

  // Teal accent hairline above footer
  ctx.fillStyle = '#12b8a6';
  ctx.fillRect(0, footerStart, width, 3);

  // Deep navy bottom ribbon for footer metadata
  const footGrad = ctx.createLinearGradient(0, 0, width, 0);
  footGrad.addColorStop(0, '#08477e');
  footGrad.addColorStop(1, '#0a5ea6');
  ctx.fillStyle = footGrad;
  ctx.fillRect(0, footerStart + 3, width, 101);

  const left = 40;
  const right = width - 40;

  // Issuing laboratory — the operator's own lab, never the app vendor.
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Inter", "Helvetica", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText((labName || 'Laboratory').toUpperCase(), left, footerStart + 28);

  // Document type on the right, where the fake accreditation claim used to sit.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.font = 'bold 10px "JetBrains Mono", "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(legal.tagline.toUpperCase(), right, footerStart + 28);

  // Accreditation / registration: printed only because the operator asserted
  // it and accepted responsibility for it in Settings → Legal footer.
  const credential = legal.accreditation || legal.licence;
  if (credential) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '10px "Inter", "Helvetica", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(credential, left, footerStart + 47);
  }

  // How the report came to exist — factual, and explicit that nothing outside
  // the device can confirm it.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = 'italic 9.5px "Inter", "Helvetica", sans-serif';
  ctx.textAlign = 'left';
  const signerLines = wrapText(ctx, legal.signer, width - 80, 2);
  signerLines.forEach((line, i) => {
    ctx.fillText(line, left, footerStart + 67 + i * 14);
  });

  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.font = '9px "Inter", "Helvetica", sans-serif';
  ctx.fillText(legal.disclaimer, left, footerStart + 96);

  return canvas.toDataURL('image/png');
}
