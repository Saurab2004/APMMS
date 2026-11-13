// Tiny CSV writer with protection against spreadsheet formula injection.

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  // A leading = + - @ can run as a formula when opened in Excel. Neutralise it.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** columns: [{ header: 'Title', value: (row) => row.title }] */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','));
  return `﻿${[head, ...lines].join('\r\n')}\r\n`;
}
