import PDFDocument from 'pdfkit';

const BLUE = '#2563EB';
const GREY = '#64748B';

/** Starts a PDF download response. Remember to call doc.end() when you are done. */
export function startPdf(res, filename, info = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: info.title || filename, Author: 'APMMS' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  doc.pipe(res);
  return doc;
}

export function header(doc, title, subtitle) {
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(10).text('APMMS - Academic Project Management and Monitoring System');
  doc.moveDown(0.5).fillColor('#0F172A').fontSize(20).text(title);
  if (subtitle) doc.moveDown(0.2).font('Helvetica').fontSize(11).fillColor(GREY).text(subtitle);
  doc.moveTo(50, doc.y + 8).lineTo(545, doc.y + 8).strokeColor('#E2E8F0').stroke();
  doc.moveDown(1.2).fillColor('#0F172A');
}

export const section = (doc, text) => {
  ensureSpace(doc, 60);
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor('#0F172A').text(text).moveDown(0.3);
};

export function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - 70) doc.addPage();
}

export function keyValues(doc, rows) {
  doc.font('Helvetica').fontSize(10);
  for (const [k, v] of rows) {
    ensureSpace(doc, 18);
    const y = doc.y;
    doc.fillColor(GREY).text(k, 50, y, { width: 130 });
    doc.fillColor('#0F172A').text(String(v ?? '-'), 185, y, { width: 360 });
    doc.y = Math.max(doc.y, y + 14);
  }
}

/** Simple table: columns [{ label, width, align }], rows are arrays of strings. */
export function table(doc, columns, rows) {
  const draw = (cells, bold) => {
    ensureSpace(doc, 22);
    const y = doc.y;
    let x = 50;
    let h = 14;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(bold ? '#0F172A' : '#1E293B');
    cells.forEach((c, i) => { const hh = doc.heightOfString(String(c ?? ''), { width: columns[i].width - 6 }); h = Math.max(h, hh); });
    if (bold) doc.rect(50, y - 2, columns.reduce((s, c) => s + c.width, 0), h + 6).fill('#F1F5F9').fillColor('#0F172A');
    cells.forEach((c, i) => { doc.text(String(c ?? ''), x + 3, y, { width: columns[i].width - 6, align: columns[i].align || 'left' }); x += columns[i].width; });
    doc.y = y + h + 6;
    doc.moveTo(50, doc.y - 2).lineTo(50 + columns.reduce((s, c) => s + c.width, 0), doc.y - 2).strokeColor('#E2E8F0').stroke();
  };
  draw(columns.map((c) => c.label), true);
  rows.forEach((r) => draw(r, false));
}

export function footer(doc, text) {
  const range = doc.bufferedPageRange ? doc.bufferedPageRange() : null;
  void range;
  doc.moveDown(2).font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text(text, 50, doc.y, { width: 495 });
}
